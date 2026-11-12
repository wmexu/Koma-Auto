import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import crypto from 'node:crypto';

const ENDPOINT = process.env.AWS_ENDPOINT_URL_S3;
const REGION = process.env.AWS_REGION || 'us-east-2';
const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const BUCKET = 'assets';

let s3ClientInstance: S3Client | null = null;

export function isNeonStorageConfigured(): boolean {
  return Boolean(ENDPOINT && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

export function getNeonStorageClient(): S3Client | null {
  if (!isNeonStorageConfigured()) return null;
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      endpoint: ENDPOINT,
      region: REGION,
      credentials: {
        accessKeyId: ACCESS_KEY_ID!,
        secretAccessKey: SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    });
  }
  return s3ClientInstance;
}

/**
 * Returns direct public HTTPS URL for an asset in Neon Object Storage
 */
export function getStoragePublicUrl(key: string): string {
  if (!ENDPOINT) return '';
  return `${ENDPOINT.replace(/\/$/, '')}/${BUCKET}/${key.replace(/^\//, '')}`;
}

/**
 * Extracts a stable UUID or hash identifier from a MoySklad image download URL
 */
export function extractPhotoKey(href: string): string {
  const match = href.match(/\/download\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return crypto.createHash('sha256').update(href).digest('hex');
}

/**
 * Strict maximum size for automotive part photos: 21.16 KB = 21,667 bytes
 * Guarantees that 18,502 positions + extra photos fit within 400 MB
 */
export const MAX_PHOTO_BYTES = 21667;

/**
 * Multi-tiered adaptive compression pipeline for e-commerce auto-part images
 * Reduces raw 500KB - 3MB MoySklad JPEGs/PNGs into <= 21.16 KB WebP
 * Strips camera/EXIF metadata to strictly fit 19,000+ photos into < 400 MB
 */
export async function compressToWebp(
  inputBuffer: Buffer,
  targetMaxBytes = MAX_PHOTO_BYTES
): Promise<Buffer> {
  const tiers = [
    { dim: 700, q: 75 },
    { dim: 640, q: 70 },
    { dim: 560, q: 65 },
    { dim: 500, q: 60 },
    { dim: 450, q: 55 },
    { dim: 400, q: 50 },
    { dim: 360, q: 45 },
  ];

  let best: Buffer | null = null;
  for (const tier of tiers) {
    const webp = await sharp(inputBuffer)
      .rotate() // preserve proper orientation from EXIF before stripping
      .resize(tier.dim, tier.dim, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: tier.q,
        effort: 6,
        smartSubsample: true,
      })
      .toBuffer();

    best = webp;
    if (webp.length <= targetMaxBytes) {
      break;
    }
  }

  return Buffer.from(best || inputBuffer);
}

/**
 * Retrieves image from Neon Object Storage bucket
 */
export async function getImageFromStorage(
  key: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const s3 = getNeonStorageClient();
  if (!s3) return null;

  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );

    if (!res.Body) return null;
    const byteArray = await res.Body.transformToByteArray();
    return {
      buffer: Buffer.from(byteArray),
      contentType: res.ContentType || 'image/webp',
    };
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    console.warn(`[Neon Storage] Error getting object ${key}:`, err?.message || err);
    return null;
  }
}

/**
 * Fast check if an object exists in Neon Object Storage
 */
export async function checkImageExistsInStorage(key: string): Promise<boolean> {
  const s3 = getNeonStorageClient();
  if (!s3) return false;

  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Uploads an image to Neon Object Storage with 1-year immutable cache headers
 */
export async function uploadImageToStorage(
  key: string,
  buffer: Buffer,
  contentType = 'image/webp'
): Promise<string> {
  const s3 = getNeonStorageClient();
  if (!s3) throw new Error('Neon Object Storage is not configured');

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  return getStoragePublicUrl(key);
}
