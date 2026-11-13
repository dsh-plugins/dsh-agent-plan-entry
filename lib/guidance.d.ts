/**
 * Pure helpers for delivering relocated prompt sections as a trailing context
 * snapshot. No Harness imports: the plugin's tests run these functions with the
 * Node type-stripping loader, before any build.
 *
 * @module agent-plan-entry/guidance
 */
/** One section moved out of the system prompt, with its model-visible text. */
export interface GuidanceSection {
    /** Registered prompt-section name the text came from. */
    readonly name: string;
    /** Rendered section text, exactly as the head would have carried it. */
    readonly text: string;
}
/**
 * Keep plugin-supplied prose from closing the reminder wrapper early.
 * @param text - rendered section text.
 * @returns the text with every closing reminder tag escaped.
 */
export declare function escapeReminderText(text: string): string;
/** How the plan state changed since the previous delivery. */
export type GuidanceTransition = 'entered' | 'left';
/**
 * The prompt section that carries the deployment's plan guidance.
 * Its configuration belongs to dsh-plan-mode, so the plugin can only recognize
 * the section by the name that package registers.
 */
export declare const PLAN_POLICY_SECTION = "plan:policy";
/**
 * Render the snapshot delivered to the model.
 * @param sections - relocated sections in prompt order; at least one.
 * @param transition - whether the plan section appeared or disappeared.
 * @returns complete user-message text, including the reminder wrapper.
 */
export declare function renderGuidance(sections: readonly GuidanceSection[], transition?: GuidanceTransition): string;
/**
 * Read the plan-state change from the delivered and desired section names.
 * @param delivered - sections the model read last.
 * @param desired - sections the current step applies.
 * @returns the transition, or undefined when the plan section did not change sides.
 */
export declare function planTransition(delivered: readonly GuidanceSection[], desired: readonly GuidanceSection[]): GuidanceTransition | undefined;
/** The notice that retires previously delivered guidance. */
export declare const CLEARED_GUIDANCE_TEXT = "<system-reminder>\nPlan mode is inactive. The plan-mode guidance delivered earlier no longer applies; return to normal task execution.\n</system-reminder>";
/** The one-line account recorded on the notice. */
export declare const CLEARED_GUIDANCE_SUMMARY = "Plan mode inactive";
/**
 * Compare delivered and desired sections in order and text.
 * @param left - one section list.
 * @param right - the other section list.
 * @returns whether both lists carry the same names and text in the same order.
 */
export declare function sameSections(left: readonly GuidanceSection[], right: readonly GuidanceSection[]): boolean;
/** What one step must deliver, if anything. */
export type Delivery = {
    readonly kind: 'none';
} | {
    readonly kind: 'snapshot';
    readonly sections: readonly GuidanceSection[];
} | {
    readonly kind: 'cleared';
};
/**
 * Decide what a step delivers, given the sections it assembled and the sections
 * the model read last.
 * @param desired - sections the current step relocated out of the prompt head.
 * @param delivered - sections the model read in the previous delivery.
 * @param noticeWhenCleared - whether retired guidance produces a notice.
 * @returns the delivery, or `none` when the model already reads the current guidance.
 */
export declare function planDelivery(desired: readonly GuidanceSection[], delivered: readonly GuidanceSection[], noticeWhenCleared: boolean): Delivery;
