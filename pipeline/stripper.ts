// Strip non-language elements from traversal events.
//
// Mechanical pass — no LLM. Keeps only roles that carry human-readable text
// (AXStaticText, AXTextArea, etc.), converts surviving elements to markdown,
// and drops events that strip to near-empty.
//
// Usage:
//   import { strip } from './stripper';
//   for await (const event of strip(buffer(deduplicate(readCaretEvents(file))))) { ... }

import type { PerceptionEvent, AccessibilityElement } from './common';

/** Roles that carry human-readable language content. */
export const LANGUAGE_ROLES = new Set([
  'AXStaticText',
  'AXTextArea',
  'AXTextField',
  'AXHeading',
  'AXLink',
  'AXWebArea',
  'AXCell',
]);

export interface StripOptions {
  keepRoles?: Set<string>;    // override LANGUAGE_ROLES
  minChars?: number;          // near-empty threshold (default 10)
}

/** Strip null bytes and control characters from a11y text. */
function sanitize(s: string): string {
  return s.replace(/\0/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** Convert a single element to markdown based on its role. */
export function elementToMarkdown(el: AccessibilityElement): string {
  const title = el.title ? sanitize(el.title) : undefined;
  const value = el.value ? sanitize(el.value) : undefined;
  const description = el.description ? sanitize(el.description) : undefined;
  switch (el.role) {
    case 'AXHeading':
      return `## ${title ?? ''}`;
    case 'AXLink':
      if (description) {
        return `[${title ?? ''}](${description})`;
      }
      return title ?? value ?? '';
    case 'AXTextArea':
    case 'AXTextField':
      return value ?? title ?? '';
    case 'AXStaticText':
      return value ?? title ?? '';
    case 'AXCell':
      return value ?? title ?? '';
    case 'AXWebArea':
      return title ?? value ?? '';
    default:
      return value ?? title ?? description ?? '';
  }
}

/** Filter elements to only those with language roles. */
export function stripElements(
  elements: AccessibilityElement[],
  keepRoles?: Set<string>,
): AccessibilityElement[] {
  const roles = keepRoles ?? LANGUAGE_ROLES;
  return elements.filter((el) => roles.has(el.role));
}

/**
 * Strip stage: remove non-language elements, convert to markdown,
 * drop near-empty events, attach stripped_text metadata.
 */
export async function* strip(
  events: AsyncIterable<PerceptionEvent>,
  opts?: StripOptions,
): AsyncGenerator<PerceptionEvent> {
  const keepRoles = opts?.keepRoles;
  const minChars = opts?.minChars ?? 10;

  for await (const event of events) {
    // Non-traversal events pass through unmodified
    if (event.event_type !== 'traversal') {
      yield event;
      continue;
    }

    if (!event.elements || event.elements.length === 0) {
      continue;
    }

    // Filter to language roles
    const surviving = stripElements(event.elements, keepRoles);
    if (surviving.length === 0) {
      continue;
    }

    // Convert to markdown
    const markdownLines = surviving.map(elementToMarkdown).filter((s) => s.length > 0);
    const strippedText = markdownLines.join('\n');

    // Near-empty threshold
    if (strippedText.length < minChars) {
      continue;
    }

    yield {
      ...event,
      elements: surviving,
      metadata: {
        ...event.metadata,
        stripped_text: strippedText,
      },
    };
  }
}
