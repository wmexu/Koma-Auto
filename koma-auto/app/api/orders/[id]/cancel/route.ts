import { NextResponse } from 'next/server';
import { cancelAndRefundOrder } from '@/lib/order-cancellation';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
      cancelledBy: 'admin',
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
