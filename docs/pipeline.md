# Perception Pipeline

Offline pipeline that normalizes desktop activity streams from multiple sources into a common event format, then feeds them through processing stages.

## Data Flow

```
┌─────────────┐     ┌─────────────┐
│ Caret JSONL  │     │ BEHACOM CSV  │
│ (1s, a11y)   │     │ (1min, agg)  │
└──────┬───────┘     └──────┬───────┘
       │                    │
       ▼                    ▼
  caret adapter       behacom adapter
       │                    │
       └────────┬───────────┘
                │
                ▼
       PerceptionEvent stream
                │
                ▼
        ┌───────────────┐
        │    Dedup /     │
        │   Diffing      │  ← no LLM
        └───────┬────────┘
                │
                ▼
        ┌───────────────┐
        │    Buffer      │
        │ (flush on non- │  ← no LLM
        │  superset)     │
        └───────┬────────┘
                │
                ▼
        ┌───────────────┐
        │  Strip non-    │
        │  language       │  ← no LLM
        └───────┬────────┘
                │
                ▼
        ┌───────────────┐
        │ Condensation   │
        │ (per source    │  ← cheap LLM
        │  type)         │
        └───────┬────────┘
                │
                ▼
            moments
           (markdown)
                │
                ▼
        ┌───────────────┐
        │   Salience     │
        │ (competition)  │
        └───────┬────────┘
                │
                ▼
        ┌───────────────┐
        │   Synthesis    │
        │  (blog draft)  │
        └───────┬────────┘
                │
                ▼
        ┌───────────────┐
        │  Quality Gate  │
        │  (freshness    │
        │   filter)      │
        └───────────────┘
```

## Sources

### Caret Recorder

The recorder (`src/sidecar/`) emits JSONL with 9 event types (see `event-schema.md`). Events fire at ~1s intervals with full accessibility tree snapshots. This is the primary high-fidelity source.

### BEHACOM Dataset

12 users x 55 days of desktop activity captured at 1-minute resolution. Each row is an aggregated activity vector (~12K columns): active app, keystrokes, mouse events, window titles. No accessibility trees. See `docs/adapters/behacom.md` for mapping details.

## Common Format

Both adapters yield `PerceptionEvent` objects (defined in `pipeline/common.ts`). The format is deliberately lossy — it captures what both sources provide (timestamps, app context) and carries source-specific data in a `metadata` field.

## Goal

The pipeline's end product is a **vibelog** — a blog post drafted from a recording session. Not a summary of what happened, but a post with enough specificity and reasoning that a reader (or agent) could reproduce the work.

What the [reasoning-filter](https://github.com/kimjune01/reasoning-filter) experiments established:

- **Argument Dependency Chain (ADC)** is the strongest signal of original reasoning — paragraphs that depend on each other can't be faked by humanizers
- The real discriminator is **unevenness** — human writing is dense where the author has hard-won insight, sparse where they're just setting context
- Numeric scoring is gameable; qualitative classification is robust
- **Specificity comes from experience** — actual error messages, actual tool names, actual numbers. The a11y tree captures all of this

The pipeline turns raw screen activity into [moments](https://www.june.kim/moments) — condensed markdown units carrying what the user actually produced. Moments enter salience, where they compete for attention. Winners feed synthesis. The specifics in the vibelog come from the moments carrying actual code, actual errors, actual decisions — not from an LLM hallucinating plausible details.

## Pipeline Stages

1. **Adapters** — source-specific parsers that yield `PerceptionEvent` streams
2. **Dedup / Diffing** — collapse consecutive identical states
3. **Buffer** — accumulate superset diffs, flush on non-superset/app switch/timeout; guarantees moments are complete actions, not fragments
4. **Strip non-language** — remove HTML/UI chrome, leaving markdown-adjacent text
5. **Condensation** — cheap LLM with source-specific prompt produces composable markdown units ([blog post](https://www.june.kim/condensation-preprocess-by-source))
6. **→ Moments** — the output of condensation; the unit of perception that enters salience ([blog post](https://www.june.kim/moments))
7. **Salience** — competitive inhibition; moments race, winners surface, losers decay ([blog post](https://www.june.kim/learn-to-forget))
8. **Synthesis** — LLM drafts a blog post from salient moments
9. **Quality Gate** — freshness filter on the draft; reject if too reconstructable ([blog post](https://www.june.kim/freshness-filter))

### Dedup / Diffing (`pipeline/dedup.ts`)

Two complementary strategies run in sequence as an async generator transform.

**Stage 1: Snapshot Diffing** (traversal events only)

Maintains a per-app snapshot of element trees. When a new traversal arrives for an app, it diffs the current elements against the previous snapshot. If the diff is empty (identical a11y tree), the event is dropped entirely. If there are new elements, the event is yielded with `elements` replaced by only the insertions. On `app_switch`, the previous app's snapshot is cleared.

This catches the common case where the Caret recorder emits full a11y tree snapshots every second even when nothing has changed. For a typical session, ~60-80% of traversal events are identical to the previous one.

**Stage 2: Content Hash Dedup** (all event types)

A bloom filter catches exact-repeat events that survive diffing. Each event type has a type-specific content key:

| Event Type | Identity Key |
|---|---|
| `app_switch` | `app_name + bundleId` |
| `focus` | `role + description + value` |
| `traversal` | `app_name + joined element text` (post-diff) |
| `activity_summary` | `app_name + window_title + keystrokes + clicks` |
| `system` | `internalId` |

Timestamps are excluded from keys — the same content at different times is still a duplicate.

**Why a bloom filter?** For BEHACOM runs (12 users x 55 days x ~1440 events/day = 950K+ events), a bloom filter uses ~2% of the memory of a hash set with constant-time lookups. The tradeoff is a tunable false-positive rate (default 1%) — meaning ~1% of genuinely novel events may be incorrectly dropped. This is acceptable for our offline analysis use case.

**Usage:**

```typescript
import { deduplicate } from '../pipeline/dedup';
import { readCaretEvents } from '../pipeline/adapters/caret';

for await (const event of deduplicate(readCaretEvents(file))) {
  // only novel events reach here
}
```

### Buffer (`pipeline/buffer.ts`)

Accumulates diffs as long as each incoming diff is a superset of the buffered state. Flushes when:

- **Non-superset diff** — the user deleted something, or a different part of the screen changed
- **App switch** — the user moved to a different window
- **Timeout** — the user stopped typing (default 5s)

**Superset detection**: Extract text from elements (`value ?? title ?? description` per element, joined by `\n`). New diff is a superset if `newText.includes(bufferedText)`. Typing "func" → "function" accumulates; deletion "function" → "funct" flushes.

**Per-window buffers**: Key = `app_name + '::' + window_title`. Switching between windows doesn't cause premature flushes.

**Terminal buffer growth**: iTerm2's AXTextArea contains the full visible buffer. Each command output extends it. The substring check merges these because each new snapshot contains the previous as prefix. Flushed on app_switch or timeout.

**Known limitation**: If an unrelated element changes alongside the user's typing (e.g. status bar update), the concatenated text changes and forces a premature flush. Acceptable for v1.

**Why this matters:** Without buffering, someone typing `function handleClick() {` produces a moment per keystroke. With buffering, it produces one moment for the completed edit. This reduces redundant processing and makes moments less likely to be fragments of what follows, though the heuristic assumes typing patterns that won't always hold (e.g. a user who types, deletes, retypes in the same field will flush multiple times).

**Usage:**

```typescript
import { buffer } from '../pipeline/buffer';
import { deduplicate } from '../pipeline/dedup';

for await (const event of buffer(deduplicate(readCaretEvents(file)))) {
  // buffered events reach here
}
```

### Strip non-language (`pipeline/stripper.ts`)

Mechanical pass that removes non-language elements from diffs using a role allowlist. No LLM. The output is markdown-adjacent text.

**Role allowlist** (not blocklist — new roles default to dropped):

Keep: `AXStaticText`, `AXTextArea`, `AXTextField`, `AXHeading`, `AXLink`, `AXWebArea`, `AXCell`

Drop everything else: `AXWindow`, `AXRadioButton` (browser tabs), `AXButton`, `AXCheckBox`, `AXPopUpButton`, `AXImage`, `AXComboBox`, `AXGroup`, etc.

**Markdown conversion** per surviving element: AXHeading → `## title`, AXLink → `[title](description)`, AXTextArea/AXTextField → value, AXStaticText → value or title.

**Near-empty threshold**: Events with < 10 chars of stripped text are dropped. This eliminates YouTube player chrome, image galleries, and other UI-only diffs before any model sees them.

**Metadata enrichment**: Attaches `metadata.stripped_text` (joined markdown) for condensation to consume.

**Usage:**

```typescript
import { strip } from '../pipeline/stripper';

for await (const event of strip(buffer(deduplicate(readCaretEvents(file))))) {
  // stripped events with metadata.stripped_text
}
```

### Condensation (`pipeline/condensation.ts`)

[Source-aware condensation](https://www.june.kim/condensation-preprocess-by-source) with a cheap model. Each source type has a different signal-to-noise profile:

- **Terminal**: commands + key output, stripped of prompt prefixes and scroll artifacts
- **Code editor**: lines written, stripped of unchanged surrounding context
- **Conversation**: messages, stripped of timestamps and UI indicators
- **Browser**: article/docs text for first visits (context); near-empty for media sites (dropped)

**Source detection**: Maps `app_name` to `SourceType` via lookup table (iTerm2→terminal, Code→code_editor, Chrome→browser, Slack→conversation, etc.). Unknown → 'other'.

**LLM abstraction**: Accepts an `LLMFn` callback — no SDK dependency in the pipeline module. The caller constructs the callback from whichever SDK they prefer.

**Context collection**: Non-traversal events accumulate in a buffer. When a traversal produces a moment, the buffered context is attached and cleared.

Reads `metadata.stripped_text` from the stripper stage. Missing/empty → skip.

**Input:** Stripped diffs from the previous stage.

**Output:** An ordered list of `Moment` objects — markdown snippets carrying the condensed signal from each user-produced diff, with surrounding context events (app switches, focus changes) attached as metadata.

**Usage:**

```typescript
import { condense } from '../pipeline/condensation';

const llm: LLMFn = async (text, systemPrompt) => {
  // call your preferred LLM SDK
};
const moments = condense(strip(buffer(deduplicate(readCaretEvents(file)))), { llm });
for await (const moment of moments) {
  console.log(moment.content);
}
```

### Salience (not yet implemented)

Moments are the candidates that enter [competitive inhibition](https://www.june.kim/learn-to-forget). All recent moments race against each other, weighted by similarity to whatever the user is doing right now. Most lose and decay. The winners surface for cognition.

What surfaces gets used: an agent coordinates work from it, a synthesis stage writes from it, a retrieval system indexes it. If a moment keeps winning across sessions, it earns long-term storage. Most don't survive past a session.

A moment is a unit of perception. Memory is what a moment becomes.

### Synthesis (not yet implemented)

Takes the salient moments and produces a blog post draft. The LLM receives:

1. The winning moments — condensed markdown snippets (actual code, actual error messages, actual decisions)
2. Context metadata — first-visit content the user was reading, session duration, apps used
3. A prompt: write a blog post where every claim traces back to a moment. No filler. If a moment doesn't contribute to the argument, skip it.

The draft should read like a [vibelogging](https://www.june.kim/vibelogging) post — specific enough that a reader could follow the same steps, opinionated enough that the decisions are justified, not just described. Moments are already condensed markdown, so the synthesis stage works with clean text, not raw accessibility trees. The moment ordering provides the narrative arc (what happened, what went wrong, what I learned).

**Open questions:**

- Should the synthesis prompt produce the full post, or a structured outline that a second pass expands? Outline-first might be more controllable.
- What's the right voice? The vibelogging post argues for first-person, opinionated, spec-depth prose. The prompt should encode that.

### Quality Gate (not yet implemented)

The [freshness filter](https://www.june.kim/freshness-filter) runs once on the synthesis output — one frontier-model call per session. If the draft scores above 80% reconstructable, the synthesis stage produced generic prose despite having specific moments to write from. Send it back with feedback pointing at the actual code, actual errors, and actual decisions sitting in the moment data.

The quality gate isn't defending against an adversary — it's catching the pipeline's own synthesis stage producing generic filler instead of using the specifics sitting in the recording data. If the synthesis prompt has access to real moments and still produces interchangeable paragraphs, the fix is pointing it back at the data, not tuning a rubric.

See also: [slop detection experiments](https://www.june.kim/slop-detection) for why numeric rubrics are gameable and the bare reconstructability prompt outperforms elaborate scoring.

### Snapshot Boundaries (`src/renderer.ts`)

The renderer emits `{"event":"snapshot_end","seq":N}` separator lines into the JSONL after each `TraversalCompleted` event. This marks the end of each sidecar observation cycle (app check → focus → window update → traversal). The sequence counter resets to 0 on each new recording session. The pipeline adapter skips these lines gracefully — `mapSidecarEventType` returns `null` for unknown event types.

## Benchmark (2026-03-11, ~30s session)

```
Stage          Events   Elements
raw                69        268
dedup              20        105
buffer             20        105
stripper           16         42

By type:        Raw  Dedup  Buffer  Strip
  app_switch:    14      4       4      4
  focus:         13      5       5      5
  traversal:     42     11      11      7
```

Dedup provides the largest reduction (71% of events). Buffer has no effect on this short session — the ~1s snapshot frequency means each post-dedup traversal is already a non-superset diff. Longer typing sessions with many sequential supersets will show more buffer compression. Stripper drops 4 traversals (all-chrome events) and cuts elements from 105 to 42 (60% reduction). Condensation is not benchmarked here since it requires an LLM call.

## Running

```bash
# Caret adapter
npx tsx pipeline/adapters/caret.ts Recordings/context-*.jsonl

# BEHACOM adapter
npx tsx pipeline/adapters/behacom.ts /path/to/User_1_BEHACOM.csv

# Tests
npx tsx pipeline/test_dedup.ts
npx tsx pipeline/test_buffer.ts
npx tsx pipeline/test_stripper.ts
npx tsx pipeline/test_condensation.ts

# Benchmark dedup on real data
npx tsx pipeline/bench_dedup.ts Recordings/context-*.jsonl

# Benchmark full mechanical pipeline (no LLM)
npx tsx pipeline/bench_pipeline.ts Recordings/context-*.jsonl
```
