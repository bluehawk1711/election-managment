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
import { Directory, File, Paths } from 'expo-file-system';

/** Longest edge of an uploaded photo, in pixels. */
const TARGET_WIDTH = 512;
/** JPEG quality — aggressive, but 0.40 keeps faces legible for ID photos. */
const QUALITY = 0.4;

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

/** Subdirectory of the document dir that holds locally-saved voter photos. */
const LOCAL_PHOTO_DIR = 'voter-photos';

/**
 * Writes an already-compressed JPEG (base64) into the app's document
 * directory and returns its `file://` URI.
 *
 * The no-Cloudinary path: without this, a build with no upload env vars could
 * not store a photo *at all* — `uploadPhoto` throws by contract and the pick
 * was silently discarded, so the detail screen showed a spinner and then no
 * photo. Document dir, not cache dir, because the cache is fair game for the
 * OS to purge; a photo the karykarta took yesterday has to still be there.
 *
 * `key` is the voter id — stable, so re-taking a photo for the same voter
 * overwrites in place instead of leaking one file per attempt. Sanitised to a
 * filename-safe form first: voter ids are already `w{ward}-{serial}` and need
 * no changes, but a stray separator would escape the subdirectory.
 */
export async function savePhotoLocally(base64: string, key: string): Promise<string> {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'photo';
  const dir = new Directory(Paths.document, LOCAL_PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });

  const file = new File(dir, `${safe}.jpg`);
  // `create()` is what actually makes the file — `write` alone writes into an
  // existing one — and it *throws* if the path is already taken. Since the
  // filename is the voter id, re-taking a photo for the same voter hits an
  // existing file, so the create is guarded: first photo creates, later ones
  // overwrite in place (`write` defaults to `append: false`). Unguarded, the
  // second photo for any voter failed with "already exists" and surfaced as
  // "Photo upload failed" — a bug that only appears on the *second* attempt.
  if (!file.exists) file.create({ intermediates: true });
  file.write(base64, { encoding: 'base64' });
  return file.uri;
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
