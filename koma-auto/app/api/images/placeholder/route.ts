import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getCategoryIconSvg(category: string, name: string): string {
  const text = `${category} ${name}`.toLowerCase();

  // Shock absorber / suspension
  if (/амортизатор|стойка|пружина|опора|рычаг|сайлентблок/i.test(text)) {
    return `
      <g stroke="#0284c7" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <line x1="150" y1="60" x2="150" y2="120" />
        <rect x="135" y="120" width="30" height="90" rx="6" fill="#0284c7" fill-opacity="0.1" />
        <path d="M125 150 L175 160 L125 170 L175 180 L125 190 L175 200" stroke="#0ea5e9" stroke-width="3" />
        <line x1="150" y1="210" x2="150" y2="240" />
        <circle cx="150" cy="50" r="10" />
        <circle cx="150" cy="250" r="10" />
      </g>
    `;
  }

  // Brake pads / discs
  if (/колодк|диск тормоз|суппорт|тормоз/i.test(text)) {
    return `
      <g stroke="#0284c7" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="150" cy="150" r="80" stroke-dasharray="10 6" />
        <circle cx="150" cy="150" r="45" fill="#0284c7" fill-opacity="0.1" />
        <circle cx="150" cy="150" r="15" />
        <rect x="190" y="90" width="30" height="60" rx="8" fill="#38bdf8" fill-opacity="0.2" stroke="#0284c7" />
      </g>
    `;
  }

  // Filters (oil, air, fuel, cabin)
  if (/фильтр/i.test(text)) {
    return `
      <g stroke="#0284c7" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <rect x="105" y="80" width="90" height="130" rx="14" fill="#0284c7" fill-opacity="0.08" />
        <line x1="105" y1="110" x2="195" y2="110" />
        <line x1="105" y1="145" x2="195" y2="145" stroke-dasharray="4 4" />
        <line x1="105" y1="180" x2="195" y2="180" />
        <circle cx="150" cy="65" r="12" fill="#0284c7" />
      </g>
    `;
  }

  // Pump / fuel pump / water pump
  if (/насос|помпа|топливн/i.test(text)) {
    return `
      <g stroke="#0284c7" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <rect x="115" y="95" width="70" height="110" rx="10" fill="#0284c7" fill-opacity="0.1" />
        <line x1="130" y1="70" x2="130" y2="95" />
        <line x1="170" y1="70" x2="170" y2="95" />
        <line x1="150" y1="205" x2="150" y2="230" />
        <circle cx="150" cy="150" r="22" stroke="#38bdf8" stroke-dasharray="6 3" />
      </g>
    `;
  }

  // Engine mount / pillow
  if (/подушка|опора двигател/i.test(text)) {
    return `
      <g stroke="#0284c7" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="150" cy="150" rx="70" ry="50" fill="#0284c7" fill-opacity="0.1" />
        <circle cx="150" cy="150" r="25" fill="#38bdf8" fill-opacity="0.3" />
        <rect x="75" y="140" width="20" height="20" rx="4" />
        <rect x="205" y="140" width="20" height="20" rx="4" />
      </g>
    `;
  }

  // Bearing / ступица
  if (/подшипник|ступиц/i.test(text)) {
    return `
      <g stroke="#0284c7" stroke-width="4" fill="none" stroke-linecap="round">
        <circle cx="150" cy="150" r="75" fill="#0284c7" fill-opacity="0.08" />
        <circle cx="150" cy="150" r="45" />
        <circle cx="150" cy="150" r="22" fill="#0284c7" fill-opacity="0.2" />
        <circle cx="150" cy="100" r="8" fill="#38bdf8" />
        <circle cx="150" cy="200" r="8" fill="#38bdf8" />
        <circle cx="100" cy="150" r="8" fill="#38bdf8" />
        <circle cx="200" cy="150" r="8" fill="#38bdf8" />
      </g>
    `;
  }

  // Default: Generic Precision Auto Component
  return `
    <g stroke="#0284c7" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="150,75 220,115 220,195 150,235 80,195 80,115" fill="#0284c7" fill-opacity="0.08" />
      <polygon points="150,105 190,130 190,180 150,205 110,180 110,130" stroke="#38bdf8" stroke-dasharray="6 4" />
      <circle cx="150" cy="155" r="16" fill="#0284c7" fill-opacity="0.2" />
    </g>
  `;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || 'Автозапчасть';
  const oem = searchParams.get('oem') || searchParams.get('article') || '';
  const brand = (searchParams.get('brand') || 'KOMA AUTO').toUpperCase();
  const category = searchParams.get('category') || '';

  const cleanOem = oem.replace(/[\s\-\.]/g, '').toUpperCase();
  const displayOem = cleanOem ? `OEM: ${cleanOem}` : 'CAR CITY 1 ЯРУС';
  const iconSvg = getCategoryIconSvg(category, name);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="600" height="600">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f8fafc" />
        <stop offset="100%" stop-color="#edf2f7" />
      </linearGradient>
      <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#1e3a8a" />
        <stop offset="100%" stop-color="#0284c7" />
      </linearGradient>
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" stroke-width="0.8" />
      </pattern>
    </defs>

    <!-- Background Blueprint Grid -->
    <rect width="300" height="300" fill="url(#bgGrad)" />
    <rect width="300" height="300" fill="url(#grid)" opacity="0.6" />

    <!-- Corner Technical Registration Marks -->
    <path d="M 15 25 L 15 15 L 25 15" stroke="#94a3b8" stroke-width="1.5" fill="none" />
    <path d="M 285 25 L 285 15 L 275 15" stroke="#94a3b8" stroke-width="1.5" fill="none" />
    <path d="M 15 275 L 15 285 L 25 285" stroke="#94a3b8" stroke-width="1.5" fill="none" />
    <path d="M 285 275 L 285 285 L 275 285" stroke="#94a3b8" stroke-width="1.5" fill="none" />

    <!-- Top Brand Pill -->
    <rect x="20" y="20" width="130" height="24" rx="12" fill="url(#brandGrad)" />
    <text x="85" y="36" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">
      ${brand.substring(0, 16)}
    </text>

    <!-- Top Right Spec Tag -->
    <text x="280" y="36" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="9" font-weight="600" fill="#64748b" text-anchor="end">
      ORIGINAL SPEC
    </text>

    <!-- Central Auto Part Schematic -->
    ${iconSvg}

    <!-- Bottom Technical Spec Badge -->
    <rect x="25" y="248" width="250" height="32" rx="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="1" />
    <text x="150" y="268" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="12" font-weight="700" fill="#0f172a" text-anchor="middle" letter-spacing="1">
      ${displayOem}
    </text>
  </svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
