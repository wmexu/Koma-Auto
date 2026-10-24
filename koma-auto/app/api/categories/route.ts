import { NextResponse } from 'next/server';
import { getCategoriesFromDb } from '@/lib/products-db';
import { getProductFolders } from '@/lib/moysklad';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. High-speed database lookup (<10ms) - Zero MoySklad rate limit consumption
    try {
      const dbCategories = await getCategoriesFromDb();
      if (dbCategories && dbCategories.length > 0) {
        return NextResponse.json(dbCategories);
      }
    } catch (dbErr) {
      console.warn('[Categories API] Neon DB lookup failed, falling back:', dbErr);
    }

    // 2. Fallback to MoySklad API only if DB misses
    const foldersRes = await getProductFolders();
    const categories = foldersRes.rows.map((folder: any) => ({
      id: folder.id,
      name: folder.name,
    }));

    categories.sort((a: any, b: any) => a.name.localeCompare(b.name));

    return NextResponse.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}
