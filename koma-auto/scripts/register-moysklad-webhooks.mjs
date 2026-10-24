import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const token = process.env.MOYSKLAD_TOKEN;
const WEBHOOK_URL = 'https://koma.com.kz/api/moysklad/webhook';

const requiredWebhooks = [
  { entityType: 'product', action: 'CREATE' },
  { entityType: 'product', action: 'UPDATE' },
  { entityType: 'product', action: 'DELETE' },
  { entityType: 'demand', action: 'CREATE' },
  { entityType: 'retaildemand', action: 'CREATE' },
  { entityType: 'enter', action: 'CREATE' },
  { entityType: 'supply', action: 'CREATE' },
  { entityType: 'loss', action: 'CREATE' },
];

async function run() {
  console.log('Fetching existing webhooks from MoySklad...');
  const res = await fetch('https://api.moysklad.ru/api/remap/1.2/entity/webhook', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json;charset=utf-8',
    },
  });

  if (!res.ok) {
    console.error('Failed to fetch webhooks:', res.status, await res.text());
    return;
  }

  const data = await res.json();
  const existing = data.rows || [];
  console.log(`Found ${existing.length} existing webhooks.`);

  for (const req of requiredWebhooks) {
    const isAlreadyRegistered = existing.some(
      (w) => w.entityType === req.entityType && w.action === req.action && w.url === WEBHOOK_URL
    );

    if (isAlreadyRegistered) {
      console.log(`[OK] Webhook ${req.entityType}:${req.action} already registered.`);
      continue;
    }

    console.log(`[+] Registering webhook for ${req.entityType}:${req.action}...`);
    const createRes = await fetch('https://api.moysklad.ru/api/remap/1.2/entity/webhook', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': 'application/json;charset=utf-8',
      },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        action: req.action,
        entityType: req.entityType,
        enabled: true,
      }),
    });

    if (createRes.ok) {
      const created = await createRes.json();
      console.log(`Successfully created webhook ${req.entityType}:${req.action} (id: ${created.id})`);
    } else {
      console.error(`Failed to create webhook ${req.entityType}:${req.action}:`, createRes.status, await createRes.text());
    }
  }

  console.log('\nAll webhooks checked/registered.');
}

run().catch(console.error);
