import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CLEARED_GUIDANCE_SUMMARY, CLEARED_GUIDANCE_TEXT, renderGuidance, sameSections, } from "./guidance.js";
export const name = 'agent-plan-entry';
export const inject = ['tools', 'agentPresets', 'systemPrompt'];
export const Config = z.object({
    relocatedSections: z.array(z.string()).default(['plan:policy'])
        .description('System-prompt sections delivered as trailing context instead of the prompt head.'),
    noticeWhenCleared: z.boolean().default(true)
        .description('Deliver a trailing notice when relocated guidance stops applying.'),
});
const ENTER_PLAN_MODE = 'enter_plan_mode';
const PROMPT_SECTION = 'agent-plan-entry:complexity-policy';
const PLAN_POLICY_SECTION = 'plan:policy';
const PLAN_ENTRY_PROMPT = 'Assess task complexity before taking action. Unless a task is trivial, localized to a single file, and fully specified, you MUST call `enter_plan_mode` first—especially for multi-file/module changes, architectural decisions, ambiguous requirements, or coordinated updates. While in plan mode, perform strictly read-only exploration without mutating any files or system state. Once ready, call `exit_plan_mode` with a comprehensive implementation plan and wait for explicit user approval before executing. When in doubt, always default to planning first.';
function planModeFor(ctx, agent) {
    return ctx.agentPresets.serviceFor(agent, 'planMode');
}
function planModeEntry(ctx, agent) {
    const planMode = planModeFor(ctx, agent);
    if (planMode === undefined)
        return undefined;
    return { planMode, state: planMode.get(agent) };
}
function selectedActive(state) {
    return state.pending ?? state.active;
}
/** Sections the current step relocated out of the prompt head, keyed by Agent. */
const relocatedByAgent = new WeakMap();
/**
 * Render one section exactly as the head would have carried it.
 * @param section - assembled section before interpolation.
 * @param variables - assembly variables available to the section.
 * @returns the model-visible section text.
 */
function visibleSectionText(section, variables) {
    return renderPrompt({ sections: [section], contexts: [], variables, tools: [] });
}
/**
 * Read the guidance this plugin delivered before the current step.
 * Scans the live surface backwards, so compaction, resume, and fork rebuild the
 * comparison from durable messages instead of process-local state.
 * @param agent - agent whose session is scanned.
 * @returns the delivered sections, or an empty list when the last delivery was a cleared notice.
 */
function deliveredSections(agent) {
    for (const seq of agent.session.surface.nodes.toReversed()) {
        const event = agent.session.eventAt(seq);
        if (event?.type !== 'user/message')
            continue;
        const source = event.data.source;
        if (source.kind !== 'agent-plan-entry')
            continue;
        // A snapshot carries its sections; a notice means guidance was retired.
        return 'sections' in source && Array.isArray(source.sections) ? source.sections : [];
    }
    return [];
}
function guidanceMessage(sections) {
    return createUserMessage({
        content: [{ type: 'text', text: renderGuidance(sections) }],
        source: { kind: name, form: 'snapshot', sections },
    });
}
function clearedGuidanceMessage() {
    return createUserMessage({
        content: [{ type: 'text', text: CLEARED_GUIDANCE_TEXT }],
        source: { kind: name, form: 'notice', summary: CLEARED_GUIDANCE_SUMMARY },
    });
}
function createEnterPlanModeTool(ctx) {
    return defineTool({
        name: ENTER_PLAN_MODE,
        description: 'Enter plan mode before implementation when task complexity or risk makes an approved plan valuable. Use it for cross-file or architectural changes, ambiguous requirements, non-obvious sequencing, or work with substantial consequences. Do not use it for simple questions or small, fully specified edits. Call it alone before changing files. Plan mode becomes active on the next step; explore read-only, then present the complete plan with exit_plan_mode. If plan mode is already active, this tool returns that state without changing it.',
        parameters: {
            reason: {
                type: 'string',
                required: true,
                description: 'Concrete complexity that warrants planning, naming the scope, uncertainty, or risk that makes direct execution inappropriate.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    active: { type: 'boolean', required: true },
                    pending: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => {
                if (value.pending) {
                    return [{
                            type: 'text',
                            text: 'Plan mode will be active from the next step. Treat the rest of this step as read-only; next, explore the task and call exit_plan_mode with the complete plan.',
                        }];
                }
                if (value.active) {
                    return [{
                            type: 'text',
                            text: 'Plan mode is already active. Explore and design before calling exit_plan_mode with the complete plan.',
                        }];
                }
                return [{ type: 'text', text: 'Plan mode is not active.' }];
            },
        },
        async execute(args, exec) {
            exec.signal.throwIfAborted();
            const agent = exec.agent;
            if (agent === undefined) {
                throw new Error(`${ENTER_PLAN_MODE} requires an agent context`);
            }
            if (args.reason.trim() === '') {
                throw new Error(`${ENTER_PLAN_MODE} requires a non-empty reason`);
            }
            const entry = planModeEntry(ctx, agent);
            if (entry === undefined) {
                throw new Error('Plan mode is unavailable in the current agent preset');
            }
            entry.planMode.set(agent, true);
            const state = entry.planMode.get(agent);
            if (!state.active && state.pending !== true) {
                throw new Error('Plan mode did not enter an active or pending state');
            }
            return {
                active: state.active,
                pending: state.pending === true,
            };
        },
        presentCall: (args) => ({
            card: 'generic',
            title: 'Enter plan mode',
            kind: 'other',
            content: [{ type: 'text', text: args.reason }],
        }),
        presentResult: (_args, result) => ({
            card: 'generic',
            title: 'Plan mode',
            content: result.content,
        }),
    });
}
/**
 * Move the configured sections out of the prompt head and remember them for this step.
 * The step's request then carries a byte-identical prompt head; delivery follows on the tail.
 * @param ctx - plugin context owning the assembly listener.
 * @param relocated - section names delivered as trailing context.
 */
function registerRelocation(ctx, relocated) {
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
        const result = await next();
        const agent = context.agent;
        // Diagnostic assemblies carry no step signal; they must not clear the step's stash.
        if (agent === undefined || context.signal === undefined)
            return result;
        const kept = [];
        const moved = [];
        for (const section of result.sections) {
            if (!relocated.has(section.name)) {
                kept.push(section);
                continue;
            }
            let text;
            try {
                text = visibleSectionText(section, result.variables);
            }
            catch (error) {
                ctx.logger.warn('agent-plan-entry: cannot render relocated section %s: %o', section.name, error);
                return result;
            }
            if (text.length > 0)
                moved.push({ name: section.name, text });
        }
        if (moved.length === 0 && kept.length === result.sections.length) {
            relocatedByAgent.set(agent, []);
            return result;
        }
        relocatedByAgent.set(agent, moved);
        if (moved.length === 0 && relocated.has(PLAN_POLICY_SECTION)) {
            warnWhenPlanPolicyMissing(ctx, agent, result);
        }
        return { ...result, sections: kept };
    });
}
/**
 * Report the one composition this relocation cannot serve: a complete-section
 * persona replaces the assembled prompt after this waterfall, so plan guidance
 * never reaches the model.
 * @param ctx - plugin context for the warning channel.
 * @param agent - agent being assembled.
 * @param assembly - assembly whose sections were inspected.
 */
function warnWhenPlanPolicyMissing(ctx, agent, assembly) {
    try {
        const entry = planModeEntry(ctx, agent);
        if (entry === undefined || !selectedActive(entry.state))
            return;
        if (assembly.sections.some(section => section.name === PLAN_POLICY_SECTION))
            return;
        ctx.logger.warn('agent-plan-entry: plan mode is active but no %s section was assembled; the plan guidance cannot be relocated for this agent', PLAN_POLICY_SECTION);
    }
    catch (error) {
        ctx.logger.warn('agent-plan-entry: cannot inspect plan state while checking relocated guidance: %o', error);
    }
}
/**
 * Deliver the step's relocated sections as one trailing context message.
 * A failure here must never block the step, so it reports and returns the decision unchanged.
 * @param ctx - plugin context owning the pre-step listener.
 * @param active - whether a cleared notice is delivered.
 */
function registerDelivery(ctx, noticeWhenCleared) {
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || signal.aborted)
            return decision;
        try {
            const desired = relocatedByAgent.get(agent) ?? [];
            const delivered = deliveredSections(agent);
            if (sameSections(desired, delivered))
                return decision;
            if (desired.length === 0 && (!noticeWhenCleared || delivered.length === 0))
                return decision;
            const message = desired.length === 0 ? clearedGuidanceMessage() : guidanceMessage(desired);
            return { ...decision, messages: [...decision.messages, message] };
        }
        catch (error) {
            ctx.logger.warn('agent-plan-entry: failed to deliver relocated guidance at step start: %o', error);
            return decision;
        }
    }, { prepend: true });
}
export function apply(ctx, config) {
    const relocated = new Set([...config.relocatedSections, PROMPT_SECTION]);
    ctx.effect(() => {
        const disposeTool = ctx.tools.register(createEnterPlanModeTool(ctx), {
            when: ({ agent }) => planModeFor(ctx, agent) !== undefined,
        });
        const disposePrompt = ctx.systemPrompt.section({
            name: PROMPT_SECTION,
            order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 1,
            text: (context) => {
                const agent = context.agent;
                if (agent === undefined)
                    return '';
                const entry = planModeEntry(ctx, agent);
                if (entry === undefined)
                    return '';
                return selectedActive(entry.state) ? '' : PLAN_ENTRY_PROMPT;
            },
            interpolate: false,
        });
        return () => {
            disposePrompt();
            disposeTool();
        };
    }, 'agent-plan-entry: register plan entry tool and prompt section');
    registerRelocation(ctx, relocated);
    registerDelivery(ctx, config.noticeWhenCleared);
}
