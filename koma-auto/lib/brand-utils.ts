export interface BrandInfo {
  brand: string;
  tier: number;
}

export interface ProductVariant {
  id: string;
  moySkladId?: string;
  name: string;
  code: string;
  oem: string;
  brand: string;
  tier: number;
  price: number;
  oldPrice?: number;
  stock: number;
  inStock: boolean;
  image?: string;
  images?: string[];
  article?: string;
  description?: string;
}

export interface GroupedProduct {
  id: string;
  moySkladId?: string;
  oem: string;
  article: string; // Shows OEM code now!
  name: string;
  price: number;
  minPrice: number;
  maxPrice: number;
  oldPrice?: number;
  inStock: boolean;
  category: string;
  image?: string;
  images?: string[];
  brand: string; // Default selected brand
  availableBrandsCount: number;
  variants: ProductVariant[];
  specs: Record<string, string>;
  compatibility: string[];
  description?: string;
}

/**
 * Extracts canonical OEM code from product code or article
 * Strictly ignores internal MoySklad counter numbers (e.g. 000009554, 004200200, 003303131)
 */
export function extractOemCode(code?: string, article?: string, name?: string): string {
  const isInternalCounter = (str: string) => /^00[0-9]{4,}$/.test(str) || /^[0-9]{1,4}$/.test(str);

  const cleanCode = (code || '').trim().replace(/[\s\-\.]/g, '');
  let cleanArticle = (article || '').trim().replace(/[\s\-\.]/g, '');
  if (isInternalCounter(cleanArticle)) {
    cleanArticle = '';
  }

  const raw = cleanCode || cleanArticle;
  if (!raw) {
    if (name) {
      const nameOem = name.match(/([0-9]{5}[0-9a-zA-Z]{5}|[1-9][0-9]{7})/i);
      if (nameOem) return nameOem[1].toUpperCase();
    }
    return '';
  }

  // 1. GM / Daewoo: 8 digits not starting with 00 (e.g. 96130396gm -> 96130396, 95259950 -> 95259950)
  const gm = raw.match(/^([1-9][0-9]{7})([a-zA-Z]*)$/);
  if (gm) return gm[1];

  // 2. Hyundai / Kia: 10 chars (e.g. 31112b1000org -> 31112B1000, 253293x600mob -> 253293X600, 41700a75d10uz -> 41700A75D10)
  const hk = raw.match(/^([0-9]{5}[0-9a-zA-Z]{5})([a-zA-Z]*)$/i);
  if (hk) return hk[1].toUpperCase();

  // 3. Known supplier code suffixes (e.g. JL132Buz -> JL132B, 94583399SAUL -> 94583399, 343304EXCEL -> 343304)
  const knownSfx = raw.match(/^([0-9a-zA-Z]{4,})?(org|mob|gmq|gm|buz|uz|sq|hq|kex|kp|kap|ps|mp|car|kw|os|aydo|trt|ml|ux|cs|saul|mj|ysf|dyc|dy|ch|bs|sl|hyt|excel|w)$/i);
  if (knownSfx && knownSfx[1] && !isInternalCounter(knownSfx[1])) {
    return knownSfx[1].toUpperCase();
  }

  // 4. Fallback: if ends with 1-4 letters and prefix is at least 4 alphanumeric
  const sfxMatch = raw.match(/^([0-9a-zA-Z]{4,})([a-zA-Z]{1,4})$/);
  if (sfxMatch && !isInternalCounter(sfxMatch[1])) {
    return sfxMatch[1].toUpperCase();
  }

  if (isInternalCounter(raw)) {
    return '';
  }

  return raw.toUpperCase();
}

import {
  CANONICAL_BRANDS,
  RAW_TO_CANONICAL_BRAND,
  findCanonicalBrand,
  getBrandTier,
  isBrandBlacklisted,
  BLACKLISTED_BRANDS,
} from './manager-brands';

export {
  CANONICAL_BRANDS,
  RAW_TO_CANONICAL_BRAND,
  findCanonicalBrand,
  getBrandTier,
  isBrandBlacklisted,
  BLACKLISTED_BRANDS,
};

/**
 * Fallback code suffix rules when supplier name is missing or internal trash
 */
const CODE_SUFFIX_RULES: Array<{ sfx: RegExp; brand: string; tier: number }> = [
  { sfx: /org$/i, brand: 'Hyundai', tier: 100 },
  { sfx: /gm$/i, brand: 'GM', tier: 55 },
  { sfx: /mob$/i, brand: 'Mobis', tier: 85 },
  { sfx: /mdo$|m$/i, brand: 'Mando', tier: 80 },
  { sfx: /kex$|kp$|kap$/i, brand: 'KorParts', tier: 70 },
  { sfx: /sq$|hq$/i, brand: 'Hi-Q', tier: 70 },
  { sfx: /ps$|mp$/i, brand: 'PartSmall', tier: 70 },
  { sfx: /car$/i, brand: 'Cardex', tier: 70 },
  { sfx: /kw$/i, brand: 'KorWheel', tier: 40 },
  { sfx: /uz$|buz$/i, brand: 'UzDW', tier: 40 },
  { sfx: /os$/i, brand: 'Oscca', tier: 40 },
  { sfx: /aydo$/i, brand: 'Daydo', tier: 40 },
  { sfx: /tn$|trt$/i, brand: 'TRT', tier: 40 },
  { sfx: /ml$/i, brand: 'Meillor', tier: 40 },
  { sfx: /ux$/i, brand: 'Uxclent', tier: 40 },
  { sfx: /cs$/i, brand: 'Carstation', tier: 40 },
  { sfx: /saul$/i, brand: 'Saul', tier: 40 },
  { sfx: /mj$|ysf$/i, brand: 'Yuilfilter', tier: 70 },
  { sfx: /dyc$|dy$/i, brand: 'DYC Korea', tier: 70 },
  { sfx: /ch$/i, brand: 'China', tier: 40 },
];

/**
 * Normalizes any messy supplier or code into a clean brand name and tier
 * using the manager's canonical brand dictionary and branch mappings.
 */
export function normalizeBrand(supplierName?: string, code?: string): BrandInfo {
  const cleanSupplier = (supplierName || '').trim();

  // If supplier is blacklisted (e.g. Genuine Parts), treat as unbranded
  if (isBrandBlacklisted(cleanSupplier)) {
    return { brand: 'Корея', tier: 30 };
  }

  // 1. Direct lookup in manager's canonical brands dictionary
  if (cleanSupplier) {
    const canonical = findCanonicalBrand(cleanSupplier);
    if (canonical && !isBrandBlacklisted(canonical)) {
      return { brand: canonical, tier: getBrandTier(canonical) };
    }
  }

  // 2. If supplier is trash/stall or empty, check code suffix
  if (code) {
    for (const sr of CODE_SUFFIX_RULES) {
      if (sr.sfx.test(code.trim())) {
        return { brand: sr.brand, tier: sr.tier };
      }
    }
  }

  // 3. Fallback: check if supplier name starts with a known brand (NEVER promote to Tier 100 via fallback)
  if (cleanSupplier) {
    for (const [rawKey, canonical] of Object.entries(RAW_TO_CANONICAL_BRAND)) {
      // Only match if exact prefix match, length >= 4, and NOT an OEM Tier 100 brand
      if (
        canonical !== 'Hyundai' &&
        canonical !== 'Genesis' &&
        canonical !== 'KIA' &&
        rawKey.length >= 4 &&
        cleanSupplier.toLowerCase().startsWith(rawKey + ' ')
      ) {
        return { brand: canonical, tier: getBrandTier(canonical) };
      }
    }
  }

  // 4. Filter out stalls (e.g. '3-150', '2-164a') and human orderers/mechanics
  const isTrash =
    !cleanSupplier ||
    /^[0-9]\-[0-9]+|^[0-9]+$/i.test(cleanSupplier) ||
    /^(саша|стас|нуртаз|алексей|рашид|витя|асхат|шукуржон|кайрош|багжан|рохман|свободни|дядька|no_supplier)/i.test(
      cleanSupplier
    ) ||
    cleanSupplier.toLowerCase().includes('сто ') ||
    cleanSupplier.toLowerCase().includes('карсити');

  if (!isTrash) {
    return { brand: cleanSupplier, tier: getBrandTier(cleanSupplier) };
  }

  return { brand: 'Корея', tier: 30 };
}

/**
 * Sorts brand variants from top tier to low tier, with in-stock items first
 */
export function sortProductVariants(variants: ProductVariant[]): ProductVariant[] {
  return [...variants].sort((a, b) => {
    // 1. In stock first
    if (a.inStock !== b.inStock) {
      return a.inStock ? -1 : 1;
    }
    // 2. Higher tier first (e.g. 100 > 85 > 65 > 45)
    if (a.tier !== b.tier) {
      return b.tier - a.tier;
    }
    // 3. Lower price first within same tier
    return a.price - b.price;
  });
}
