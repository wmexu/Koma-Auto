import { client, isDbConfigured } from '@/db';

interface CacheEntry {
  value: any;
  expiresAt: number;
}

const MEMORY_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2 * 1000; // 2 seconds high-reactivity cache

/**
 * Retrieves a system setting with 30-second in-memory caching to prevent DB load
 */
export async function getSystemSetting<T = any>(key: string, defaultValue: T): Promise<T> {
  const now = Date.now();
  const cached = MEMORY_CACHE.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  if (!isDbConfigured() || !client) {
    return defaultValue;
  }

  try {
    const rows = await client`
      SELECT value FROM system_settings WHERE key = ${key} LIMIT 1;
    `;

    if (rows && rows.length > 0) {
      const val = rows[0].value as T;
      MEMORY_CACHE.set(key, { value: val, expiresAt: now + CACHE_TTL_MS });
      return val;
    }
  } catch (error) {
    console.error(`[SystemSettings] Error reading key "${key}":`, error);
  }

  return defaultValue;
}

/**
 * Updates a system setting in Neon and immediately invalidates in-memory cache
 */
export async function setSystemSetting(key: string, value: any, userId?: string): Promise<boolean> {
  // Invalidate local memory cache immediately
  MEMORY_CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });

  if (!isDbConfigured() || !client) return false;

  try {
    await client`
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${userId || null}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW();
    `;
    return true;
  } catch (error) {
    console.error(`[SystemSettings] Error setting key "${key}":`, error);
    return false;
  }
}

/**
 * Returns true if the director has engaged emergency checkout block
 */
export async function isKillSwitchActive(): Promise<boolean> {
  return await getSystemSetting<boolean>('kill_switch_active', false);
}

/**
 * Returns active warehouse info
 */
export async function getActiveWarehouse(): Promise<{ id: string; name: string }> {
  return await getSystemSetting('active_warehouse', {
    id: 'car_city_podval',
    name: 'Car City 1 ярус Подвал',
  });
}
