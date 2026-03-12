// Tests for stripper pipeline stage.
//
// Usage: npx tsx pipeline/test_stripper.ts

import { strip, LANGUAGE_ROLES, elementToMarkdown, stripElements } from './stripper';
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
): PerceptionEvent {
  return makeEvent({
    event_type: 'traversal',
    app_name: appName,
    window_title: 'Win1',
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
// elementToMarkdown Tests
// ---------------------------------------------------------------------------

function testMarkdownConversion(): void {
  console.log('  markdown: each role type converts correctly');

  assert(
    elementToMarkdown({ role: 'AXHeading', title: 'My Heading' }) === '## My Heading',
    'AXHeading → ## title',
  );
  assert(
    elementToMarkdown({ role: 'AXLink', title: 'Click here', description: 'https://example.com' }) ===
      '[Click here](https://example.com)',
    'AXLink → [title](description)',
  );
  assert(
    elementToMarkdown({ role: 'AXLink', title: 'No URL' }) === 'No URL',
    'AXLink without description → just title',
  );
  assert(
    elementToMarkdown({ role: 'AXTextArea', value: 'some code here' }) === 'some code here',
    'AXTextArea → value',
  );
  assert(
    elementToMarkdown({ role: 'AXTextField', value: 'input text' }) === 'input text',
    'AXTextField → value',
  );
  assert(
    elementToMarkdown({ role: 'AXStaticText', value: 'static val' }) === 'static val',
    'AXStaticText with value → value',
  );
  assert(
    elementToMarkdown({ role: 'AXStaticText', title: 'static title' }) === 'static title',
    'AXStaticText without value → title',
  );
  assert(
    elementToMarkdown({ role: 'AXCell', value: 'cell content' }) === 'cell content',
    'AXCell → value',
  );
  assert(
    elementToMarkdown({ role: 'AXWebArea', title: 'Page Title' }) === 'Page Title',
    'AXWebArea → title',
  );
}

// ---------------------------------------------------------------------------
// stripElements Tests
// ---------------------------------------------------------------------------

function testRoleFiltering(): void {
  console.log('  strip: mixed roles → only language roles survive');
  const elements: AccessibilityElement[] = [
    { role: 'AXWindow', title: 'My Window' },
    { role: 'AXButton', title: 'OK' },
    { role: 'AXStaticText', value: 'Hello world this is a test' },
    { role: 'AXRadioButton', title: 'Tab 1' },
    { role: 'AXTextArea', value: 'Some code in the editor' },
    { role: 'AXImage', description: 'logo.png' },
    { role: 'AXHeading', title: 'Section Title' },
  ];

  const result = stripElements(elements);
  assert(result.length === 3, `expected 3 surviving elements, got ${result.length}`);
  assert(result[0].role === 'AXStaticText', 'first should be AXStaticText');
  assert(result[1].role === 'AXTextArea', 'second should be AXTextArea');
  assert(result[2].role === 'AXHeading', 'third should be AXHeading');
}

// ---------------------------------------------------------------------------
// Strip Stage Tests
// ---------------------------------------------------------------------------

async function testNearEmptyDropping(): Promise<void> {
  console.log('  strip: near-empty stripped text → event dropped');
  const events = [
    makeTraversal('App', [
      { role: 'AXStaticText', value: 'hi' }, // only 2 chars < 10 threshold
    ]),
  ];

  const result = await collect(strip(asyncFrom(events)));
  assert(result.length === 0, `expected 0 events, got ${result.length}`);
}

async function testPassThroughNonTraversal(): Promise<void> {
  console.log('  strip: non-traversal events pass through');
  const events = [
    makeEvent({ event_type: 'focus', metadata: { role: 'AXTextField' } }),
    makeEvent({ event_type: 'app_switch', app_name: 'Chrome' }),
    makeEvent({ event_type: 'system', metadata: { internalId: 'lock' } }),
  ];

  const result = await collect(strip(asyncFrom(events)));
  assert(result.length === 3, `expected 3 events, got ${result.length}`);
}

async function testStrippedTextMetadata(): Promise<void> {
  console.log('  strip: stripped_text metadata is set');
  const events = [
    makeTraversal('App', [
      { role: 'AXStaticText', value: 'Hello world this is real content' },
      { role: 'AXButton', title: 'Submit' }, // stripped
      { role: 'AXHeading', title: 'My Section' },
    ]),
  ];

  const result = await collect(strip(asyncFrom(events)));
  assert(result.length === 1, `expected 1 event, got ${result.length}`);
  const stripped = result[0].metadata.stripped_text as string;
  assert(
    stripped.includes('Hello world this is real content'),
    'stripped_text should contain static text',
  );
  assert(
    stripped.includes('## My Section'),
    'stripped_text should contain heading as markdown',
  );
  assert(!stripped.includes('Submit'), 'stripped_text should not contain button text');
}

async function testAllChromeTraversal(): Promise<void> {
  console.log('  strip: all-chrome traversal (only buttons/windows) → dropped');
  const events = [
    makeTraversal('App', [
      { role: 'AXWindow', title: 'My Window' },
      { role: 'AXButton', title: 'Close' },
      { role: 'AXButton', title: 'Minimize' },
      { role: 'AXButton', title: 'Maximize' },
    ]),
  ];

  const result = await collect(strip(asyncFrom(events)));
  assert(result.length === 0, `expected 0 events, got ${result.length}`);
}

async function testRealWorldITerm(): Promise<void> {
  console.log('  strip: iTerm2 AXWindow + AXTextArea + AXStaticText shortcuts → AXTextArea survives');
  const events = [
    makeTraversal('iTerm2', [
      { role: 'AXWindow', title: 'iTerm2' },
      { role: 'AXTextArea', value: '$ npm test\n\n> test passed\n\nTotal: 5 passed' },
      { role: 'AXStaticText', title: '⌘C' }, // keyboard shortcut label — tiny
    ]),
  ];

  const result = await collect(strip(asyncFrom(events)));
  assert(result.length === 1, `expected 1 event, got ${result.length}`);
  const stripped = result[0].metadata.stripped_text as string;
  assert(stripped.includes('npm test'), 'should contain terminal text');
}

async function testCustomKeepRoles(): Promise<void> {
  console.log('  strip: custom keepRoles overrides default');
  const events = [
    makeTraversal('App', [
      { role: 'AXButton', title: 'A button that is actually important content for this test' },
      { role: 'AXStaticText', value: 'Static text that should be dropped now' },
    ]),
  ];

  // Only keep AXButton
  const result = await collect(
    strip(asyncFrom(events), { keepRoles: new Set(['AXButton']) }),
  );
  assert(result.length === 1, `expected 1 event, got ${result.length}`);
  const stripped = result[0].metadata.stripped_text as string;
  assert(
    stripped.includes('A button that is actually important'),
    'should contain button text',
  );
  assert(
    !stripped.includes('Static text'),
    'should not contain static text',
  );
}

async function testElementsReplacedWithFiltered(): Promise<void> {
  console.log('  strip: output event elements contain only surviving roles');
  const events = [
    makeTraversal('App', [
      { role: 'AXWindow', title: 'Win' },
      { role: 'AXStaticText', value: 'This is enough text to pass the threshold' },
      { role: 'AXButton', title: 'OK' },
    ]),
  ];

  const result = await collect(strip(asyncFrom(events)));
  assert(result.length === 1, `expected 1 event, got ${result.length}`);
  assert(result[0].elements!.length === 1, 'should have 1 element');
  assert(result[0].elements![0].role === 'AXStaticText', 'surviving element should be AXStaticText');
}

function testSanitizesControlChars(): void {
  console.log('  sanitize: null bytes and control chars stripped from text');
  const md = elementToMarkdown({
    role: 'AXTextArea',
    value: 'hello\0world\x01foo\x1Fbar',
  });
  assert(!md.includes('\0'), 'should not contain null byte');
  assert(!md.includes('\x01'), 'should not contain SOH');
  assert(!md.includes('\x1F'), 'should not contain US');
  assert(md === 'helloworldfoobar', `got: "${md}"`);
}

function testSanitizesInHeadingAndLink(): void {
  console.log('  sanitize: heading title and link description sanitized');
  const heading = elementToMarkdown({
    role: 'AXHeading',
    title: 'My\0Title',
  });
  assert(heading === '## MyTitle', `heading got: "${heading}"`);

  const link = elementToMarkdown({
    role: 'AXLink',
    title: 'Click\0Here',
    description: 'https://example\0.com',
  });
  assert(link === '[ClickHere](https://example.com)', `link got: "${link}"`);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async () => {
  console.log('--- Markdown Conversion ---');
  testMarkdownConversion();

  console.log('--- Sanitization ---');
  testSanitizesControlChars();
  testSanitizesInHeadingAndLink();

  console.log('--- Role Filtering ---');
  testRoleFiltering();

  console.log('--- Strip Stage ---');
  await testNearEmptyDropping();
  await testPassThroughNonTraversal();
  await testStrippedTextMetadata();
  await testAllChromeTraversal();
  await testRealWorldITerm();
  await testCustomKeepRoles();
  await testElementsReplacedWithFiltered();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
