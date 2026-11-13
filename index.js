import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'agent-plan-entry'
export const inject = ['tools', 'agentPresets', 'systemPrompt']

const ENTER_PLAN_MODE = 'enter_plan_mode'
const PLAN_ENTRY_PROMPT = 'Assess task complexity before taking action. Unless a task is trivial, localized to a single file, and fully specified, you MUST call `enter_plan_mode` first—especially for multi-file/module changes, architectural decisions, ambiguous requirements, or coordinated updates. While in plan mode, perform strictly read-only exploration without mutating any files or system state. Once ready, call `exit_plan_mode` with a comprehensive implementation plan and wait for explicit user approval before executing. When in doubt, always default to planning first.'

function planModeFor(ctx, agent) {
  return ctx.agentPresets.serviceFor(agent, 'planMode')
}

function planModeState(ctx, agent) {
  const planMode = planModeFor(ctx, agent)
  if (planMode === undefined) return undefined
  return { planMode, state: planMode.get(agent) }
}

function enterPlanModeTool(ctx) {
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
          }]
        }
        if (value.active) {
          return [{
            type: 'text',
            text: 'Plan mode is already active. Explore and design before calling exit_plan_mode with the complete plan.',
          }]
        }
        return [{ type: 'text', text: 'Plan mode is not active.' }]
      },
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()

      const agent = exec.agent
      if (agent === undefined) {
        throw new Error(`${ENTER_PLAN_MODE} requires an agent context`)
      }
      if (args.reason.trim() === '') {
        throw new Error(`${ENTER_PLAN_MODE} requires a non-empty reason`)
      }

      const entry = planModeState(ctx, agent)
      if (entry === undefined) {
        throw new Error('Plan mode is unavailable in the current agent preset')
      }

      entry.planMode.set(agent, true)
      const state = entry.planMode.get(agent)
      if (!state.active && state.pending !== true) {
        throw new Error('Plan mode did not enter an active or pending state')
      }

      return {
        active: state.active,
        pending: state.pending === true,
      }
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
  })
}

export function apply(ctx) {
  ctx.effect(() => {
    const disposeTool = ctx.tools.register(enterPlanModeTool(ctx), {
      when: ({ agent }) => planModeFor(ctx, agent) !== undefined,
    })
    const disposePrompt = ctx.systemPrompt.section({
      name: 'agent-plan-entry:complexity-policy',
      order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 1,
      text: (context) => {
        if (context.agent === undefined) return ''
        const entry = planModeState(ctx, context.agent)
        if (entry === undefined) return ''
        const selected = entry.state.pending === undefined ? entry.state.active : entry.state.pending
        return selected ? '' : PLAN_ENTRY_PROMPT
      },
      interpolate: false,
    })

    return () => {
      disposePrompt()
      disposeTool()
    }
  }, 'agent-plan-entry: register plan entry prompt and tool')
}
