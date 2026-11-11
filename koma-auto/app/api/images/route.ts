import { NextResponse } from 'next/server';
import { getMoySkladAuthHeaders } from '@/lib/moysklad';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

// In-memory cache for instant (<0.1ms) image delivery
interface CachedImage {
  buffer: Buffer;
  contentType: string;
}
const memoryCache = new Map<string, CachedImage>();
const MAX_MEMORY_ITEMS = 500;

// Negative cache: stores failed image UUIDs to prevent repeated failing requests to MoySklad
const negativeCache = new Map<string, number>();
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Local disk cache directory to survive restarts and avoid repeating MoySklad downloads
const CACHE_DIR = path.join(process.cwd(), '.cache', 'ms-images');

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const href = searchParams.get('href');

    if (!href) {
      return new NextResponse('Missing href', { status: 400 });
    }

    // Strict security check: allow ONLY MoySklad file download URLs, block any entity or security access
    if (
      !href.startsWith('https://api.moysklad.ru/') ||
      !href.includes('/download/') ||
      href.includes('/entity/') ||
      href.includes('/security/') ||
      href.includes('/audit/') ||
      href.includes('/notification/')
    ) {
      return new NextResponse('Access denied: URL is not an allowed image download resource', { status: 403 });
    }

    // Cache key based on SHA256 of download URL (each photo UUID in MoySklad is unique and immutable)
    const cacheKey = crypto.createHash('sha256').update(href).digest('hex');

    // 1. Negative cache check: If this download URL previously failed/404, block immediately without touching MoySklad
    const negativeUntil = negativeCache.get(cacheKey);
    if (negativeUntil && negativeUntil > Date.now()) {
      return new NextResponse('Image not found', {
        status: 404,
        headers: { 'Cache-Control': 'public, max-age=3600, immutable' },
      });
    }

    // 2. Check in-memory cache (Fastest: <0.1ms, 0 I/O)
    if (memoryCache.has(cacheKey)) {
      const cached = memoryCache.get(cacheKey)!;
      return new NextResponse(new Uint8Array(cached.buffer), {
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // 3. Check persistent disk cache
    const dataPath = path.join(CACHE_DIR, `${cacheKey}.bin`);
    const metaPath = path.join(CACHE_DIR, `${cacheKey}.json`);

    try {
      if (fs.existsSync(dataPath) && fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const buffer = fs.readFileSync(dataPath);

        // Populate in-memory cache
        if (memoryCache.size < MAX_MEMORY_ITEMS) {
          memoryCache.set(cacheKey, { buffer, contentType: meta.contentType });
        }

        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': meta.contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    } catch (diskErr) {
      console.warn('[Image Proxy] Disk cache read error, proceeding to fetch:', diskErr);
    }

    // 4. Fetch directly from MoySklad (No artificial client-throttling / No 429 queue reject)
    try {
      const headers = getMoySkladAuthHeaders();
      let response = await fetch(href, { headers });

      // Handle MoySklad 429 rate limit with automatic backoff retry
      if (response.status === 429) {
        const retryMs = Number(response.headers.get('X-Lognex-Retry-TimeInterval')) || 2500;
        console.warn(`[Image Proxy] MoySklad 429 rate limit hit. Waiting ${retryMs}ms...`);
        await new Promise((r) => setTimeout(r, retryMs));
        response = await fetch(href, { headers });
      }

      if (!response.ok) {
        // Record in negative cache so repeated failed requests don't hit MoySklad again
        negativeCache.set(cacheKey, Date.now() + NEGATIVE_CACHE_TTL_MS);
        return new NextResponse(`Failed to fetch image: ${response.statusText}`, {
          status: response.status === 429 ? 429 : 404,
          headers: { 'Cache-Control': 'public, max-age=3600' },
        });
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';

      // Verify response is actually an image and not serialized JSON data
      if (!contentType.startsWith('image/')) {
        negativeCache.set(cacheKey, Date.now() + NEGATIVE_CACHE_TTL_MS);
        return new NextResponse('Access denied: Requested resource is not an image', {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        });
      }

      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      // Save to disk cache
      try {
        if (!fs.existsSync(CACHE_DIR)) {
          fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(dataPath, buffer);
        fs.writeFileSync(metaPath, JSON.stringify({ contentType, cachedAt: Date.now() }));
      } catch (cacheWriteErr) {
        console.warn('[Image Proxy] Failed to write disk cache:', cacheWriteErr);
      }

      // Save to in-memory cache
      if (memoryCache.size < MAX_MEMORY_ITEMS) {
        memoryCache.set(cacheKey, { buffer, contentType });
      }

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (fetchErr) {
      console.warn('[Image Proxy] Error fetching from MoySklad:', fetchErr);
      negativeCache.set(cacheKey, Date.now() + 60000); // 1 minute negative cache on network error
      return new NextResponse('Image unavailable', {
        status: 404,
        headers: { 'Cache-Control': 'public, max-age=60' },
      });
    }
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
