// Tests for caret and behacom adapters.
// Feeds sample data through both adapters and asserts schema consistency.
//
// Usage: npx tsx pipeline/test_adapters.ts

import { readCaretEvents } from './adapters/caret';
import { readBehacomEvents } from './adapters/behacom';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PerceptionEvent } from './common';

const REQUIRED_FIELDS: (keyof PerceptionEvent)[] = [
  'timestamp_ms',
  'source',
  'event_type',
  'app_name',
  'window_title',
  'elements',
  'metadata',
];

const VALID_SOURCES = new Set(['caret', 'behacom']);
const VALID_EVENT_TYPES = new Set([
  'app_switch',
  'focus',
  'traversal',
  'activity_summary',
  'system',
]);

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

function validateEvent(event: PerceptionEvent, label: string): void {
  for (const field of REQUIRED_FIELDS) {
    assert(field in event, `${label}: missing field "${field}"`);
  }
  assert(
    typeof event.timestamp_ms === 'number',
    `${label}: timestamp_ms should be number`,
  );
  assert(
    VALID_SOURCES.has(event.source),
    `${label}: invalid source "${event.source}"`,
  );
  assert(
    VALID_EVENT_TYPES.has(event.event_type),
    `${label}: invalid event_type "${event.event_type}"`,
  );
  assert(
    event.app_name === null || typeof event.app_name === 'string',
    `${label}: app_name should be string|null`,
  );
  assert(
    event.window_title === null || typeof event.window_title === 'string',
    `${label}: window_title should be string|null`,
  );
  assert(
    event.elements === null || Array.isArray(event.elements),
    `${label}: elements should be array|null`,
  );
  assert(
    typeof event.metadata === 'object' && event.metadata !== null,
    `${label}: metadata should be object`,
  );
}

async function testCaretAdapter(): Promise<void> {
  console.log('--- Caret Adapter ---');

  const tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-test-'));
  const filepath = join(
    tmpDir,
    'context-2026-03-11T04-19-23-926Z.jsonl',
  );

  const lines = [
    JSON.stringify({
      event: 0,
      payload: { bundleId: 'com.test.app', windows: ['Win1'], name: 'TestApp', pid: 123 },
    }),
    JSON.stringify({
      event: 1,
      payload: { role: 'AXTextField', description: 'Search', value: 'hello', frame: null, selection: null },
    }),
    JSON.stringify({
      event: 2,
      payload: { frame: { x: 0, y: 0, width: 100, height: 100 }, title: 'Win1' },
    }),
    JSON.stringify({
      event: 3,
      payload: {
        appName: 'TestApp',
        windowTitle: 'Win1',
        startTime: 1773202688820,
        endTime: 1773202688823,
        elements: [{ depth: 0, role: 'AXWindow', title: 'Win1' }],
      },
    }),
    JSON.stringify({
      event: 7,
      payload: { internalId: 'screen_lock' },
    }),
  ];

  writeFileSync(filepath, lines.join('\n') + '\n');

  const events: PerceptionEvent[] = [];
  for await (const event of readCaretEvents(filepath)) {
    events.push(event);
  }

  // Event 2 (WindowUpdate) should be skipped
  assert(events.length === 4, `expected 4 events, got ${events.length}`);
  assert(events[0].event_type === 'app_switch', 'first event should be app_switch');
  assert(events[0].app_name === 'TestApp', 'app_switch should have app_name');
  assert(events[1].event_type === 'focus', 'second event should be focus');
  assert((events[1].metadata as Record<string, unknown>).role === 'AXTextField', 'focus should have role in metadata');
  assert(events[2].event_type === 'traversal', 'third event should be traversal');
  assert(events[2].elements !== null, 'traversal should have elements');
  assert(events[2].elements!.length === 1, 'traversal should have 1 element');
  assert(events[2].timestamp_ms === 1773202688823, 'traversal should use endTime as timestamp');
  assert(events[3].event_type === 'system', 'fourth event should be system');

  // Validate schema for all events
  for (let i = 0; i < events.length; i++) {
    validateEvent(events[i], `caret[${i}]`);
    assert(events[i].source === 'caret', `caret[${i}]: source should be "caret"`);
  }

  // Session timestamp from filename
  assert(
    events[0].timestamp_ms === new Date('2026-03-11T04:19:23.926Z').getTime(),
    'non-traversal events should use filename timestamp',
  );

  unlinkSync(filepath);
  console.log('  Caret adapter OK');
}

async function testBehacomAdapter(): Promise<void> {
  console.log('--- BEHACOM Adapter ---');

  const tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-test-'));
  const filepath = join(tmpDir, 'User_1_BEHACOM.csv');

  const header =
    'timestamp,day_of_week,hour,current_app,current_window,penultimate_app,penultimate_window,total_keys_pressed,total_keys_released,special_keys_pressed,mouse_clicks_left,mouse_clicks_right,mouse_clicks_middle,mouse_distance,mouse_scrolls,cpu_usage,memory_usage';
  const row1 =
    '2021-01-01T00:00:00,Friday,0,Google Chrome,Gmail - Inbox,Explorer,Desktop,42,40,3,7,0,0,1200,5,15.2,62.1';
  const row2 =
    '2021-01-01T00:01:00,Friday,0,Google Chrome,Gmail - Inbox,Google Chrome,Gmail - Inbox,30,28,2,3,0,0,800,2,14.8,62.3';
  const row3 =
    '2021-01-01T00:02:00,Friday,0,Visual Studio Code,main.py,Google Chrome,Gmail - Inbox,100,98,10,5,1,0,2000,0,18.5,63.0';

  writeFileSync(filepath, [header, row1, row2, row3].join('\n') + '\n');

  const events: PerceptionEvent[] = [];
  for await (const event of readBehacomEvents(filepath)) {
    events.push(event);
  }

  // Row 1: app_switch (null→Chrome) + activity_summary
  // Row 2: same app, just activity_summary
  // Row 3: app_switch (Chrome→VS Code) + activity_summary
  assert(events.length === 5, `expected 5 events, got ${events.length}`);

  assert(events[0].event_type === 'app_switch', 'first event should be app_switch');
  assert(events[0].app_name === 'Google Chrome', 'first app_switch app_name');
  assert(events[1].event_type === 'activity_summary', 'second event should be activity_summary');
  assert(events[1].app_name === 'Google Chrome', 'activity_summary app_name');
  assert(events[2].event_type === 'activity_summary', 'third event should be activity_summary (no app change)');
  assert(events[3].event_type === 'app_switch', 'fourth event should be app_switch');
  assert(events[3].app_name === 'Visual Studio Code', 'second app_switch app_name');
  assert(events[4].event_type === 'activity_summary', 'fifth event should be activity_summary');

  // Validate metadata shape
  const meta = events[1].metadata as Record<string, unknown>;
  assert('keyboard' in meta, 'activity_summary should have keyboard metadata');
  assert('mouse' in meta, 'activity_summary should have mouse metadata');
  assert(meta.duration_ms === 60_000, 'duration_ms should be 60000');

  const keyboard = meta.keyboard as Record<string, number>;
  assert(keyboard.total_pressed === 42, 'keyboard total_pressed should be 42');

  // Validate schema for all events
  for (let i = 0; i < events.length; i++) {
    validateEvent(events[i], `behacom[${i}]`);
    assert(events[i].source === 'behacom', `behacom[${i}]: source should be "behacom"`);
  }

  unlinkSync(filepath);
  console.log('  BEHACOM adapter OK');
}

async function testSchemaConsistency(): Promise<void> {
  console.log('--- Schema Consistency ---');

  // Both adapters produce events with the exact same set of keys
  const tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-test-'));

  const caretFile = join(tmpDir, 'context-2026-01-01T00-00-00-000Z.jsonl');
  writeFileSync(
    caretFile,
    JSON.stringify({
      event: 0,
      payload: { bundleId: 'com.test', windows: [], name: 'App', pid: 1 },
    }) + '\n',
  );

  const behacomFile = join(tmpDir, 'User_test.csv');
  writeFileSync(
    behacomFile,
    'timestamp,current_app,current_window\n2021-01-01T00:00:00,App,Win\n',
  );

  const caretEvents: PerceptionEvent[] = [];
  for await (const e of readCaretEvents(caretFile)) caretEvents.push(e);

  const behacomEvents: PerceptionEvent[] = [];
  for await (const e of readBehacomEvents(behacomFile)) behacomEvents.push(e);

  assert(caretEvents.length > 0, 'caret should produce events');
  assert(behacomEvents.length > 0, 'behacom should produce events');

  const caretKeys = Object.keys(caretEvents[0]).sort();
  const behacomKeys = Object.keys(behacomEvents[0]).sort();

  assert(
    JSON.stringify(caretKeys) === JSON.stringify(behacomKeys),
    `schema keys should match: caret=${caretKeys} behacom=${behacomKeys}`,
  );

  unlinkSync(caretFile);
  unlinkSync(behacomFile);
  console.log('  Schema consistency OK');
}

(async () => {
  await testCaretAdapter();
  await testBehacomAdapter();
  await testSchemaConsistency();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
