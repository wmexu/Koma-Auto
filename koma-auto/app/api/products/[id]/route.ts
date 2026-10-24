import { NextResponse } from 'next/server';
import { getProductByIdFromDb } from '@/lib/products-db';
import { getProduct, mapMoySkladToProduct, getProductVariantsByOem } from '@/lib/moysklad';
import {
  sortProductVariants,
  normalizeBrand,
  isBrandBlacklisted,
  ProductVariant,
} from '@/lib/brand-utils';
import { products as fallbackProducts } from '@/data/products';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const { id } = params;

    // 1. High-speed database lookup (<15ms) - Zero MoySklad rate limit consumption
    try {
      const dbProduct = await getProductByIdFromDb(id);
      if (dbProduct) {
        if (dbProduct.price < 500 && (!dbProduct.variants || dbProduct.variants.length === 0)) {
          return NextResponse.json({ error: 'Product not available' }, { status: 404 });
        }
        return NextResponse.json(dbProduct);
      }
    } catch (dbErr) {
      console.warn('[Product API] Neon DB lookup failed, falling back:', dbErr);
    }

    // 2. Fallback to direct MoySklad API only if DB misses
    const productRes = await getProduct(id);
    const mappedProduct = mapMoySkladToProduct(productRes);

    // Fetch all variants sharing the same OEM
    const oem = mappedProduct.oem || mappedProduct.article;
    if (oem && oem.length >= 4) {
      try {
        const rawVariants = await getProductVariantsByOem(oem);
        if (rawVariants && rawVariants.length > 0) {
          const variantsList: ProductVariant[] = rawVariants
            .filter((ms) => !isBrandBlacklisted(ms.supplier?.name) && !isBrandBlacklisted(ms.name))
            .map((ms) => {
              const mapped = mapMoySkladToProduct(ms);
              const brandInfo = normalizeBrand(ms.supplier?.name, ms.code);
              return {
                id: ms.id,
                moySkladId: ms.id,
                name: ms.name,
                code: ms.code || '',
                oem,
                brand: brandInfo.brand,
                tier: brandInfo.tier,
                price: mapped.price,
                oldPrice: mapped.oldPrice,
                stock: ms.stock || 0,
                inStock: (ms.stock || 0) > 0,
                image: mapped.image,
                images: mapped.images,
                article: oem,
                description: ms.description || mapped.description,
              };
            })
            .filter((v) => !isBrandBlacklisted(v.brand) && v.price >= 500);

          if (
            !isBrandBlacklisted(mappedProduct.brand) &&
            mappedProduct.price >= 500 &&
            !variantsList.some((v) => v.id === mappedProduct.id)
          ) {
            const curBrand = normalizeBrand(productRes.supplier?.name, productRes.code);
            if (!isBrandBlacklisted(curBrand.brand)) {
              variantsList.push({
                id: mappedProduct.id,
                moySkladId: mappedProduct.id,
                name: mappedProduct.name,
                code: productRes.code || '',
                oem,
                brand: curBrand.brand,
                tier: curBrand.tier,
                price: mappedProduct.price,
                oldPrice: mappedProduct.oldPrice,
                stock: productRes.stock || 0,
                inStock: (productRes.stock || 0) > 0,
                image: mappedProduct.image,
                images: mappedProduct.images,
                article: oem,
                description: mappedProduct.description,
              });
            }
          }

          // Deduplicate variants by brand (keep in-stock or lower price)
          const brandMap = new Map<string, ProductVariant>();
          variantsList.forEach((v) => {
            if (isBrandBlacklisted(v.brand)) return;
            const existing = brandMap.get(v.brand);
            if (!existing) {
              brandMap.set(v.brand, v);
            } else {
              if (!existing.inStock && v.inStock) {
                brandMap.set(v.brand, v);
              } else if (existing.inStock === v.inStock && v.price < existing.price && v.price > 0) {
                brandMap.set(v.brand, v);
              }
            }
          });

          const sortedVariants = sortProductVariants(Array.from(brandMap.values())).filter(
            (v) => v.price >= 500 && !isBrandBlacklisted(v.brand)
          );
          mappedProduct.variants = sortedVariants;
          mappedProduct.availableBrandsCount = sortedVariants.length;

          if (sortedVariants.length > 0) {
            mappedProduct.brand = sortedVariants[0].brand;
            if (mappedProduct.price < 500) {
              mappedProduct.price = sortedVariants[0].price;
            }
          }
        }
      } catch (varErr) {
        console.warn('Failed to load variants for OEM:', oem, varErr);
      }
    }

    if (mappedProduct.price < 500 && (!mappedProduct.variants || mappedProduct.variants.length === 0)) {
      return NextResponse.json({ error: 'Product not available' }, { status: 404 });
    }

    return NextResponse.json(mappedProduct);
  } catch (error) {
    console.error(`Error fetching product:`, error);

    const params = await context.params;
    const fallbackProduct = fallbackProducts.find(
      (p) => p.id === params.id || p.moySkladId === params.id
    );
    if (fallbackProduct) {
      return NextResponse.json(fallbackProduct);
    }

    return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
  }
}
