import { NextResponse } from 'next/server';
import { getProductByIdFromDb } from '@/lib/products-db';
import { products as fallbackProducts } from '@/data/products';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const { id } = params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
    }

    // 1. High-speed database lookup (<15ms) - Neon Postgres is Single Source of Truth
    // Zero MoySklad rate limit consumption: protects MoySklad from DDoS/flooding
    try {
      const dbProduct = await getProductByIdFromDb(id);
      if (dbProduct) {
        if (dbProduct.price < 500 && (!dbProduct.variants || dbProduct.variants.length === 0)) {
          return NextResponse.json({ error: 'Product not available' }, { status: 404 });
        }
        return NextResponse.json(dbProduct);
      }
    } catch (dbErr) {
      console.error('[Product API] Neon DB lookup error:', dbErr);
    }

    // 2. Fallback to static products if ID matches initial seed dataset
    const fallbackProduct = fallbackProducts.find(
      (p) => p.id === id || p.moySkladId === id
    );
    if (fallbackProduct) {
      return NextResponse.json(fallbackProduct);
    }

    // 3. Product does not exist -> 404 Not Found immediately
    // NEVER proxy unknown IDs to MoySklad API (prevents 15 req/sec rate-limit exhaustion)
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  } catch (error) {
    console.error(`Error in product API:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
