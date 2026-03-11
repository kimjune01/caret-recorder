// Run the full pipeline on real recording data, producing moments.
//
// Usage: npx tsx pipeline/run_pipeline.ts <file.jsonl> [file2.jsonl ...]

import { readCaretEvents } from './adapters/caret';
import { deduplicate } from './dedup';
import { buffer } from './buffer';
import { strip } from './stripper';
import { condense } from './condensation';
import { codexLLM } from './llm_codex';
import type { PerceptionEvent, Moment } from './common';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    'Usage: npx tsx pipeline/run_pipeline.ts <file.jsonl> [file2.jsonl ...]',
  );
  process.exit(1);
}

async function* concatFiles(
  paths: string[],
): AsyncGenerator<PerceptionEvent> {
  for (const p of paths) {
    yield* readCaretEvents(p);
  }
}

(async () => {
  const pipeline = condense(
    strip(buffer(deduplicate(concatFiles(files)))),
    { llm: codexLLM },
  );

  let count = 0;
  for await (const moment of pipeline) {
    count++;
    const m = moment as Moment;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Moment #${count}`);
    console.log(`  app: ${m.source_app} (${m.source_type})`);
    console.log(`  time: ${new Date(m.timestamp_ms).toISOString()}`);
    console.log(`  context events: ${m.context.length}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(m.content);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total moments: ${count}`);
})();
