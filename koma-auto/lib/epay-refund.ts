/**
 * Halyk ePay Automatic Refund Service
 * Handles OAuth2 token, transaction lookup, and payment reversal/refund.
 */

export interface EpayRefundResult {
  success: boolean;
  transactionId?: string;
  status: 'completed' | 'manual_required' | 'failed' | 'not_applicable';
  amount?: number;
  message: string;
  error?: string;
  rawResponse?: any;
}

const EPAY_OAUTH_URL = process.env.HALYK_EPAY_OAUTH_URL || 'https://epay-oauth.homebank.kz/oauth2/token';
const EPAY_API_BASE_URL = process.env.HALYK_EPAY_API_URL || 'https://epay-api.homebank.kz';

/**
 * Retrieves OAuth2 Bearer token with scope "payment" for refund operations
 */
async function getRefundAuthToken(): Promise<string> {
  const clientId = process.env.HALYK_EPAY_CLIENT_ID || 'KOMA.COM.KZ';
  const clientSecret = process.env.HALYK_EPAY_CLIENT_SECRET || '';
  const terminal = process.env.HALYK_EPAY_TERMINAL_ID || '';

  if (!clientSecret || !terminal) {
    throw new Error('Halyk ePay credentials are not configured');
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'payment');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('terminal', terminal);

  const res = await fetch(EPAY_OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ePay OAuth error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('ePay OAuth returned empty access_token');
  }

  return data.access_token;
}

/**
 * Finds transaction ID in Halyk ePay by invoiceId
 */
export async function findEpayTransactionByInvoiceId(
  invoiceId: string,
  token: string
): Promise<{ id?: string; amount?: number; status?: string; raw?: any }> {
  const cleanId = invoiceId.replace(/^№\s*/, '').trim();

  try {
    const res = await fetch(`${EPAY_API_BASE_URL}/check-status/payment/transaction/${encodeURIComponent(cleanId)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`[ePay Check Status] HTTP ${res.status} for invoice ${cleanId}`);
      return {};
    }

    const data = await res.json();
    if (data.resultCode === '100' && data.transaction && data.transaction.id) {
      return {
        id: data.transaction.id,
        amount: Number(data.transaction.amount) || undefined,
        status: data.transaction.statusName || data.transaction.reason || 'SUCCESS',
        raw: data,
      };
    }

    console.log(`[ePay Check Status] Invoice ${cleanId} status: ${data.resultCode} - ${data.resultMessage}`);
    return { raw: data };
  } catch (err) {
    console.error(`[ePay Check Status] Failed for invoice ${cleanId}:`, err);
    return {};
  }
}

/**
 * Initiates automatic refund in Halyk ePay
 */
export async function refundEpayPayment(params: {
  invoiceId: string;
  amount?: number;
  reason?: string;
  transactionId?: string;
}): Promise<EpayRefundResult> {
  const cleanInvoiceId = params.invoiceId.replace(/^№\s*/, '').trim();

  try {
    const token = await getRefundAuthToken();

    // 1. Locate transactionId if not provided directly
    let txId = params.transactionId;
    let originalAmount = params.amount;

    if (!txId) {
      const txInfo = await findEpayTransactionByInvoiceId(cleanInvoiceId, token);
      if (txInfo.id) {
        txId = txInfo.id;
        if (!originalAmount && txInfo.amount) {
          originalAmount = txInfo.amount;
        }
      }
    }

    if (!txId) {
      console.warn(`[ePay Refund] No online transaction found for invoice ${cleanInvoiceId}. (May have been cash, test, or unpaid)`);
      return {
        success: false,
        status: 'manual_required',
        message: 'Транзакция оплаты не найдена в Halyk ePay. Возможно, заказ не был оплачен картой онлайн или возврат уже был проведен в кабинете банка.',
        error: 'Transaction ID not found in ePay',
      };
    }

    // 2. Call Halyk ePay Refund API: POST /operation/:id/refund
    let refundUrl = `${EPAY_API_BASE_URL}/operation/${encodeURIComponent(txId)}/refund`;
    if (params.amount && params.amount > 0) {
      refundUrl += `?amount=${encodeURIComponent(params.amount.toString())}`;
    }

    console.log(`[ePay Refund] Calling refund on transaction ${txId} for invoice ${cleanInvoiceId}...`);

    const refundRes = await fetch(refundUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    const resText = await refundRes.text();
    let resJson: any = null;
    try {
      resJson = JSON.parse(resText);
    } catch {
      // ignore
    }

    if (refundRes.ok) {
      console.log(`[ePay Refund SUCCESS]: Invoice ${cleanInvoiceId}, Tx ${txId}, Amount: ${originalAmount} KZT`);
      return {
        success: true,
        transactionId: txId,
        status: 'completed',
        amount: originalAmount,
        message: `Возврат денежных средств${originalAmount ? ` на сумму ${originalAmount.toLocaleString('ru-RU')} ₸` : ''} успешно оформлен в Halyk ePay.`,
        rawResponse: resJson || resText,
      };
    } else {
      console.error(`[ePay Refund Error]: HTTP ${refundRes.status} for Tx ${txId}:`, resText);
      const errMsg = resJson?.message || resJson?.error || resText || `HTTP ${refundRes.status}`;
      return {
        success: false,
        transactionId: txId,
        status: 'failed',
        amount: originalAmount,
        message: `Ошибка при оформлении возврата через Halyk ePay: ${errMsg}`,
        error: errMsg,
        rawResponse: resJson || resText,
      };
    }
  } catch (err: any) {
    console.error(`[ePay Refund Exception] for invoice ${cleanInvoiceId}:`, err);
    return {
      success: false,
      status: 'failed',
      message: `Исключение при обращении к платёжной системе: ${err?.message || 'Неизвестная ошибка'}`,
      error: err?.message || 'Unknown error',
    };
  }
}
