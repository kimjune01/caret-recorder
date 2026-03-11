import fixWebmDuration from 'fix-webm-duration';
import { CONFIG } from './shared/types';

declare const window: Window & {
  caret: {
    saveSegment: (filename: string, data: ArrayBuffer) => Promise<void>;
  };
};

/**
 * SegmentedRecorder uses dual overlapping MediaRecorder instances to produce
 * seamless, independently-playable WebM segments without frame drops.
 *
 * Pattern: Two recorders alternate on the same stream. Each produces a complete
 * WebM file with headers. Overlap prevents gaps during rotation.
 */
export class SegmentedRecorder {
  private stream: MediaStream;
  private recorderA: MediaRecorder | null = null;
  private recorderB: MediaRecorder | null = null;
  private chunksA: Blob[] = [];
  private chunksB: Blob[] = [];
  private startTimeA = 0;
  private startTimeB = 0;
  private segmentIndex = 0;
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  private activeRecorder: 'A' | 'B' = 'A';
  private stopping = false;
  private sessionTimestamp: string;

  constructor(stream: MediaStream) {
    this.stream = stream;
    this.sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  }

  start(): void {
    this.stopping = false;
    this.startRecorderA();

    // Rotate segments at the configured interval
    this.rotationTimer = setInterval(() => {
      this.rotate();
    }, CONFIG.SEGMENT_DURATION_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;

    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }

    // Stop whichever recorder(s) are active and flush final segments
    const promises: Promise<void>[] = [];
    if (this.recorderA?.state === 'recording') {
      promises.push(this.stopAndSave(this.recorderA, this.chunksA, this.startTimeA));
    }
    if (this.recorderB?.state === 'recording') {
      promises.push(this.stopAndSave(this.recorderB, this.chunksB, this.startTimeB));
    }

    await Promise.all(promises);
  }

  private startRecorderA(): void {
    this.chunksA = [];
    this.startTimeA = Date.now();
    this.recorderA = this.createRecorder(this.chunksA);
    this.recorderA.start(CONFIG.DATA_COLLECT_INTERVAL_MS);
    this.activeRecorder = 'A';
  }

  private startRecorderB(): void {
    this.chunksB = [];
    this.startTimeB = Date.now();
    this.recorderB = this.createRecorder(this.chunksB);
    this.recorderB.start(CONFIG.DATA_COLLECT_INTERVAL_MS);
    this.activeRecorder = 'B';
  }

  private rotate(): void {
    if (this.stopping) return;

    if (this.activeRecorder === 'A') {
      // Start B first, then stop A (overlap ensures no gap)
      this.startRecorderB();
      if (this.recorderA?.state === 'recording') {
        this.stopAndSave(this.recorderA, this.chunksA, this.startTimeA);
      }
    } else {
      this.startRecorderA();
      if (this.recorderB?.state === 'recording') {
        this.stopAndSave(this.recorderB, this.chunksB, this.startTimeB);
      }
    }
  }

  private createRecorder(chunks: Blob[]): MediaRecorder {
    const recorder = new MediaRecorder(this.stream, {
      mimeType: CONFIG.VIDEO_CODEC,
      videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    return recorder;
  }

  private async stopAndSave(
    recorder: MediaRecorder,
    chunks: Blob[],
    startTime: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        if (chunks.length === 0) {
          resolve();
          return;
        }

        const duration = Date.now() - startTime;
        const blob = new Blob(chunks, { type: CONFIG.VIDEO_CODEC });

        try {
          const fixedBlob = await fixWebmDuration(blob, duration);
          const buffer = await fixedBlob.arrayBuffer();
          const filename = `${this.sessionTimestamp}_${String(this.segmentIndex).padStart(3, '0')}.webm`;
          this.segmentIndex++;

          await window.caret.saveSegment(filename, buffer);
          console.log(`[Recorder] Saved segment: ${filename} (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
        } catch (err) {
          console.error('[Recorder] Failed to save segment:', err);
        }

        resolve();
      };

      recorder.stop();
    });
  }
}
