// Canonical event format for the perception pipeline.
// All source adapters normalize to this shape.

import { SidecarEventType } from '../src/sidecar/types';

export type EventSource = 'caret' | 'behacom';

export type EventType =
  | 'app_switch'
  | 'focus'
  | 'traversal'
  | 'activity_summary'
  | 'system';

export interface AccessibilityElement {
  depth?: number;
  role: string;
  title?: string;
  value?: string;
  description?: string;
}

export interface PerceptionEvent {
  timestamp_ms: number; // Unix epoch ms, 0 if unavailable
  source: EventSource;
  event_type: EventType;
  app_name: string | null;
  window_title: string | null;
  elements: AccessibilityElement[] | null;
  metadata: Record<string, unknown>;
}

export type SourceType = 'terminal' | 'code_editor' | 'conversation' | 'browser' | 'other';

export type LLMFn = (text: string, systemPrompt: string) => Promise<string>;

export interface Moment {
  timestamp_ms: number;
  source_app: string;
  source_type: SourceType;
  content: string;              // condensed markdown
  context: PerceptionEvent[];   // surrounding non-traversal events
}

// Map sidecar event types to pipeline event types.
// Returns null for events we skip.
export function mapSidecarEventType(
  event: SidecarEventType,
): EventType | null {
  switch (event) {
    case SidecarEventType.FrontmostApp:
      return 'app_switch';
    case SidecarEventType.ElementFocus:
      return 'focus';
    case SidecarEventType.TraversalCompleted:
      return 'traversal';
    case SidecarEventType.SystemEventReceived:
      return 'system';
    default:
      return null; // WindowUpdate, Meeting*, AudioEnergy — skip
  }
}
