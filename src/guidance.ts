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

/**
 * Render the snapshot delivered to the model.
 * @param sections - relocated sections in prompt order; at least one.
 * @returns complete user-message text, including the reminder wrapper.
 */
export function renderGuidance(sections: readonly GuidanceSection[]): string {
  const body = sections
    .map(section => escapeReminderText(section.text))
    .filter(text => text.length > 0)
    .join('\n\n')
  return `<system-reminder>\nCurrent plan-mode guidance. This snapshot supersedes earlier plan-mode guidance.\n\n${body}\n</system-reminder>`
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
