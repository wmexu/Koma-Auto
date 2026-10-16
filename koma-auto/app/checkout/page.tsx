import { Suspense } from 'react';
import { Metadata } from 'next';
import CheckoutClient from './CheckoutClient';

export const metadata: Metadata = {
  title: 'Оформление заказа - koma.com.kz',
};

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: '60px 16px', textAlign: 'center' }}>Загрузка оформления заказа...</div>}>
      <CheckoutClient />
    </Suspense>
  );
}

