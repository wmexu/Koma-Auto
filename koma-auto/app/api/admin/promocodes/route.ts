import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { logAuditEvent } from '@/lib/audit';
import { verifyStaffSession } from '@/lib/admin-auth';

export async function GET(request: Request) {
  try {
    // Strict Server-Side Authorization: Only Director can list internal promo codes & bound users
    const auth = await verifyStaffSession(request, ['director']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const promocodesList = await client`
      SELECT 
        p.id, p.code, p.type, p.value, p.min_cart_total, p.max_discount,
        p.target_audience, p.bound_user_id, p.bound_emails, p.usage_limit, p.used_count,
        p.is_active, p.created_at, u.email as bound_user_email
      FROM promocodes p
      LEFT JOIN users u ON u.id = p.bound_user_id
      ORDER BY p.created_at DESC;
    `;

    return NextResponse.json({ success: true, promocodes: promocodesList });
  } catch (error: any) {
    console.error('[AdminPromocodes GET Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки промокодов' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      code, type, value, minCartTotal, maxDiscount, 
      targetAudience, boundUserId, boundEmails, usageLimit, staffUserId 
    } = body;

    // Strict Server-Side Authorization: Only Director can create promo codes
    const auth = await verifyStaffSession(request, ['director'], staffUserId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!code || !type || value === undefined) {
      return NextResponse.json({ error: 'Укажите код, тип скидки и размер' }, { status: 400 });
    }

    const cleanCode = String(code).trim().toUpperCase();

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const emailsArray = Array.isArray(boundEmails) ? boundEmails : boundEmails ? [boundEmails] : [];

    await client`
      INSERT INTO promocodes (
        id, code, type, value, min_cart_total, max_discount,
        target_audience, bound_user_id, bound_emails, usage_limit, is_active,
        created_by, created_at
      ) VALUES (
        gen_random_uuid(),
        ${cleanCode},
        ${type},
        ${value},
        ${minCartTotal || 0},
        ${maxDiscount || null},
        ${targetAudience || 'all'},
        ${boundUserId || null},
        ${JSON.stringify(emailsArray)}::jsonb,
        ${usageLimit || null},
        true,
        ${staffUserId || null},
        NOW()
      )
      ON CONFLICT (code) DO UPDATE SET
        type = EXCLUDED.type,
        value = EXCLUDED.value,
        min_cart_total = EXCLUDED.min_cart_total,
        max_discount = EXCLUDED.max_discount,
        target_audience = EXCLUDED.target_audience,
        bound_user_id = EXCLUDED.bound_user_id,
        bound_emails = EXCLUDED.bound_emails,
        usage_limit = EXCLUDED.usage_limit,
        is_active = true;
    `;

    logAuditEvent({
      userId: staffUserId || null,
      action: 'PROMOCODE_CREATED',
      entityType: 'promocode',
      entityId: cleanCode,
      details: { type, value, targetAudience, boundUserId },
    });

    return NextResponse.json({ success: true, message: `Промокод "${cleanCode}" успешно создан!` });
  } catch (error: any) {
    console.error('[AdminPromocodes POST Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка создания промокода' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const staffUserId = searchParams.get('staffUserId');

    // Strict Server-Side Authorization: Only Director can delete promo codes
    const auth = await verifyStaffSession(request, ['director'], staffUserId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!id) {
      return NextResponse.json({ error: 'ID промокода не указан' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    await client`
      DELETE FROM promocodes WHERE id = ${id};
    `;

    logAuditEvent({
      userId: staffUserId || null,
      action: 'PROMOCODE_DELETED',
      entityType: 'promocode',
      entityId: id,
    });

    return NextResponse.json({ success: true, message: 'Промокод удален' });
  } catch (error: any) {
    console.error('[AdminPromocodes DELETE Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка удаления промокода' }, { status: 500 });
  }
}
