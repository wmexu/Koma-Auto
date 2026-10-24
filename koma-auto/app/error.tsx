'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCw, Home } from 'lucide-react';

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
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
        Что-то пошло не так
      </h2>
      <p style={{ fontSize: '15px', color: '#6B7280', maxWidth: '480px', marginBottom: '24px' }}>
        Произошла ошибка при загрузке. Попробуйте обновить страницу или вернуться на главную.
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
          href="/"
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
          <Home size={16} />
          На главную
        </Link>
      </div>
    </div>
  );
}
