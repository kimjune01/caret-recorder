import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMediaStream } from '../mocks/media-stream';

// Mock navigator.mediaDevices.getDisplayMedia
const mockGetDisplayMedia = vi.fn();

Object.defineProperty(globalThis, 'navigator', {
  value: {
    mediaDevices: {
      getDisplayMedia: mockGetDisplayMedia,
    },
  },
  writable: true,
});

// Import after global mocks are set up
const { startCapture } = await import('../../src/capture');

describe('startCapture — screen + audio capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getDisplayMedia with 1920x1080 @ 30fps and audio:true', async () => {
    const mockStream = createMockMediaStream();
    mockGetDisplayMedia.mockResolvedValue(mockStream);

    await startCapture();

    expect(mockGetDisplayMedia).toHaveBeenCalledOnce();
    const constraints = mockGetDisplayMedia.mock.calls[0][0];

    expect(constraints.video).toEqual({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
    expect(constraints.audio).toBe(true);
  });

  it('returns a stream with both video and audio tracks', async () => {
    const mockStream = createMockMediaStream();
    mockGetDisplayMedia.mockResolvedValue(mockStream);

    const stream = await startCapture();

    expect(stream.getVideoTracks()).toHaveLength(1);
    expect(stream.getAudioTracks()).toHaveLength(1);
  });

  it('propagates permission denial errors', async () => {
    const permError = new DOMException('Permission denied', 'NotAllowedError');
    mockGetDisplayMedia.mockRejectedValue(permError);

    await expect(startCapture()).rejects.toThrow('Permission denied');
  });
});
