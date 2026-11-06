import { NextResponse } from 'next/server';
import { getSystemSetting, setSystemSetting } from '@/lib/system-settings';
import { logAuditEvent } from '@/lib/audit';
import { verifyStaffSession } from '@/lib/admin-auth';
import { client } from '@/db';

export async function GET() {
  try {
    const killSwitch = await getSystemSetting<boolean>('kill_switch_active', false);
    const warehouse = await getSystemSetting('active_warehouse', {
      id: 'car_city_podval',
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
        const warehouseId = typeof value === 'object' ? value.id : value;
        const isAll = warehouseId === 'all_warehouses' || value?.name === 'Все склады';
        const sql = client;
        if (sql) {
          if (isAll) {
            await sql`
              UPDATE my_sklad_products
              SET 
                stock_quantity = stock_total,
                in_stock = in_stock_total,
                updated_at = NOW();
            `;
          } else {
            await sql`
              UPDATE my_sklad_products
              SET 
                stock_quantity = stock_podval,
                in_stock = in_stock_podval,
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
