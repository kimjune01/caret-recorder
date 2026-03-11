// Tests for condensation pipeline stage.
//
// Usage: npx tsx pipeline/test_condensation.ts

import { condense, detectSourceType, SOURCE_MAP, PROMPTS } from './condensation';
import type {
  PerceptionEvent,
  AccessibilityElement,
  EventType,
  Moment,
  LLMFn,
} from './common';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<PerceptionEvent> & { event_type: EventType },
): PerceptionEvent {
  return {
    timestamp_ms: Date.now(),
    source: 'caret',
    app_name: null,
    window_title: null,
    elements: null,
    metadata: {},
    ...overrides,
  };
}

function makeStrippedTraversal(
  appName: string,
  strippedText: string,
  timestamp_ms = Date.now(),
): PerceptionEvent {
  return makeEvent({
    event_type: 'traversal',
    app_name: appName,
    window_title: 'Win1',
    elements: [{ role: 'AXStaticText', value: strippedText }],
    metadata: {
      stripped_text: strippedText,
      startTime: timestamp_ms - 100,
      endTime: timestamp_ms,
    },
    timestamp_ms,
  });
}

async function* asyncFrom<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of gen) {
    result.push(item);
  }
  return result;
}

/** Mock LLM that echoes the input text as "condensed: <text>" */
const echoLLM: LLMFn = async (text: string, _systemPrompt: string) => {
  return `condensed: ${text.slice(0, 50)}`;
};

/** Mock LLM that returns empty string (no signal). */
const emptyLLM: LLMFn = async () => '';

// ---------------------------------------------------------------------------
// Source Type Detection Tests
// ---------------------------------------------------------------------------

function testSourceTypeDetection(): void {
  console.log('  source: detects all mapped apps');

  assert(detectSourceType('iTerm2') === 'terminal', 'iTerm2 → terminal');
  assert(detectSourceType('Terminal') === 'terminal', 'Terminal → terminal');
  assert(detectSourceType('Code') === 'code_editor', 'Code → code_editor');
  assert(detectSourceType('Xcode') === 'code_editor', 'Xcode → code_editor');
  assert(detectSourceType('Google Chrome') === 'browser', 'Chrome → browser');
  assert(detectSourceType('Safari') === 'browser', 'Safari → browser');
  assert(detectSourceType('Firefox') === 'browser', 'Firefox → browser');
  assert(detectSourceType('Slack') === 'conversation', 'Slack → conversation');
  assert(detectSourceType('Messages') === 'conversation', 'Messages → conversation');
  assert(detectSourceType('UnknownApp') === 'other', 'unknown → other');
  assert(detectSourceType(null) === 'other', 'null → other');
}

function testPromptsExist(): void {
  console.log('  source: prompts exist for all source types');
  assert(PROMPTS.terminal.length > 0, 'terminal prompt exists');
  assert(PROMPTS.code_editor.length > 0, 'code_editor prompt exists');
  assert(PROMPTS.browser.length > 0, 'browser prompt exists');
  assert(PROMPTS.conversation.length > 0, 'conversation prompt exists');
  assert(PROMPTS.other.length > 0, 'other prompt exists');
}

// ---------------------------------------------------------------------------
// Condensation Stage Tests
// ---------------------------------------------------------------------------

async function testMockLLMProducesMoment(): Promise<void> {
  console.log('  condense: mock LLM produces moment with correct shape');
  const events = [
    makeStrippedTraversal('iTerm2', '$ npm test\n5 passed', 1000),
  ];

  const result = await collect(condense(asyncFrom(events), { llm: echoLLM }));
  assert(result.length === 1, `expected 1 moment, got ${result.length}`);

  const m = result[0] as Moment;
  assert(m.timestamp_ms === 1000, 'timestamp should match');
  assert(m.source_app === 'iTerm2', 'source_app should be iTerm2');
  assert(m.source_type === 'terminal', 'source_type should be terminal');
  assert(m.content.startsWith('condensed:'), 'content should be from LLM');
  assert(Array.isArray(m.context), 'context should be array');
}

async function testContextEventsAttached(): Promise<void> {
  console.log('  condense: context events attached to next moment');
  const events = [
    makeEvent({ event_type: 'app_switch', app_name: 'iTerm2', timestamp_ms: 500 }),
    makeEvent({ event_type: 'focus', timestamp_ms: 600, metadata: { role: 'AXTextArea' } }),
    makeStrippedTraversal('iTerm2', '$ npm test\n5 passed', 1000),
  ];

  const result = await collect(condense(asyncFrom(events), { llm: echoLLM }));
  assert(result.length === 1, `expected 1 moment, got ${result.length}`);

  const m = result[0] as Moment;
  assert(m.context.length === 2, `expected 2 context events, got ${m.context.length}`);
  assert(m.context[0].event_type === 'app_switch', 'first context should be app_switch');
  assert(m.context[1].event_type === 'focus', 'second context should be focus');
}

async function testContextResetAfterMoment(): Promise<void> {
  console.log('  condense: context reset after each moment');
  const events = [
    makeEvent({ event_type: 'app_switch', app_name: 'iTerm2', timestamp_ms: 500 }),
    makeStrippedTraversal('iTerm2', '$ npm test\nAll passed test one', 1000),
    makeEvent({ event_type: 'focus', timestamp_ms: 1500, metadata: { role: 'AXTextArea' } }),
    makeStrippedTraversal('iTerm2', '$ npm run build\nBuild successful done', 2000),
  ];

  const result = await collect(condense(asyncFrom(events), { llm: echoLLM }));
  assert(result.length === 2, `expected 2 moments, got ${result.length}`);

  const m1 = result[0] as Moment;
  const m2 = result[1] as Moment;
  assert(m1.context.length === 1, `first moment should have 1 context event, got ${m1.context.length}`);
  assert(m2.context.length === 1, `second moment should have 1 context event, got ${m2.context.length}`);
  assert(m2.context[0].event_type === 'focus', 'second moment context should be focus');
}

async function testEmptyLLMResponseSkipped(): Promise<void> {
  console.log('  condense: empty LLM response → no moment');
  const events = [
    makeStrippedTraversal('iTerm2', '$ npm test\nAll tests passed OK', 1000),
  ];

  const result = await collect(condense(asyncFrom(events), { llm: emptyLLM }));
  assert(result.length === 0, `expected 0 moments, got ${result.length}`);
}

async function testMissingStrippedTextSkipped(): Promise<void> {
  console.log('  condense: missing stripped_text → no moment');
  const events = [
    makeEvent({
      event_type: 'traversal',
      app_name: 'iTerm2',
      elements: [{ role: 'AXStaticText', value: 'some text' }],
      metadata: {}, // no stripped_text
      timestamp_ms: 1000,
    }),
  ];

  const result = await collect(condense(asyncFrom(events), { llm: echoLLM }));
  assert(result.length === 0, `expected 0 moments, got ${result.length}`);
}

async function testMultipleAppsCorrectSourceTypes(): Promise<void> {
  console.log('  condense: multiple apps → correct source types');

  // Track which system prompts the LLM receives
  const receivedPrompts: string[] = [];
  const trackingLLM: LLMFn = async (text: string, systemPrompt: string) => {
    receivedPrompts.push(systemPrompt);
    return `condensed: ${text.slice(0, 30)}`;
  };

  const events = [
    makeStrippedTraversal('iTerm2', '$ git status\nmodified: file.ts here', 1000),
    makeStrippedTraversal('Code', 'function handleClick() { return null; }', 2000),
    makeStrippedTraversal('Google Chrome', 'React Documentation for Hooks API reference', 3000),
    makeStrippedTraversal('Slack', 'Hey can you review my PR please and thanks', 4000),
  ];

  const result = await collect(condense(asyncFrom(events), { llm: trackingLLM }));
  assert(result.length === 4, `expected 4 moments, got ${result.length}`);

  assert((result[0] as Moment).source_type === 'terminal', 'first should be terminal');
  assert((result[1] as Moment).source_type === 'code_editor', 'second should be code_editor');
  assert((result[2] as Moment).source_type === 'browser', 'third should be browser');
  assert((result[3] as Moment).source_type === 'conversation', 'fourth should be conversation');

  // Each should have received a different system prompt
  assert(receivedPrompts.length === 4, 'LLM should be called 4 times');
  assert(
    receivedPrompts[0] !== receivedPrompts[1],
    'terminal and code_editor prompts should differ',
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async () => {
  console.log('--- Source Type Detection ---');
  testSourceTypeDetection();
  testPromptsExist();

  console.log('--- Condensation Stage ---');
  await testMockLLMProducesMoment();
  await testContextEventsAttached();
  await testContextResetAfterMoment();
  await testEmptyLLMResponseSkipped();
  await testMissingStrippedTextSkipped();
  await testMultipleAppsCorrectSourceTypes();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
