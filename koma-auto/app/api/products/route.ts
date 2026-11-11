import { NextResponse } from 'next/server';
import { products as fallbackProducts } from '@/data/products';
import { getProductsFromDb } from '@/lib/products-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '36', 10), 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    const inStockOnly = searchParams.get('inStockOnly') === 'true';
    const category = searchParams.get('category') || undefined;
    const search = searchParams.get('search') || undefined;

    // 1. High-speed database layer (<15ms) - Single Source of Truth
    // Zero MoySklad rate limit consumption: protects MoySklad from DDoS/flooding
    try {
      const dbResult = await getProductsFromDb({
        limit,
        offset,
        search,
        category,
        inStockOnly,
      });

      if (dbResult !== null) {
        return NextResponse.json(dbResult);
      }
    } catch (dbErr) {
      console.error('[Products API] DB lookup error:', dbErr);
    }

    // 2. Safe fallback to local seed data if database is unreachable
    return NextResponse.json({
      products: fallbackProducts,
      total: fallbackProducts.length,
      limit,
      offset: 0,
      hasMore: false,
    });
  } catch (error) {
    console.error('Error in products API:', error);
    return NextResponse.json({
      products: [],
      total: 0,
      limit: 36,
      offset: 0,
      hasMore: false,
      error: 'Failed to fetch products',
    }, { status: 500 });
  }
}
