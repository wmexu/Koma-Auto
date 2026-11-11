import { NextResponse } from 'next/server';
import { getMoySkladAuthHeaders } from '@/lib/moysklad';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

// In-memory cache for ultra-fast (<0.1ms) image delivery
interface CachedImage {
  buffer: Buffer;
  contentType: string;
}
const memoryCache = new Map<string, CachedImage>();
const MAX_MEMORY_ITEMS = 500;

// Negative cache: stores failed image UUIDs to prevent repeated requests to MoySklad (DDoS protection)
const negativeCache = new Map<string, number>();
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Strict concurrency throttle: limits simultaneous outbound fetches to MoySklad
// MoySklad has a global 15 req/sec limit. Capping to max 3 concurrent fetches guarantees
// we never exceed MoySklad limits, even under severe DDoS or script attacks.
const MAX_CONCURRENT_MOYSKLAD_FETCHES = 3;
let activeMoyskladFetches = 0;
const fetchQueue: Array<() => void> = [];

async function acquireFetchSlot(): Promise<() => void> {
  if (activeMoyskladFetches < MAX_CONCURRENT_MOYSKLAD_FETCHES) {
    activeMoyskladFetches++;
    return releaseFetchSlot;
  }

  return new Promise((resolve, reject) => {
    // Fast backpressure timeout (3.5s) so client requests never hang
    const timer = setTimeout(() => {
      const idx = fetchQueue.indexOf(proceed);
      if (idx !== -1) fetchQueue.splice(idx, 1);
      reject(new Error('Image fetch queue busy'));
    }, 3500);

    const proceed = () => {
      clearTimeout(timer);
      resolve(releaseFetchSlot);
    };
    fetchQueue.push(proceed);
  });
}

function releaseFetchSlot() {
  activeMoyskladFetches--;
  const next = fetchQueue.shift();
  if (next) {
    activeMoyskladFetches++;
    next();
  }
}

// Local disk cache directory to survive server restarts and avoid any MoySklad traffic
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

    // 4. Not in cache: Acquire concurrency semaphore slot before talking to MoySklad
    let releaseSlot: (() => void) | null = null;
    try {
      releaseSlot = await acquireFetchSlot();
    } catch {
      // Concurrency limit reached and queue timed out: return 429 backpressure to protect MoySklad
      return new NextResponse('Too many image requests in progress. Please retry.', {
        status: 429,
        headers: { 'Retry-After': '2' },
      });
    }

    try {
      const headers = getMoySkladAuthHeaders();
      let response = await fetch(href, { headers });

      // Handle 429 rate limit with backoff
      if (response.status === 429) {
        const retryMs = Number(response.headers.get('X-Lognex-Retry-TimeInterval')) || 2500;
        console.warn(`[Image Proxy] 429 rate limit hit. Waiting ${retryMs}ms...`);
        await new Promise((r) => setTimeout(r, retryMs));
        response = await fetch(href, { headers });
      }

      if (!response.ok) {
        // Record in negative cache so repeated attacks with this non-existent URL never hit MoySklad again
        negativeCache.set(cacheKey, Date.now() + NEGATIVE_CACHE_TTL_MS);
        return new NextResponse(`Failed to fetch image: ${response.statusText}`, {
          status: response.status,
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
    } finally {
      if (releaseSlot) {
        releaseSlot();
      }
    }
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
