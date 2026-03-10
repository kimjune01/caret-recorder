import { AppState, LiveKitConfig } from './shared/types';
import { startCapture } from './capture';
import { SegmentedRecorder } from './recorder';
import { LiveKitPublisher } from './livekit';
import { SidecarEvent, SidecarEventType } from './sidecar/types';

declare const window: Window & {
  terac: {
    onStartRecording: (callback: () => void) => void;
    onStopRecording: (callback: () => void) => void;
    onToggleLiveKit: (callback: () => void) => void;
    onSidecarEvent: (callback: (_event: unknown, data: SidecarEvent) => void) => void;
    saveSegment: (filename: string, data: ArrayBuffer) => Promise<void>;
    saveContext: (filename: string, data: string) => Promise<void>;
    stateChanged: (state: string) => void;
    getLiveKitConfig: () => Promise<LiveKitConfig>;
  };
};

let stream: MediaStream | null = null;
let recorder: SegmentedRecorder | null = null;
let livekit: LiveKitPublisher | null = null;
let state: AppState = AppState.Idle;
let contextLines: string[] = [];
let contextFlushTimer: ReturnType<typeof setInterval> | null = null;
let sessionTimestamp: string | null = null;

function setState(newState: AppState): void {
  state = newState;
  window.terac.stateChanged(state);
  console.log(`[Renderer] State: ${state}`);
}

async function handleStart(): Promise<void> {
  if (state !== AppState.Idle) return;

  try {
    stream = await startCapture();
  } catch (err) {
    console.error('[Renderer] Failed to start capture. Is screen recording permission granted?', err);
    return;
  }

  sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  recorder = new SegmentedRecorder(stream);
  recorder.start();
  setState(AppState.Recording);

  // Start flushing context data periodically
  contextFlushTimer = setInterval(flushContext, 30_000);
}

async function handleStop(): Promise<void> {
  if (state === AppState.Idle) return;

  // Unpublish from LiveKit first
  if (livekit) {
    try { await livekit.unpublish(); } catch (err) {
      console.error('[Renderer] Error unpublishing from LiveKit:', err);
    }
  }

  // Stop recorder and flush final segment
  if (recorder) {
    try { await recorder.stop(); } catch (err) {
      console.error('[Renderer] Error stopping recorder:', err);
    }
    recorder = null;
  }

  // Flush remaining context
  await flushContext();
  if (contextFlushTimer) {
    clearInterval(contextFlushTimer);
    contextFlushTimer = null;
  }

  // Stop media tracks
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  setState(AppState.Idle);
}

async function handleToggleLiveKit(): Promise<void> {
  if (state === AppState.Idle || !stream) return;

  if (state === AppState.Publishing) {
    // Unpublish but keep recording
    if (livekit) {
      try { await livekit.unpublish(); } catch (err) {
        console.error('[Renderer] Error unpublishing:', err);
      }
    }
    setState(AppState.Recording);
  } else {
    // Start publishing
    try {
      if (!livekit) {
        const config = await window.terac.getLiveKitConfig();
        livekit = new LiveKitPublisher(config);
      }
      await livekit.publish(stream);
      setState(AppState.Publishing);
    } catch (err) {
      console.error('[Renderer] Failed to publish to LiveKit:', err);
      // Stay in Recording state — don't break local recording
    }
  }
}

function handleSidecarEvent(_event: unknown, data: SidecarEvent): void {
  // Store context for disk archival
  contextLines.push(JSON.stringify(data));

  // Forward traversal data to LiveKit data channel
  if (state === AppState.Publishing && livekit?.isConnected) {
    if (data.event === SidecarEventType.TraversalCompleted) {
      const encoder = new TextEncoder();
      const payload = encoder.encode(JSON.stringify(data.payload));
      livekit.publishData(payload, 'context').catch((err) => {
        console.warn('[Renderer] Failed to publish context data:', err);
      });
    }
  }
}

async function flushContext(): Promise<void> {
  if (contextLines.length === 0 || !sessionTimestamp) return;

  const data = contextLines.join('\n') + '\n';
  contextLines = [];
  const filename = `context-${sessionTimestamp}.jsonl`;

  try {
    await window.terac.saveContext(filename, data);
  } catch (err) {
    console.error('[Renderer] Failed to save context:', err);
  }
}

// Wire up IPC commands
window.terac.onStartRecording(handleStart);
window.terac.onStopRecording(handleStop);
window.terac.onToggleLiveKit(handleToggleLiveKit);
window.terac.onSidecarEvent(handleSidecarEvent);

console.log('[Renderer] Orchestrator initialized');
