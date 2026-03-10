// Global test setup — polyfills for browser APIs not available in Node

import { vi } from 'vitest';

// Blob is available in Node 18+, but TextEncoder needs globalThis assignment
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = await import('util');
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// Stub console.log/warn/error to keep test output clean
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
