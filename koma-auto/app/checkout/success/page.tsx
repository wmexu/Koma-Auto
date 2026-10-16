import { Suspense } from 'react';
import { Metadata } from 'next';
import SuccessClient from './SuccessClient';

export const metadata: Metadata = {
  title: 'Заказ успешно оплачен - koma.com.kz',
};

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: '80px 16px', textAlign: 'center' }}>Загрузка подтверждения...</div>}>
      <SuccessClient />
    </Suspense>
  );
}
