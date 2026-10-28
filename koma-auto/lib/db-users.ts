import { client, isDbConfigured } from '@/db';

/**
 * Safely resolves or creates a user record in PostgreSQL to satisfy the
 * `orders_user_id_fkey` foreign key constraint.
 * If user does not exist, safely creates a placeholder or customer record.
 * If any error or collision occurs, safely returns null so the order insert NEVER fails.
 */
export async function resolveAndEnsureUserId(
  rawUserId?: string | null,
  rawEmail?: string | null,
  rawName?: string | null,
  rawPhone?: string | null
): Promise<string | null> {
  if (!isDbConfigured() || !client) return null;

  const cleanUserId = rawUserId ? String(rawUserId).trim() : null;
  const cleanEmail = rawEmail ? String(rawEmail).trim().toLowerCase() : null;
  const cleanName = rawName ? String(rawName).trim() : 'Покупатель';
  const cleanPhone = rawPhone ? String(rawPhone).trim() : null;

  try {
    // 1. If cleanUserId is given, check if that exact user exists in PostgreSQL
    if (cleanUserId) {
      const byId = await client`SELECT id FROM users WHERE id = ${cleanUserId} LIMIT 1`;
      if (byId && byId.length > 0) {
        // Update name and phone if present
        if (cleanName !== 'Покупатель' || cleanPhone) {
          await client`
            UPDATE users
            SET full_name = COALESCE(NULLIF(${cleanName}, 'Покупатель'), full_name),
                phone = COALESCE(${cleanPhone}, phone),
                updated_at = NOW()
            WHERE id = ${cleanUserId};
          `.catch(() => {});
        }
        return byId[0].id;
      }
    }

    // 2. Check if a user with this email already exists in PostgreSQL
    if (cleanEmail) {
      const byEmail = await client`SELECT id FROM users WHERE LOWER(email) = LOWER(${cleanEmail}) LIMIT 1`;
      if (byEmail && byEmail.length > 0) {
        const existingId = byEmail[0].id;
        // If cleanUserId is provided and different from existingId, relink if needed
        if (cleanName !== 'Покупатель' || cleanPhone) {
          await client`
            UPDATE users
            SET full_name = COALESCE(NULLIF(${cleanName}, 'Покупатель'), full_name),
                phone = COALESCE(${cleanPhone}, phone),
                updated_at = NOW()
            WHERE id = ${existingId};
          `.catch(() => {});
        }
        return existingId;
      }
    }

    // 3. User does not exist at all in PostgreSQL: create customer record so foreign key is valid
    if (cleanUserId) {
      const fallbackEmail = cleanEmail || `customer_${cleanUserId}@koma.kz`;
      await client`
        INSERT INTO users (id, email, full_name, phone, role, created_at, updated_at)
        VALUES (
          ${cleanUserId},
          ${fallbackEmail},
          ${cleanName},
          ${cleanPhone},
          'customer',
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          full_name = COALESCE(NULLIF(EXCLUDED.full_name, 'Покупатель'), users.full_name),
          phone = COALESCE(EXCLUDED.phone, users.phone),
          updated_at = NOW();
      `;
      return cleanUserId;
    }
  } catch (err) {
    console.warn('[resolveAndEnsureUserId] Handled user resolution notice:', err);
  }

  // Graceful fallback to null to ensure orders table insert NEVER crashes on foreign key
  return null;
}
