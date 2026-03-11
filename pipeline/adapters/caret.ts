// Caret adapter: reads JSONL event files and yields PerceptionEvents.
//
// Usage: npx tsx pipeline/adapters/caret.ts <file.jsonl> [file2.jsonl ...]

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { SidecarEventType } from '../../src/sidecar/types';
import {
  type PerceptionEvent,
  type AccessibilityElement,
  mapSidecarEventType,
} from '../common';

interface RawSidecarEvent {
  event: SidecarEventType;
  payload: Record<string, unknown>;
}

function parseTimestampFromFilename(filepath: string): number {
  // context-2026-03-11T04-19-23-926Z.jsonl → 2026-03-11T04:19:23.926Z
  const match = filepath.match(
    /context-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
  );
  if (!match) return 0;
  const [, date, h, m, s, ms] = match;
  return new Date(`${date}T${h}:${m}:${s}.${ms}Z`).getTime();
}

function buildAppSwitch(
  payload: Record<string, unknown>,
): Partial<PerceptionEvent> {
  return {
    event_type: 'app_switch',
    app_name: (payload.name as string) ?? null,
    window_title: null,
    elements: null,
    metadata: {
      pid: payload.pid,
      bundleId: payload.bundleId,
      windows: payload.windows,
    },
  };
}

function buildFocus(
  payload: Record<string, unknown>,
): Partial<PerceptionEvent> {
  return {
    event_type: 'focus',
    app_name: null,
    window_title: null,
    elements: null,
    metadata: {
      role: payload.role,
      description: payload.description,
      value: payload.value,
      frame: payload.frame,
      selection: payload.selection,
    },
  };
}

function buildTraversal(
  payload: Record<string, unknown>,
): Partial<PerceptionEvent> {
  const elements = (payload.elements as AccessibilityElement[]) ?? null;
  return {
    event_type: 'traversal',
    app_name: (payload.appName as string) ?? null,
    window_title: (payload.windowTitle as string) ?? null,
    elements,
    metadata: {
      startTime: payload.startTime,
      endTime: payload.endTime,
    },
  };
}

function buildSystem(
  payload: Record<string, unknown>,
): Partial<PerceptionEvent> {
  return {
    event_type: 'system',
    app_name: null,
    window_title: null,
    elements: null,
    metadata: {
      internalId: payload.internalId,
    },
  };
}

function toPerceptionEvent(
  raw: RawSidecarEvent,
  sessionStartMs: number,
): PerceptionEvent | null {
  const eventType = mapSidecarEventType(raw.event);
  if (eventType === null) return null;

  let partial: Partial<PerceptionEvent>;
  switch (raw.event) {
    case SidecarEventType.FrontmostApp:
      partial = buildAppSwitch(raw.payload);
      break;
    case SidecarEventType.ElementFocus:
      partial = buildFocus(raw.payload);
      break;
    case SidecarEventType.TraversalCompleted:
      partial = buildTraversal(raw.payload);
      break;
    case SidecarEventType.SystemEventReceived:
      partial = buildSystem(raw.payload);
      break;
    default:
      return null;
  }

  // Traversals have their own timestamps; others use session start (best we have)
  let timestamp_ms = sessionStartMs;
  if (raw.event === SidecarEventType.TraversalCompleted) {
    const endTime = raw.payload.endTime as number | undefined;
    if (endTime) timestamp_ms = Math.round(endTime);
  }

  return {
    timestamp_ms,
    source: 'caret',
    event_type: partial.event_type!,
    app_name: partial.app_name ?? null,
    window_title: partial.window_title ?? null,
    elements: partial.elements ?? null,
    metadata: partial.metadata ?? {},
  };
}

export async function* readCaretEvents(
  filepath: string,
): AsyncGenerator<PerceptionEvent> {
  const sessionStartMs = parseTimestampFromFilename(filepath);

  const rl = createInterface({
    input: createReadStream(filepath, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let raw: RawSidecarEvent;
    try {
      raw = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }
    const event = toPerceptionEvent(raw, sessionStartMs);
    if (event) yield event;
  }
}

// CLI entry point
if (
  process.argv[1] &&
  (process.argv[1].endsWith('caret.ts') ||
    process.argv[1].endsWith('caret.js'))
) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: npx tsx pipeline/adapters/caret.ts <file.jsonl> ...');
    process.exit(1);
  }

  (async () => {
    for (const file of files) {
      for await (const event of readCaretEvents(file)) {
        console.log(JSON.stringify(event));
      }
    }
  })();
}
