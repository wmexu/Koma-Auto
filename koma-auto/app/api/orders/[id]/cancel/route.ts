import { NextResponse } from 'next/server';
import { cancelAndRefundOrder } from '@/lib/order-cancellation';
import { verifyStaffSession } from '@/lib/admin-auth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Strict Security Authentication: require valid ADMIN_SECRET_KEY or verified Director/Manager session
    const authHeader = request.headers.get('authorization');
    const customKey = request.headers.get('x-admin-key');
    const adminKey = process.env.ADMIN_SECRET_KEY;

    const providedKey = customKey || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null);

    let isAuthorized = Boolean(adminKey && providedKey === adminKey);
    let cancelledBy: 'admin' | 'user' | 'system' = 'admin';

    if (!isAuthorized) {
      const staffAuth = await verifyStaffSession(request, ['director', 'manager']);
      if (staffAuth.authorized && staffAuth.user) {
        isAuthorized = true;
        cancelledBy = 'admin';
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Отказано в доступе: требуются права администратора или руководителя для отмены заказа' },
        { status: 401 }
      );
    }

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Body may be empty
    }

    const reason = body?.reason || 'Заказ отменен администратором.';

    const result = await cancelAndRefundOrder({
      orderId: id,
      reason,
      cancelledBy,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.message || 'Ошибка отмены заказа' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      order: result.order,
      refundResult: result.refundResult,
    });
  } catch (error: any) {
    console.error('[API Order Cancel Error]:', error);
    return NextResponse.json(
      { error: error?.message || 'Внутренняя ошибка при отмене заказа' },
      { status: 500 }
    );
  }
}
