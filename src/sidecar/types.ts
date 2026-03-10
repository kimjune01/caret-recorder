// Event types emitted by the Swift sidecar over stdout
export enum SidecarEventType {
  FrontmostApp = 0,
  ElementFocus = 1,
  WindowUpdate = 2,
  TraversalCompleted = 3,
  MeetingAppDetected = 4,
  MeetingStarted = 5,
  MeetingStopped = 6,
  SystemEventReceived = 7,
  AudioEnergyLevelsReceived = 8,
}

export interface SidecarEvent {
  event: SidecarEventType;
  payload: unknown;
}

export interface FrontmostAppPayload {
  name: string;
  pid: number;
  iconBase64: string | null;
  windows: string[];
}

export interface ElementFocusPayload {
  role: string;
  description: string;
  value: string | null;
  frame: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  } | null;
  selection: string | null;
}

export interface TraversalCompletedPayload {
  appName: string;
  results: string;
  startTime: number;
  endTime: number;
  iconBase64: string | null;
}

export interface SystemEventPayload {
  internalId: string;
}

export interface AudioEnergyLevelsPayload {
  latestLevels: number[];
}
