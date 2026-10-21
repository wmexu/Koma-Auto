import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const login = process.env.MOYSKLAD_LOGIN;
const password = process.env.MOYSKLAD_PASSWORD;

if (!login || !password) {
  console.error('Missing login or password');
  process.exit(1);
}

const auth = Buffer.from(`${login}:${password}`).toString('base64');

async function getNewToken() {
  console.log('Requesting new MoySklad token with Basic Auth for:', login);
  const res = await fetch('https://api.moysklad.ru/api/remap/1.2/security/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/json',
    },
  });

  console.log('Status:', res.status, res.statusText);
  const data = await res.json();
  console.log('Result:', data);
}

getNewToken().catch(console.error);
