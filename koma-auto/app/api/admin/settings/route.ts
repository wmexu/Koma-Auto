import { NextResponse } from 'next/server';
import { getSystemSetting, setSystemSetting } from '@/lib/system-settings';
import { logAuditEvent } from '@/lib/audit';
import { verifyStaffSession } from '@/lib/admin-auth';

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
