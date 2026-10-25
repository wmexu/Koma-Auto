/**
 * Universal deterministic pickup code utility.
 * Safe for both client and server execution.
 */

export function computeDeterministicPickupCode(orderId: string): string {
  const cleanId = String(orderId || '').trim();
  if (!cleanId) return '482910573912';

  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const str = `${cleanId}:koma-auto-pickup-salt-2026`;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const part1 = Math.abs(h1).toString().padStart(6, '0').slice(-6);
  const part2 = Math.abs(h2).toString().padStart(6, '0').slice(-6);
  return `${part1}${part2}`;
}

export function formatPickupCode(code?: string | null): string {
  if (!code) return '4829 - 1057 - 3912';
  const clean = String(code).replace(/\D/g, '');
  if (clean.length !== 12) return String(code);
  return `${clean.slice(0, 4)} - ${clean.slice(4, 8)} - ${clean.slice(8, 12)}`;
}

export function getOrderPickupCode(orderId: string, existingCode?: string | null): string {
  const clean = String(existingCode || '').replace(/\D/g, '');
  if (clean.length === 12) return clean;
  return computeDeterministicPickupCode(orderId);
}
