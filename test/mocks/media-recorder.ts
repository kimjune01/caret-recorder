import { vi } from 'vitest';

export class MockMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  private stream: MediaStream;
  private options: MediaRecorderOptions;
  private collectInterval: ReturnType<typeof setInterval> | null = null;

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream;
    this.options = options || {};
  }

  start(timeslice?: number): void {
    this.state = 'recording';
    if (timeslice && this.ondataavailable) {
      // Simulate periodic data collection
      this.collectInterval = setInterval(() => {
        if (this.ondataavailable && this.state === 'recording') {
          this.ondataavailable({ data: new Blob(['chunk'], { type: 'video/webm' }) });
        }
      }, timeslice);
    }
  }

  stop(): void {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
    }
    this.state = 'inactive';
    // Emit one final data chunk before onstop
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['final-chunk'], { type: 'video/webm' }) });
    }
    // Call onstop asynchronously to match real API
    if (this.onstop) {
      setTimeout(() => this.onstop?.(), 0);
    }
  }

  static isTypeSupported = vi.fn().mockReturnValue(true);
}
