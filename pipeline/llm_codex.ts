// LLMFn implementation using codex CLI (gpt-5.4 via ChatGPT account).
//
// Writes the prompt to a temp file and pipes it via stdin to avoid
// arg length limits and null byte issues in process arguments.
//
// Usage:
//   import { codexLLM } from './llm_codex';
//   const moments = condense(strip(buffer(dedup(events))), { llm: codexLLM });

import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMFn } from './common';

/** Strip null bytes and other control chars that break child_process. */
function sanitize(s: string): string {
  return s.replace(/\0/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** Call codex exec with combined prompt via stdin, return the response text. */
export const codexLLM: LLMFn = async (
  text: string,
  systemPrompt: string,
): Promise<string> => {
  const prompt = sanitize(
    `${systemPrompt}\n\n---\n\nHere is the raw accessibility tree text to condense:\n\n${text}`,
  );
  const outFile = join(
    tmpdir(),
    `codex-out-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );
  const promptFile = join(
    tmpdir(),
    `codex-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );

  try {
    await writeFile(promptFile, prompt, 'utf-8');

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
    await unlink(promptFile).catch(() => {});
  }
};
