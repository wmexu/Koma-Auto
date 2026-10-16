'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, ShoppingBag } from 'lucide-react';
import { useCartStore } from '@/store/useCartStore';
import styles from '../Checkout.module.css';

export default function SuccessClient() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId') || searchParams.get('invoiceId') || '176819032';
  const clearCart = useCartStore((state) => state.clearCart);

  useEffect(() => {
    // Clear cart upon successful payment confirmation
    clearCart();
  }, [clearCart]);

  return (
    <div className={`container ${styles.successState}`}>
      <div style={{ marginBottom: '8px' }}>
        <CheckCircle size={84} color="var(--color-success)" strokeWidth={2} />
      </div>
      <h1>Оплата прошла успешно!</h1>
      <p style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-navy)', margin: '8px 0 16px' }}>
        Заказ №{orderId}
      </p>
      <p style={{ maxWidth: '540px', lineHeight: 1.6, color: '#555', marginBottom: '32px' }}>
        Спасибо за покупку в интернет-магазине koma.com.kz! Платёж через систему Halyk ePay успешно принят.
        Наши менеджеры уже формируют заказ для доставки.
      </p>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/" className={styles.homeBtn} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          На главную
        </Link>
        <Link
          href="/catalog"
          className={styles.homeBtn}
          style={{
            backgroundColor: '#f0f2f5',
            color: 'var(--color-navy)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <ShoppingBag size={18} />
          В каталог
        </Link>
      </div>
    </div>
  );
}
