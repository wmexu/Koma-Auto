import { client, isDbConfigured } from '@/db';
import { Product } from '@/data/products';

export interface GetProductsDbParams {
  limit?: number;
  offset?: number;
  search?: string;
  category?: string;
  brand?: string;
  inStockOnly?: boolean;
}

export interface GetProductsDbResult {
  products: Product[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export async function getProductsFromDb(params: GetProductsDbParams): Promise<GetProductsDbResult | null> {
  const sql = client;
  if (!isDbConfigured() || !sql) {
    return null;
  }

  const limit = Math.min(params.limit || 36, 100);
  const offset = params.offset || 0;
  const search = (params.search || '').trim();
  const cleanSearch = search.replace(/[\s\-\.]/g, '').toUpperCase();

  try {
    let whereConditions = [];

    // Filter price >= 500
    whereConditions.push(sql`price >= 500`);

    if (params.inStockOnly) {
      whereConditions.push(sql`in_stock = true`);
    }

    if (params.brand) {
      whereConditions.push(sql`brand ILIKE ${params.brand}`);
    }

    if (search) {
      const searchPattern = `%${search}%`;
      const oemPattern = `%${cleanSearch}%`;
      whereConditions.push(
        sql`(title ILIKE ${searchPattern} OR clean_oem_number ILIKE ${oemPattern} OR brand ILIKE ${searchPattern} OR compatibility::text ILIKE ${searchPattern})`
      );
    }

    // Combine WHERE clauses
    const whereSql = whereConditions.length > 0
      ? sql`WHERE ${whereConditions.reduce((acc, curr) => sql`${acc} AND ${curr}`)}`
      : sql``;

    // Count query
    const countResult = await sql`
      SELECT COUNT(*)::int as count FROM my_sklad_products ${whereSql};
    `;
    const total = countResult[0]?.count || 0;

    // Data query with ordering
    const rows = await sql`
      SELECT * FROM my_sklad_products
      ${whereSql}
      ORDER BY in_stock DESC, id ASC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const products: Product[] = rows.map((r: any) => {
      let images: string[] = [];
      if (Array.isArray(r.images)) {
        images = r.images;
      } else if (typeof r.images === 'string') {
        try {
          images = JSON.parse(r.images);
        } catch {
          // ignore
        }
      }

      let compatibility: string[] = [];
      if (Array.isArray(r.compatibility)) {
        compatibility = r.compatibility.map((c: any) =>
          typeof c === 'string' ? c : `${c.make} ${c.model}${c.years ? ` (${c.years})` : ''}`
        );
      }

      let specs: Record<string, string> = {};
      if (r.specs && typeof r.specs === 'object') {
        specs = r.specs;
      }

      const price = Number(r.price) || 0;
      const oldPrice = r.old_price ? Number(r.old_price) : undefined;

      return {
        id: r.id,
        moySkladId: r.id,
        article: r.clean_oem_number || r.original_oem || '',
        oem: r.clean_oem_number || '',
        brand: r.brand || 'Koma Auto',
        name: r.title,
        price,
        oldPrice,
        inStock: r.in_stock,
        category: r.category || 'Автозапчасти',
        image: r.image || (images.length > 0 ? images[0] : ''),
        images,
        specs,
        compatibility,
        description: r.description || '',
        variants: [
          {
            id: r.id,
            name: r.title,
            code: r.original_oem || '',
            oem: r.clean_oem_number || '',
            brand: r.brand || 'Koma Auto',
            tier: 1,
            price,
            oldPrice,
            stock: r.stock_quantity || 1,
            inStock: r.in_stock,
            image: r.image,
            images,
            article: r.clean_oem_number,
          },
        ],
        availableBrandsCount: 1,
      };
    });

    return {
      products,
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  } catch (err) {
    console.error('[PostgreSQL Catalog Error]:', err);
    return null;
  }
}

/**
 * Fast batch lookup by IDs for price and inventory re-verification (e.g. at checkout)
 */
export async function getProductsByIdsFromDb(ids: string[]): Promise<Array<{ id: string; price: number; title: string }>> {
  const sql = client;
  if (!isDbConfigured() || !sql || ids.length === 0) return [];
  try {
    const rows = await sql`
      SELECT id, price, title 
      FROM my_sklad_products 
      WHERE id IN ${sql(ids)}
    `;
    return rows.map((r: any) => ({
      id: r.id,
      price: Number(r.price) || 0,
      title: r.title,
    }));
  } catch (err) {
    console.error('[DB] Error querying products by ids:', err);
    return [];
  }
}
