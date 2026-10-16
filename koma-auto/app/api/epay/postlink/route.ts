import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    console.log('[Halyk ePay Postlink received]:', JSON.stringify(data, null, 2));

    const {
      invoiceId,
      amount,
      currency,
      approvalCode,
      code,
      reason,
      reasonCode,
      reference,
      terminal,
      cardMask,
      cardType,
      dateTime,
    } = data;

    if (code === 'ok') {
      console.log(`[Halyk ePay Payment SUCCESS]: Order ${invoiceId}, Amount: ${amount} ${currency}, Ref: ${reference}, Approval: ${approvalCode}`);
      // Here: update DB, notify MoySklad, send confirmation SMS/email, etc.
    } else {
      console.warn(`[Halyk ePay Payment FAILED]: Order ${invoiceId}, Reason: ${reason} (code: ${reasonCode})`);
    }

    // ePay expects 200 OK with simple json or status ok
    return NextResponse.json({ status: 'ok', invoiceId });
  } catch (error) {
    console.error('Error handling Halyk ePay postlink:', error);
    return NextResponse.json({ status: 'error' }, { status: 200 }); // Still return 200 to prevent infinite webhook retries
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Halyk ePay postlink endpoint active' });
}
