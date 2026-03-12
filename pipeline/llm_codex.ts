// LLMFn implementation using codex CLI (gpt-5.4 via ChatGPT account).
//
// Writes the prompt via stdin to codex exec to avoid arg length limits.
// Sanitization of control characters happens upstream in the stripper stage.
//
// Usage:
//   import { codexLLM } from './llm_codex';
//   const moments = condense(strip(buffer(dedup(events))), { llm: codexLLM });

import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMFn } from './common';

/** Call codex exec with combined prompt via stdin, return the response text. */
export const codexLLM: LLMFn = async (
  text: string,
  systemPrompt: string,
): Promise<string> => {
  const prompt = `${systemPrompt}\n\n---\n\nHere is the raw accessibility tree text to condense:\n\n${text}`;
  const outFile = join(
    tmpdir(),
    `codex-out-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'codex',
        ['exec', '--ephemeral', '-o', outFile, '-'],
        { stdio: ['pipe', 'ignore', 'ignore'], timeout: 60_000 },
      );

      child.stdin.write(prompt);
      child.stdin.end();

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`codex exec exited with code ${code}`));
      });
      child.on('error', reject);
    });

    const output = await readFile(outFile, 'utf-8');
    return output.trim();
  } finally {
    await unlink(outFile).catch(() => {});
  }
};
