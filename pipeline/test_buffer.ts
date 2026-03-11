// Tests for buffer pipeline stage.
//
// Usage: npx tsx pipeline/test_buffer.ts

import { buffer, extractText } from './buffer';
import type {
  PerceptionEvent,
  AccessibilityElement,
  EventType,
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

function makeTraversal(
  appName: string,
  elements: AccessibilityElement[],
  timestamp_ms = Date.now(),
  windowTitle = 'Win1',
): PerceptionEvent {
  return makeEvent({
    event_type: 'traversal',
    app_name: appName,
    window_title: windowTitle,
    elements,
    metadata: { startTime: timestamp_ms - 100, endTime: timestamp_ms },
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

// ---------------------------------------------------------------------------
// extractText Tests
// ---------------------------------------------------------------------------

function testExtractText(): void {
  console.log('  extractText: prefers value > title > description');
  const elements: AccessibilityElement[] = [
    { role: 'AXTextArea', value: 'hello world' },
    { role: 'AXStaticText', title: 'some title' },
    { role: 'AXButton', description: 'a button' },
    { role: 'AXWindow' }, // no text fields
  ];
  const text = extractText(elements);
  assert(text === 'hello world\nsome title\na button', `got: "${text}"`);
}

// ---------------------------------------------------------------------------
// Buffer Stage Tests
// ---------------------------------------------------------------------------

async function testSupersetDetection(): Promise<void> {
  console.log('  buffer: superset traversals → one event yielded');
  const events = [
    makeTraversal('App', [{ role: 'AXTextArea', value: 'func' }], 1000),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'function' }], 2000),
  ];

  const result = await collect(buffer(asyncFrom(events)));
  assert(result.length === 1, `expected 1 event, got ${result.length}`);
  assert(
    result[0].elements![0].value === 'function',
    'should yield the superset event',
  );
}

async function testNonSupersetFlush(): Promise<void> {
  console.log('  buffer: non-superset → both yielded');
  const events = [
    makeTraversal('App', [{ role: 'AXTextArea', value: 'function' }], 1000),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'funct' }], 2000),
  ];

  const result = await collect(buffer(asyncFrom(events)));
  assert(result.length === 2, `expected 2 events, got ${result.length}`);
  assert(
    result[0].elements![0].value === 'function',
    'first should be "function"',
  );
  assert(result[1].elements![0].value === 'funct', 'second should be "funct"');
}

async function testFlushOnAppSwitch(): Promise<void> {
  console.log('  buffer: flush on app_switch');
  const events = [
    makeTraversal('App', [{ role: 'AXTextArea', value: 'hello' }], 1000),
    makeEvent({
      event_type: 'app_switch',
      app_name: 'App',
      timestamp_ms: 2000,
    }),
  ];

  const result = await collect(buffer(asyncFrom(events)));
  // Should get: flushed traversal + app_switch
  assert(result.length === 2, `expected 2 events, got ${result.length}`);
  assert(result[0].event_type === 'traversal', 'first should be traversal');
  assert(result[1].event_type === 'app_switch', 'second should be app_switch');
}

async function testFlushOnTimeout(): Promise<void> {
  console.log('  buffer: flush on timeout');
  const events = [
    makeTraversal('App', [{ role: 'AXTextArea', value: 'old' }], 1000),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'old and new' }], 7000), // 6s gap > 5s default
  ];

  const result = await collect(buffer(asyncFrom(events), { timeoutMs: 5000 }));
  assert(result.length === 2, `expected 2 events, got ${result.length}`);
  assert(result[0].elements![0].value === 'old', 'first flushed on timeout');
  assert(
    result[1].elements![0].value === 'old and new',
    'second starts new buffer',
  );
}

async function testPerWindowBuffering(): Promise<void> {
  console.log('  buffer: per-window buffering (interleaved windows)');
  const events = [
    makeTraversal(
      'App',
      [{ role: 'AXTextArea', value: 'win1-a' }],
      1000,
      'Window1',
    ),
    makeTraversal(
      'App',
      [{ role: 'AXTextArea', value: 'win2-a' }],
      2000,
      'Window2',
    ),
    makeTraversal(
      'App',
      [{ role: 'AXTextArea', value: 'win1-ab' }],
      3000,
      'Window1',
    ), // superset of win1-a
    makeTraversal(
      'App',
      [{ role: 'AXTextArea', value: 'win2-ab' }],
      4000,
      'Window2',
    ), // superset of win2-a
  ];

  const result = await collect(buffer(asyncFrom(events)));
  // Both windows should accumulate independently → 2 events (one per window)
  assert(result.length === 2, `expected 2 events, got ${result.length}`);
}

async function testPassThroughNonTraversal(): Promise<void> {
  console.log('  buffer: non-traversal events pass through immediately');
  const events = [
    makeEvent({ event_type: 'focus', timestamp_ms: 1000, metadata: { role: 'AXTextField' } }),
    makeEvent({ event_type: 'system', timestamp_ms: 2000, metadata: { internalId: 'lock' } }),
  ];

  const result = await collect(buffer(asyncFrom(events)));
  assert(result.length === 2, `expected 2 events, got ${result.length}`);
  assert(result[0].event_type === 'focus', 'first should be focus');
  assert(result[1].event_type === 'system', 'second should be system');
}

async function testEndOfStreamFlush(): Promise<void> {
  console.log('  buffer: end of stream flushes remaining buffers');
  const events = [
    makeTraversal('App', [{ role: 'AXTextArea', value: 'buffered' }], 1000),
  ];

  const result = await collect(buffer(asyncFrom(events)));
  assert(result.length === 1, `expected 1 event, got ${result.length}`);
  assert(
    result[0].elements![0].value === 'buffered',
    'should flush on stream end',
  );
}

async function testTypingScenario(): Promise<void> {
  console.log('  buffer: typing "f" → "fu" → "fun" → "func" → "function" → one event');
  const events = [
    makeTraversal('App', [{ role: 'AXTextArea', value: 'f' }], 1000),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'fu' }], 1500),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'fun' }], 2000),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'func' }], 2500),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'function' }], 3000),
  ];

  const result = await collect(buffer(asyncFrom(events)));
  assert(result.length === 1, `expected 1 event, got ${result.length}`);
  assert(
    result[0].elements![0].value === 'function',
    'should yield final "function"',
  );
}

async function testTypingThenDeletion(): Promise<void> {
  console.log('  buffer: typing then deletion → two events');
  const events = [
    makeTraversal('App', [{ role: 'AXTextArea', value: 'f' }], 1000),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'fu' }], 1500),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'function' }], 2000),
    makeTraversal('App', [{ role: 'AXTextArea', value: 'funct' }], 2500), // deletion
  ];

  const result = await collect(buffer(asyncFrom(events)));
  assert(result.length === 2, `expected 2 events, got ${result.length}`);
  assert(
    result[0].elements![0].value === 'function',
    'first should be "function"',
  );
  assert(result[1].elements![0].value === 'funct', 'second should be "funct"');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async () => {
  console.log('--- extractText ---');
  testExtractText();

  console.log('--- Buffer Stage ---');
  await testSupersetDetection();
  await testNonSupersetFlush();
  await testFlushOnAppSwitch();
  await testFlushOnTimeout();
  await testPerWindowBuffering();
  await testPassThroughNonTraversal();
  await testEndOfStreamFlush();
  await testTypingScenario();
  await testTypingThenDeletion();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
