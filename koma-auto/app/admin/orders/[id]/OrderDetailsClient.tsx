'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Search,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { formatPickupCode, getOrderPickupCode } from '@/lib/pickup-code';
import styles from './OrderDetails.module.css';

interface OrderDetailsClientProps {
  orderId: string;
}

function WhatsAppIcon({ size = 20, color = '#10B981', className = '' }: { size?: number; color?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ minWidth: size, color: color, display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path d="M12.031 2C6.495 2 2 6.495 2 12.031c0 1.768.46 3.493 1.334 5.008L2 22l5.127-1.344c1.464.799 3.111 1.22 4.904 1.22h.004c5.534 0 10.029-4.495 10.029-10.031A10.01 10.01 0 0012.031 2zm0 18.369c-1.547 0-3.064-.416-4.387-1.2l-.315-.187-3.259.855.87-3.178-.205-.327a8.318 8.318 0 01-1.272-4.299c0-4.606 3.748-8.354 8.358-8.354 2.233 0 4.332.869 5.91 2.448a8.31 8.31 0 012.451 5.915c0 4.607-3.748 8.354-8.36 8.354zm4.577-6.257c-.251-.126-1.487-.734-1.718-.818-.23-.084-.398-.126-.566.126-.168.251-.649.818-.796.986-.147.168-.293.189-.544.063-.251-.126-1.06-.391-2.02-1.246-.747-.666-1.252-1.488-1.399-1.74-.147-.251-.016-.387.11-.512.113-.113.251-.293.377-.44.126-.147.168-.251.251-.419.084-.168.042-.315-.021-.44-.063-.126-.566-1.363-.775-1.866-.204-.49-.411-.424-.566-.432-.147-.008-.315-.01-.482-.01-.168 0-.44.063-.67.315-.23.251-.88.86-.88 2.098s.901 2.434 1.027 2.602c.126.168 1.772 2.706 4.294 3.794.6.259 1.069.414 1.435.53.603.192 1.152.165 1.586.1.484-.072 1.487-.608 1.696-1.195.21-.586.21-1.089.147-1.195-.063-.105-.23-.168-.481-.293z" />
    </svg>
  );
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
  const [courierSearchQuery, setCourierSearchQuery] = useState('');
  const [isLoadingCouriers, setIsLoadingCouriers] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [phoneBottomSheet, setPhoneBottomSheet] = useState<{ isOpen: boolean; phone: string; name: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Timer ticker for live 20-minute payment countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const getPendingRemainingTime = (createdAt: string) => {
    try {
      const expiresMs = new Date(createdAt).getTime() + 20 * 60 * 1000;
      const diff = expiresMs - currentTime;
      if (diff <= 0) return '00:00';
      const totalSeconds = Math.floor(diff / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } catch {
      return '20:00';
    }
  };

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
  const loadCouriers = useCallback(async () => {
    if (!user?.uid) return;
    try {
      setIsLoadingCouriers(true);
      const res = await adminFetch('/api/admin/couriers');
      const data = await res.json();
      if (data.success && Array.isArray(data.couriers)) {
        setCouriersList(data.couriers);
      }
    } catch (err) {
      console.error('[OrderDetailsClient] Failed to load couriers:', err);
    } finally {
      setIsLoadingCouriers(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (isManager && user?.uid) {
      loadCouriers();
    }
  }, [isManager, user?.uid, loadCouriers]);

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

  const handleConfirmKaspiPayment = async () => {
    const confirmed = window.confirm(
      `Подтвердить поступление оплаты через Kaspi Pay для заказа #${order.id} на сумму ${Number(order.amount).toLocaleString('ru-RU')} ₸?\n\nСтатус заказа изменится на «Оплачен» / «Комплектуется», а статус и описание в МойСклад обновятся автоматически.`
    );
    if (!confirmed) return;

    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_kaspi_payment',
          orderId: order.id,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ошибка подтверждения оплаты');
      }

      addToast(data.message || 'Оплата Kaspi Pay успешно подтверждена!', 'success');
      loadOrder();
    } catch (err: any) {
      addToast(err.message || 'Не удалось подтвердить оплату', 'error');
    }
  };

  const handleSetKaspiStatus = async (targetStatus: 'pending' | 'invoiced' | 'paid') => {
    if (targetStatus === 'paid') {
      return handleConfirmKaspiPayment();
    }

    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_kaspi_status',
          orderId: order.id,
          status: targetStatus,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ошибка изменения статуса счета');
      }

      addToast(data.message || 'Статус Kaspi Pay обновлен', 'success');
      loadOrder();
    } catch (err: any) {
      addToast(err.message || 'Не удалось изменить статус', 'error');
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
    order.fulfillment_status === 'ready_for_pickup' ? 'Готов к получению' :
    order.fulfillment_status === 'delivered' ? 'Доставлен по адресу' :
    order.fulfillment_status === 'out_for_delivery' ? 'Передан в доставку' :
    order.fulfillment_status === 'packaging' ? 'Упаковывается' :
    'На складе';

  const badgeClass =
    isDeleted ? styles.badgeDeleted :
    isCancelled ? styles.badgeCancelled :
    isCompleted ? styles.badgeCompleted :
    order.fulfillment_status === 'ready_for_pickup' ? styles.badgeReady :
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
              {isPaid 
                ? (order.payment_method === 'kaspi_pay' ? 'Оплачен (Kaspi Pay)' : 'Оплачен онлайн (ePay)') 
                : (order.payment_method === 'kaspi_pay'
                    ? (order.payment_status === 'invoiced' ? 'Счет выставлен (Kaspi Pay)' : 'Ожидает выставления (Kaspi Pay)')
                    : `Ожидает оплаты: ${getPendingRemainingTime(order.created_at)}`)}
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

                  const itemLink = it.id ? `/product/${it.id}` : null;
                  const rowContent = (
                    <>
                      <div className={styles.itemImageWrap}>
                        {itemImg ? (
                          <img src={itemImg} alt={itemTitle} className={styles.itemImage} />
                        ) : (
                          <Package size={24} color="#94a3b8" />
                        )}
                      </div>
                      <div className={styles.itemDetails}>
                        <div className={styles.itemTitle}>
                          {itemTitle}
                          {itemLink && <ExternalLink size={13} style={{ marginLeft: 6, opacity: 0.6, display: 'inline-block', verticalAlign: 'middle' }} />}
                        </div>
                        <div className={styles.itemMeta}>
                          {itemBrand && <span>Бренд: <strong>{itemBrand}</strong></span>}
                          {itemArticle && <span>Артикул/OEM: <strong>{itemArticle}</strong></span>}
                        </div>
                      </div>
                      <div className={styles.itemPriceQty}>
                        <div className={styles.itemUnit}>{itemPrice.toLocaleString('ru-RU')} ₸ × {itemQty} шт.</div>
                        <div className={styles.itemTotal}>{itemTotal.toLocaleString('ru-RU')} ₸</div>
                      </div>
                    </>
                  );

                  return itemLink ? (
                    <Link
                      key={idx}
                      href={itemLink}
                      target="_blank"
                      className={`${styles.itemRow} ${styles.itemRowLink}`}
                      title="Открыть товар в новой вкладке"
                    >
                      {rowContent}
                    </Link>
                  ) : (
                    <div key={idx} className={styles.itemRow}>
                      {rowContent}
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
                      value={order.fulfillment_status || 'assembling'}
                      disabled={isUpdatingStatus}
                      onChange={(e) => handleUpdateStatus(e.target.value)}
                    >
                      {order.delivery_method === 'pickup' ? (
                        <>
                          <option value="assembling">На складе</option>
                          <option value="packaging">Упаковывается</option>
                          <option value="ready_for_pickup">Готов к получению</option>
                        </>
                      ) : (
                        <>
                          <option value="assembling">На складе</option>
                          <option value="packaging">Упаковывается</option>
                          <option value="out_for_delivery">Передан в доставку</option>
                          <option value="delivered">Доставлен по адресу</option>
                        </>
                      )}
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

                {order.payment_method === 'kaspi_pay' && order.payment_status !== 'paid' && !isCancelled && !isDeleted && (
                  <>
                    {order.payment_status !== 'invoiced' ? (
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.secondaryActionBtn}`}
                        style={{ backgroundColor: '#2563eb', color: '#fff', borderColor: '#2563eb' }}
                        onClick={() => handleSetKaspiStatus('invoiced')}
                        title="Пометить, что счет выставлен клиенту в приложении Kaspi"
                      >
                        <CreditCard size={16} />
                        <span>Выставить счет</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.secondaryActionBtn}`}
                        onClick={() => handleSetKaspiStatus('pending')}
                        title="Вернуть статус в «Ожидает выставления»"
                      >
                        <span>Вернуть в ожидание</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.confirmKaspiBtn}`}
                      onClick={() => handleSetKaspiStatus('paid')}
                      title="Подтвердить получение оплаты через Kaspi Pay"
                    >
                      <CheckCircle size={16} />
                      <span>Подтвердить оплату (Kaspi Pay)</span>
                    </button>
                  </>
                )}

                {order.delivery_method === 'courier' && !isCompleted && !isCancelled && !isDeleted && (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.secondaryActionBtn}`}
                    onClick={() => {
                      setIsAssignModalOpen(true);
                      setSelectedCourierId(order.assigned_courier_id || '');
                      setCourierSearchQuery('');
                      loadCouriers();
                    }}
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
          <div className={styles.courierModalOverlay} onClick={() => setIsAssignModalOpen(false)}>
            <div className={styles.courierModalCard} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-navy)' }}>
                Назначить курьера
              </h3>
              <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b' }}>
                Заказ #{order.id} ({order.customer_name}, {Number(order.amount).toLocaleString('ru-RU')} ₸).
                Выберите курьера для назначения:
              </p>

              {/* Courier Search Input */}
              <div className={styles.courierSearchWrapper}>
                <span className={styles.courierSearchIcon}>
                  <Search size={16} />
                </span>
                <input
                  type="text"
                  className={styles.courierSearchInput}
                  placeholder="Поиск курьера по имени, email или телефону..."
                  value={courierSearchQuery}
                  onChange={e => setCourierSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Courier List Scroll */}
              <div className={styles.courierListScroll}>
                {couriersList
                  .filter(c => {
                    if (!courierSearchQuery.trim()) return true;
                    const q = courierSearchQuery.toLowerCase();
                    const name = (c.full_name || '').toLowerCase();
                    const email = (c.email || '').toLowerCase();
                    const phone = (c.phone || '').toLowerCase();
                    return name.includes(q) || email.includes(q) || phone.includes(q);
                  })
                  .map(c => {
                    const isSelected = selectedCourierId === c.id;
                    const initials = (c.full_name || c.email || 'К')
                      .split(' ')
                      .filter(Boolean)
                      .map((p: string) => p[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase();

                    return (
                      <div
                        key={c.id}
                        className={`${styles.courierOptionCard} ${isSelected ? styles.courierOptionCardSelected : ''}`}
                        onClick={() => setSelectedCourierId(c.id)}
                      >
                        <div className={styles.courierAvatar}>
                          {initials}
                        </div>
                        <div className={styles.courierInfo}>
                          <span className={styles.courierName}>
                            {c.full_name || 'Курьер без имени'}
                          </span>
                          <div className={styles.courierMeta}>
                            <span>{c.email}</span>
                            {c.phone && (
                              <>
                                <span>•</span>
                                <span className={styles.courierPhone}>{c.phone}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className={styles.courierCheckmark}>
                          {isSelected ? '✓' : ''}
                        </div>
                      </div>
                    );
                  })}

                {couriersList.length === 0 && !isLoadingCouriers && (
                  <div className={styles.courierEmptyState}>
                    <p>Нет доступных сотрудников с ролью «Курьер».</p>
                    <button
                      type="button"
                      className={styles.courierRefreshBtn}
                      onClick={loadCouriers}
                    >
                      Обновить список курьеров
                    </button>
                  </div>
                )}

                {couriersList.length > 0 &&
                  couriersList.filter(c => {
                    const q = courierSearchQuery.toLowerCase();
                    return (
                      (c.full_name || '').toLowerCase().includes(q) ||
                      (c.email || '').toLowerCase().includes(q) ||
                      (c.phone || '').toLowerCase().includes(q)
                    );
                  }).length === 0 && (
                    <div className={styles.courierEmptyState}>
                      <p>Курьер по запросу «{courierSearchQuery}» не найден</p>
                    </div>
                  )}
              </div>

              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '16px', display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className={styles.sheetCancelBtn}
                  onClick={() => setIsAssignModalOpen(false)}
                  style={{ flex: 1, margin: 0, padding: '10px', fontSize: '14px' }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={!selectedCourierId}
                  onClick={handleAssignCourier}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '12px',
                    border: 'none',
                    background: 'var(--color-navy)',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 800,
                    cursor: selectedCourierId ? 'pointer' : 'not-allowed',
                    opacity: selectedCourierId ? 1 : 0.6,
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
              {/* SVG Gradient definition for phone icon */}
              <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
                <defs>
                  <linearGradient id="phoneCallIconGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#1e40af" />
                    <stop offset="50%" stopColor="#13296b" />
                    <stop offset="100%" stopColor="#060F48" />
                  </linearGradient>
                </defs>
              </svg>

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
                    <Phone size={20} stroke="url(#phoneCallIconGradient)" color="url(#phoneCallIconGradient)" strokeWidth={2.2} />
                    <span>Позвонить</span>
                  </a>

                  <a
                    href={waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.sheetWhatsAppBtn}
                    onClick={() => setPhoneBottomSheet(null)}
                  >
                    <WhatsAppIcon size={20} color="#10B981" />
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
