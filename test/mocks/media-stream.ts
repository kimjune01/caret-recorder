import { vi } from 'vitest';

export function createMockMediaStreamTrack(kind: 'video' | 'audio'): MediaStreamTrack {
  return {
    kind,
    id: `mock-${kind}-${Math.random().toString(36).slice(2)}`,
    enabled: true,
    muted: false,
    readyState: 'live' as MediaStreamTrackState,
    label: `Mock ${kind} track`,
    stop: vi.fn(),
    clone: vi.fn(),
    getSettings: vi.fn(() => ({})),
    getConstraints: vi.fn(() => ({})),
    getCapabilities: vi.fn(() => ({})),
    applyConstraints: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onended: null,
    onmute: null,
    onunmute: null,
    contentHint: '',
  } as unknown as MediaStreamTrack;
}

export function createMockMediaStream(): MediaStream {
  const videoTrack = createMockMediaStreamTrack('video');
  const audioTrack = createMockMediaStreamTrack('audio');
  const tracks = [videoTrack, audioTrack];

  return {
    id: `mock-stream-${Math.random().toString(36).slice(2)}`,
    active: true,
    getTracks: vi.fn(() => [...tracks]),
    getVideoTracks: vi.fn(() => [videoTrack]),
    getAudioTracks: vi.fn(() => [audioTrack]),
    getTrackById: vi.fn((id: string) => tracks.find((t) => t.id === id) || null),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onaddtrack: null,
    onremovetrack: null,
    onactive: null,
    oninactive: null,
  } as unknown as MediaStream;
}
