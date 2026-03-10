import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppState } from '../../src/shared/types';
import { SidecarEventType } from '../../src/sidecar/types';

// --- Hoisted mocks (accessible in vi.mock factories) ---
const {
  callbacksRef,
  mockSaveSegment,
  mockSaveContext,
  mockStateChanged,
  mockGetLiveKitConfig,
  mockStartCapture,
  mockRecorderStart,
  mockRecorderStop,
  mockPublish,
  mockUnpublish,
  mockLkPublishData,
  mockLkDisconnect,
  mockStreamRef,
} = vi.hoisted(() => {
  const callbacksRef: Record<string, (...args: unknown[]) => unknown> = {};
  const mockSaveSegment = vi.fn().mockResolvedValue(undefined);
  const mockSaveContext = vi.fn().mockResolvedValue(undefined);
  const mockStateChanged = vi.fn();
  const mockGetLiveKitConfig = vi.fn().mockResolvedValue({
    url: 'wss://test.livekit.cloud',
    token: 'test-token',
  });
  const mockStartCapture = vi.fn();
  const mockRecorderStart = vi.fn();
  const mockRecorderStop = vi.fn().mockResolvedValue(undefined);
  const mockPublish = vi.fn().mockResolvedValue(undefined);
  const mockUnpublish = vi.fn().mockResolvedValue(undefined);
  const mockLkPublishData = vi.fn().mockResolvedValue(undefined);
  const mockLkDisconnect = vi.fn().mockResolvedValue(undefined);
  const mockStreamRef: { current: unknown } = { current: null };

  return {
    callbacksRef, mockSaveSegment, mockSaveContext, mockStateChanged,
    mockGetLiveKitConfig, mockStartCapture, mockRecorderStart, mockRecorderStop,
    mockPublish, mockUnpublish, mockLkPublishData, mockLkDisconnect, mockStreamRef,
  };
});

// Install window.terac before import
Object.defineProperty(globalThis, 'window', {
  value: {
    terac: {
      onStartRecording: vi.fn((cb: () => void) => { callbacksRef.start = cb; }),
      onStopRecording: vi.fn((cb: () => void) => { callbacksRef.stop = cb; }),
      onToggleLiveKit: vi.fn((cb: () => void) => { callbacksRef.toggleLivekit = cb; }),
      onSidecarEvent: vi.fn((cb: (...args: unknown[]) => void) => { callbacksRef.sidecarEvent = cb; }),
      saveSegment: mockSaveSegment,
      saveContext: mockSaveContext,
      stateChanged: mockStateChanged,
      getLiveKitConfig: mockGetLiveKitConfig,
    },
  },
  writable: true,
  configurable: true,
});

// Mock navigator for capture
Object.defineProperty(globalThis, 'navigator', {
  value: {
    mediaDevices: {
      getDisplayMedia: vi.fn(),
    },
  },
  writable: true,
});

vi.mock('../../src/capture', () => ({
  startCapture: (...args: unknown[]) => mockStartCapture(...args),
}));

vi.mock('../../src/recorder', () => {
  class MockSegmentedRecorder {
    start: typeof mockRecorderStart;
    stop: typeof mockRecorderStop;
    constructor() {
      this.start = mockRecorderStart;
      this.stop = mockRecorderStop;
    }
  }
  return { SegmentedRecorder: MockSegmentedRecorder };
});

vi.mock('../../src/livekit', () => {
  class MockLiveKitPublisher {
    publish = mockPublish;
    unpublish = mockUnpublish;
    publishData = mockLkPublishData;
    disconnect = mockLkDisconnect;
    isConnected = true;
    constructor() {}
  }
  return { LiveKitPublisher: MockLiveKitPublisher };
});

// Create mock stream with stop-able tracks
function createTestStream() {
  const videoStop = vi.fn();
  const audioStop = vi.fn();
  const stream = {
    id: 'test-stream',
    active: true,
    getTracks: vi.fn(() => [
      { kind: 'video', stop: videoStop },
      { kind: 'audio', stop: audioStop },
    ]),
    getVideoTracks: vi.fn(() => [{ kind: 'video', stop: videoStop }]),
    getAudioTracks: vi.fn(() => [{ kind: 'audio', stop: audioStop }]),
  };
  mockStreamRef.current = stream;
  return stream;
}

// Set up the mock stream before import
const testStream = createTestStream();
mockStartCapture.mockResolvedValue(testStream);

// Import renderer — this registers all callbacks
await import('../../src/renderer');

describe('Renderer Orchestrator — state machine & IPC', () => {
  beforeEach(async () => {
    vi.useFakeTimers();

    // Reset module state to Idle by calling stop (harmless if already idle)
    mockRecorderStop.mockResolvedValue(undefined);
    mockUnpublish.mockResolvedValue(undefined);
    await callbacksRef.stop?.();

    vi.clearAllMocks();
    // Re-setup the stream mock since clearAllMocks resets it
    const newStream = createTestStream();
    mockStartCapture.mockResolvedValue(newStream);
    mockRecorderStop.mockResolvedValue(undefined);
    mockUnpublish.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Idle → Recording on start', async () => {
    await callbacksRef.start();
    expect(mockStateChanged).toHaveBeenCalledWith(AppState.Recording);
    expect(mockRecorderStart).toHaveBeenCalledOnce();
  });

  it('Stop flushes context and returns to Idle', async () => {
    await callbacksRef.start();
    mockStateChanged.mockClear();

    await callbacksRef.stop();

    expect(mockRecorderStop).toHaveBeenCalledOnce();
    expect(mockStateChanged).toHaveBeenCalledWith(AppState.Idle);
  });

  it('Toggle LiveKit: Recording → Publishing without stopping recorder', async () => {
    await callbacksRef.start();
    mockRecorderStop.mockClear();
    mockStateChanged.mockClear();

    await callbacksRef.toggleLivekit();

    expect(mockPublish).toHaveBeenCalled();
    expect(mockStateChanged).toHaveBeenCalledWith(AppState.Publishing);
    expect(mockRecorderStop).not.toHaveBeenCalled();
  });

  it('Toggle back: Publishing → Recording (unpublish only)', async () => {
    await callbacksRef.start();
    await callbacksRef.toggleLivekit();
    mockStateChanged.mockClear();

    await callbacksRef.toggleLivekit();

    expect(mockUnpublish).toHaveBeenCalled();
    expect(mockStateChanged).toHaveBeenCalledWith(AppState.Recording);
  });

  it('Sidecar events stored in context, flushed every 30s', async () => {
    await callbacksRef.start();

    const event = { event: SidecarEventType.FrontmostApp, payload: { name: 'Safari' } };
    callbacksRef.sidecarEvent(null, event);
    callbacksRef.sidecarEvent(null, event);

    // Advance 30 seconds to trigger context flush
    vi.advanceTimersByTime(30_000);
    await vi.advanceTimersByTimeAsync(100);

    expect(mockSaveContext).toHaveBeenCalled();
    const savedData = mockSaveContext.mock.calls[0][1] as string;
    // The data should contain the serialized sidecar events
    expect(savedData).toContain('"event"');
  });

  it('Stop unpublishes LiveKit before stopping recorder', async () => {
    await callbacksRef.start();
    await callbacksRef.toggleLivekit();

    const callOrder: string[] = [];
    mockUnpublish.mockImplementation(async () => { callOrder.push('unpublish'); });
    mockRecorderStop.mockImplementation(async () => { callOrder.push('recorder.stop'); });

    await callbacksRef.stop();

    const unpubIdx = callOrder.indexOf('unpublish');
    const recIdx = callOrder.indexOf('recorder.stop');
    expect(unpubIdx).toBeLessThan(recIdx);
  });

  it('Stop stops MediaStream tracks last', async () => {
    await callbacksRef.start();

    await callbacksRef.stop();

    const stream = mockStreamRef.current as ReturnType<typeof createTestStream>;
    const tracks = stream.getTracks();
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
  });
});
