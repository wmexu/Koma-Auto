import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import https from 'node:https';

const token = process.env.MOYSKLAD_TOKEN;

const req = https.request(
  {
    hostname: 'api.moysklad.ru',
    path: '/api/remap/1.2/entity/customerorder?limit=5',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json;charset=utf-8',
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log('Total orders:', json.meta?.size);
        for (const r of json.rows || []) {
          console.log({
            id: r.id,
            name: r.name,
            sum: (r.sum || 0) / 100,
            created: r.created,
            updated: r.updated,
            description: r.description?.slice(0, 100),
          });
        }
      } catch {
        console.log('Response:', res.statusCode, data);
      }
    });
  }
);
req.end();
