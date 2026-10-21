import { NextResponse } from 'next/server';
import { getMoySkladAuthHeaders } from '@/lib/moysklad';

export const dynamic = 'force-dynamic';

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

    const headers = getMoySkladAuthHeaders();

    const response = await fetch(href, {
      headers,
    });

    if (!response.ok) {
      return new NextResponse(`Failed to fetch image: ${response.statusText}`, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Verify response is actually an image and not serialized JSON data
    if (!contentType.startsWith('image/')) {
      return new NextResponse('Access denied: Requested resource is not an image', { status: 403 });
    }
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
