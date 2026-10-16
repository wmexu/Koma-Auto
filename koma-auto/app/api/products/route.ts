import { NextResponse } from 'next/server';
import {
  getProducts,
  getProductFolders,
  mapMoySkladToProduct,
  groupProductsByOem,
  PODVAL_STORE_URL,
} from '@/lib/moysklad';
import { products as fallbackProducts } from '@/data/products';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '36', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const inStockOnly = searchParams.get('inStockOnly') === 'true';
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    let categoryHref: string | string[] = '';

    if (category) {
      const foldersRes = await getProductFolders();
      const folder = foldersRes.rows.find(
        (f: any) => f.name.toLowerCase() === category.toLowerCase() || f.id === category
      );
      if (folder && folder.meta) {
        categoryHref = folder.meta.href;
      }
    }

    // Fetch from MoySklad strictly using store "Car City 1 ярус Подвал"
    const productsRes = await getProducts(
      limit,
      offset,
      search || '',
      categoryHref,
      '',
      inStockOnly
    );

    // Map each MoySklad product to Product with OEM and clean normalized brand
    let mappedProducts = (productsRes.rows || []).map((msProduct) =>
      mapMoySkladToProduct(msProduct)
    );

    // Filter out products with 0 price
    mappedProducts = mappedProducts.filter((p) => p.price > 0);

    // Group products that share the same OEM code into 1 single card!
    const groupedProducts = groupProductsByOem(mappedProducts);

    const rawCount = productsRes.rows?.length || 0;
    const hasMore = rawCount >= limit;

    return NextResponse.json({
      products: groupedProducts,
      total: productsRes.meta?.size || groupedProducts.length,
      limit: productsRes.meta?.limit || limit,
      offset: productsRes.meta?.offset || offset,
      hasMore,
    });
  } catch (error) {
    console.error('Error fetching products from API:', error);
    return NextResponse.json({
      products: fallbackProducts,
      total: fallbackProducts.length,
      limit: 100,
      offset: 0,
      error: 'MoySklad API failed, using fallback data',
    });
  }
}
