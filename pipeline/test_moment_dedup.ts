// Tests for post-condensation moment dedup.
//
// Usage: npx tsx pipeline/test_moment_dedup.ts

import { deduplicateMoments } from './moment_dedup';
import type { Moment, SourceType } from './common';

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

function makeMoment(
  app: string,
  content: string,
  timestamp_ms = Date.now(),
  source_type: SourceType = 'terminal',
): Moment {
  return {
    timestamp_ms,
    source_app: app,
    source_type,
    content,
    context: [],
  };
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
// Tests
// ---------------------------------------------------------------------------

async function testSubsetDropped(): Promise<void> {
  console.log('  dedup: moment that is substring of previous from same app → dropped');
  const moments = [
    makeMoment('iTerm2', '$ npm start\n> build complete\n> server ready', 1000),
    makeMoment('iTerm2', '$ npm start\n> build complete', 2000), // subset
  ];

  const result = await collect(deduplicateMoments(asyncFrom(moments)));
  assert(result.length === 1, `expected 1, got ${result.length}`);
  assert(result[0].content.includes('server ready'), 'should keep the longer one');
}

async function testSupersetReplacesAndDropsPrevious(): Promise<void> {
  console.log('  dedup: moment that is superset of previous from same app → keeps superset');
  const moments = [
    makeMoment('iTerm2', '$ npm start', 1000),
    makeMoment('iTerm2', '$ npm start\n> build complete\n> server ready', 2000), // superset
  ];

  const result = await collect(deduplicateMoments(asyncFrom(moments)));
  // The superset should replace; we end up with just the superset
  assert(result.length === 1, `expected 1, got ${result.length}`);
  assert(result[0].content.includes('server ready'), 'should keep the superset');
}

async function testDifferentAppsNotDeduped(): Promise<void> {
  console.log('  dedup: same content but different apps → both kept');
  const moments = [
    makeMoment('iTerm2', '$ npm start', 1000),
    makeMoment('Terminal', '$ npm start', 2000),
  ];

  const result = await collect(deduplicateMoments(asyncFrom(moments)));
  assert(result.length === 2, `expected 2, got ${result.length}`);
}

async function testDistinctContentKept(): Promise<void> {
  console.log('  dedup: distinct content from same app → both kept');
  const moments = [
    makeMoment('iTerm2', '$ npm test\n5 passed', 1000),
    makeMoment('iTerm2', '$ npm run build\nBuild successful', 2000),
  ];

  const result = await collect(deduplicateMoments(asyncFrom(moments)));
  assert(result.length === 2, `expected 2, got ${result.length}`);
}

async function testMultipleAppsInterleaved(): Promise<void> {
  console.log('  dedup: interleaved apps with subset → only subset dropped');
  const moments = [
    makeMoment('iTerm2', '$ npm start\n> ready', 1000),
    makeMoment('Code', 'function handleClick() {}', 2000),
    makeMoment('iTerm2', '$ npm start', 3000), // subset of first iTerm2 moment
  ];

  const result = await collect(deduplicateMoments(asyncFrom(moments)));
  assert(result.length === 2, `expected 2, got ${result.length}`);
  assert(result[0].source_app === 'iTerm2', 'first should be iTerm2');
  assert(result[1].source_app === 'Code', 'second should be Code');
}

async function testEmptyStream(): Promise<void> {
  console.log('  dedup: empty stream → empty output');
  const result = await collect(deduplicateMoments(asyncFrom([])));
  assert(result.length === 0, `expected 0, got ${result.length}`);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async () => {
  console.log('--- Moment Dedup ---');
  await testSubsetDropped();
  await testSupersetReplacesAndDropsPrevious();
  await testDifferentAppsNotDeduped();
  await testDistinctContentKept();
  await testMultipleAppsInterleaved();
  await testEmptyStream();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
