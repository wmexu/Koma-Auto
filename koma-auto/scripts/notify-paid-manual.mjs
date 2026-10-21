import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import { notifyMoySkladOrderPaid } from '../lib/moysklad-order.ts';

async function main() {
  const order = {
    id: '7397081773',
    invoiceId: '7397081773',
    createdAt: '2026-10-21T12:56:37.000Z',
    expiresAt: '2026-10-21T13:16:37.000Z',
    status: 'paid',
    amount: 10,
    itemsPrice: 1000,
    deliveryCost: 0,
    deliveryMethod: 'courier',
    address: 'г. Алматы, ул. Дом, д. 23, кв. 1, подъезд 1, инд. 050070',
    city: 'Алматы',
    customer: {
      name: 'Алан Манкусов',
      phone: '+77472301270',
      email: 'nurgantesti@gmail.com',
      comment: 'ТЕСТОВЫЙ ЗАКАЗ. ИГНОРИРУЙТЕ',
    },
    paymentMethod: 'online',
    receiptUrl: 'https://epay.homebank.kz/receipt/7397081773',
    items: [
      {
        id: '96130396',
        name: 'Фильтр топливный Chevrolet Nexia 1.5',
        price: 1000,
        quantity: 1,
        oem: '96130396',
        article: '96130396',
        brand: 'GM',
      },
    ],
    userId: 'ohwKkhkKHmdaI5CkbcGJcunNuID2',
    userAccountDetails: {
      uid: 'ohwKkhkKHmdaI5CkbcGJcunNuID2',
      email: 'acooldumb123@gmail.com',
    },
    isTestOrder: true,
    promoCode: '7KkVaBaspdehR975jbgt',
  };

  console.log('Notifying MoySklad and Telegram for order 7397081773...');
  const res = await notifyMoySkladOrderPaid(order);
  console.log('Result:', res);
}

main().catch(console.error);
