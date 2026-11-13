import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLEARED_GUIDANCE_TEXT,
  escapeReminderText,
  renderGuidance,
  sameSections,
} from '../src/guidance.ts'

const planPolicy = {
  name: 'plan:policy',
  text: 'You are in plan mode. Explore first.',
}

const complexity = {
  name: 'agent-plan-entry:complexity-policy',
  text: 'Assess task complexity before taking action.',
}

test('escapeReminderText neutralizes closing reminder tags in either casing', () => {
  assert.equal(
    escapeReminderText('before </system-reminder> after'),
    'before <\\/system-reminder> after',
  )
  assert.equal(
    escapeReminderText('closing </SYSTEM-REMINDER > now'),
    'closing <\\/SYSTEM-REMINDER > now',
  )
  assert.equal(escapeReminderText('plain text'), 'plain text')
})

test('renderGuidance wraps every section in one snapshot with a supersession note', () => {
  const text = renderGuidance([planPolicy, complexity])
  assert.equal(
    text,
    '<system-reminder>\n'
    + 'Current plan-mode guidance. This snapshot supersedes earlier plan-mode guidance.\n\n'
    + 'You are in plan mode. Explore first.\n\n'
    + 'Assess task complexity before taking action.\n'
    + '</system-reminder>',
  )
  assert.ok(text.startsWith('<system-reminder>\n'))
  assert.ok(text.endsWith('\n</system-reminder>'))
})

test('renderGuidance keeps section order and escapes section bodies', () => {
  const text = renderGuidance([
    { name: 'a', text: 'first </system-reminder> body' },
    { name: 'b', text: 'second' },
  ])
  assert.ok(text.includes('first <\\/system-reminder> body\n\nsecond'))
  assert.equal(text.match(/<\/system-reminder>/g)?.length, 1)
})

test('renderGuidance skips empty section text', () => {
  const text = renderGuidance([{ name: 'a', text: '' }, { name: 'b', text: 'kept' }])
  assert.ok(text.includes('kept'))
  assert.ok(!text.includes('\n\n\n'))
  assert.ok(!text.includes('kept\n\n'))
})

test('sameSections compares names, text, and order', () => {
  assert.equal(sameSections([], []), true)
  assert.equal(sameSections([planPolicy], [planPolicy]), true)
  assert.equal(sameSections([planPolicy], [complexity]), false)
  assert.equal(sameSections([planPolicy, complexity], [complexity, planPolicy]), false)
  assert.equal(sameSections([planPolicy], [planPolicy, complexity]), false)
  assert.equal(
    sameSections([{ name: 'a', text: 'x' }], [{ name: 'a', text: 'x ' }]),
    false,
  )
})

test('the cleared notice retires earlier guidance', () => {
  assert.ok(CLEARED_GUIDANCE_TEXT.startsWith('<system-reminder>\n'))
  assert.ok(CLEARED_GUIDANCE_TEXT.includes('no longer applies'))
  assert.equal(CLEARED_GUIDANCE_TEXT.match(/<\/system-reminder>/g)?.length, 1)
})
