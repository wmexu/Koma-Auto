import { client, isDbConfigured } from '@/db';
import { Product, ProductVariant } from '@/data/products';
import { normalizeBrand, sortProductVariants } from '@/lib/brand-utils';

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
    images = r.images.filter((img: any) => typeof img === 'string' && img.trim().length > 0);
  } else if (typeof r.images === 'string') {
    try {
      const parsed = JSON.parse(r.images);
      if (Array.isArray(parsed)) {
        images = parsed.filter((img: any) => typeof img === 'string' && img.trim().length > 0);
      } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
        images = [parsed.trim()];
      }
    } catch {
      if (r.images.trim().length > 0) {
        images = [r.images.trim()];
      }
    }
  }

  let compatibility: string[] = [];
  if (Array.isArray(r.compatibility)) {
    compatibility = r.compatibility.map((c: any) =>
      typeof c === 'string' ? c : `${c.make} ${c.model}${c.years ? ` (${c.years})` : ''}`
    );
  } else if (typeof r.compatibility === 'string') {
    try {
      const parsed = JSON.parse(r.compatibility);
      if (Array.isArray(parsed)) {
        compatibility = parsed.map((c: any) =>
          typeof c === 'string' ? c : `${c.make} ${c.model}${c.years ? ` (${c.years})` : ''}`
        );
      } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
        compatibility = [parsed.trim()];
      }
    } catch {
      if (r.compatibility.trim().length > 0) {
        compatibility = [r.compatibility.trim()];
      }
    }
  }

  let specs: Record<string, string> = {};
  if (r.specs && typeof r.specs === 'object' && !Array.isArray(r.specs)) {
    specs = { ...r.specs };
  } else if (typeof r.specs === 'string') {
    try {
      const parsed = JSON.parse(r.specs);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        specs = { ...parsed };
      }
    } catch {}
  }
  // Remove stale manufacturer keys from specs so the canonical brand takes precedence
  delete specs['Производитель'];
  delete specs['производитель'];
  delete specs['Бренд'];
  delete specs['бренд'];

  const price = Number(r.price) || 0;
  let oldPrice = r.old_price ? Number(r.old_price) : undefined;
  // Safety: strikethrough oldPrice must strictly be higher than the real selling price
  if (oldPrice && oldPrice <= price) {
    oldPrice = undefined;
  }
  const stock = Number(r.stock_quantity) || 0;

  const rawOemClean = (r.clean_oem_number || '').replace(/[\s\-\.]/g, '').toUpperCase();
  const rawCode = (r.original_oem || '').replace(/[\s\-\.]/g, '').toUpperCase();
  const isStarter361002G200 = rawOemClean === '361002G200' || rawCode.includes('361002G200');

  let rawBrand = r.brand && r.brand !== 'Koma Auto' ? r.brand : undefined;
  if (isStarter361002G200 && rawBrand && /valeo/i.test(rawBrand)) {
    rawBrand = 'Valeo China';
  }

  const brandInfo = normalizeBrand(
    rawBrand,
    r.original_oem || r.clean_oem_number
  );
  const determinedBrand = isStarter361002G200 && /valeo/i.test(brandInfo.brand) ? 'Valeo China' : brandInfo.brand;
  const determinedTier = isStarter361002G200 && determinedBrand === 'Valeo China' ? 45 : brandInfo.tier;

  let resolvedImage = r.image || (images.length > 0 ? images[0] : '');
  if (!resolvedImage && variants && variants.length > 0) {
    const vWithImage = variants.find((v) => Boolean(v.image && v.image.trim().length > 0));
    if (vWithImage) {
      resolvedImage = vWithImage.image;
      if (images.length === 0 && vWithImage.images && vWithImage.images.length > 0) {
        images = vWithImage.images;
      }
    }
  }

  // Ensure all sibling variants inherit resolvedImage if they do not have their own
  if (resolvedImage && variants && variants.length > 0) {
    variants.forEach((v) => {
      if (!v.image || v.image.trim().length === 0) {
        v.image = resolvedImage;
        if (!v.images || v.images.length === 0) {
          v.images = images.length > 0 ? images : [resolvedImage];
        }
      }
    });
  }

  const defaultVariant: ProductVariant = {
    id: r.id,
    name: r.title,
    code: r.original_oem || '',
    oem: r.clean_oem_number || '',
    brand: determinedBrand,
    tier: determinedTier,
    price,
    oldPrice,
    stock,
    inStock: Boolean(r.in_stock),
    image: resolvedImage,
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
    brand: determinedBrand,
    name: r.title,
    price,
    oldPrice,
    stock,
    inStock: Boolean(r.in_stock),
    category: r.category || 'Автозапчасти',
    image: resolvedImage,
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
  const search = (params.search || '').trim().slice(0, 100);
  const cleanSearch = search.replace(/[\s\-_.\/\\,]/g, '').toUpperCase();

  try {
    let whereConditions = [];

    // Filter price >= 500
    whereConditions.push(sql`price >= 500`);

    // Deduplication rule: 361002G200 has two duplicate catalog entries (Mobis & Valeo).
    // In catalog and search results, show ONLY the primary Mobis entry (02bd811c-4e95-11f1-0a80-17ce000b265a)
    // while the Valeo China option is accessible as a variant inside the product card.
    whereConditions.push(sql`id != 'bade0018-4e95-11f1-0a80-17ce000c04b4'`);

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
      const oemPattern = cleanSearch ? `%${cleanSearch}%` : searchPattern;
      const words = search.split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 2);

      if (words.length > 1) {
        const wordClauses = words.map((w) => {
          const wp = `%${w}%`;
          const cleanW = w.replace(/[\s\-_\./\\,]/g, '').toUpperCase();
          const cleanWp = cleanW ? `%${cleanW}%` : wp;
          return sql`(
            title ILIKE ${wp}
            OR clean_oem_number ILIKE ${cleanWp}
            OR original_oem ILIKE ${wp}
            OR translate(COALESCE(original_oem, ''), ' -_./\,', '') ILIKE ${cleanWp}
            OR brand ILIKE ${wp}
            OR compatibility::text ILIKE ${wp}
          )`;
        });
        whereConditions.push(sql`(${wordClauses.reduce((acc, curr) => sql`${acc} AND ${curr}`)})`);
      } else {
        whereConditions.push(
          sql`(
            title ILIKE ${searchPattern}
            OR clean_oem_number ILIKE ${oemPattern}
            OR original_oem ILIKE ${searchPattern}
            OR translate(COALESCE(original_oem, ''), ' -_./\,', '') ILIKE ${oemPattern}
            OR translate(COALESCE(title, ''), ' -_./\,', '') ILIKE ${oemPattern}
            OR brand ILIKE ${searchPattern}
            OR compatibility::text ILIKE ${searchPattern}
          )`
        );
      }
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
  const normalizedOem = cleanOem.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  try {
    const rows = await sql`
      SELECT id, title, brand, clean_oem_number, original_oem, price, old_price, stock_quantity, in_stock, image, images, description
      FROM my_sklad_products
      WHERE clean_oem_number = ${normalizedOem} AND price >= 500
      ORDER BY in_stock DESC, price ASC;
    `;
    const mappedVariants = rows.map((r: any) => {
      let images: string[] = [];
      if (Array.isArray(r.images)) {
        images = r.images.filter((img: any) => typeof img === 'string' && img.trim().length > 0);
      } else if (typeof r.images === 'string') {
        try {
          const parsed = JSON.parse(r.images);
          if (Array.isArray(parsed)) {
            images = parsed.filter((img: any) => typeof img === 'string' && img.trim().length > 0);
          } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
            images = [parsed.trim()];
          }
        } catch {
          if (r.images.trim().length > 0) images = [r.images.trim()];
        }
      }
      const variantPrice = Number(r.price) || 0;
      let variantOldPrice = r.old_price ? Number(r.old_price) : undefined;
      if (variantOldPrice && variantOldPrice <= variantPrice) {
        variantOldPrice = undefined;
      }
      const rawOemClean = (r.clean_oem_number || '').replace(/[\s\-\.]/g, '').toUpperCase();
      const rawCode = (r.original_oem || '').replace(/[\s\-\.]/g, '').toUpperCase();
      const isStarter361002G200 = rawOemClean === '361002G200' || rawCode.includes('361002G200');

      let rawBrand = r.brand && r.brand !== 'Koma Auto' ? r.brand : undefined;
      if (isStarter361002G200 && rawBrand && /valeo/i.test(rawBrand)) {
        rawBrand = 'Valeo China';
      }

      const bInfo = normalizeBrand(
        rawBrand,
        r.original_oem || r.clean_oem_number
      );
      const finalBrand = isStarter361002G200 && /valeo/i.test(bInfo.brand) ? 'Valeo China' : bInfo.brand;
      const finalTier = isStarter361002G200 && finalBrand === 'Valeo China' ? 45 : bInfo.tier;

      return {
        id: r.id,
        moySkladId: r.id,
        name: r.title,
        code: r.original_oem || '',
        oem: r.clean_oem_number,
        brand: finalBrand,
        tier: finalTier,
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

    const brandMap = new Map<string, ProductVariant>();
    mappedVariants.forEach((v: ProductVariant) => {
      const existing = brandMap.get(v.brand);
      if (!existing) {
        brandMap.set(v.brand, v);
      } else {
        if (!existing.inStock && v.inStock) {
          brandMap.set(v.brand, v);
        } else if (existing.inStock === v.inStock && v.price < existing.price && v.price >= 500) {
          brandMap.set(v.brand, v);
        }
      }
    });

    const sortedVariants = sortProductVariants(Array.from(brandMap.values()));

    // OEM photo inheritance rule:
    // If one or more manufacturers have a photo, any sibling manufacturer without a photo
    // inherits the first available manufacturer's photo for this clean OEM.
    const firstAvailableImage = sortedVariants.find((v) => Boolean(v.image && v.image.trim().length > 0))?.image || '';
    const firstAvailableImages = sortedVariants.find((v) => Boolean(v.images && v.images.length > 0))?.images || [];

    if (firstAvailableImage) {
      sortedVariants.forEach((v) => {
        if (!v.image || v.image.trim().length === 0) {
          v.image = firstAvailableImage;
          if (!v.images || v.images.length === 0) {
            v.images = firstAvailableImages;
          }
        }
      });
    }

    return sortedVariants;
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
    const mapped = rows.map((r: any) => mapDbRowToProduct(r));
    const productMap = new Map<string, Product>();
    mapped.forEach((p) => productMap.set(p.id, p));
    return ids.map((id) => productMap.get(id)).filter((p): p is Product => Boolean(p));
  } catch (err) {
    console.error('[DB] Error querying batch products:', err);
    return [];
  }
}

/**
 * Fast featured products lookup directly from Neon (<15ms)
 * Preserves exact requested ID order, loads sibling OEM variants, calculates min/max price
 */
export async function getFeaturedProductsFromDb(ids: string[]): Promise<Product[]> {
  const sql = client;
  if (!isDbConfigured() || !sql || ids.length === 0) return [];
  try {
    const rows = await sql`
      SELECT * FROM my_sklad_products 
      WHERE id IN ${sql(ids)} AND price >= 500;
    `;
    if (!rows || rows.length === 0) return [];

    const mappedProducts = rows.map((r: any) => mapDbRowToProduct(r));
    const productMap = new Map<string, Product>();
    mappedProducts.forEach((p) => productMap.set(p.id, p));

    return ids
      .map((id) => productMap.get(id))
      .filter((p): p is Product => typeof p !== 'undefined' && p !== null && p.price >= 500);
  } catch (err) {
    console.error('[DB] Error querying featured products:', err);
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
