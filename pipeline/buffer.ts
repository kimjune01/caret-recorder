// Buffer stage: accumulate superset diffs, flush on non-superset/app switch/timeout.
//
// After dedup, traversal events contain only insertions (changed elements).
// The buffer detects whether each new diff is a superset of the buffered state
// (e.g. typing "func" → "function") and accumulates. Non-superset diffs (e.g.
// deletion "function" → "funct") flush the buffer and start a new one.
//
// Per-window buffers allow switching between windows without premature flushes.
//
// Usage:
//   import { buffer } from './buffer';
//   for await (const event of buffer(deduplicate(readCaretEvents(file)))) { ... }

import type { PerceptionEvent, AccessibilityElement } from './common';

export interface BufferOptions {
  timeoutMs?: number; // default 5000
}

/** Extract text from elements: value ?? title ?? description per element, joined by \n. */
export function extractText(elements: AccessibilityElement[]): string {
  return elements
    .map((el) => el.value ?? el.title ?? el.description ?? '')
    .filter((s) => s.length > 0)
    .join('\n');
}

interface BufferedEntry {
  event: PerceptionEvent;
  text: string;
}

/**
 * Buffer stage: accumulates superset traversal diffs, flushes on
 * non-superset, app_switch, timeout, or end of stream.
 * Non-traversal events pass through immediately.
 */
export async function* buffer(
  events: AsyncIterable<PerceptionEvent>,
  opts?: BufferOptions,
): AsyncGenerator<PerceptionEvent> {
  const timeoutMs = opts?.timeoutMs ?? 5000;

  // Per-window buffers: key = app_name + '::' + window_title
  const buffers = new Map<string, BufferedEntry>();

  function bufferKey(event: PerceptionEvent): string {
    return `${event.app_name ?? ''}::${event.window_title ?? ''}`;
  }

  function* flushBuffer(key: string): Generator<PerceptionEvent> {
    const entry = buffers.get(key);
    if (entry) {
      buffers.delete(key);
      yield entry.event;
    }
  }

  function* flushAllForApp(appName: string | null): Generator<PerceptionEvent> {
    const prefix = `${appName ?? ''}::`;
    for (const [key] of buffers) {
      if (key.startsWith(prefix)) {
        yield* flushBuffer(key);
      }
    }
  }

  function* flushAll(): Generator<PerceptionEvent> {
    for (const [key] of [...buffers]) {
      yield* flushBuffer(key);
    }
  }

  for await (const event of events) {
    // Non-traversal events: pass through, but app_switch flushes first
    if (event.event_type !== 'traversal') {
      if (event.event_type === 'app_switch') {
        yield* flushAllForApp(event.app_name);
      }
      yield event;
      continue;
    }

    // Traversal event
    if (!event.elements || event.elements.length === 0) {
      yield event;
      continue;
    }

    const key = bufferKey(event);
    const newText = extractText(event.elements);
    const existing = buffers.get(key);

    if (!existing) {
      // Nothing buffered for this window — start buffer
      buffers.set(key, { event, text: newText });
      continue;
    }

    // Check timeout
    if (event.timestamp_ms - existing.event.timestamp_ms > timeoutMs) {
      yield* flushBuffer(key);
      buffers.set(key, { event, text: newText });
      continue;
    }

    // Superset check: new text contains the buffered text
    if (newText.includes(existing.text)) {
      // Accumulate — replace buffer with newer (superset) event
      buffers.set(key, { event, text: newText });
    } else {
      // Non-superset — flush old, start new buffer
      yield* flushBuffer(key);
      buffers.set(key, { event, text: newText });
    }
  }

  // End of stream — flush all remaining buffers
  yield* flushAll();
}
