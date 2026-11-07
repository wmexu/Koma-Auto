import { NextResponse } from 'next/server';
import { getSystemSetting, setSystemSetting } from '@/lib/system-settings';
import { logAuditEvent } from '@/lib/audit';
import { verifyStaffSession } from '@/lib/admin-auth';
import { client } from '@/db';

export async function GET() {
  try {
    const killSwitch = await getSystemSetting<boolean>('kill_switch_active', false);
    const warehouse = await getSystemSetting('active_warehouse', {
      store_ids: ['4240a87a-4ea5-11f1-0a80-1b5c0008497a'],
      name: 'Car City 1 ярус Подвал',
    });

    return NextResponse.json({
      success: true,
      settings: {
        killSwitchActive: killSwitch,
        activeWarehouse: warehouse,
      },
    });
  } catch (error: any) {
    console.error('[AdminSettings GET Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки настроек' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, value, staffUserId } = body;

    // Strict Server-Side Authorization: Only Director can modify system settings (Kill Switch, Warehouse)
    const auth = await verifyStaffSession(request, ['director'], staffUserId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Не указан ключ или значение' }, { status: 400 });
    }

    const success = await setSystemSetting(key, value, staffUserId);

    if (key === 'kill_switch_active') {
      logAuditEvent({
        userId: staffUserId || null,
        action: 'KILL_SWITCH_TOGGLED',
        entityType: 'system',
        details: { killSwitchActive: value },
      });
    } else if (key === 'active_warehouse') {
      logAuditEvent({
        userId: staffUserId || null,
        action: 'WAREHOUSE_CHANGED',
        entityType: 'system',
        details: { activeWarehouse: value },
      });

      try {
        const sql = client;
        if (sql) {
          const storeIds: string[] = Array.isArray(value?.store_ids)
            ? value.store_ids
            : value?.id === 'all_warehouses' || value?.name === 'Все склады'
            ? [
                '4240a87a-4ea5-11f1-0a80-1b5c0008497a',
                '1fa24dca-7a9a-11f1-0a80-136c0004b13a',
                '80a4ab92-914b-11f1-0a80-00580016cddc',
                'eabd6cc4-896e-11f1-0a80-06a40027eb6a',
                '790b52f2-4aa7-11f1-0a80-1ac70019f4b1',
                'ff2b1657-4ea4-11f1-0a80-134100085ef2',
                '1c1ad4e3-4ea5-11f1-0a80-0df00008db2b',
              ]
            : ['4240a87a-4ea5-11f1-0a80-1b5c0008497a'];

          const podvalId = '4240a87a-4ea5-11f1-0a80-1b5c0008497a';
          const isAll = storeIds.length >= 7;
          const isOnlyPodval = storeIds.length === 1 && storeIds[0] === podvalId;

          if (isAll) {
            await sql`
              UPDATE my_sklad_products
              SET 
                stock_quantity = stock_total,
                in_stock = in_stock_total,
                updated_at = NOW();
            `;
          } else if (isOnlyPodval) {
            await sql`
              UPDATE my_sklad_products
              SET 
                stock_quantity = stock_podval,
                in_stock = in_stock_podval,
                updated_at = NOW();
            `;
          } else if (storeIds.length > 0) {
            const sumParts = storeIds
              .map((sid) => `COALESCE((stocks_by_store->>'${sid}')::int, 0)`)
              .join(' + ');

            await sql.unsafe(`
              UPDATE my_sklad_products
              SET 
                stock_quantity = (${sumParts}),
                in_stock = (${sumParts}) > 0,
                updated_at = NOW();
            `);
          } else {
            await sql`
              UPDATE my_sklad_products
              SET 
                stock_quantity = 0,
                in_stock = false,
                updated_at = NOW();
            `;
          }
        }
      } catch (sqlErr) {
        console.warn('[AdminSettings] Failed to update my_sklad_products active stock on warehouse switch:', sqlErr);
      }
    }

    if (!success) {
      return NextResponse.json({ error: 'Ошибка сохранения настроек' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Настройки успешно обновлены' });
  } catch (error: any) {
    console.error('[AdminSettings POST Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка сохранения настроек' }, { status: 500 });
  }
}
