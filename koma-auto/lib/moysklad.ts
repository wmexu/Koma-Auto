import { MoySkladListResponse, MoySkladProduct, MoySkladProductFolder } from './moysklad-types';
import { Product, ProductVariant } from '../data/products';
import {
  extractOemCode,
  normalizeBrand,
  sortProductVariants,
  isBrandBlacklisted,
} from './brand-utils';

const API_URL = process.env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const TOKEN = process.env.MOYSKLAD_TOKEN;
const LOGIN = process.env.MOYSKLAD_LOGIN;
const PASSWORD = process.env.MOYSKLAD_PASSWORD;

// The main store URL for "Car City 1 ярус Подвал"
export const PODVAL_STORE_URL =
  'https://api.moysklad.ru/api/remap/1.2/entity/store/4240a87a-4ea5-11f1-0a80-1b5c0008497a';
const MAIN_STORE_URL = PODVAL_STORE_URL;

export function getMoySkladAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/json',
  };

  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  } else if (LOGIN && PASSWORD) {
    const basic = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  return headers;
}

export async function fetchMoySklad<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;

  const headers = {
    ...getMoySkladAuthHeaders(),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `MoySklad API Error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.errors && errorData.errors.length > 0) {
        errorMsg += ` - ${errorData.errors[0].error}`;
      }
    } catch (e) {
      // Ignored
    }
    throw new Error(errorMsg);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export async function getProducts(
  limit = 48,
  offset = 0,
  search = '',
  categoryHref: string | string[] = '',
  brandHref: string | string[] = '',
  inStockOnly = false
): Promise<MoySkladListResponse<MoySkladProduct>> {
  const filters: string[] = ['archived=false'];
  if (categoryHref) {
    if (Array.isArray(categoryHref)) {
      categoryHref.forEach((href) => filters.push(`productFolder=${href}`));
    } else {
      filters.push(`productFolder=${categoryHref}`);
    }
  }

  if (inStockOnly) {
    filters.push(`stockMode=positiveonly`);
  }

  const cleanSearch = search.trim();
  let url = `/entity/assortment?limit=${limit}&offset=${offset}&expand=images,productFolder,supplier&stockStore=${encodeURIComponent(
    PODVAL_STORE_URL
  )}`;

  // In MoySklad /entity/assortment, the 'search' parameter is ignored by the API!
  // Instead, filtering is done via filter=code~... (OEM/code) or filter=name~... (name contains)
  if (cleanSearch) {
    const cleanOem = cleanSearch.replace(/[\s\-\.]/g, '');
    const isOemLike = /^[0-9a-zA-Z]{4,}$/.test(cleanOem) && /\d/.test(cleanOem);
    if (isOemLike) {
      filters.push(`code~${encodeURIComponent(cleanOem)}`);
    } else {
      filters.push(`name~${encodeURIComponent(cleanSearch)}`);
    }
  }

  if (filters.length > 0) {
    url += `&filter=${filters.join(';')}`;
  }

  try {
    const res = await fetchMoySklad<MoySkladListResponse<MoySkladProduct>>(url);
    // If OEM code search returned 0 items, retry with name~
    if ((!res.rows || res.rows.length === 0) && cleanSearch) {
      const cleanOem = cleanSearch.replace(/[\s\-\.]/g, '');
      const isOemLike = /^[0-9a-zA-Z]{4,}$/.test(cleanOem) && /\d/.test(cleanOem);
      if (isOemLike) {
        const retryFilters = filters.filter((f) => !f.startsWith('code~'));
        retryFilters.push(`name~${encodeURIComponent(cleanSearch)}`);
        const retryUrl = `/entity/assortment?limit=${limit}&offset=${offset}&expand=images,productFolder,supplier&stockStore=${encodeURIComponent(
          PODVAL_STORE_URL
        )}&filter=${retryFilters.join(';')}`;
        return await fetchMoySklad<MoySkladListResponse<MoySkladProduct>>(retryUrl);
      }
    }
    return res;
  } catch (err) {
    // If filter failed, fallback to name~ search
    if (cleanSearch) {
      const fallbackUrl = `/entity/assortment?limit=${limit}&offset=${offset}&expand=images,productFolder,supplier&stockStore=${encodeURIComponent(
        PODVAL_STORE_URL
      )}&filter=name~${encodeURIComponent(cleanSearch)}`;
      return await fetchMoySklad<MoySkladListResponse<MoySkladProduct>>(fallbackUrl);
    }
    throw err;
  }
}

export async function getProduct(id: string): Promise<MoySkladProduct> {
  const res = await fetchMoySklad<MoySkladListResponse<MoySkladProduct>>(
    `/entity/assortment?limit=1&filter=id=${id}&expand=images,productFolder,supplier&stockStore=${encodeURIComponent(
      PODVAL_STORE_URL
    )}`
  );
  if (!res.rows || res.rows.length === 0) {
    throw new Error(`Product with id ${id} not found in assortment`);
  }

  const product = res.rows[0];

  if (product.supplier && !product.supplier.name && product.supplier.meta && product.supplier.meta.href) {
    try {
      const supplierData = await fetchMoySklad<any>(product.supplier.meta.href);
      if (supplierData && supplierData.name) {
        product.supplier.name = supplierData.name;
      }
    } catch (e) {
      console.error('Failed to fetch supplier details for product:', e);
    }
  }

  return product;
}

export async function getProductVariantsByOem(oem: string): Promise<MoySkladProduct[]> {
  if (!oem || oem.length < 4) return [];

  const cleanOem = oem.replace(/[\s\-\.]/g, '');
  try {
    const res = await fetchMoySklad<MoySkladListResponse<MoySkladProduct>>(
      `/entity/assortment?filter=code~${encodeURIComponent(cleanOem)}&expand=images,supplier&stockStore=${encodeURIComponent(
        PODVAL_STORE_URL
      )}&limit=100`
    );
    const rows = res.rows || [];
    return rows.filter((r) => {
      const p = r.salePrices?.[0]?.value ? r.salePrices[0].value / 100 : 0;
      return p >= 500;
    });
  } catch (e) {
    return [];
  }
}

export async function getProductsByIds(ids: string[]): Promise<Product[]> {
  if (!ids || ids.length === 0) return [];

  const chunkSize = 20;
  const allProducts: Product[] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const filterStr = chunk.map((id) => `id=${id}`).join(';');
    try {
      const res = await fetchMoySklad<MoySkladListResponse<MoySkladProduct>>(
        `/entity/assortment?limit=100&filter=${filterStr}&expand=images,productFolder,supplier&stockStore=${encodeURIComponent(
          PODVAL_STORE_URL
        )}`
      );
      if (res.rows) {
        allProducts.push(
          ...res.rows
            .map(mapMoySkladToProduct)
            .filter((p) => p.price >= 500 && (p.minPrice ?? p.price) >= 500 && !isBrandBlacklisted(p.brand))
        );
      }
    } catch (e) {
      console.error('Error fetching batch products chunk:', e);
    }
  }

  return allProducts;
}

export async function getProductFolders(): Promise<MoySkladListResponse<MoySkladProductFolder>> {
  return fetchMoySklad<MoySkladListResponse<MoySkladProductFolder>>(`/entity/productfolder`);
}

export function mapMoySkladToProduct(msProduct: MoySkladProduct): Product {
  let category = 'other';
  if (msProduct.productFolder && 'name' in msProduct.productFolder) {
    category = msProduct.productFolder.name as string;
  }

  const supplierName = msProduct.supplier?.name;
  const brandInfo = normalizeBrand(supplierName, msProduct.code);
  const oem = extractOemCode(msProduct.code, msProduct.article, msProduct.name);

  let price = 0;
  if (msProduct.salePrices && msProduct.salePrices.length > 0) {
    price = msProduct.salePrices[0].value / 100;
  }

  let oldPrice: number | undefined;
  if (msProduct.salePrices && msProduct.salePrices.length > 1) {
    const oldPriceValue = msProduct.salePrices[1].value / 100;
    if (oldPriceValue > price) {
      oldPrice = oldPriceValue;
    }
  }

  // Stock from 1 ярус Подвал
  const stock = msProduct.stock || 0;
  const inStock = stock > 0;

  let image: string | undefined;
  let images: string[] = [];
  if (msProduct.images && msProduct.images.rows && msProduct.images.rows.length > 0) {
    const imgUrl = msProduct.images.rows[0].meta.downloadHref;
    if (imgUrl) {
      image = `/api/images?href=${encodeURIComponent(imgUrl)}`;
    }

    images = msProduct.images.rows
      .map((img) => (img.meta.downloadHref ? `/api/images?href=${encodeURIComponent(img.meta.downloadHref)}` : ''))
      .filter((url) => url !== '');
  }

  const specs: Record<string, string> = {};
  if (msProduct.attributes) {
    msProduct.attributes.forEach((attr) => {
      if (attr.name.toLowerCase() !== 'бренд') {
        if (typeof attr.value === 'string') {
          specs[attr.name] = attr.value;
        } else if (typeof attr.value === 'object' && 'name' in attr.value) {
          specs[attr.name] = attr.value.name;
        }
      }
    });
  }

  return {
    id: msProduct.id,
    moySkladId: msProduct.id,
    article: oem || msProduct.code || msProduct.article || '',
    oem: oem || msProduct.code || '',
    brand: brandInfo.brand,
    name: msProduct.name,
    price,
    oldPrice,
    inStock,
    category,
    image,
    images,
    specs,
    compatibility: [],
    description: msProduct.description || '',
    variants: [
      {
        id: msProduct.id,
        name: msProduct.name,
        code: msProduct.code || '',
        oem,
        brand: brandInfo.brand,
        tier: brandInfo.tier,
        price,
        oldPrice,
        stock,
        inStock,
        image,
        images,
        article: oem || msProduct.code || '',
      },
    ],
    availableBrandsCount: 1,
  };
}

/**
 * Groups multiple products sharing the same OEM into 1 single Product card with variants
 */
export function groupProductsByOem(products: Product[]): Product[] {
  const groups = new Map<string, Product[]>();

  products.forEach((p) => {
    if (p.price < 500 && (p.minPrice === undefined || p.minPrice < 500)) return;
    if (isBrandBlacklisted(p.brand)) return;
    const key = (p.oem || p.article || p.id).toUpperCase().replace(/[\s\-\.]/g, '');
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(p);
  });

  const groupedList: Product[] = [];

  for (const [oemKey, items] of groups.entries()) {
    // Collect all variants with price >= 500
    const allVariants: ProductVariant[] = [];
    items.forEach((item) => {
      if (item.variants && item.variants.length > 0) {
        allVariants.push(...item.variants.filter((v) => v.price >= 500 && !isBrandBlacklisted(v.brand)));
      } else if (item.price >= 500 && !isBrandBlacklisted(item.brand)) {
        const brandInfo = normalizeBrand(item.brand, item.article);
        if (isBrandBlacklisted(brandInfo.brand)) return;
        allVariants.push({
          id: item.id,
          name: item.name,
          code: item.article,
          oem: item.oem || item.article,
          brand: brandInfo.brand,
          tier: brandInfo.tier,
          price: item.price,
          oldPrice: item.oldPrice,
          stock: item.inStock ? 1 : 0,
          inStock: item.inStock,
          image: item.image,
          images: item.images,
        });
      }
    });

    if (allVariants.length === 0) continue;

    // Deduplicate variants by brand (if duplicate supplier entries exist, pick in-stock or cheaper)
    const uniqueVariantsMap = new Map<string, ProductVariant>();
    allVariants.forEach((v) => {
      if (isBrandBlacklisted(v.brand)) return;
      const existing = uniqueVariantsMap.get(v.brand);
      if (!existing) {
        uniqueVariantsMap.set(v.brand, v);
      } else {
        // Prefer in-stock, then lower price
        if (!existing.inStock && v.inStock) {
          uniqueVariantsMap.set(v.brand, v);
        } else if (existing.inStock === v.inStock && v.price < existing.price && v.price >= 500) {
          uniqueVariantsMap.set(v.brand, v);
        }
      }
    });

    const sortedVariants = sortProductVariants(Array.from(uniqueVariantsMap.values()));

    // The primary variant (top tier with stock, or top tier)
    const primary = sortedVariants[0] || allVariants[0];
    if (!primary || primary.price < 500) continue;

    const prices = sortedVariants.map((v) => v.price).filter((p) => p >= 500);
    if (prices.length === 0) continue;

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (minPrice < 500) continue;
    const hasAnyStock = sortedVariants.some((v) => v.inStock);

    // Pick best image available across all variants
    const bestImage =
      primary.image ||
      sortedVariants.find((v) => v.image)?.image ||
      items.find((i) => i.image)?.image;

    const allImages = Array.from(
      new Set(
        sortedVariants
          .flatMap((v) => v.images || (v.image ? [v.image] : []))
          .filter((img): img is string => Boolean(img))
      )
    );

    groupedList.push({
      id: primary.id,
      moySkladId: primary.id,
      article: primary.oem || oemKey,
      oem: primary.oem || oemKey,
      name: primary.name,
      brand: primary.brand,
      price: primary.price,
      minPrice,
      maxPrice,
      oldPrice: primary.oldPrice,
      inStock: hasAnyStock,
      category: items[0].category,
      image: bestImage,
      images: allImages,
      specs: items[0].specs || {},
      compatibility: items[0].compatibility || [],
      description: primary.description || items[0].description,
      variants: sortedVariants,
      availableBrandsCount: sortedVariants.length,
    });
  }

  return groupedList;
}
