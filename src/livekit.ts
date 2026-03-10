import {
  Room,
  RoomEvent,
  Track,
  LocalVideoTrack,
  LocalAudioTrack,
  VideoPresets,
} from 'livekit-client';
import { CONFIG } from './shared/types';

export class LiveKitPublisher {
  private room: Room;
  private videoTrack: LocalVideoTrack | null = null;
  private audioTrack: LocalAudioTrack | null = null;
  private connected = false;

  constructor() {
    this.room = new Room({
      dynacast: true,
      adaptiveStream: false,
    });

    this.room
      .on(RoomEvent.Reconnecting, () => {
        console.log('[LiveKit] Reconnecting...');
      })
      .on(RoomEvent.Reconnected, () => {
        console.log('[LiveKit] Reconnected');
      })
      .on(RoomEvent.Disconnected, (reason) => {
        console.log('[LiveKit] Disconnected:', reason);
        this.connected = false;
      });
  }

  async connect(): Promise<void> {
    if (!CONFIG.LIVEKIT_URL || !CONFIG.LIVEKIT_TOKEN) {
      console.warn('[LiveKit] No URL/token configured, skipping connection');
      return;
    }

    try {
      await this.room.connect(CONFIG.LIVEKIT_URL, CONFIG.LIVEKIT_TOKEN);
      this.connected = true;
      console.log('[LiveKit] Connected to room:', this.room.name);
    } catch (err) {
      console.error('[LiveKit] Connection failed:', err);
      throw err;
    }
  }

  async publish(stream: MediaStream): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
    if (!this.connected) return;

    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    if (videoTracks.length > 0) {
      this.videoTrack = new LocalVideoTrack(videoTracks[0]);
      await this.room.localParticipant.publishTrack(this.videoTrack, {
        source: Track.Source.ScreenShare,
        simulcast: false,
        videoEncoding: VideoPresets.h1080.encoding,
      });
      console.log('[LiveKit] Published screen share video');
    }

    if (audioTracks.length > 0) {
      this.audioTrack = new LocalAudioTrack(audioTracks[0]);
      await this.room.localParticipant.publishTrack(this.audioTrack, {
        source: Track.Source.ScreenShareAudio,
      });
      console.log('[LiveKit] Published screen share audio');
    }
  }

  async unpublish(): Promise<void> {
    if (this.videoTrack) {
      await this.room.localParticipant.unpublishTrack(this.videoTrack, true);
      this.videoTrack = null;
      console.log('[LiveKit] Unpublished video');
    }
    if (this.audioTrack) {
      await this.room.localParticipant.unpublishTrack(this.audioTrack, true);
      this.audioTrack = null;
      console.log('[LiveKit] Unpublished audio');
    }
  }

  async publishData(payload: Uint8Array, topic: string): Promise<void> {
    if (!this.connected) return;

    // Chunk if > 14KB to stay within LiveKit's 15KB reliable limit
    const MAX_CHUNK = 14 * 1024;
    if (payload.byteLength <= MAX_CHUNK) {
      await this.room.localParticipant.publishData(payload, { reliable: true, topic });
    } else {
      for (let offset = 0; offset < payload.byteLength; offset += MAX_CHUNK) {
        const chunk = payload.slice(offset, offset + MAX_CHUNK);
        await this.room.localParticipant.publishData(chunk, { reliable: true, topic });
      }
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    await this.unpublish();
    await this.room.disconnect();
    this.connected = false;
  }
}
