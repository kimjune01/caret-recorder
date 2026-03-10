// Application state
export enum AppState {
  Idle = 'idle',
  Recording = 'recording',
  Publishing = 'publishing', // recording + LiveKit publish
}

// IPC channel names
export const IPC = {
  // Commands from main → renderer
  START_RECORDING: 'command:start-recording',
  STOP_RECORDING: 'command:stop-recording',
  TOGGLE_LIVEKIT: 'command:toggle-livekit',

  // Events from renderer → main
  STATE_CHANGED: 'state:changed',
  SAVE_SEGMENT: 'segment:save',
  SAVE_CONTEXT: 'context:save',

  // Sidecar events from main → renderer
  SIDECAR_EVENT: 'sidecar:event',

  // LiveKit config from main → renderer
  GET_LIVEKIT_CONFIG: 'config:get-livekit',
} as const;

// Recording/capture constants (safe for both main and renderer)
export const CONFIG = {
  SEGMENT_DURATION_MS: 5 * 60 * 1000, // 5 minutes
  RECORDINGS_DIR: 'Terac/Recordings',
  VIDEO_CODEC: 'video/webm;codecs=vp8,opus',
  VIDEO_BITRATE: 2_500_000, // 2.5 Mbps
  FRAME_RATE: 30,
  WIDTH: 1920,
  HEIGHT: 1080,
  DATA_COLLECT_INTERVAL_MS: 1000,
} as const;

// LiveKit config — only used in main process, passed to renderer via IPC
export interface LiveKitConfig {
  url: string;
  token: string;
}
