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
        │   Diffing      │
        └───────┬────────┘
                │
                ▼
        ┌───────────────┐
        │   Salience     │  ← placeholder
        │  (competition) │
        └───────┬────────┘
                │
                ▼
        ┌───────────────┐
        │   Output /     │
        │   Storage      │
        └────────────────┘
```

## Sources

### Caret Recorder

The recorder (`src/sidecar/`) emits JSONL with 9 event types (see `event-schema.md`). Events fire at ~1s intervals with full accessibility tree snapshots. This is the primary high-fidelity source.

### BEHACOM Dataset

12 users x 55 days of desktop activity captured at 1-minute resolution. Each row is an aggregated activity vector (~12K columns): active app, keystrokes, mouse events, window titles. No accessibility trees. See `docs/adapters/behacom.md` for mapping details.

## Common Format

Both adapters yield `PerceptionEvent` objects (defined in `pipeline/common.ts`). The format is deliberately lossy — it captures what both sources provide (timestamps, app context) and carries source-specific data in a `metadata` field.

## Pipeline Stages

1. **Adapters** — source-specific parsers that yield `PerceptionEvent` streams
2. **Dedup / Diffing** — collapse consecutive identical states (e.g. same app, same focused element)
3. **Salience** — competitive inhibition layer (not yet implemented)
4. **Output** — write normalized stream to JSONL or feed downstream consumers

## Running

```bash
# Caret adapter
npx tsx pipeline/adapters/caret.ts ~/Documents/Terac/Recordings/context-*.jsonl

# BEHACOM adapter
npx tsx pipeline/adapters/behacom.ts /path/to/User_1_BEHACOM.csv
```
