import { client, isDbConfigured } from '@/db';
import { Product, ProductVariant } from '@/data/products';

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

/**
 * Maps a single PostgreSQL row from `my_sklad_products` into the canonical `Product` structure
 */
export function mapDbRowToProduct(r: any, variants: ProductVariant[] = []): Product {
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
  let oldPrice = r.old_price ? Number(r.old_price) : undefined;
  // Safety: strikethrough oldPrice must strictly be higher than the real selling price
  if (oldPrice && oldPrice <= price) {
    oldPrice = undefined;
  }
  const stock = Number(r.stock_quantity) || 0;

  const defaultVariant: ProductVariant = {
    id: r.id,
    name: r.title,
    code: r.original_oem || '',
    oem: r.clean_oem_number || '',
    brand: r.brand || 'Koma Auto',
    tier: 1,
    price,
    oldPrice,
    stock,
    inStock: Boolean(r.in_stock),
    image: r.image || (images.length > 0 ? images[0] : ''),
    images,
    article: r.clean_oem_number || r.original_oem || '',
    description: r.description || '',
  };

  const finalVariants = variants.length > 0 ? variants : [defaultVariant];

  return {
    id: r.id,
    moySkladId: r.id,
    article: r.clean_oem_number || r.original_oem || '',
    oem: r.clean_oem_number || '',
    brand: r.brand || 'Koma Auto',
    name: r.title,
    price,
    oldPrice,
    stock,
    inStock: Boolean(r.in_stock),
    category: r.category || 'Автозапчасти',
    image: r.image || (images.length > 0 ? images[0] : ''),
    images,
    specs,
    compatibility,
    description: r.description || '',
    variants: finalVariants,
    availableBrandsCount: finalVariants.length,
  };
}

/**
 * Fast catalog and search queries (<15ms)
 */
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

    if (params.category && params.category !== 'Все категории' && params.category !== 'all') {
      whereConditions.push(
        sql`(category ILIKE ${'%' + params.category + '%'} OR title ILIKE ${'%' + params.category + '%'})`
      );
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

    // Data query with ordering - Alphabetical order (title ASC), with in-stock products first
    const rows = await sql`
      SELECT * FROM my_sklad_products
      ${whereSql}
      ORDER BY in_stock DESC, title ASC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const products: Product[] = rows.map((r: any) => mapDbRowToProduct(r));

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
 * Fetch all brand variants sharing the same clean OEM number
 */
export async function getVariantsByOemFromDb(cleanOem: string): Promise<ProductVariant[]> {
  const sql = client;
  if (!isDbConfigured() || !sql || !cleanOem) return [];
  try {
    const rows = await sql`
      SELECT id, title, brand, clean_oem_number, original_oem, price, old_price, stock_quantity, in_stock, image, images, description
      FROM my_sklad_products
      WHERE clean_oem_number = ${cleanOem} AND price >= 500
      ORDER BY in_stock DESC, price ASC;
    `;
    return rows.map((r: any) => {
      let images: string[] = [];
      if (Array.isArray(r.images)) images = r.images;
      else if (typeof r.images === 'string') {
        try { images = JSON.parse(r.images); } catch {}
      }
      const variantPrice = Number(r.price) || 0;
      let variantOldPrice = r.old_price ? Number(r.old_price) : undefined;
      if (variantOldPrice && variantOldPrice <= variantPrice) {
        variantOldPrice = undefined;
      }
      return {
        id: r.id,
        moySkladId: r.id,
        name: r.title,
        code: r.original_oem || '',
        oem: r.clean_oem_number,
        brand: r.brand || 'Koma Auto',
        tier: 1,
        price: variantPrice,
        oldPrice: variantOldPrice,
        stock: Number(r.stock_quantity) || 0,
        inStock: Boolean(r.in_stock),
        image: r.image || (images.length > 0 ? images[0] : ''),
        images,
        article: r.clean_oem_number,
        description: r.description || '',
      };
    });
  } catch (err) {
    console.error('[DB] Error querying variants by OEM:', err);
    return [];
  }
}

/**
 * Fast single product query by ID with all OEM brand variants (<15ms)
 */
export async function getProductByIdFromDb(id: string): Promise<Product | null> {
  const sql = client;
  if (!isDbConfigured() || !sql || !id) return null;
  try {
    const rows = await sql`
      SELECT * FROM my_sklad_products WHERE id = ${id} LIMIT 1;
    `;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];

    // Fetch sibling variants sharing the same clean OEM
    let variants: ProductVariant[] = [];
    if (r.clean_oem_number && r.clean_oem_number.length >= 4) {
      variants = await getVariantsByOemFromDb(r.clean_oem_number);
    }

    return mapDbRowToProduct(r, variants);
  } catch (err) {
    console.error('[DB] Error querying product by id:', err);
    return null;
  }
}

/**
 * Fast batch lookup of full products (e.g. for Cart)
 */
export async function getBatchProductsFromDb(ids: string[]): Promise<Product[]> {
  const sql = client;
  if (!isDbConfigured() || !sql || ids.length === 0) return [];
  try {
    const rows = await sql`
      SELECT * FROM my_sklad_products 
      WHERE id IN ${sql(ids)} AND price >= 500;
    `;
    return rows.map((r: any) => mapDbRowToProduct(r));
  } catch (err) {
    console.error('[DB] Error querying batch products:', err);
    return [];
  }
}

/**
 * Fast categories query directly from Neon (<10ms)
 */
export async function getCategoriesFromDb(): Promise<Array<{ id: string; name: string; count: number }>> {
  const sql = client;
  if (!isDbConfigured() || !sql) return [];
  try {
    const rows = await sql`
      SELECT category as name, count(*)::int as count
      FROM my_sklad_products
      WHERE category IS NOT NULL AND category != '' AND category != 'Автозапчасти' AND category != 'Без группы'
      GROUP BY category
      ORDER BY category ASC;
    `;
    return rows.map((r: any, idx: number) => ({
      id: String(idx + 1),
      name: r.name,
      count: r.count,
    }));
  } catch (err) {
    console.error('[DB] Error querying categories:', err);
    return [];
  }
}

/**
 * Fast batch lookup by IDs for price and inventory re-verification (e.g. at checkout)
 */
export async function getProductsByIdsFromDb(ids: string[]): Promise<Array<{ id: string; price: number; title: string; stock_quantity: number; in_stock: boolean }>> {
  const sql = client;
  if (!isDbConfigured() || !sql || ids.length === 0) return [];
  try {
    const rows = await sql`
      SELECT id, price, title, stock_quantity, in_stock
      FROM my_sklad_products 
      WHERE id IN ${sql(ids)}
    `;
    return rows.map((r: any) => ({
      id: r.id,
      price: Number(r.price) || 0,
      title: r.title,
      stock_quantity: Number(r.stock_quantity) || 0,
      in_stock: Boolean(r.in_stock),
    }));
  } catch (err) {
    console.error('[DB] Error querying products by ids:', err);
    return [];
  }
}
