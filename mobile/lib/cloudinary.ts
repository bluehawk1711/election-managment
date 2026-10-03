/**
 * Cloudinary upload for voter photos (plan-voters.md §8).
 *
 * Unsigned preset — no secret ships in the bundle, which is the right shape
 * for a client that must upload without a backend. The preset itself is what
 * restricts the destination (folder, formats, max size); these two env vars
 * only name the cloud and the preset.
 *
 * Compression happens in `compressForUpload`, never here: by the time a file
 * reaches this module it is already ≤512 px wide and a JPEG at quality ~0.35,
 * i.e. tens of KB, not megabytes.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Longest edge of an uploaded photo, in pixels. */
const TARGET_WIDTH = 512;
/** JPEG quality — deliberately aggressive; these are ID photos. */
const QUALITY = 0.35;

const CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

export interface UploadedPhoto {
  secureUrl: string;
  publicId: string;
  bytes: number;
  width: number;
  height: number;
}

/** `true` when the two Cloudinary env vars are present. */
export function isCloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && UPLOAD_PRESET);
}

/**
 * Downscales and re-encodes a picked image to a JPEG blob.
 *
 * Uses the context API (`manipulate`) rather than `manipulateAsync` because it
 * renders without writing an intermediate file to disk. The result is returned
 * as base64 so the upload can send a data URL — one request, no multipart
 * assembly, no temporary file left behind on the device.
 */
export async function compressForUpload(
  uri: string
): Promise<{ base64: string; width: number; height: number; bytes: number }> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: TARGET_WIDTH });
  const image = await context.renderAsync();
  const result = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: QUALITY,
    base64: true,
  });

  const bytes = result.base64 ? Math.floor((result.base64.length * 3) / 4) : 0;
  return {
    base64: result.base64 ?? '',
    width: result.width,
    height: result.height,
    bytes,
  };
}

/**
 * Uploads a compressed JPEG data URL.
 *
 * Throws a plain `Error` with a readable message; `useAction` translates that
 * for the toast, so callers never have to inspect Cloudinary's response body.
 */
export async function uploadPhoto(base64: string): Promise<UploadedPhoto> {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      'Cloudinary is not configured — set EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME and ' +
        'EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET in .env.'
    );
  }

  const body = new FormData();
  body.append('file', `data:image/jpeg;base64,${base64}`);
  body.append('upload_preset', UPLOAD_PRESET as string);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: 'POST', body }
  );

  if (!response.ok) {
    let reason = `${response.status}`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      if (payload.error?.message) reason = payload.error.message;
    } catch {
      // Non-JSON error body — the status code is all we have.
    }
    throw new Error(`Cloudinary upload failed: ${reason}`);
  }

  const payload = (await response.json()) as {
    secure_url: string;
    public_id: string;
    bytes?: number;
    width?: number;
    height?: number;
  };

  return {
    secureUrl: payload.secure_url,
    publicId: payload.public_id,
    bytes: payload.bytes ?? 0,
    width: payload.width ?? 0,
    height: payload.height ?? 0,
  };
}
