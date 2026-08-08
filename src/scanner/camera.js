/**
 * Camera plumbing for the scan view: acquire a rear-facing stream, sample
 * frames into a canvas, and hand each frame to a decoder.
 *
 * Frames are cropped to the on-screen guide and downscaled before decoding.
 * A 1280-wide frame costs several times more to scan than the 640-wide strip
 * the barcode actually occupies, and the crop also stops the scanner reading
 * a neighbouring book on the shelf.
 */

import { createConfirmer, createDecoder } from './decode.js';

const SCAN_INTERVAL_MS = 100;
const DECODE_WIDTH = 640;

/** Proportion of the frame the guide covers; must match the CSS reticle. */
export const CROP = { width: 0.92, height: 0.38 };

export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Turn a getUserMedia rejection into something worth showing a user. */
export function describeCameraError(error) {
  const name = error?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow the camera in your browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is already in use by another app.';
  }
  if (!window.isSecureContext) {
    return 'The camera needs a secure (https) connection.';
  }
  return 'The camera could not be started on this device.';
}

/**
 * Runs a scanning session against a <video> element.
 *
 * @param {HTMLVideoElement} video
 * @param {{onResult: (raw: string) => void, onError?: (error: Error) => void,
 *          onReady?: (info: {engine: string, torch: boolean}) => void,
 *          deviceId?: string}} options
 */
export async function startScanner(video, options) {
  const { onResult, onError, onReady, deviceId } = options;

  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const [track] = stream.getVideoTracks();

  video.srcObject = stream;
  video.setAttribute('playsinline', ''); // iOS refuses to inline-play without it
  video.muted = true;
  await video.play().catch(() => {});

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const confirmer = createConfirmer();

  // Declared before anything that can fail: `stop` reads them, and the failure
  // path below calls it. Left until after the decoder loads, they would still
  // be in the temporal dead zone and stop() would throw a ReferenceError over
  // the top of the real error — leaving the camera running.
  let running = true;
  let timer = null;
  let busy = false;

  let decoder;
  try {
    decoder = await createDecoder();
  } catch (error) {
    stop();
    throw error;
  }

  const capabilities = track?.getCapabilities?.() ?? {};
  const hasTorch = Boolean(capabilities.torch);
  onReady?.({ engine: decoder.name, torch: hasTorch });

  async function tick() {
    if (!running || busy) return;
    if (video.readyState < 2 || !video.videoWidth) return;
    busy = true;
    try {
      const cropWidth = Math.round(video.videoWidth * CROP.width);
      const cropHeight = Math.round(video.videoHeight * CROP.height);
      const scale = Math.min(1, DECODE_WIDTH / cropWidth);
      canvas.width = Math.round(cropWidth * scale);
      canvas.height = Math.round(cropHeight * scale);
      context.drawImage(
        video,
        Math.round((video.videoWidth - cropWidth) / 2),
        Math.round((video.videoHeight - cropHeight) / 2),
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const values = await decoder.decode(canvas);
      for (const value of values) {
        const confirmed = confirmer.offer(value);
        if (confirmed && running) {
          onResult(confirmed);
          break;
        }
      }
    } catch (error) {
      onError?.(error);
    } finally {
      busy = false;
    }
  }

  timer = setInterval(tick, SCAN_INTERVAL_MS);

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
    for (const t of stream.getTracks()) t.stop();
    if (video.srcObject) video.srcObject = null;
  }

  return {
    engine: decoder.name,
    hasTorch,
    stop,
    pause() {
      running = false;
    },
    resume() {
      running = true;
      confirmer.reset();
    },
    async setTorch(on) {
      if (!hasTorch) return false;
      try {
        await track.applyConstraints({ advanced: [{ torch: on }] });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Decode a still image — the photo-library fallback for when the live camera
 * is unavailable or the barcode is too worn to catch in motion.
 */
export async function decodeImageFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    // Cap the working size: phone photos are far larger than a decoder needs.
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const decoder = await createDecoder();
    const values = await decoder.decode(canvas);
    return values;
  } finally {
    bitmap.close?.();
  }
}
