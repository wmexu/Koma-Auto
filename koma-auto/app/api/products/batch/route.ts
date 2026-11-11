import { NextResponse } from 'next/server';
import { getBatchProductsFromDb } from '@/lib/products-db';
import { isBrandBlacklisted } from '@/lib/brand-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ids = body?.ids;

    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: 'ids must be an array' }, { status: 400 });
    }

    // Sanitize and cap to 100 items per request to prevent memory or socket abuse
    const sanitizedIds = ids.filter((id) => typeof id === 'string' && id.trim().length > 0).slice(0, 100);
    if (sanitizedIds.length === 0) {
      return NextResponse.json([]);
    }

    // High-speed database lookup (<15ms) - Single Source of Truth
    // Zero MoySklad rate limit consumption: protects MoySklad from DDoS/flooding
    const dbProducts = await getBatchProductsFromDb(sanitizedIds);
    const filtered = (dbProducts || []).filter(
      (p) => p.price >= 500 && !isBrandBlacklisted(p.brand)
    );

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Error in batch products API:', error);
    return NextResponse.json({ error: 'Failed to fetch batch products' }, { status: 500 });
  }
}
