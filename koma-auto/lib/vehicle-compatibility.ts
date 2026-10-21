/**
 * Vehicle Compatibility Engine for Auto Parts
 * Maps OEM part numbers, part names, and platform codes to compatible vehicles (Make, Model, Years, Engines).
 */

export interface VehicleCompatibility {
  make: string;
  model: string;
  generation?: string;
  years?: string;
  yearStart?: number;
  yearEnd?: number;
  engines?: string[];
  position?: string;
}

// Popular car makes in Kazakhstan
export const CAR_MAKES = [
  'Toyota',
  'Hyundai',
  'Kia',
  'Chevrolet',
  'Daewoo',
  'Lexus',
  'Nissan',
  'Volkswagen',
  'Mercedes-Benz',
  'BMW',
  'Mitsubishi',
  'Subaru',
  'Renault',
  'LADA (ВАЗ)',
] as const;

// Common vehicle model signatures and their generation metadata
const KNOWN_VEHICLE_PATTERNS: Array<{
  regex: RegExp;
  make: string;
  model: string;
  generation?: string;
  years: string;
  yearStart: number;
  yearEnd?: number;
  engines?: string[];
}> = [
  // Hyundai / Kia
  { regex: /акцент|accent|солярис|solaris/i, make: 'Hyundai', model: 'Accent / Solaris', generation: 'IV / V', years: '2010–2022', yearStart: 2010, yearEnd: 2022, engines: ['1.4L', '1.6L'] },
  { regex: /элантра|elantra/i, make: 'Hyundai', model: 'Elantra', generation: 'MD / AD', years: '2011–2020', yearStart: 2011, yearEnd: 2020, engines: ['1.6L', '1.8L', '2.0L'] },
  { regex: /соната|sonata/i, make: 'Hyundai', model: 'Sonata', generation: 'YF / LF', years: '2010–2019', yearStart: 2010, yearEnd: 2019, engines: ['2.0L', '2.4L'] },
  { regex: /туссан|тусон|tucson/i, make: 'Hyundai', model: 'Tucson', generation: 'JM / TL', years: '2004–2021', yearStart: 2004, yearEnd: 2021, engines: ['2.0L', '2.4L', '2.0 CRDi'] },
  { regex: /санта[\s\-]?фе|santa[\s\-]?fe/i, make: 'Hyundai', model: 'Santa Fe', generation: 'CM / DM', years: '2006–2018', yearStart: 2006, yearEnd: 2018, engines: ['2.4L', '2.7L', '2.2 CRDi'] },
  { regex: /крета|creta/i, make: 'Hyundai', model: 'Creta', generation: 'GS', years: '2016–2021', yearStart: 2016, yearEnd: 2021, engines: ['1.6L', '2.0L'] },
  { regex: /старекс|starex|h[\-\s]?1|grand starex/i, make: 'Hyundai', model: 'Grand Starex (H-1)', generation: 'TQ', years: '2007–2021', yearStart: 2007, yearEnd: 2021, engines: ['2.5 CRDi'] },

  // Kia
  { regex: /\bрио\b|rio/i, make: 'Kia', model: 'Rio', generation: 'III / IV (QB/FB)', years: '2011–2022', yearStart: 2011, yearEnd: 2022, engines: ['1.4L', '1.6L'] },
  { regex: /церато|cerato|forte/i, make: 'Kia', model: 'Cerato', generation: 'TD / YD', years: '2009–2018', yearStart: 2009, yearEnd: 2018, engines: ['1.6L', '2.0L'] },
  { regex: /оптима|optima|\bk[\s\-]?5\b/i, make: 'Kia', model: 'Optima (K5)', generation: 'TF / JF', years: '2010–2020', yearStart: 2010, yearEnd: 2020, engines: ['2.0L', '2.4L'] },
  { regex: /спортейдж|спортаж|sportage/i, make: 'Kia', model: 'Sportage', generation: 'SL / QL', years: '2010–2021', yearStart: 2010, yearEnd: 2021, engines: ['2.0L', '2.4L', '2.0 CRDi'] },
  { regex: /соренто|sorento/i, make: 'Kia', model: 'Sorento', generation: 'XM / UM', years: '2009–2020', yearStart: 2009, yearEnd: 2020, engines: ['2.4L', '3.5L', '2.2 CRDi'] },
  { regex: /карнивал|carnival|sedona/i, make: 'Kia', model: 'Carnival', generation: 'VQ / YP', years: '2006–2020', yearStart: 2006, yearEnd: 2020, engines: ['2.2 CRDi', '2.9 CRDi', '3.3L'] },

  // Daewoo / Chevrolet
  { regex: /нексия|nexia/i, make: 'Daewoo', model: 'Nexia (N100 / N150)', generation: 'I / II', years: '1995–2016', yearStart: 1995, yearEnd: 2016, engines: ['1.5L SOHC', '1.5L DOHC', '1.6L'] },
  { regex: /матиз|matiz/i, make: 'Daewoo', model: 'Matiz', generation: 'M100 / M150', years: '1998–2018', yearStart: 1998, yearEnd: 2018, engines: ['0.8L', '1.0L'] },
  { regex: /ланос|lanos/i, make: 'Daewoo', model: 'Lanos', generation: 'T100', years: '1997–2017', yearStart: 1997, yearEnd: 2017, engines: ['1.4L', '1.5L', '1.6L'] },
  { regex: /лачетти|ласетти|lacetti|джентра|gentra/i, make: 'Chevrolet', model: 'Lacetti / Gentra', generation: 'J200', years: '2003–2020', yearStart: 2003, yearEnd: 2020, engines: ['1.4L', '1.6L', '1.8L', '1.5L'] },
  { regex: /кобальт|cobalt|равон|ravon r4/i, make: 'Chevrolet', model: 'Cobalt', generation: 'II', years: '2012–2024', yearStart: 2012, yearEnd: 2024, engines: ['1.5L 16V'] },
  { regex: /круз|cruze/i, make: 'Chevrolet', model: 'Cruze', generation: 'J300', years: '2009–2016', yearStart: 2009, yearEnd: 2016, engines: ['1.6L', '1.8L', '1.4T'] },
  { regex: /авео|aveo/i, make: 'Chevrolet', model: 'Aveo', generation: 'T200 / T250 / T300', years: '2003–2018', yearStart: 2003, yearEnd: 2018, engines: ['1.2L', '1.4L', '1.6L'] },
  { regex: /малибу|malibu/i, make: 'Chevrolet', model: 'Malibu', generation: 'VIII / IX', years: '2012–2022', yearStart: 2012, yearEnd: 2022, engines: ['1.5T', '2.0T', '2.4L', '2.5L'] },
  { regex: /каптива|captiva/i, make: 'Chevrolet', model: 'Captiva', generation: 'C100 / C140', years: '2006–2018', yearStart: 2006, yearEnd: 2018, engines: ['2.4L', '3.2L', '2.2D'] },
  { regex: /дамас|damas|лабо|labo/i, make: 'Chevrolet', model: 'Damas / Labo', generation: 'I / II', years: '1996–2024', yearStart: 1996, yearEnd: 2024, engines: ['0.8L'] },

  // Toyota / Lexus
  { regex: /камри|camry\s*50|camry\s*55/i, make: 'Toyota', model: 'Camry', generation: 'XV50 (50/55)', years: '2011–2017', yearStart: 2011, yearEnd: 2017, engines: ['2.0L 1AZ/6AR', '2.5L 2AR', '3.5L 2GR'] },
  { regex: /камри|camry\s*40/i, make: 'Toyota', model: 'Camry', generation: 'XV40', years: '2006–2011', yearStart: 2006, yearEnd: 2011, engines: ['2.4L 2AZ', '3.5L 2GR'] },
  { regex: /камри|camry\s*70/i, make: 'Toyota', model: 'Camry', generation: 'XV70', years: '2017–2023', yearStart: 2017, yearEnd: 2023, engines: ['2.0L', '2.5L', '3.5L'] },
  { regex: /королла|corolla/i, make: 'Toyota', model: 'Corolla', generation: 'E150 / E180 / E210', years: '2007–2022', yearStart: 2007, yearEnd: 2022, engines: ['1.33L', '1.6L', '1.8L'] },
  { regex: /рав[\s\-]?4|rav[\s\-]?4/i, make: 'Toyota', model: 'RAV4', generation: 'XA30 / XA40 / XA50', years: '2006–2023', yearStart: 2006, yearEnd: 2023, engines: ['2.0L', '2.4L', '2.5L'] },
  { regex: /прадо|prado|land cruiser prado/i, make: 'Toyota', model: 'Land Cruiser Prado', generation: '120 / 150', years: '2002–2023', yearStart: 2002, yearEnd: 2023, engines: ['2.7L 2TR', '4.0L 1GR', '3.0 D-4D', '2.8 D-4D'] },
  { regex: /ленд крузер|land cruiser\s*200/i, make: 'Toyota', model: 'Land Cruiser 200', generation: 'J200', years: '2007–2021', yearStart: 2007, yearEnd: 2021, engines: ['4.6L', '4.7L', '4.5 D-4D'] },
  { regex: /хайлендер|highlander/i, make: 'Toyota', model: 'Highlander', generation: 'XU40 / XU50', years: '2007–2019', yearStart: 2007, yearEnd: 2019, engines: ['2.7L', '3.5L 2GR'] },
];

// OEM chassis platform codes for Hyundai / Kia (from part number 5-10 characters)
const OEM_PLATFORM_MAP: Record<string, { make: string; model: string; years: string; engines?: string[] }> = {
  '2P': { make: 'Kia', model: 'Sorento (XM) / Hyundai Santa Fe (DM)', years: '2010–2018', engines: ['2.4L', '2.2 CRDi'] },
  '3X': { make: 'Hyundai', model: 'Elantra (MD) / Avante', years: '2010–2015', engines: ['1.6L', '1.8L'] },
  '4L': { make: 'Hyundai', model: 'Accent / Solaris / Kia Rio', years: '2011–2017', engines: ['1.4L', '1.6L'] },
  '1R': { make: 'Hyundai', model: 'Accent / Solaris (RB)', years: '2010–2017', engines: ['1.4L', '1.6L'] },
  '4X': { make: 'Kia', model: 'Rio (UB)', years: '2011–2017', engines: ['1.4L', '1.6L'] },
  '2T': { make: 'Kia', model: 'Optima (TF) / K5', years: '2010–2015', engines: ['2.0L', '2.4L'] },
  '2K': { make: 'Kia', model: 'Cerato (TD) / Forte', years: '2008–2013', engines: ['1.6L', '2.0L'] },
  'A9': { make: 'Kia', model: 'Carnival / Sedona (YP)', years: '2014–2020', engines: ['2.2 CRDi', '3.3L'] },
  'C5': { make: 'Kia', model: 'Sorento Prime (UM)', years: '2015–2020', engines: ['2.4L', '3.3L', '2.2 CRDi'] },
  'H8': { make: 'Kia', model: 'Rio (FB) / Solaris (HCR)', years: '2017–2022', engines: ['1.4L', '1.6L'] },
};

/**
 * Extracts and maps vehicle compatibility from product code, title, and OEM
 */
export function extractVehicleCompatibility(product: {
  name: string;
  code?: string;
  article?: string;
  oem?: string;
  brand?: string;
}): VehicleCompatibility[] {
  const result: VehicleCompatibility[] = [];
  const text = `${product.name} ${product.code || ''} ${product.article || ''}`.toLowerCase();
  const cleanOem = (product.oem || product.code || '').replace(/[\s\-\.]/g, '').toUpperCase();

  // 1. Check known vehicle signatures in title / description
  for (const pattern of KNOWN_VEHICLE_PATTERNS) {
    if (pattern.regex.test(text)) {
      result.push({
        make: pattern.make,
        model: pattern.model,
        generation: pattern.generation,
        years: pattern.years,
        yearStart: pattern.yearStart,
        yearEnd: pattern.yearEnd,
        engines: pattern.engines,
      });
    }
  }

  // 2. Check Hyundai/Kia OEM platform code (e.g. 54661-2P000 -> platform "2P")
  if (cleanOem.length >= 7) {
    const platformCode = cleanOem.substring(5, 7);
    const platformInfo = OEM_PLATFORM_MAP[platformCode];
    if (platformInfo) {
      const alreadyPresent = result.some(
        (r) => r.make === platformInfo.make && r.model.includes(platformInfo.model.split(' ')[0])
      );
      if (!alreadyPresent) {
        result.push({
          make: platformInfo.make,
          model: platformInfo.model,
          years: platformInfo.years,
          engines: platformInfo.engines,
        });
      }
    }
  }

  // 3. Brand fallback if still empty: if title says "Hyundai/Kia", tag both brands
  if (result.length === 0) {
    if (/hyundai[\s\/]kia|kia[\s\/]hyundai/i.test(text)) {
      result.push({
        make: 'Hyundai / Kia',
        model: 'Модели Hyundai / Kia с двигателями ' + (cleanOem.startsWith('2') ? '2.0L / 2.4L / CRDi' : '1.4L / 1.6L'),
        years: '2008–2022',
      });
    } else if (/daewoo|chevrolet|шевроле/i.test(text)) {
      result.push({
        make: 'Chevrolet / Daewoo',
        model: 'Nexia / Lanos / Lacetti / Cobalt',
        years: '1998–2020',
      });
    } else if (/toyota|тойота/i.test(text)) {
      result.push({
        make: 'Toyota',
        model: 'Модели Toyota (Camry / Corolla / RAV4)',
        years: '2006–2020',
      });
    }
  }

  return result;
}

/**
 * Returns human-readable summary badge string for product card
 */
export function formatCompatibilityBadge(compat: VehicleCompatibility[]): string {
  if (!compat || compat.length === 0) {
    return 'Универсальная деталь / Уточняйте по VIN';
  }

  if (compat.length === 1) {
    const item = compat[0];
    return `Подходит: ${item.make} ${item.model}${item.years ? ` (${item.years})` : ''}`;
  }

  const makes = Array.from(new Set(compat.map((c) => c.make))).join(', ');
  return `Подходит на ${compat.length} мод. (${makes})`;
}
