// Condensation stage: source-aware LLM extraction of signal from stripped diffs.
//
// Each source type (terminal, code editor, browser, conversation) gets a
// tailored system prompt. The LLM extracts the signal and produces a composable
// markdown unit — a Moment.
//
// The LLM is injected as a callback (LLMFn), so this module has no SDK dependency.
//
// Usage:
//   import { condense } from './condensation';
//   const moments = condense(strip(buffer(dedup(events))), { llm: myLLMFn });

import type { PerceptionEvent, Moment, SourceType, LLMFn } from './common';

export interface CondenseOptions {
  llm: LLMFn;
}

/** Map app names to source types. */
export const SOURCE_MAP: Record<string, SourceType> = {
  // Terminal
  'iTerm2': 'terminal',
  'Terminal': 'terminal',
  'Alacritty': 'terminal',
  'kitty': 'terminal',
  'Warp': 'terminal',
  'Hyper': 'terminal',

  // Code editors
  'Code': 'code_editor',
  'Visual Studio Code': 'code_editor',
  'Xcode': 'code_editor',
  'Sublime Text': 'code_editor',
  'Cursor': 'code_editor',
  'Zed': 'code_editor',
  'IntelliJ IDEA': 'code_editor',
  'WebStorm': 'code_editor',
  'PyCharm': 'code_editor',
  'Nova': 'code_editor',

  // Browsers
  'Google Chrome': 'browser',
  'Safari': 'browser',
  'Firefox': 'browser',
  'Arc': 'browser',
  'Brave Browser': 'browser',
  'Microsoft Edge': 'browser',

  // Conversation
  'Slack': 'conversation',
  'Messages': 'conversation',
  'Discord': 'conversation',
  'Telegram': 'conversation',
  'Microsoft Teams': 'conversation',
  'Zoom': 'conversation',
};

/** Detect source type from app name. */
export function detectSourceType(appName: string | null): SourceType {
  if (!appName) return 'other';
  return SOURCE_MAP[appName] ?? 'other';
}

/** Source-specific system prompts for condensation. */
export const PROMPTS: Record<SourceType, string> = {
  terminal: `You are extracting signal from terminal output captured via accessibility tree.
Extract the commands the user ran and their key output. Strip prompt prefixes (e.g. "$ ", "% ", "user@host:~$ "), ANSI escape codes, and scroll artifacts. Keep error messages, test results, and build output verbatim. Produce concise markdown.
If there is no meaningful command or output, return empty string.`,

  code_editor: `You are extracting signal from code editor content captured via accessibility tree.
Extract the lines the user wrote or modified. Strip unchanged boilerplate context (imports that didn't change, unmodified function signatures). Keep actual code changes, new functions, and error annotations. Produce concise markdown with code blocks.
If there is no meaningful code change, return empty string.`,

  browser: `You are extracting signal from browser content captured via accessibility tree.
Extract article text, documentation content, or meaningful page content. Strip navigation elements, ads, cookie banners, and repeated UI chrome. Keep headings, key paragraphs, and code examples from docs. Produce concise markdown.
If the page is mostly media (video player, image gallery) with no text content, return empty string.`,

  conversation: `You are extracting signal from a messaging app captured via accessibility tree.
Preserve the messages the user sent and received. Strip timestamps, read receipts, typing indicators, and UI elements. Keep the conversation thread intact with speaker attribution where possible. Produce concise markdown.
If there are no meaningful messages, return empty string.`,

  other: `You are extracting signal from a desktop application captured via accessibility tree.
Extract any meaningful text content the user produced or consumed. Strip UI chrome, button labels, and window decorations. Keep document text, form content, and data. Produce concise markdown.
If there is no meaningful content, return empty string.`,
};

/**
 * Condensation stage: LLM-powered extraction of signal from stripped diffs.
 * Non-traversal events accumulate as context, attached to the next moment.
 */
export async function* condense(
  events: AsyncIterable<PerceptionEvent>,
  opts: CondenseOptions,
): AsyncGenerator<Moment> {
  const { llm } = opts;
  const contextBuffer: PerceptionEvent[] = [];

  for await (const event of events) {
    // Non-traversal events accumulate as context
    if (event.event_type !== 'traversal') {
      contextBuffer.push(event);
      continue;
    }

    // Read stripped_text from metadata (set by stripper stage)
    const strippedText = event.metadata.stripped_text as string | undefined;
    if (!strippedText || strippedText.length === 0) {
      continue;
    }

    // Detect source type and select prompt
    const sourceType = detectSourceType(event.app_name);
    const systemPrompt = PROMPTS[sourceType];

    // Call LLM
    const content = await llm(strippedText, systemPrompt);

    // Empty response means no signal
    if (!content || content.trim().length === 0) {
      continue;
    }

    // Produce moment
    const moment: Moment = {
      timestamp_ms: event.timestamp_ms,
      source_app: event.app_name ?? 'unknown',
      source_type: sourceType,
      content: content.trim(),
      context: [...contextBuffer],
    };

    // Reset context buffer
    contextBuffer.length = 0;

    yield moment;
  }
}
