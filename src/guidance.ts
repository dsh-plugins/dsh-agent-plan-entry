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
  readonly name: string
  /** Rendered section text, exactly as the head would have carried it. */
  readonly text: string
}

const CLOSING_TAG = /<\/system-reminder\s*>/gi

/**
 * Keep plugin-supplied prose from closing the reminder wrapper early.
 * @param text - rendered section text.
 * @returns the text with every closing reminder tag escaped.
 */
export function escapeReminderText(text: string): string {
  return text.replace(CLOSING_TAG, tag => `<\\${tag.slice(1)}`)
}

/** How the plan state changed since the previous delivery. */
export type GuidanceTransition = 'entered' | 'left'

/**
 * The prompt section that carries the deployment's plan guidance.
 * Its configuration belongs to dsh-plan-mode, so the plugin can only recognize
 * the section by the name that package registers.
 */
export const PLAN_POLICY_SECTION = 'plan:policy'

/**
 * Name the change the model is about to read, so an entry and an exit stay
 * distinguishable at a glance.
 * @param transition - the plan section appeared or disappeared, when known.
 * @returns the leading sentence of the snapshot.
 */
function transitionLine(transition: GuidanceTransition | undefined): string {
  switch (transition) {
    case 'entered':
      return 'Plan mode is now active. This snapshot supersedes earlier plan-mode guidance.'
    case 'left':
      return 'Plan mode is now inactive. This snapshot supersedes earlier plan-mode guidance.'
    default:
      return 'Current plan-mode guidance. This snapshot supersedes earlier plan-mode guidance.'
  }
}

/**
 * Render the snapshot delivered to the model.
 * @param sections - relocated sections in prompt order; at least one.
 * @param transition - whether the plan section appeared or disappeared.
 * @returns complete user-message text, including the reminder wrapper.
 */
export function renderGuidance(
  sections: readonly GuidanceSection[],
  transition?: GuidanceTransition,
): string {
  const body = sections
    .map(section => escapeReminderText(section.text))
    .filter(text => text.length > 0)
    .join('\n\n')
  return `<system-reminder>\n${transitionLine(transition)}\n\n${body}\n</system-reminder>`
}

/**
 * Read the plan-state change from the delivered and desired section names.
 * @param delivered - sections the model read last.
 * @param desired - sections the current step applies.
 * @returns the transition, or undefined when the plan section did not change sides.
 */
export function planTransition(
  delivered: readonly GuidanceSection[],
  desired: readonly GuidanceSection[],
): GuidanceTransition | undefined {
  const had = delivered.some(section => section.name === PLAN_POLICY_SECTION)
  const has = desired.some(section => section.name === PLAN_POLICY_SECTION)
  if (has && !had) return 'entered'
  if (!has && had) return 'left'
  return undefined
}

/** The notice that retires previously delivered guidance. */
export const CLEARED_GUIDANCE_TEXT
  = '<system-reminder>\nPlan mode is inactive. The plan-mode guidance delivered earlier no longer applies; return to normal task execution.\n</system-reminder>'

/** The one-line account recorded on the notice. */
export const CLEARED_GUIDANCE_SUMMARY = 'Plan mode inactive'

/**
 * Compare delivered and desired sections in order and text.
 * @param left - one section list.
 * @param right - the other section list.
 * @returns whether both lists carry the same names and text in the same order.
 */
export function sameSections(
  left: readonly GuidanceSection[],
  right: readonly GuidanceSection[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((section, index) => {
    const other = right[index]
    return other !== undefined && other.name === section.name && other.text === section.text
  })
}

/** What one step must deliver, if anything. */
export type Delivery =
  | { readonly kind: 'none' }
  | { readonly kind: 'snapshot', readonly sections: readonly GuidanceSection[] }
  | { readonly kind: 'cleared' }

/**
 * Decide what a step delivers, given the sections it assembled and the sections
 * the model read last.
 * @param desired - sections the current step relocated out of the prompt head.
 * @param delivered - sections the model read in the previous delivery.
 * @param noticeWhenCleared - whether retired guidance produces a notice.
 * @returns the delivery, or `none` when the model already reads the current guidance.
 */
export function planDelivery(
  desired: readonly GuidanceSection[],
  delivered: readonly GuidanceSection[],
  noticeWhenCleared: boolean,
): Delivery {
  if (sameSections(desired, delivered)) return { kind: 'none' }
  if (desired.length > 0) return { kind: 'snapshot', sections: desired }
  // Nothing applies now: retire the previous delivery in one short notice rather
  // than restating guidance the model already read.
  if (!noticeWhenCleared || delivered.length === 0) return { kind: 'none' }
  return { kind: 'cleared' }
}
