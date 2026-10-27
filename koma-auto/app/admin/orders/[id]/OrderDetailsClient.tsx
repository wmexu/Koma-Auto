'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Package,
  Clock,
  CheckCircle,
  XCircle,
  Truck,
  MapPin,
  KeyRound,
  Trash2,
  Archive,
  RotateCcw,
  User,
  Phone,
  Mail,
  CreditCard,
  AlertCircle,
  ShieldCheck,
  Check,
  ChevronRight,
  ExternalLink,
  MessageCircle,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { formatPickupCode, getOrderPickupCode } from '@/lib/pickup-code';
import styles from './OrderDetails.module.css';

interface OrderDetailsClientProps {
  orderId: string;
}

export default function OrderDetailsClient({ orderId }: OrderDetailsClientProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  const { addToast } = useToastStore();

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [couriersList, setCouriersList] = useState<any[]>([]);
  const [userRole, setUserRole] = useState<string>('customer');

  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [phoneBottomSheet, setPhoneBottomSheet] = useState<{ isOpen: boolean; phone: string; name: string } | null>(null);

  // Authenticated fetch helper with Bearer ID token
  const adminFetch = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (user) {
      headers.set('x-staff-user-id', user.uid);
      try {
        const idToken = await user.getIdToken();
        if (idToken) {
          headers.set('authorization', `Bearer ${idToken}`);
        }
      } catch (err) {
        console.warn('Failed to retrieve Firebase ID token:', err);
      }
    }
    return fetch(url, {
      ...options,
      headers,
    });
  };

  // 1. Fetch user role
  useEffect(() => {
    if (!user?.uid) return;
    adminFetch(`/api/user/role?userId=${user.uid}`)
      .then(res => res.json())
      .then(data => {
        if (data.role) setUserRole(data.role);
      })
      .catch(() => {});
  }, [user?.uid]);

  const isDirector = userRole === 'director';
  const isManager = isDirector || userRole === 'manager';
  const isStaff = isManager || userRole === 'courier';

  // 2. Fetch order data
  const loadOrder = async () => {
    if (!user?.uid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/orders?orderId=${encodeURIComponent(orderId)}`);
      const data = await res.json();
      if (!res.ok || !data.success || !data.order) {
        throw new Error(data.error || 'Заказ не найден');
      }
      setOrder(data.order);
      setSelectedCourierId(data.order.assigned_courier_id || '');
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки заказа');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.uid) {
      loadOrder();
    }
  }, [orderId, user?.uid]);

  // 3. Fetch couriers list for assignment
  useEffect(() => {
    if (isManager && user?.uid) {
      adminFetch('/api/admin/couriers')
        .then(res => res.json())
        .then(data => {
          if (data.success) setCouriersList(data.couriers || []);
        })
        .catch(() => {});
    }
  }, [isManager, user?.uid]);

  // Actions
  const handleUpdateStatus = async (newStatus: string) => {
    setIsUpdatingStatus(true);
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_fulfillment_status',
          orderId: order.id,
          status: newStatus,
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ошибка смены статуса');
      }
      addToast(data.message || 'Статус заказа обновлен', 'success');
      loadOrder();
    } catch (err: any) {
      addToast(err.message || 'Ошибка смены статуса', 'error');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleVerifyPickup = async () => {
    if (!order) return;
    setIsVerifying(true);
    try {
      const res = await adminFetch('/api/orders/verify-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          staffUserId: user?.uid,
          confirmMatch: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ошибка верификации выдачи');
      }
      addToast('Заказ успешно верифицирован и выдан!', 'success');
      setIsVerifyModalOpen(false);
      loadOrder();
    } catch (err: any) {
      addToast(err.message || 'Ошибка верификации', 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleAssignCourier = async () => {
    if (!selectedCourierId) return;
    const courier = couriersList.find(c => c.id === selectedCourierId);
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign_courier',
          orderId: order.id,
          courierId: selectedCourierId,
          courierName: courier?.full_name || courier?.email,
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка назначения курьера');
      addToast(data.message || 'Курьер назначен', 'success');
      setIsAssignModalOpen(false);
      loadOrder();
    } catch (err: any) {
      addToast(err.message || 'Ошибка назначения курьера', 'error');
    }
  };

  const handleCancelOrder = async () => {
    if (!confirm('Вы уверены, что хотите отклонить данный заказ? Клиенту будет отображен статус "Отменен менеджером".')) {
      return;
    }
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel_order',
          orderId: order.id,
          reason: 'Отменен менеджером в CRM',
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка отмены заказа');
      addToast('Заказ успешно отклонен', 'success');
      loadOrder();
    } catch (err: any) {
      addToast(err.message || 'Ошибка отмены заказа', 'error');
    }
  };

  const handleArchiveOrder = async () => {
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archive_order',
          orderId: order.id,
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка архивации');
      addToast('Заказ перемещен в архив', 'success');
      loadOrder();
    } catch (err: any) {
      addToast(err.message || 'Ошибка архивации', 'error');
    }
  };

  const handleRestoreToActive = async () => {
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore_to_active',
          orderId: order.id,
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка восстановления');
      addToast('Заказ возвращен в активные', 'success');
      loadOrder();
    } catch (err: any) {
      addToast(err.message || 'Ошибка восстановления', 'error');
    }
  };

  const handleMoveToDeleted = async () => {
    if (!confirm('Переместить заказ в раздел "Удаленные"? Вы сможете восстановить его позже из настроек.')) {
      return;
    }
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move_to_deleted',
          orderId: order.id,
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка перемещения в удаленные');
      addToast('Заказ перемещен в удаленные', 'success');
      router.push('/admin');
    } catch (err: any) {
      addToast(err.message || 'Ошибка удаления', 'error');
    }
  };

  if (!user) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingCenter}>
          <AlertCircle size={32} color="#dc2626" />
          <p style={{ marginTop: '12px', fontWeight: 600 }}>Требуется авторизация в системе</p>
          <Link href="/profile" className={styles.backBtn} style={{ marginTop: '16px' }}>
            Войти в профиль
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingCenter}>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-navy)', marginBottom: '8px' }}>
            Загрузка заказа №{orderId}...
          </div>
          <p style={{ color: '#64748b' }}>Синхронизация данных из базы PostgreSQL...</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className={styles.container}>
        <div className={styles.wrapper}>
          <div className={styles.breadcrumbs}>
            <Link href="/admin">Панель управления</Link>
            <span>/</span>
            <span className={styles.breadcrumbCurrent}>Заказ №{orderId}</span>
          </div>
          <div className={styles.card} style={{ textAlign: 'center', padding: '48px 24px' }}>
            <AlertCircle size={40} color="#dc2626" style={{ margin: '0 auto 16px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
              Заказ не найден
            </h2>
            <p style={{ color: '#64748b', marginBottom: '24px' }}>
              {error || 'Заказ отсутствует или у вас нет прав на его просмотр.'}
            </p>
            <Link href="/admin" className={styles.backBtn} style={{ display: 'inline-flex' }}>
              <ArrowLeft size={16} />
              Вернуться в список заказов
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isCancelled = order.fulfillment_status === 'cancelled' || order.payment_status === 'cancelled' || order.payment_status === 'failed';
  const isCompleted = order.fulfillment_status === 'completed';
  const isDeleted = order.fulfillment_status === 'deleted';
  const isPaid = order.payment_status === 'paid';
  const pickupCode = getOrderPickupCode(order.id, order.pickup_code || null);

  const statusLabel =
    isDeleted ? 'Удален' :
    isCancelled ? 'Отменен менеджером' :
    isCompleted ? 'Выдан' :
    order.fulfillment_status === 'delivered' ? 'Доставлен по адресу' :
    order.fulfillment_status === 'out_for_delivery' ? 'Передан в доставку' :
    order.fulfillment_status === 'packaging' ? 'Упаковывается' :
    'На складе';

  const badgeClass =
    isDeleted ? styles.badgeDeleted :
    isCancelled ? styles.badgeCancelled :
    isCompleted ? styles.badgeCompleted :
    order.fulfillment_status === 'delivered' ? styles.badgeDelivered :
    order.fulfillment_status === 'out_for_delivery' ? styles.badgeOutForDelivery :
    order.fulfillment_status === 'packaging' ? styles.badgePackaging :
    styles.badgeAssembling;

  const items = Array.isArray(order.items) ? order.items : [];

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        {/* Breadcrumbs */}
        <div className={styles.breadcrumbs}>
          <Link href="/admin">Панель управления</Link>
          <span>/</span>
          <Link href="/admin">Заказы</Link>
          <span>/</span>
          <span className={styles.breadcrumbCurrent}>Заказ №{order.id}</span>
        </div>

        {/* Top Bar */}
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link href="/admin" className={styles.backBtn}>
              <ArrowLeft size={16} />
              Назад
            </Link>
            <div>
              <h1 className={styles.orderHeading}>Заказ №{order.id}</h1>
              <span className={styles.orderMetaDate}>
                Оформлен: {new Date(order.created_at).toLocaleString('ru-RU')} • Склад: {order.warehouse_id || 'Car City 1 ярус'}
              </span>
            </div>
          </div>

          <div className={styles.statusBadgesGroup}>
            <span className={`${styles.badge} ${badgeClass}`}>
              {statusLabel}
            </span>
            <span className={`${styles.badge} ${isPaid ? styles.badgePaid : styles.badgePending}`}>
              {isPaid ? 'Оплачен онлайн (ePay)' : 'Ожидает оплаты'}
            </span>
          </div>
        </div>

        {/* Two-Column Grid */}
        <div className={styles.mainLayout}>
          {/* Left Column: Items & Pricing Summary */}
          <div>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>
                <Package size={20} color="var(--color-navy)" />
                Состав заказа ({items.length} поз.)
              </h2>

              <div className={styles.itemsList}>
                {items.map((it: any, idx: number) => {
                  const itemTitle = it.name || it.title || 'Автозапчасть';
                  const itemQty = Number(it.quantity) || 1;
                  const itemPrice = Number(it.price) || 0;
                  const itemTotal = itemPrice * itemQty;
                  const itemArticle = it.article || it.oem || '';
                  const itemBrand = it.brand || '';
                  const itemImg = it.image || '';

                  return (
                    <div key={idx} className={styles.itemRow}>
                      <div className={styles.itemImageWrap}>
                        {itemImg ? (
                          <img src={itemImg} alt={itemTitle} className={styles.itemImage} />
                        ) : (
                          <Package size={24} color="#94a3b8" />
                        )}
                      </div>
                      <div className={styles.itemDetails}>
                        <div className={styles.itemTitle}>{itemTitle}</div>
                        <div className={styles.itemMeta}>
                          {itemBrand && <span>Бренд: <strong>{itemBrand}</strong></span>}
                          {itemArticle && <span>Артикул/OEM: <strong>{itemArticle}</strong></span>}
                        </div>
                      </div>
                      <div className={styles.itemPriceQty}>
                        <div className={styles.itemUnit}>{itemPrice.toLocaleString('ru-RU')} ₸ × {itemQty} шт.</div>
                        <div className={styles.itemTotal}>{itemTotal.toLocaleString('ru-RU')} ₸</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Price Summary */}
              <div className={styles.priceSummary}>
                <div className={styles.priceRow}>
                  <span>Сумма товаров:</span>
                  <span>{Number(order.items_price || order.amount).toLocaleString('ru-RU')} ₸</span>
                </div>
                <div className={styles.priceRow}>
                  <span>Доставка:</span>
                  <span>{Number(order.delivery_cost || 0) > 0 ? `${Number(order.delivery_cost).toLocaleString('ru-RU')} ₸` : 'Бесплатно'}</span>
                </div>
                <div className={styles.priceRowTotal}>
                  <span>Итого к оплате:</span>
                  <span>{Number(order.amount).toLocaleString('ru-RU')} ₸</span>
                </div>
              </div>
            </div>

            {/* Delivery Details Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>
                <Truck size={20} color="var(--color-navy)" />
                Информация о доставке
              </h2>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Способ доставки</span>
                <span className={styles.infoVal}>
                  {order.delivery_method === 'courier' ? 'Курьерская доставка по адресу' : 'Самовывоз (Car City 1 ярус Подвал)'}
                </span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Адрес получения</span>
                <span className={styles.infoVal}>
                  {order.delivery_address || 'г. Алматы, Car City 1 ярус Подвал'}
                </span>
              </div>
              {order.city && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Город</span>
                  <span className={styles.infoVal}>{order.city}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Customer info, Pickup code & Actions */}
          <div>
            {/* 12-Digit Pickup Code Banner */}
            <div className={styles.pickupCodeCard}>
              <div className={styles.pickupCodeHeader}>
                <KeyRound size={16} />
                <span>Код верификации получения</span>
              </div>
              <div className={styles.pickupCodeValue}>{formatPickupCode(pickupCode)}</div>
              <p className={styles.pickupCodeHint}>
                Сверьте этот код с экраном смартфона клиента при выдаче заказа
              </p>
            </div>

            {/* Staff Actions Card */}
            {isManager && (
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>
                  <ShieldCheck size={20} color="var(--color-navy)" />
                  Управление заказом
                </h2>

                {/* Status Selector */}
                {!isCancelled && !isCompleted && !isDeleted && (
                  <div>
                    <label className={styles.infoLabel} style={{ display: 'block', marginBottom: '8px' }}>
                      Изменить статус (виден клиенту):
                    </label>
                    <select
                      className={styles.statusSelectField}
                      value={order.fulfillment_status}
                      disabled={isUpdatingStatus}
                      onChange={(e) => handleUpdateStatus(e.target.value)}
                    >
                      <option value="assembling">На складе</option>
                      <option value="packaging">Упаковывается</option>
                      <option value="out_for_delivery">Передан в доставку</option>
                      <option value="delivered">Доставлен по адресу</option>
                    </select>
                  </div>
                )}

                {/* Action Buttons */}
                {!isCompleted && !isCancelled && !isDeleted && (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.primaryActionBtn}`}
                    onClick={() => setIsVerifyModalOpen(true)}
                  >
                    <KeyRound size={16} />
                    <span>Перейти к выдаче заказа</span>
                  </button>
                )}

                {order.delivery_method === 'courier' && !isCompleted && !isCancelled && !isDeleted && (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.secondaryActionBtn}`}
                    onClick={() => setIsAssignModalOpen(true)}
                  >
                    <Truck size={16} />
                    <span>{order.assigned_courier_id ? 'Сменить курьера' : 'Назначить курьера'}</span>
                  </button>
                )}

                {!isCompleted && !isDeleted && (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.secondaryActionBtn}`}
                    onClick={handleArchiveOrder}
                  >
                    <Archive size={16} />
                    <span>Перенести в архив</span>
                  </button>
                )}

                {!isCancelled && !isDeleted && (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.dangerActionBtn}`}
                    onClick={handleCancelOrder}
                  >
                    <XCircle size={16} />
                    <span>Отклонить заказ</span>
                  </button>
                )}

                {(isCompleted || isCancelled) && !isDeleted && (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.secondaryActionBtn}`}
                    onClick={handleRestoreToActive}
                  >
                    <RotateCcw size={16} />
                    <span>Перенести в Активные заказы</span>
                  </button>
                )}

                {!isDeleted && (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.dangerActionBtn}`}
                    onClick={handleMoveToDeleted}
                  >
                    <Trash2 size={16} />
                    <span>Перенести в удаленные</span>
                  </button>
                )}

                {isDeleted && (
                  <>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.primaryActionBtn}`}
                      onClick={handleRestoreToActive}
                    >
                      <RotateCcw size={16} />
                      <span>Восстановить в активные</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.secondaryActionBtn}`}
                      onClick={handleArchiveOrder}
                    >
                      <Archive size={16} />
                      <span>Восстановить в архив</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Customer Details Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>
                <User size={20} color="var(--color-navy)" />
                Данные клиента
              </h2>

              {/* Clickable Customer Profile Link */}
              <div
                className={styles.customerProfileClickable}
                onClick={() => {
                  const targetId = order.user_id || order.customer_email;
                  if (targetId) {
                    router.push(`/admin/users/${encodeURIComponent(targetId)}`);
                  }
                }}
                title="Нажмите для перехода в профиль клиента и просмотра его заказов"
              >
                <div>
                  <span className={styles.infoLabel} style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>
                    Покупатель
                  </span>
                  <span className={styles.infoVal} style={{ fontWeight: 800, color: 'var(--color-navy)', fontSize: '15px' }}>
                    {order.customer_name || 'Не указано'}
                  </span>
                </div>
                <span className={styles.customerProfileBadge}>
                  Профиль клиента
                  <ChevronRight size={14} />
                </span>
              </div>

              {/* Phone Clickable to open Bottom Sheet */}
              <div className={styles.infoRow} style={{ marginTop: '12px' }}>
                <span className={styles.infoLabel}>Телефон</span>
                <span className={styles.infoVal}>
                  {order.customer_phone ? (
                    <button
                      type="button"
                      className={styles.phoneClickableBtn}
                      onClick={() => setPhoneBottomSheet({
                        isOpen: true,
                        phone: order.customer_phone,
                        name: order.customer_name || 'Клиент',
                      })}
                      title="Нажмите для звонка или связи по WhatsApp"
                    >
                      <Phone size={13} />
                      <span>{order.customer_phone}</span>
                    </button>
                  ) : (
                    '—'
                  )}
                </span>
              </div>

              {order.customer_email && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Email</span>
                  <span className={styles.infoVal}>{order.customer_email}</span>
                </div>
              )}

              {order.kaspi_phone && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel} style={{ color: '#b91c1c' }}>Телефон Kaspi Pay</span>
                  <span className={styles.infoVal}>
                    <button
                      type="button"
                      className={styles.phoneClickableBtn}
                      style={{ color: '#b91c1c', borderColor: '#fca5a5', background: '#fef2f2' }}
                      onClick={() => setPhoneBottomSheet({
                        isOpen: true,
                        phone: order.kaspi_phone,
                        name: order.customer_name || 'Клиент',
                      })}
                      title="Нажмите для звонка или связи по WhatsApp"
                    >
                      <Phone size={13} />
                      <span>{order.kaspi_phone}</span>
                    </button>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* VERIFY PICKUP MODAL */}
        {isVerifyModalOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(4px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
            }}
            onClick={() => setIsVerifyModalOpen(false)}
          >
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '28px',
                width: '100%',
                maxWidth: '440px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <KeyRound size={22} color="var(--color-navy)" />
                <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: 'var(--color-navy)' }}>
                  Выдача заказа №{order.id}
                </h3>
              </div>
              <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
                Сверьте код выдачи с экрана смартфона покупателя. Коды должны совпадать:
              </p>

              <div className={styles.modalPickupCodeBox}>
                <div className={styles.modalPickupCodeLabel}>
                  12-значный код клиента
                </div>
                <div className={styles.modalPickupCodeValue}>
                  {formatPickupCode(pickupCode)}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsVerifyModalOpen(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#f1f5f9',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isVerifying}
                  onClick={handleVerifyPickup}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#15803d',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {isVerifying ? 'Выдача...' : 'Выдать заказ'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ASSIGN COURIER MODAL */}
        {isAssignModalOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(4px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
            }}
            onClick={() => setIsAssignModalOpen(false)}
          >
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '28px',
                width: '100%',
                maxWidth: '440px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px', color: 'var(--color-navy)' }}>
                Назначить курьера
              </h3>
              <select
                className={styles.statusSelectField}
                value={selectedCourierId}
                onChange={(e) => setSelectedCourierId(e.target.value)}
              >
                <option value="">Выберите курьера из списка...</option>
                {couriersList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name || c.email} ({c.phone || c.email})
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#f1f5f9',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleAssignCourier}
                  disabled={!selectedCourierId}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--color-navy)',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Назначить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PHONE ACTIONS BOTTOM SHEET (Slides from bottom up) */}
        {phoneBottomSheet?.isOpen && (() => {
          const raw = phoneBottomSheet.phone || '';
          const digits = raw.replace(/\D/g, '');
          const cleanDigits = digits.startsWith('8') ? '7' + digits.slice(1) : digits;
          const waLink = `https://wa.me/${cleanDigits}?text=${encodeURIComponent(`Здравствуйте, ${phoneBottomSheet.name}! По поводу вашего заказа №${order.id} в интернет-магазине Koma Auto...`)}`;

          return (
            <div className={styles.bottomSheetOverlay} onClick={() => setPhoneBottomSheet(null)}>
              <div className={styles.bottomSheetContainer} onClick={e => e.stopPropagation()}>
                <div className={styles.bottomSheetHandle} />
                
                <div className={styles.bottomSheetHeader}>
                  <h3 className={styles.bottomSheetTitle}>{phoneBottomSheet.name}</h3>
                  <p className={styles.bottomSheetSubtitle}>{phoneBottomSheet.phone}</p>
                </div>

                <div className={styles.bottomSheetActions}>
                  <a
                    href={`tel:${cleanDigits}`}
                    className={styles.sheetCallBtn}
                    onClick={() => setPhoneBottomSheet(null)}
                  >
                    <Phone size={20} />
                    <span>Позвонить</span>
                  </a>

                  <a
                    href={waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.sheetWhatsAppBtn}
                    onClick={() => setPhoneBottomSheet(null)}
                  >
                    <MessageCircle size={20} />
                    <span>WhatsApp</span>
                  </a>

                  <button
                    type="button"
                    className={styles.sheetCancelBtn}
                    onClick={() => setPhoneBottomSheet(null)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
