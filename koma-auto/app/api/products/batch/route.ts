import { NextResponse } from 'next/server';
import { getBatchProductsFromDb } from '@/lib/products-db';
import { getProductsByIds } from '@/lib/moysklad';
import { isBrandBlacklisted } from '@/lib/brand-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: 'ids must be an array' }, { status: 400 });
    }

    // 1. High-speed database lookup (<15ms) - Zero MoySklad rate limit consumption
    try {
      const dbProducts = await getBatchProductsFromDb(ids);
      if (dbProducts && dbProducts.length > 0) {
        const filtered = dbProducts.filter(
          (p) => p.price >= 500 && !isBrandBlacklisted(p.brand)
        );
        return NextResponse.json(filtered);
      }
    } catch (dbErr) {
      console.warn('[Batch API] Neon DB lookup failed, falling back:', dbErr);
    }
    
    // 2. Fallback to MoySklad API only if DB misses
    const products = (await getProductsByIds(ids)).filter(
      (p) =>
        p.price >= 500 &&
        (p.minPrice === undefined || p.minPrice >= 500) &&
        !isBrandBlacklisted(p.brand)
    );
    return NextResponse.json(products);
  } catch (error) {
    console.error('Error fetching batch products:', error);
    return NextResponse.json({ error: 'Failed to fetch batch products' }, { status: 500 });
  }
}
