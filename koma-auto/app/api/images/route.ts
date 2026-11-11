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

    // 1. Check in-memory cache (Fastest: <0.1ms, 0 I/O)
    if (memoryCache.has(cacheKey)) {
      const cached = memoryCache.get(cacheKey)!;
      return new NextResponse(new Uint8Array(cached.buffer), {
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // 2. Check disk cache
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

    // 3. Not in cache: fetch from MoySklad once
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
      console.warn(`[Image Proxy] MoySklad error ${response.status} (${response.statusText}) for href: ${href}`);
      return new NextResponse(`Failed to fetch image: ${response.statusText}`, {
        status: response.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Verify response is actually an image and not serialized JSON data
    if (!contentType.startsWith('image/')) {
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
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
