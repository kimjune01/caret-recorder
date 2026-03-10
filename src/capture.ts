import { CONFIG } from './shared/types';

export async function startCapture(): Promise<MediaStream> {
  // Main process setDisplayMediaRequestHandler auto-grants without picker
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: CONFIG.WIDTH },
      height: { ideal: CONFIG.HEIGHT },
      frameRate: { ideal: CONFIG.FRAME_RATE },
    },
    audio: true,
  });

  return stream;
}
