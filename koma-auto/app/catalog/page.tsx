import { Metadata } from 'next';
import CatalogClient from './CatalogClient';

export const metadata: Metadata = {
  title: 'Каталог запчастей - koma.com.kz',
  description: 'Широкий выбор автозапчастей в наличии и под заказ.',
};

import { Suspense } from 'react';

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: '100px 0', textAlign: 'center' }}>Загрузка каталога...</div>}>
      <CatalogClient />
    </Suspense>
  );
}
