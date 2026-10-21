'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, ShoppingBag, Package } from 'lucide-react';
import { useCartStore } from '@/store/useCartStore';
import { updateLocalOrderStatus, getLocalOrderById } from '@/lib/orders';
import { Order } from '@/lib/order-types';
import styles from '../Checkout.module.css';

export default function SuccessClient() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId') || searchParams.get('invoiceId') || '176819032';
  const clearCart = useCartStore((state) => state.clearCart);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    // Clear cart upon successful payment confirmation
    clearCart();

    // Mark order as paid
    if (orderId) {
      updateLocalOrderStatus(orderId, 'paid');
      const loaded = getLocalOrderById(orderId);
      if (loaded) {
        setOrder({ ...loaded, status: 'paid' });
      }

      fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status: 'paid', order: loaded || undefined }),
      }).catch((e) => console.error('Error updating order status in API:', e));
    }
  }, [orderId, clearCart]);

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
        Ваш заказ сохранён в истории профиля, наши специалисты уже приступили к комплектации.
      </p>

      {order && (
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '32px',
            textAlign: 'left',
            boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', color: '#64748b' }}>Сумма оплаты:</span>
            <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-navy)' }}>
              {order.amount.toLocaleString('ru-RU')} ₸
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', color: '#64748b' }}>Способ доставки:</span>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#1e293b' }}>
              {order.deliveryMethod === 'courier' ? 'Курьерская доставка' : 'Самовывоз'}
            </span>
          </div>
          {order.isTestOrder && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '14px', color: '#b91c1c' }}>Тип операции:</span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#b91c1c',
                  backgroundColor: '#fee2e2',
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}
              >
                Тестовый платеж
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '14px', color: '#64748b' }}>Статус:</span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#15803d',
                backgroundColor: '#dcfce7',
                padding: '2px 10px',
                borderRadius: '12px',
              }}
            >
              Оплачен
            </span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/profile"
          className={styles.homeBtn}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <Package size={18} />
          Перейти в мои заказы
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
