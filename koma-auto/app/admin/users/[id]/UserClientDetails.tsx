'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Shield,
  Clock,
  Package,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  Calendar,
  MessageCircle,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { formatPickupCode, getOrderPickupCode } from '@/lib/pickup-code';
import styles from './UserClientDetails.module.css';

interface UserClientDetailsProps {
  userId: string;
}

export default function UserClientDetails({ userId }: UserClientDetailsProps) {
  const router = useRouter();
  const { user, userProfile } = useAuthStore();
  const { addToast } = useToastStore();

  const [targetUser, setTargetUser] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    totalOrders: 0,
    activeOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    totalSpent: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ordersTab, setOrdersTab] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);

  const currentUserRole = userProfile?.role || 'customer';
  const isDirector = currentUserRole === 'director';
  const isManager = currentUserRole === 'manager' || isDirector;

  // Authenticated fetch helper
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

  // Load User Data
  const loadUserData = async () => {
    if (!user?.uid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (!res.ok || !data.success || !data.user) {
        throw new Error(data.error || 'Пользователь не найден');
      }
      setTargetUser(data.user);
      setOrders(data.orders || []);
      if (data.stats) setStats(data.stats);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки данных пользователя');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.uid) {
      loadUserData();
    }
  }, [userId, user?.uid]);

  // Handle Role Change (Director only)
  const handleChangeRole = async (newRole: string) => {
    if (!targetUser) return;
    setIsUpdatingRole(true);
    try {
      const res = await adminFetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: targetUser.id,
          newRole,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка смены роли');

      addToast(data.message || 'Роль пользователя успешно обновлена', 'success');
      setTargetUser((prev: any) => ({ ...prev, role: newRole }));
    } catch (err: any) {
      addToast(err.message || 'Ошибка изменения роли', 'error');
    } finally {
      setIsUpdatingRole(false);
    }
  };

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    addToast('Код получения скопирован', 'success');
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const roleLabels: Record<string, string> = {
    director: 'Директор (SuperAdmin)',
    manager: 'Менеджер склада',
    courier: 'Курьер доставки',
    wholesale: 'Оптовый покупатель',
    customer: 'Розничный покупатель',
  };

  const roleClassMap: Record<string, string> = {
    director: styles.roleDirector,
    manager: styles.roleManager,
    courier: styles.roleCourier,
    wholesale: styles.roleWholesale,
    customer: styles.roleCustomer,
  };

  if (!isManager) {
    return (
      <div className={styles.detailsContainer}>
        <div className={styles.detailsWrapper} style={{ textAlign: 'center', paddingTop: '80px' }}>
          <Shield size={48} color="var(--color-navy)" style={{ marginBottom: '16px' }} />
          <h1 style={{ color: 'var(--color-navy)', fontSize: '24px', fontWeight: 800 }}>
            Доступ ограничен
          </h1>
          <p style={{ color: '#64748b', maxWidth: '460px', margin: '12px auto 24px auto' }}>
            Просмотр профилей пользователей доступен только авторизованным сотрудникам Koma Auto.
          </p>
          <Link href="/admin" className={styles.backBtn}>
            <ArrowLeft size={16} />
            Вернуться в панель управления
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.detailsContainer}>
        <div className={styles.detailsWrapper} style={{ textAlign: 'center', paddingTop: '80px', color: '#64748b' }}>
          Загрузка профиля пользователя...
        </div>
      </div>
    );
  }

  if (error || !targetUser) {
    return (
      <div className={styles.detailsContainer}>
        <div className={styles.detailsWrapper} style={{ textAlign: 'center', paddingTop: '80px' }}>
          <h2 style={{ color: '#b91c1c', marginBottom: '12px' }}>{error || 'Пользователь не найден'}</h2>
          <Link href="/admin" className={styles.backBtn}>
            <ArrowLeft size={16} />
            Вернуться в панель управления
          </Link>
        </div>
      </div>
    );
  }

  const isOrderCancelled = (o: any) => {
    return o.fulfillment_status === 'cancelled' ||
           o.payment_status === 'cancelled' ||
           o.payment_status === 'failed' ||
           o.payment_status === 'declined' ||
           o.status === 'declined';
  };

  const isOrderCompleted = (o: any) => {
    return o.fulfillment_status === 'completed';
  };

  const isOrderActive = (o: any) => {
    return !isOrderCancelled(o) && !isOrderCompleted(o);
  };

  const filteredOrders = orders.filter(o => {
    if (ordersTab === 'active') return isOrderActive(o);
    if (ordersTab === 'completed') return isOrderCompleted(o);
    if (ordersTab === 'cancelled') return isOrderCancelled(o);
    return true;
  });

  const rawPhone = targetUser.phone || '';
  const digitsOnly = rawPhone.replace(/\D/g, '');
  const cleanPhone = digitsOnly.startsWith('8') ? '7' + digitsOnly.slice(1) : digitsOnly;

  return (
    <div className={styles.detailsContainer}>
      <div className={styles.detailsWrapper}>
        {/* Breadcrumbs */}
        <div className={styles.breadcrumbsBar}>
          <div className={styles.breadcrumbs}>
            <Link href="/admin" className={styles.breadcrumbLink}>Панель управления</Link>
            <ChevronRight size={14} color="#94a3b8" />
            <Link href="/admin" className={styles.breadcrumbLink}>Пользователи</Link>
            <ChevronRight size={14} color="#94a3b8" />
            <span className={styles.breadcrumbActive}>{targetUser.full_name || targetUser.email}</span>
          </div>

          <Link href="/admin" className={styles.backBtn}>
            <ArrowLeft size={16} />
            В панель управления
          </Link>
        </div>

        {/* Profile Hero Card */}
        <div className={styles.profileHeroCard}>
          <div className={styles.profileHeroTop}>
            <div className={styles.profileInfoBlock}>
              <div className={styles.profileTitleBlock}>
                <h1>{targetUser.full_name || 'Без имени'}</h1>
                <div className={styles.profileMetaRow}>
                  <span className={styles.profileMetaItem}>
                    <Mail size={14} />
                    <strong>{targetUser.email}</strong>
                  </span>
                  {targetUser.phone && (
                    <span className={styles.profileMetaItem}>
                      <Phone size={14} />
                      <a href={`tel:${targetUser.phone}`} className={styles.phoneActionBtn}>
                        {targetUser.phone}
                      </a>
                      <a
                        href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent('Здравствуйте! Обращаемся к вам из интернет-магазина Koma Auto.')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.whatsappActionBtn}
                        title="Написать в WhatsApp"
                      >
                        <MessageCircle size={13} />
                        WhatsApp
                      </a>
                    </span>
                  )}
                  <span className={`${styles.roleBadge} ${roleClassMap[targetUser.role] || styles.roleCustomer}`}>
                    {roleLabels[targetUser.role] || targetUser.role}
                  </span>
                </div>
              </div>
            </div>

            {/* If Director, allow changing role */}
            {isDirector && (
              <div className={styles.roleSelectorBlock}>
                <span className={styles.roleSelectLabel}>Изменить статус:</span>
                <select
                  value={targetUser.role}
                  onChange={e => handleChangeRole(e.target.value)}
                  disabled={isUpdatingRole}
                  className={styles.roleSelectDropdown}
                >
                  <option value="customer">Розничный покупатель</option>
                  <option value="wholesale">Оптовый покупатель</option>
                  <option value="courier">Курьер доставки</option>
                  <option value="manager">Менеджер склада</option>
                  <option value="director">Директор (SuperAdmin)</option>
                </select>
              </div>
            )}
          </div>

          {/* Stat Badges */}
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Всего заказов</span>
              <span className={styles.statValue}>{stats.totalOrders}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Активных</span>
              <span className={styles.statValue} style={{ color: '#0284c7' }}>{stats.activeOrders}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Завершено</span>
              <span className={styles.statValue} style={{ color: '#16a34a' }}>{stats.completedOrders}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Общая сумма</span>
              <span className={styles.statValue} style={{ color: 'var(--color-navy)' }}>
                {Number(stats.totalSpent).toLocaleString('ru-RU')} ₸
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Регистрация</span>
              <span className={styles.statValue} style={{ fontSize: '15px', color: '#475569', fontWeight: 700 }}>
                {targetUser.created_at ? new Date(targetUser.created_at).toLocaleDateString('ru-RU') : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Orders History Section */}
        <div>
          <div className={styles.ordersSectionTitleRow}>
            <h2 className={styles.ordersSectionTitle}>
              <Package size={20} color="var(--color-navy)" />
              История заказов пользователя ({orders.length})
            </h2>

            <div className={styles.ordersFilterTabs}>
              <button
                type="button"
                className={`${styles.filterTabBtn} ${ordersTab === 'all' ? styles.activeFilterTabBtn : ''}`}
                onClick={() => setOrdersTab('all')}
              >
                Все
                <span className={styles.tabBadge}>{orders.length}</span>
              </button>
              <button
                type="button"
                className={`${styles.filterTabBtn} ${ordersTab === 'active' ? styles.activeFilterTabBtn : ''}`}
                onClick={() => setOrdersTab('active')}
              >
                Активные
                <span className={styles.tabBadge}>{stats.activeOrders}</span>
              </button>
              <button
                type="button"
                className={`${styles.filterTabBtn} ${ordersTab === 'completed' ? styles.activeFilterTabBtn : ''}`}
                onClick={() => setOrdersTab('completed')}
              >
                Выполненные
                <span className={styles.tabBadge}>{stats.completedOrders}</span>
              </button>
              <button
                type="button"
                className={`${styles.filterTabBtn} ${ordersTab === 'cancelled' ? styles.activeFilterTabBtn : ''}`}
                onClick={() => setOrdersTab('cancelled')}
              >
                Отмененные
                <span className={styles.tabBadge}>{stats.cancelledOrders}</span>
              </button>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', color: '#64748b' }}>
              В данном разделе у пользователя нет заказов
            </div>
          ) : (
            <div className={styles.ordersList}>
              {filteredOrders.map(order => {
                const isCancelled = isOrderCancelled(order);
                const isCompleted = isOrderCompleted(order);
                const pickupCode = formatPickupCode(order.pickup_code || getOrderPickupCode(order.id));

                return (
                  <div key={order.id} className={styles.orderCard}>
                    <div className={styles.orderCardHeader}>
                      <Link href={`/admin/orders/${order.id}`} className={styles.orderIdLink}>
                        Заказ №{order.id}
                        <ExternalLink size={14} />
                      </Link>

                      <span className={`${styles.statusBadge} ${
                        isCompleted ? styles.statusCompleted :
                        isCancelled ? styles.statusCancelled :
                        order.fulfillment_status === 'out_for_delivery' ? styles.statusOutForDelivery :
                        order.fulfillment_status === 'ready_for_pickup' ? styles.statusReady :
                        order.fulfillment_status === 'packaging' ? styles.statusPackaging :
                        styles.statusAssembling
                      }`}>
                        {isCompleted ? <CheckCircle size={14} /> : isCancelled ? <XCircle size={14} /> : <Clock size={14} />}
                        {isCompleted ? 'Выдан' :
                         isCancelled ? 'Отменен менеджером' :
                         order.fulfillment_status === 'out_for_delivery' ? 'В доставке' :
                         order.fulfillment_status === 'ready_for_pickup' ? 'Готов к получению' :
                         order.fulfillment_status === 'packaging' ? 'Упаковывается' :
                         'На складе'}
                      </span>
                    </div>

                    <div className={styles.orderCardBody}>
                      <div>
                        <div className={styles.orderDetailsRow}>
                          <strong>Дата:</strong> {new Date(order.created_at).toLocaleString('ru-RU')}
                        </div>
                        <div className={styles.orderDetailsRow}>
                          <strong>Способ:</strong> {order.delivery_method === 'pickup' ? 'Самовывоз (Car City 1 ярус)' : `Доставка: ${order.delivery_address || 'Алматы'}`}
                        </div>
                        {order.kaspi_phone && (
                          <div className={styles.orderDetailsRow} style={{ color: '#b91c1c' }}>
                            <strong>Kaspi Pay:</strong> {order.kaspi_phone}
                          </div>
                        )}

                        <div className={styles.itemsList}>
                          {Array.isArray(order.items) && order.items.map((it: any, idx: number) => (
                            <div key={idx} className={styles.itemRow}>
                              <span>{it.name || it.title} ({it.quantity} шт)</span>
                              <span>{(Number(it.price) * Number(it.quantity)).toLocaleString('ru-RU')} ₸</span>
                            </div>
                          ))}
                        </div>

                        {/* 12-Digit Pickup Code */}
                        <div className={styles.pickupCodeBox}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                            Код получения:
                          </span>
                          <span className={styles.pickupCodeText}>{pickupCode}</span>
                          <button
                            type="button"
                            onClick={() => copyCode(pickupCode, order.id)}
                            style={{
                              border: 'none',
                              background: '#e2e8f0',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            {copiedCodeId === order.id ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                            {copiedCodeId === order.id ? 'Скопирован' : 'Копия'}
                          </button>
                        </div>
                      </div>

                      <div className={styles.orderCardRight}>
                        <div>
                          <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', marginBottom: '2px' }}>
                            Сумма к оплате
                          </div>
                          <div className={styles.orderTotalText}>
                            {Number(order.amount).toLocaleString('ru-RU')} ₸
                          </div>
                        </div>

                        <Link href={`/admin/orders/${order.id}`} className={styles.openOrderBtn}>
                          Открыть заказ
                          <ChevronRight size={15} />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
