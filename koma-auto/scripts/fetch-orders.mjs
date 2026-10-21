import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import zlib from 'node:zlib';
import https from 'node:https';

const token = process.env.MOYSKLAD_TOKEN;

const options = {
  hostname: 'api.moysklad.ru',
  path: '/api/remap/1.2/entity/customerorder?limit=5&order=created,desc',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept-Encoding': 'gzip',
  },
};

const req = https.request(options, (res) => {
  const isGzip = res.headers['content-encoding'] === 'gzip';
  const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
  let data = '';
  stream.on('data', (c) => (data += c));
  stream.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Total orders in MoySklad:', json.meta?.size);
      for (const r of json.rows || []) {
        console.log('==============================');
        console.log('ID:', r.id);
        console.log('Name:', r.name);
        console.log('Sum:', (r.sum || 0) / 100, 'KZT');
        console.log('Created:', r.created);
        console.log('Updated:', r.updated);
        console.log('State:', r.state?.meta?.href);
        console.log('Description:\n', r.description);
      }
    } catch (e) {
      console.error('JSON parse error:', e, data);
    }
  });
});
req.on('error', console.error);
req.end();
