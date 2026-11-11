import { NextResponse } from 'next/server';
import { getCategoriesFromDb } from '@/lib/products-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. High-speed database lookup (<10ms) - Single Source of Truth
    // Zero MoySklad rate limit consumption: protects MoySklad from DDoS/flooding
    const dbCategories = await getCategoriesFromDb();
    if (dbCategories && dbCategories.length > 0) {
      return NextResponse.json(dbCategories);
    }

    return NextResponse.json([]);
  } catch (error) {
    console.error('Error fetching categories from DB:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}
