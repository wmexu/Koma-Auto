import { NextResponse } from 'next/server';
import { getProductsByIds } from '@/lib/moysklad';
import { isBrandBlacklisted } from '@/lib/brand-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: 'ids must be an array' }, { status: 400 });
    }
    
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
