import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMediaStream } from '../mocks/media-stream';

// --- Hoisted mock state ---
const {
  mockConnect,
  mockDisconnect,
  mockPublishTrack,
  mockUnpublishTrack,
  mockPublishData,
  roomRef,
} = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);
  const mockPublishTrack = vi.fn().mockResolvedValue(undefined);
  const mockUnpublishTrack = vi.fn().mockResolvedValue(undefined);
  const mockPublishData = vi.fn().mockResolvedValue(undefined);
  const roomRef: {
    options: Record<string, unknown> | null;
    disconnectedHandler: ((reason?: unknown) => void) | null;
  } = { options: null, disconnectedHandler: null };
  return { mockConnect, mockDisconnect, mockPublishTrack, mockUnpublishTrack, mockPublishData, roomRef };
});

vi.mock('livekit-client', () => {
  function Room(options: Record<string, unknown>) {
    roomRef.options = options;
    const instance = {
      name: 'test-room',
      connect: mockConnect,
      disconnect: mockDisconnect,
      localParticipant: {
        publishTrack: mockPublishTrack,
        unpublishTrack: mockUnpublishTrack,
        publishData: mockPublishData,
      },
      on: vi.fn().mockImplementation(function (this: typeof instance, event: string, handler: (...args: unknown[]) => void) {
        if (event === 'Disconnected') {
          roomRef.disconnectedHandler = handler;
        }
        return this;
      }),
    };
    return instance;
  }

  return {
    Room,
    RoomEvent: {
      Reconnecting: 'Reconnecting',
      Reconnected: 'Reconnected',
      Disconnected: 'Disconnected',
    },
    Track: {
      Source: {
        ScreenShare: 'screen_share',
        ScreenShareAudio: 'screen_share_audio',
      },
    },
    LocalVideoTrack: class MockLocalVideoTrack {
      mediaStreamTrack: MediaStreamTrack;
      _isLocalVideoTrack = true;
      constructor(track: MediaStreamTrack) {
        this.mediaStreamTrack = track;
      }
    },
    LocalAudioTrack: class MockLocalAudioTrack {
      mediaStreamTrack: MediaStreamTrack;
      _isLocalAudioTrack = true;
      constructor(track: MediaStreamTrack) {
        this.mediaStreamTrack = track;
      }
    },
    VideoPresets: {
      h1080: {
        encoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
      },
    },
  };
});

const { LiveKitPublisher } = await import('../../src/livekit');

describe('LiveKitPublisher — room integration', () => {
  let publisher: InstanceType<typeof LiveKitPublisher>;

  beforeEach(() => {
    vi.clearAllMocks();
    roomRef.options = null;
    roomRef.disconnectedHandler = null;
    publisher = new LiveKitPublisher({ url: 'wss://test.livekit.cloud', token: 'test-token' });
  });

  it('creates Room with dynacast:true, adaptiveStream:false', () => {
    expect(roomRef.options).toEqual({
      dynacast: true,
      adaptiveStream: false,
    });
  });

  it('publish() auto-connects if not connected', async () => {
    const stream = createMockMediaStream();
    await publisher.publish(stream);

    expect(mockConnect).toHaveBeenCalledWith('wss://test.livekit.cloud', 'test-token');
  });

  it('publishes video as Track.Source.ScreenShare', async () => {
    const stream = createMockMediaStream();
    await publisher.publish(stream);

    const videoCall = mockPublishTrack.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.source === 'screen_share',
    );
    expect(videoCall).toBeDefined();
    expect((videoCall![0] as { _isLocalVideoTrack: boolean })._isLocalVideoTrack).toBe(true);
  });

  it('publishes audio as Track.Source.ScreenShareAudio', async () => {
    const stream = createMockMediaStream();
    await publisher.publish(stream);

    const audioCall = mockPublishTrack.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.source === 'screen_share_audio',
    );
    expect(audioCall).toBeDefined();
    expect((audioCall![0] as { _isLocalAudioTrack: boolean })._isLocalAudioTrack).toBe(true);
  });

  it('unpublish() removes tracks WITHOUT stopping MediaStream tracks', async () => {
    const stream = createMockMediaStream();
    await publisher.publish(stream);

    await publisher.unpublish();

    expect(mockUnpublishTrack).toHaveBeenCalledTimes(2);
    // MediaStream tracks should NOT be stopped (local recording continues)
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    expect(videoTrack.stop).not.toHaveBeenCalled();
    expect(audioTrack.stop).not.toHaveBeenCalled();
  });

  it('publish → unpublish → publish cycle works', async () => {
    const stream = createMockMediaStream();

    await publisher.publish(stream);
    expect(mockPublishTrack).toHaveBeenCalledTimes(2);

    await publisher.unpublish();
    expect(mockUnpublishTrack).toHaveBeenCalledTimes(2);

    mockPublishTrack.mockClear();
    await publisher.publish(stream);
    expect(mockPublishTrack).toHaveBeenCalledTimes(2);
  });

  it('publishData() chunks payloads > 14KB', async () => {
    // Connect first
    const stream = createMockMediaStream();
    await publisher.publish(stream);
    mockPublishData.mockClear();

    // 30KB payload → should produce 3 chunks (14KB + 14KB + 2KB)
    const payload = new Uint8Array(30 * 1024);
    await publisher.publishData(payload, 'context');

    expect(mockPublishData).toHaveBeenCalledTimes(3);
    for (const call of mockPublishData.mock.calls) {
      expect(call[1]).toEqual({ reliable: true, topic: 'context' });
    }
  });

  it('publishData() sends single chunk for payloads <= 14KB', async () => {
    const stream = createMockMediaStream();
    await publisher.publish(stream);
    mockPublishData.mockClear();

    const payload = new Uint8Array(10 * 1024);
    await publisher.publishData(payload, 'context');

    expect(mockPublishData).toHaveBeenCalledOnce();
  });

  it('publishData() is no-op when disconnected', async () => {
    const payload = new Uint8Array(100);
    await publisher.publishData(payload, 'context');

    expect(mockPublishData).not.toHaveBeenCalled();
  });

  it('Disconnected event sets isConnected = false', async () => {
    const stream = createMockMediaStream();
    await publisher.publish(stream);
    expect(publisher.isConnected).toBe(true);

    roomRef.disconnectedHandler?.('server-shutdown');
    expect(publisher.isConnected).toBe(false);
  });

  it('throws when URL or token is empty', async () => {
    const noUrl = new LiveKitPublisher({ url: '', token: 'test' });
    await expect(noUrl.connect()).rejects.toThrow('LiveKit URL and token are required');

    const noToken = new LiveKitPublisher({ url: 'wss://test', token: '' });
    await expect(noToken.connect()).rejects.toThrow('LiveKit URL and token are required');
  });
});
