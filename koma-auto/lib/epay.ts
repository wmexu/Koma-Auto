import crypto from 'crypto';

export interface EpayTokenResponse {
  access_token: string;
  expires_in: string | number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

export interface EpayPaymentObject {
  invoiceId: string;
  invoiceIdAlt?: string;
  backLink: string;
  failureBackLink: string;
  autoBackLink: boolean;
  postLink: string;
  failurePostLink?: string;
  language: string;
  description: string;
  accountId?: string;
  terminal: string;
  amount: number;
  currency: string;
  phone?: string;
  name?: string;
  email?: string;
  auth: EpayTokenResponse;
  data?: string;
  recurrent?: boolean;
}

// Transliterate Russian/Cyrillic to Latin letters (required by ePay)
export function transliterate(text: string): string {
  if (!text) return '';
  const map: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'E', 'Ж': 'Zh',
    'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
    'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts',
    'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu',
    'Я': 'Ya'
  };
  return text
    .split('')
    .map(char => map[char] || char)
    .join('')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim();
}

/**
 * Generates unique 10-digit invoiceId satisfying Halyk ePay rules:
 * - 6 to 15 digits
 * - last 6 digits must be unique per order
 */
export function generateInvoiceId(): string {
  const timestamp = Date.now().toString().slice(-7); // 7 digits
  const random = Math.floor(100 + Math.random() * 900).toString(); // 3 digits
  return `${timestamp}${random}`; // 10 digits
}

/**
 * Generates secret_hash for postlink validation
 */
export function generateSecretHash(invoiceId: string, clientSecret: string): string {
  return crypto.createHash('sha256').update(invoiceId + clientSecret).digest('hex').substring(0, 32);
}

/**
 * Requests OAuth2 token from Halyk ePay
 */
export async function getEpayToken(params: {
  invoiceId: string;
  amount: number;
  secretHash?: string;
  postLink?: string;
  failurePostLink?: string;
}): Promise<EpayTokenResponse> {
  const clientId = process.env.HALYK_EPAY_CLIENT_ID || 'KOMA.COM.KZ';
  const clientSecret = process.env.HALYK_EPAY_CLIENT_SECRET || '';
  const terminal = process.env.HALYK_EPAY_TERMINAL_ID || '';

  if (!clientSecret || !terminal) {
    throw new Error('Halyk ePay credentials are not configured in environment variables');
  }

  const urlParams = new URLSearchParams();
  urlParams.append('grant_type', 'client_credentials');
  urlParams.append('scope', 'webapi usermanagement email_send verification statement statistics payment');
  urlParams.append('client_id', clientId);
  urlParams.append('client_secret', clientSecret);
  urlParams.append('invoiceID', params.invoiceId);
  urlParams.append('amount', params.amount.toString());
  urlParams.append('currency', 'KZT');
  urlParams.append('terminal', terminal);

  if (params.secretHash) {
    urlParams.append('secret_hash', params.secretHash);
  }
  if (params.postLink) {
    urlParams.append('postLink', params.postLink);
  }
  if (params.failurePostLink) {
    urlParams.append('failurePostLink', params.failurePostLink);
  }

  const tokenUrl = 'https://epay-oauth.homebank.kz/oauth2/token';

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: urlParams.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Halyk ePay OAuth Error:', response.status, errorText);
    throw new Error(`Failed to obtain ePay token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as EpayTokenResponse;
  return data;
}

// Embedded LZString compression matching ePay's payment-api.js implementation
const LZString = (function () {
  function o(o: any, r: any) {
    if (!t[o]) {
      t[o] = {};
      for (let n = 0; n < o.length; n++) {
        t[o][o.charAt(n)] = n;
      }
    }
    return t[o][r];
  }
  const r = String.fromCharCode;
  const t: Record<string, Record<string, number>> = {};
  const e = {
    compressToEncodedURIComponent: function (o: string | null) {
      return null == o
        ? ''
        : e._compress(o, 6, function (o: number) {
            return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$'.charAt(o);
          });
    },
    _compress: function (o: string | null, n: number, e: (val: number) => string) {
      if (null == o) return '';
      let t,
        i,
        s,
        p: Record<string, number> = {},
        u: Record<string, boolean> = {},
        c = '',
        a = '',
        l = '',
        f = 2,
        h = 3,
        d = 2,
        m: string[] = [],
        v = 0,
        w = 0;
      for (s = 0; s < o.length; s += 1)
        if (
          ((c = o.charAt(s)),
          Object.prototype.hasOwnProperty.call(p, c) || ((p[c] = h++), (u[c] = !0)),
          (a = l + c),
          Object.prototype.hasOwnProperty.call(p, a))
        )
          l = a;
        else {
          if (Object.prototype.hasOwnProperty.call(u, l)) {
            if (l.charCodeAt(0) < 256) {
              for (t = 0; d > t; t++) (v <<= 1), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++;
              for (i = l.charCodeAt(0), t = 0; 8 > t; t++)
                (v = (v << 1) | (1 & i)), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i >>= 1);
            } else {
              for (i = 1, t = 0; d > t; t++) (v = (v << 1) | i), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i = 0);
              for (i = l.charCodeAt(0), t = 0; 16 > t; t++)
                (v = (v << 1) | (1 & i)), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i >>= 1);
            }
            f--, 0 == f && ((f = Math.pow(2, d)), d++), delete u[l];
          } else
            for (i = p[l], t = 0; d > t; t++)
              (v = (v << 1) | (1 & i)), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i >>= 1);
          f--, 0 == f && ((f = Math.pow(2, d)), d++), (p[a] = h++), (l = String(c));
        }
      if ('' !== l) {
        if (Object.prototype.hasOwnProperty.call(u, l)) {
          if (l.charCodeAt(0) < 256) {
            for (t = 0; d > t; t++) (v <<= 1), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++;
            for (i = l.charCodeAt(0), t = 0; 8 > t; t++)
              (v = (v << 1) | (1 & i)), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i >>= 1);
          } else {
            for (i = 1, t = 0; d > t; t++) (v = (v << 1) | i), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i = 0);
            for (i = l.charCodeAt(0), t = 0; 16 > t; t++)
              (v = (v << 1) | (1 & i)), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i >>= 1);
          }
          f--, 0 == f && ((f = Math.pow(2, d)), d++), delete u[l];
        } else
          for (i = p[l], t = 0; d > t; t++)
            (v = (v << 1) | (1 & i)), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i >>= 1);
        f--, 0 == f && ((f = Math.pow(2, d)), d++);
      }
      for (i = 2, t = 0; d > t; t++) (v = (v << 1) | (1 & i)), w == n - 1 ? ((w = 0), m.push(e(v)), (v = 0)) : w++, (i >>= 1);
      for (;;) {
        if (((v <<= 1), w == n - 1)) {
          m.push(e(v));
          break;
        }
        w++;
      }
      return m.join('');
    },
  };
  return e;
})();

function encodeParams(params: any): string {
  if (params === undefined || params === null) {
    return '';
  }
  if (typeof params !== 'object') {
    return '' + params;
  }
  const result: string[] = [];
  for (const name in params) {
    if (name) {
      result.push(name + '=' + encodeURIComponent(encodeParams(params[name])));
    }
  }
  return result.join('&');
}

/**
 * Builds direct redirect URL to Halyk ePay Hosted Payment Form
 */
export function buildDirectPaymentUrl(paymentObject: EpayPaymentObject): string {
  const encoded = LZString.compressToEncodedURIComponent(encodeParams(paymentObject));
  return `https://epay.homebank.kz/payform/?params=${encoded}&oid=${paymentObject.invoiceId}`;
}
