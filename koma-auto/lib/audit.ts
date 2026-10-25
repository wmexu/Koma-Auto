import { client, isDbConfigured } from '@/db';

export type AuditAction = 
  | 'ROLE_ACTIVATED'
  | 'ROLE_REVOKED'
  | 'ROLE_CHANGED'
  | 'ORDER_ASSIGNED'
  | 'ORDER_COMPLETED'
  | 'ORDER_STATUS_CHANGED'
  | 'KILL_SWITCH_TOGGLED'
  | 'WAREHOUSE_CHANGED'
  | 'PROMOCODE_CREATED'
  | 'PROMOCODE_DELETED'
  | 'PICKUP_CODE_VIEWED'
  | 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT'
  | 'FORBIDDEN_ADMIN_ACCESS_ATTEMPT'
  | 'BLOCKED_USER_ACCESS_ATTEMPT'
  | 'INSUFFICIENT_PRIVILEGES_ATTEMPT';

export interface AuditParams {
  userId?: string | null;
  action: AuditAction;
  entityType: 'order' | 'user' | 'promocode' | 'system' | 'token' | 'admin_api';
  entityId?: string | null;
  details?: Record<string, any>;
  ipAddress?: string | null;
}

/**
 * Writes an immutable audit entry to Neon PostgreSQL audit_logs
 */
export async function logAuditEvent(params: AuditParams): Promise<void> {
  const { userId, action, entityType, entityId, details, ipAddress } = params;

  console.log(`[AUDIT] ${action} on ${entityType}:${entityId || '-'} by ${userId || 'anonymous'}`);

  if (!isDbConfigured() || !client) return;

  try {
    await client`
      INSERT INTO audit_logs (
        id, user_id, action, entity_type, entity_id, details, ip_address, created_at
      ) VALUES (
        gen_random_uuid(),
        ${userId || null},
        ${action},
        ${entityType},
        ${entityId || null},
        ${details ? JSON.stringify(details) : null}::jsonb,
        ${ipAddress || null},
        NOW()
      );
    `;
  } catch (error) {
    console.error('[AUDIT] Failed to record audit log:', error);
  }
}
