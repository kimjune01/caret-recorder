import { describe, it, expect } from 'vitest';
import { CONFIG, AppState } from '../../src/shared/types';

describe('CONFIG constants — TAKEHOME.md spec compliance', () => {
  it('captures at 1080p resolution', () => {
    expect(CONFIG.WIDTH).toBe(1920);
    expect(CONFIG.HEIGHT).toBe(1080);
  });

  it('captures at 30fps', () => {
    expect(CONFIG.FRAME_RATE).toBe(30);
  });

  it('uses WebM container with VP8+Opus codecs (screen + system audio)', () => {
    expect(CONFIG.VIDEO_CODEC).toContain('webm');
    expect(CONFIG.VIDEO_CODEC).toContain('opus');
    expect(CONFIG.VIDEO_CODEC).toContain('vp8');
  });

  it('segments are 5 minutes long', () => {
    expect(CONFIG.SEGMENT_DURATION_MS).toBe(5 * 60 * 1000);
    expect(CONFIG.SEGMENT_DURATION_MS).toBe(300_000);
  });

  it('saves recordings to Terac/Recordings directory', () => {
    expect(CONFIG.RECORDINGS_DIR).toBe('Terac/Recordings');
  });

  it('collects data every second for smooth segment boundaries', () => {
    expect(CONFIG.DATA_COLLECT_INTERVAL_MS).toBe(1000);
  });

  it('uses a reasonable video bitrate', () => {
    expect(CONFIG.VIDEO_BITRATE).toBeGreaterThan(0);
    expect(CONFIG.VIDEO_BITRATE).toBe(2_500_000);
  });
});

describe('AppState enum — 3 tray states', () => {
  it('has exactly 3 states: Idle, Recording, Publishing', () => {
    expect(AppState.Idle).toBe('idle');
    expect(AppState.Recording).toBe('recording');
    expect(AppState.Publishing).toBe('publishing');

    const values = Object.values(AppState);
    expect(values).toHaveLength(3);
  });
});
