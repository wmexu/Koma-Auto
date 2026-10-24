import { NextResponse } from 'next/server';
import { getProductFolders } from '@/lib/moysklad';
import { getCategoriesFromDb } from '@/lib/products-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Live fetch of all categories/folders from MoySklad (so newly added or renamed folders appear instantly)
    const foldersRes = await getProductFolders();
    const seenNames = new Set<string>();
    const categories: Array<{ id: string; name: string }> = [];

    for (const folder of (foldersRes.rows || [])) {
      const name = folder.name?.trim();
      if (!name || name === 'Без группы' || name === 'Автозапчасти') continue;
      if (!seenNames.has(name.toLowerCase())) {
        seenNames.add(name.toLowerCase());
        categories.push({
          id: folder.id,
          name,
        });
      }
    }

    // Sort categories alphabetically (A-Z, А-Я)
    categories.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    return NextResponse.json(categories);
  } catch (error) {
    console.error('Error fetching categories from MoySklad, falling back to DB:', error);
    try {
      const dbCategories = await getCategoriesFromDb();
      return NextResponse.json(dbCategories);
    } catch {
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
    }
  }
}
