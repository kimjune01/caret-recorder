// Benchmark: run all mechanical pipeline stages (no LLM) on real data.
//
// Usage: npx tsx pipeline/bench_pipeline.ts <file.jsonl> [file2.jsonl ...]

import { readCaretEvents } from './adapters/caret';
import { deduplicate } from './dedup';
import { buffer } from './buffer';
import { strip } from './stripper';
import type { PerceptionEvent, EventType } from './common';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    'Usage: npx tsx pipeline/bench_pipeline.ts <file.jsonl> [file2.jsonl ...]',
  );
  process.exit(1);
}

type CountMap = Record<EventType, number>;

function emptyCounts(): CountMap {
  return {
    app_switch: 0,
    focus: 0,
    traversal: 0,
    activity_summary: 0,
    system: 0,
  };
}

interface StageStats {
  total: number;
  elements: number;
  counts: CountMap;
  timeMs: number;
}

async function* concatFiles(
  paths: string[],
): AsyncGenerator<PerceptionEvent> {
  for (const p of paths) {
    yield* readCaretEvents(p);
  }
}

async function measureStage(
  name: string,
  source: AsyncIterable<PerceptionEvent>,
): Promise<StageStats> {
  const counts = emptyCounts();
  let total = 0;
  let elements = 0;
  const t0 = performance.now();
  for await (const event of source) {
    counts[event.event_type]++;
    total++;
    if (event.elements) elements += event.elements.length;
  }
  const timeMs = performance.now() - t0;
  return { total, elements, counts, timeMs };
}

(async () => {
  // Each stage gets its own pass over the data to measure independently
  const raw = await measureStage('raw', concatFiles(files));

  const dedup = await measureStage(
    'dedup',
    deduplicate(concatFiles(files)),
  );

  const buffered = await measureStage(
    'buffer',
    buffer(deduplicate(concatFiles(files))),
  );

  const stripped = await measureStage(
    'stripper',
    strip(buffer(deduplicate(concatFiles(files)))),
  );

  // Report
  console.log(`\nFiles: ${files.length}`);
  console.log(
    `${'Stage'.padEnd(12)} ${'Events'.padStart(8)} ${'Elements'.padStart(10)} ${'Time'.padStart(8)}`,
  );
  console.log('-'.repeat(42));
  for (const [name, stats] of [
    ['raw', raw],
    ['dedup', dedup],
    ['buffer', buffered],
    ['stripper', stripped],
  ] as [string, StageStats][]) {
    console.log(
      `${name.padEnd(12)} ${String(stats.total).padStart(8)} ${String(stats.elements).padStart(10)} ${(stats.timeMs.toFixed(0) + 'ms').padStart(8)}`,
    );
  }

  console.log('\nBy event type (after each stage):');
  console.log(
    `${'Type'.padEnd(20)} ${'Raw'.padStart(6)} ${'Dedup'.padStart(6)} ${'Buffer'.padStart(8)} ${'Strip'.padStart(8)}`,
  );
  console.log('-'.repeat(52));
  for (const type of Object.keys(raw.counts) as EventType[]) {
    if (raw.counts[type] === 0 && dedup.counts[type] === 0) continue;
    console.log(
      `${type.padEnd(20)} ${String(raw.counts[type]).padStart(6)} ${String(dedup.counts[type]).padStart(6)} ${String(buffered.counts[type]).padStart(8)} ${String(stripped.counts[type]).padStart(8)}`,
    );
  }
})();
