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

/**
 * Brand matching rules mapped to clean names and quality tiers
 * Tier 100: Original (Hyundai, Kia, GM Genuine)
 * Tier 85: Premium OEM / Tier-1 (Gates, Mobis, Mando, CTR, Iljin, Valeo, Bosch, Elring, etc.)
 * Tier 65: Known Korean Aftermarket (Korparts, Hi-Q, Parts-Mall, Car-Dex, AMD, etc.)
 * Tier 45: Budget / Other (UzDW, Korwheel, Oscca, China, etc.)
 */
const BRAND_RULES: Array<{ match: RegExp; brand: string; tier: number }> = [
  // 1. Original Tier (100)
  { match: /^(hyundai|genesis|kia|hy motors|genuine parts|oem)/i, brand: 'Hyundai', tier: 100 },
  { match: /^(gm|gm china|gm org|gmq|chevrolet|daewoo genuine)/i, brand: 'GM Genuine', tier: 100 },

  // 2. Premium OEM Tier (85-80)
  { match: /^gates/i, brand: 'Gates', tier: 85 },
  { match: /^(mobis|kobis|mobiparts)/i, brand: 'Mobis', tier: 85 },
  { match: /^mando/i, brand: 'Mando', tier: 80 },
  { match: /^ctr/i, brand: 'CTR', tier: 80 },
  { match: /^iljin/i, brand: 'Iljin', tier: 80 },
  { match: /^(valeo|phc valeo)/i, brand: 'Valeo', tier: 80 },
  { match: /^bosch/i, brand: 'Bosch', tier: 80 },
  { match: /^mahle/i, brand: 'Mahle', tier: 80 },
  { match: /^(elring|erling|erliing)/i, brand: 'Elring', tier: 80 },
  { match: /^victor reinz/i, brand: 'Victor Reinz', tier: 80 },
  { match: /^(hanon|hvcc|hcc|doowon)/i, brand: 'Hanon', tier: 80 },
  { match: /^(skf|fag|ina|koyo|nsk|kbc)/i, brand: 'SKF / INA / FAG', tier: 80 },
  { match: /^delphi/i, brand: 'Delphi', tier: 80 },
  { match: /^(ngk|denso)/i, brand: 'NGK / Denso', tier: 80 },

  // 3. Known Korean Aftermarket (65-55)
  { match: /^(korparts|kaparts|korpatrs|karparts|kex|kap geniun)/i, brand: 'Korparts', tier: 65 },
  { match: /^(hi-q korea|sangsin korea|hi-q \(korea\))/i, brand: 'Hi-Q Korea', tier: 65 },
  { match: /^partsmall|^parts\-mall/i, brand: 'Parts-Mall', tier: 60 },
  { match: /^cardex|^car\-dex/i, brand: 'Car-Dex', tier: 60 },
  { match: /^onnuri/i, brand: 'Onnuri', tier: 60 },
  { match: /^besf1ts/i, brand: 'Besf1ts', tier: 60 },
  { match: /^amd/i, brand: 'AMD', tier: 60 },
  { match: /^(dong yang piston|piston)/i, brand: 'Dong Yang Piston', tier: 60 },
  { match: /^dongil/i, brand: 'Dongil', tier: 60 },
  { match: /^gmb/i, brand: 'GMB', tier: 60 },
  { match: /^(yuilfilter|mj filter|ysf filter|i filtr)/i, brand: 'Yuil Filter', tier: 60 },
  { match: /^(dyc|dyf fan)/i, brand: 'DYC', tier: 60 },
  { match: /^kfm/i, brand: 'KFM', tier: 60 },
  { match: /^hanse/i, brand: 'Hanse', tier: 60 },
  { match: /^seoul/i, brand: 'Seoul Gasket', tier: 60 },
  { match: /^thc/i, brand: 'THC', tier: 60 },
  { match: /^phg/i, brand: 'PHG', tier: 60 },
  { match: /^yulim/i, brand: 'Yulim', tier: 60 },
  { match: /^shin han/i, brand: 'Shinhan', tier: 60 },
  { match: /^shin hwa/i, brand: 'Shinhwa', tier: 60 },
  { match: /^geung young/i, brand: 'Geung Young', tier: 60 },
  { match: /^rhee jin/i, brand: 'Rhee Jin', tier: 60 },
  { match: /^kowoo/i, brand: 'Kowoo', tier: 60 },
  { match: /^stellox/i, brand: 'Stellox', tier: 55 },
  { match: /^nsp/i, brand: 'NSP', tier: 55 },
  { match: /^patron/i, brand: 'Patron', tier: 55 },
  { match: /^febest/i, brand: 'Febest', tier: 55 },
  { match: /^kashiyama/i, brand: 'Kashiyama', tier: 55 },

  // 4. Budget / China / Uzbekistan / Other (45-35)
  // If Hi-Q is not specifically Hi-Q Korea, user specified it belongs in low/budget tier
  { match: /^(hi-q|super-q|superq|yes-q|sangsin)/i, brand: 'Hi-Q', tier: 45 },
  { match: /^(uzdw|uz\-daewoo|uz daewoo|uzbek)/i, brand: 'UzDW', tier: 45 },
  { match: /^(korwheel|kerwheel|baikor)/i, brand: 'Korwheel', tier: 45 },
  { match: /^oscca/i, brand: 'Oscca', tier: 40 },
  { match: /^daydo/i, brand: 'Daydo', tier: 40 },
  { match: /^motech/i, brand: 'Motech', tier: 40 },
  { match: /^meillor/i, brand: 'Meillor', tier: 40 },
  { match: /^trt/i, brand: 'TRT', tier: 40 },
  { match: /^sib/i, brand: 'SIB', tier: 40 },
  { match: /^atc/i, brand: 'ATC', tier: 40 },
  { match: /^uxclent/i, brand: 'Uxclent', tier: 40 },
  { match: /^carstation/i, brand: 'Carstation', tier: 40 },
  { match: /^saul/i, brand: 'Saul', tier: 40 },
  { match: /^(china|kpr|китай)/i, brand: 'China', tier: 35 },
  { match: /^(korea|корея)/i, brand: 'Korea', tier: 50 },
  { match: /^4u/i, brand: '4U', tier: 40 },
];

/**
 * Fallback code suffix rules when supplier name is missing or internal trash
 */
const CODE_SUFFIX_RULES: Array<{ sfx: RegExp; brand: string; tier: number }> = [
  { sfx: /org$/i, brand: 'Hyundai', tier: 100 },
  { sfx: /gm$/i, brand: 'GM Genuine', tier: 100 },
  { sfx: /mob$/i, brand: 'Mobis', tier: 85 },
  { sfx: /mdo$|m$/i, brand: 'Mando', tier: 80 },
  { sfx: /kex$|kp$|kap$/i, brand: 'Korparts', tier: 65 },
  { sfx: /sq$|hq$/i, brand: 'Hi-Q', tier: 45 },
  { sfx: /ps$|mp$/i, brand: 'Parts-Mall', tier: 60 },
  { sfx: /car$/i, brand: 'Car-Dex', tier: 60 },
  { sfx: /kw$/i, brand: 'Korwheel', tier: 45 },
  { sfx: /uz$|buz$/i, brand: 'UzDW', tier: 45 },
  { sfx: /os$/i, brand: 'Oscca', tier: 40 },
  { sfx: /aydo$/i, brand: 'Daydo', tier: 40 },
  { sfx: /tn$|trt$/i, brand: 'TRT', tier: 40 },
  { sfx: /ml$/i, brand: 'Meillor', tier: 40 },
  { sfx: /ux$/i, brand: 'Uxclent', tier: 40 },
  { sfx: /cs$/i, brand: 'Carstation', tier: 40 },
  { sfx: /saul$/i, brand: 'Saul', tier: 40 },
  { sfx: /mj$|ysf$/i, brand: 'Yuil Filter', tier: 60 },
  { sfx: /dyc$|dy$/i, brand: 'DYC', tier: 60 },
  { sfx: /ch$/i, brand: 'China', tier: 35 },
];

/**
 * Normalizes any messy supplier or code into a clean brand name and tier
 */
export function normalizeBrand(supplierName?: string, code?: string): BrandInfo {
  const cleanSupplier = (supplierName || '').trim();

  // 1. Check known brand rules
  for (const rule of BRAND_RULES) {
    if (rule.match.test(cleanSupplier)) {
      return { brand: rule.brand, tier: rule.tier };
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

  // 3. Filter out stalls (e.g. '3-150', '2-164a') and human orderers/mechanics
  const isTrash =
    !cleanSupplier ||
    /^[0-9]\-[0-9]+|^[0-9]+$/i.test(cleanSupplier) ||
    /^(саша|стас|нуртаз|алексей|рашид|витя|асхат|шукуржон|кайрош|багжан|рохман|свободни|дядька|no_supplier)/i.test(
      cleanSupplier
    ) ||
    cleanSupplier.toLowerCase().includes('сто ') ||
    cleanSupplier.toLowerCase().includes('карсити');

  if (!isTrash) {
    return { brand: cleanSupplier, tier: 40 };
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
