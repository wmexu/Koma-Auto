import { Files } from 'files-sdk';
import { neon } from 'files-sdk/neon';

// Bucket name declared in neon.ts
export const BUCKET_NAME = 'assets';

let filesInstance: Files | null = null;

export function getFilesClient(): Files | null {
  if (filesInstance) return filesInstance;

  // Verify that required AWS/Neon Object Storage variables are present
  if (
    !process.env.AWS_ACCESS_KEY_ID ||
    !process.env.AWS_SECRET_ACCESS_KEY ||
    !process.env.AWS_ENDPOINT_URL_S3
  ) {
    return null;
  }

  try {
    filesInstance = new Files({
      adapter: neon({
        bucket: BUCKET_NAME,
      }),
    });
    return filesInstance;
  } catch (err) {
    console.error('[STORAGE] Error initializing Neon Files client:', err);
    return null;
  }
}

/**
 * Upload an image or file buffer to Neon Object Storage
 */
export async function uploadAsset(
  path: string,
  data: Buffer | Uint8Array | string,
  contentType: string = 'image/jpeg'
): Promise<string | null> {
  const client = getFilesClient();
  if (!client) {
    console.warn('[STORAGE] Object Storage not configured, skipping upload.');
    return null;
  }

  await client.upload(path, data, { contentType });

  // For public_read buckets, public URL format:
  const endpoint = process.env.AWS_ENDPOINT_URL_S3?.replace(/\/$/, '');
  return `${endpoint}/${BUCKET_NAME}/${path}`;
}

/**
 * Get public URL or presigned URL for an asset
 */
export async function getAssetUrl(path: string, expiresInSeconds: number = 3600): Promise<string> {
  const client = getFilesClient();
  if (!client) {
    return `/api/images/placeholder?id=${encodeURIComponent(path)}`;
  }

  try {
    return await client.url(path, { expiresIn: expiresInSeconds });
  } catch {
    const endpoint = process.env.AWS_ENDPOINT_URL_S3?.replace(/\/$/, '');
    return `${endpoint}/${BUCKET_NAME}/${path}`;
  }
}
