'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCw, ArrowLeft } from 'lucide-react';

export default function ProductErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Product page error:', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '40px 20px',
    }}>
      <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px', color: '#111827' }}>
        Не удалось загрузить товар
      </h2>
      <p style={{ fontSize: '15px', color: '#6B7280', maxWidth: '480px', marginBottom: '24px' }}>
        Произошла временная ошибка при загрузке данных детали. Попробуйте обновить страницу или перейти в каталог.
      </p>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={() => reset()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#060F48',
            color: '#FFFFFF',
            padding: '12px 24px',
            borderRadius: '10px',
            fontWeight: 600,
            fontSize: '14px',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          <RotateCw size={16} />
          Попробовать снова
        </button>
        <Link
          href="/catalog"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#F3F4F6',
            color: '#111827',
            padding: '12px 24px',
            borderRadius: '10px',
            fontWeight: 600,
            fontSize: '14px',
            textDecoration: 'none'
          }}
        >
          <ArrowLeft size={16} />
          В каталог
        </Link>
      </div>
    </div>
  );
}
