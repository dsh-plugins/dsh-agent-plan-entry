import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import type { ContextFormed } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'agent-plan-entry': {
            kind: 'agent-plan-entry';
        } & ContextFormed;
    }
}
export declare const name = "@dsh-plugin/dsh-agent-plan-entry";
export declare const inject: string[];
/** Plan-entry policy and plan-guidance relocation. */
export interface Config {
    /** Prompt sections delivered at the conversation tail instead of the system prompt. */
    relocatedSections: string[];
    /** Deliver a notice when relocated guidance stops applying. */
    noticeWhenCleared: boolean;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
