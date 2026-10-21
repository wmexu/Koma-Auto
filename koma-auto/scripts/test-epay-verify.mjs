import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import { findEpayTransactionByInvoiceId } from '../lib/epay-refund.ts';

const clientId = process.env.HALYK_EPAY_CLIENT_ID || 'KOMA.COM.KZ';
const clientSecret = process.env.HALYK_EPAY_CLIENT_SECRET || '';
const terminal = process.env.HALYK_EPAY_TERMINAL_ID || '';

async function main() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'payment');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('terminal', terminal);

  const res = await fetch('https://epay-oauth.homebank.kz/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });

  const data = await res.json();
  const token = data.access_token;
  console.log('Got ePay OAuth token successfully.');

  console.log('Testing verification of invoice 7397081773...');
  const tx = await findEpayTransactionByInvoiceId('7397081773', token);
  console.log('Transaction details for 7397081773:');
  console.log(tx);

  console.log('\nTesting verification of fake invoice 9999999999...');
  const fakeTx = await findEpayTransactionByInvoiceId('9999999999', token);
  console.log('Transaction details for fake invoice:');
  console.log(fakeTx);
}

main().catch(console.error);
