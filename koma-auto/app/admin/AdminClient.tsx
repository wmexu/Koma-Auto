'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { 
  Shield, Package, Truck, Users, Tag, Settings, KeyRound, 
  ArrowLeft, CheckCircle, AlertTriangle, Search, Copy, Check, Clock, Eye 
} from 'lucide-react';
import styles from './Admin.module.css';

export default function AdminClient() {
  const { user, userProfile } = useAuthStore();
  const { addToast } = useToastStore();

  const userRole = (userProfile?.role || 'customer') as 'customer' | 'wholesale' | 'courier' | 'manager' | 'director';
  const isStaff = ['courier', 'manager', 'director'].includes(userRole);
  const isDirector = userRole === 'director';
  const isManager = userRole === 'manager' || isDirector;
  const isCourier = userRole === 'courier';

  // Active tab in panel
  const [activeTab, setActiveTab] = useState<'orders' | 'promocodes' | 'users' | 'tokens' | 'settings'>('orders');

  // Orders state
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [period, setPeriod] = useState<'30' | '60' | '360' | 'all'>('30');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [couriersList, setCouriersList] = useState<any[]>([]);

  // Modals state
  const [verifyingOrder, setVerifyingOrder] = useState<any | null>(null);
  const [pickupCodeInput, setPickupCodeInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const [assigningOrder, setAssigningOrder] = useState<any | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState('');

  // Kill Switch & Warehouse state
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [activeWarehouse, setActiveWarehouse] = useState('Car City 1 ярус Подвал');

  // Promocodes state
  const [promocodes, setPromocodes] = useState<any[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoType, setPromoType] = useState<'percent' | 'fixed'>('percent');
  const [promoValue, setPromoValue] = useState<number>(10);
  const [minCartTotal, setMinCartTotal] = useState<number>(15000);
  const [maxDiscount, setMaxDiscount] = useState<number>(10000);
  const [promoAudience, setPromoAudience] = useState<'all' | 'retail' | 'wholesale'>('all');
  const [boundUserSearch, setBoundUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [searchedUsers, setSearchedUsers] = useState<any[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);

  // Users state
  const [usersList, setUsersList] = useState<any[]>([]);
  const [userAudienceFilter, setUserAudienceFilter] = useState<'all' | 'retail' | 'wholesale'>('all');
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Tokens state
  const [tokensList, setTokensList] = useState<any[]>([]);
  const [tokenRole, setTokenRole] = useState<'courier' | 'manager' | 'director'>('courier');
  const [tokenBoundEmail, setTokenBoundEmail] = useState('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Fetch initial system settings
  useEffect(() => {
    fetch('/api/admin/settings')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.settings) {
          setKillSwitchActive(Boolean(data.settings.killSwitchActive));
          if (data.settings.activeWarehouse?.name) {
            setActiveWarehouse(data.settings.activeWarehouse.name);
          }
        }
      })
      .catch(console.error);
  }, []);

  // Fetch couriers list for assignment
  useEffect(() => {
    if (isManager) {
      fetch('/api/admin/couriers')
        .then(res => res.json())
        .then(data => {
          if (data.success) setCouriersList(data.couriers || []);
        })
        .catch(console.error);
    }
  }, [isManager]);

  // Load orders
  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const url = `/api/admin/orders?period=${period}&role=${userRole}&userId=${user?.uid || ''}&status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
      }
    } catch (e) {
      console.error('Failed to load orders:', e);
    } finally {
      setOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (isStaff) {
      loadOrders();
    }
  }, [isStaff, period, statusFilter, userRole, user?.uid]);

  // Load promocodes when on tab
  useEffect(() => {
    if (activeTab === 'promocodes' && isDirector) {
      fetch('/api/admin/promocodes')
        .then(res => res.json())
        .then(data => {
          if (data.success) setPromocodes(data.promocodes || []);
        });
    }
  }, [activeTab, isDirector]);

  // Load users when on tab
  const loadUsers = () => {
    if (!isDirector) return;
    fetch(`/api/admin/users?audience=${userAudienceFilter}&q=${encodeURIComponent(userSearchQuery)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setUsersList(data.users || []);
      });
  };

  useEffect(() => {
    if (activeTab === 'users' && isDirector) {
      loadUsers();
    }
  }, [activeTab, userAudienceFilter, userSearchQuery, isDirector]);

  // Load tokens when on tab
  const loadTokens = () => {
    if (!isDirector) return;
    fetch('/api/admin/tokens')
      .then(res => res.json())
      .then(data => {
        if (data.success) setTokensList(data.tokens || []);
      });
  };

  useEffect(() => {
    if (activeTab === 'tokens' && isDirector) {
      loadTokens();
    }
  }, [activeTab, isDirector]);

  // Autocomplete search for user email
  useEffect(() => {
    if (!boundUserSearch.trim() || selectedUser) {
      setSearchedUsers([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearchingUsers(true);
      fetch(`/api/admin/users?q=${encodeURIComponent(boundUserSearch)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) setSearchedUsers(data.users || []);
        })
        .finally(() => setIsSearchingUsers(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [boundUserSearch, selectedUser]);

  // Handle Verify 12-digit code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyingOrder || !pickupCodeInput) return;

    setIsVerifying(true);
    try {
      const res = await fetch('/api/orders/verify-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: verifyingOrder.id,
          code: pickupCodeInput,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ошибка проверки кода');
      }

      addToast('Заказ успешно верифицирован и выдан клиенту!', 'success');
      setVerifyingOrder(null);
      setPickupCodeInput('');
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Неверный код получения', 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  // Handle Assign courier
  const handleAssignCourier = async () => {
    if (!assigningOrder || !selectedCourierId) return;

    const courier = couriersList.find(c => c.id === selectedCourierId);
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign_courier',
          orderId: assigningOrder.id,
          courierId: selectedCourierId,
          courierName: courier?.full_name || courier?.email,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка назначения');

      addToast(data.message || 'Курьер успешно назначен!', 'success');
      setAssigningOrder(null);
      setSelectedCourierId('');
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка назначения курьера', 'error');
    }
  };

  // Handle Kill Switch Toggle
  const handleToggleKillSwitch = async () => {
    const nextState = !killSwitchActive;
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'kill_switch_active',
          value: nextState,
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setKillSwitchActive(nextState);
        addToast(nextState ? 'Приём новых заказов заблокирован' : 'Приём заказов возобновлен', nextState ? 'error' : 'success');
      }
    } catch (e) {
      addToast('Ошибка переключения', 'error');
    }
  };

  // Handle Create Promocode
  const handleCreatePromocode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) {
      addToast('Введите код купона', 'error');
      return;
    }

    try {
      const res = await fetch('/api/admin/promocodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: promoCode,
          type: promoType,
          value: promoValue,
          minCartTotal,
          maxDiscount: promoType === 'percent' ? maxDiscount : null,
          targetAudience: promoAudience,
          boundUserId: selectedUser?.id || null,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка');

      addToast(data.message || 'Промокод создан!', 'success');
      setPromoCode('');
      setSelectedUser(null);
      setBoundUserSearch('');
      // Refresh list
      fetch('/api/admin/promocodes').then(r => r.json()).then(d => setPromocodes(d.promocodes || []));
    } catch (err: any) {
      addToast(err.message || 'Ошибка создания промокода', 'error');
    }
  };

  // Handle Delete Promocode
  const handleDeletePromocode = async (id: string) => {
    if (!confirm('Удалить данный промокод?')) return;
    try {
      const res = await fetch(`/api/admin/promocodes?id=${id}&staffUserId=${user?.uid}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        addToast('Промокод удален', 'success');
        setPromocodes(prev => prev.filter(p => p.id !== id));
      }
    } catch {
      addToast('Ошибка удаления', 'error');
    }
  };

  // Handle Change User Role
  const handleChangeUserRole = async (targetUserId: string, newRole: string) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId,
          newRole,
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (data.success) {
        addToast(data.message || 'Роль изменена', 'success');
        loadUsers();
      }
    } catch {
      addToast('Ошибка изменения роли', 'error');
    }
  };

  // Handle Generate 24-character Token
  const handleGenerateToken = async () => {
    try {
      const res = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: tokenRole,
          boundEmail: tokenBoundEmail || null,
          expiresInDays: 14,
          staffUserId: user?.uid,
        }),
      });
      const data = await res.json();
      if (data.success) {
        addToast(`Шифр успешно сгенерирован: ${data.token}`, 'success');
        setTokenBoundEmail('');
        loadTokens();
      }
    } catch {
      addToast('Ошибка генерации шифра', 'error');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(text);
    addToast('Шифр скопирован в буфер', 'success');
    setTimeout(() => setCopiedToken(null), 2000);
  };

  if (!isStaff) {
    return (
      <div className={styles.adminContainer}>
        <div className={styles.adminWrapper} style={{ textAlign: 'center', paddingTop: '80px' }}>
          <Shield size={48} color="var(--color-navy)" style={{ marginBottom: '16px' }} />
          <h1 style={{ color: 'var(--color-navy)', fontSize: '24px', fontWeight: 800 }}>
            Доступ в управляющую панель ограничен
          </h1>
          <p style={{ color: '#64748b', maxWidth: '460px', margin: '12px auto 24px auto' }}>
            Для доступа к CRM-системе Koma Auto необходимо активировать 24-значный шифр сотрудника (Курьер, Менеджер или Директор) в личном кабинете.
          </p>
          <Link href="/profile" className={styles.backBtn} style={{ padding: '12px 24px', fontSize: '15px' }}>
            <ArrowLeft size={18} />
            Перейти в личный кабинет для ввода шифра
          </Link>
        </div>
      </div>
    );
  }

  const roleLabels = {
    director: 'Директор (SuperAdmin)',
    manager: 'Менеджер склада',
    courier: 'Курьер доставки',
    wholesale: 'Оптовый покупатель',
    customer: 'Розничный покупатель',
  };

  const roleBadgeClass = {
    director: styles.roleDirector,
    manager: styles.roleManager,
    courier: styles.roleCourier,
    wholesale: '',
    customer: '',
  };

  return (
    <div className={styles.adminContainer}>
      <div className={styles.adminWrapper}>
        {/* Top Bar */}
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <h1>
              KOMA AUTO CRM
              <span className={`${styles.roleBadge} ${roleBadgeClass[userRole]}`}>
                {roleLabels[userRole]}
              </span>
            </h1>
            <p className={styles.topBarSubtitle}>
              Авторизован: {userProfile?.name || user?.displayName || user?.email} ({user?.email}) • Склад: {activeWarehouse}
            </p>
          </div>
          <div className={styles.topBarActions}>
            <Link href="/profile" className={styles.backBtn}>
              <ArrowLeft size={16} />
              В профиль
            </Link>
          </div>
        </div>

        {/* Kill Switch (Director Only) */}
        {isDirector && (
          <div className={`${styles.killSwitchBanner} ${killSwitchActive ? '' : styles.killSwitchInactive}`}>
            <div className={styles.killSwitchInfo}>
              <AlertTriangle size={20} />
              <div>
                <strong>{killSwitchActive ? 'ВНИМАНИЕ: Приём новых заказов ЗАБЛОКИРОВАН' : 'Приём заказов на сайте работает в штатном режиме'}</strong>
                <div style={{ fontSize: '12px', marginTop: '2px', opacity: 0.85 }}>
                  {killSwitchActive
                    ? 'Покупатели видят предупреждение в корзине и чекауте, новые платежи не создаются.'
                    : 'Покупатели могут свободно оформлять заказы с доставкой или самовывозом.'}
                </div>
              </div>
            </div>
            <button
              type="button"
              className={killSwitchActive ? styles.killSwitchEnableBtn : styles.killSwitchToggleBtn}
              onClick={handleToggleKillSwitch}
            >
              {killSwitchActive ? 'Возобновить приём заказов' : 'Экстренно заблокировать заказы'}
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className={styles.tabsNav}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'orders' ? styles.activeTabBtn : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            <Package size={16} />
            {isCourier ? 'Мои доставки' : 'Заказы'}
          </button>

          {isDirector && (
            <>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'promocodes' ? styles.activeTabBtn : ''}`}
                onClick={() => setActiveTab('promocodes')}
              >
                <Tag size={16} />
                Промокоды
              </button>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'users' ? styles.activeTabBtn : ''}`}
                onClick={() => setActiveTab('users')}
              >
                <Users size={16} />
                Пользователи
              </button>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'tokens' ? styles.activeTabBtn : ''}`}
                onClick={() => setActiveTab('tokens')}
              >
                <KeyRound size={16} />
                Шифры доступа
              </button>
            </>
          )}
        </div>

        {/* TAB 1: ORDERS */}
        {activeTab === 'orders' && (
          <div>
            {/* Filters */}
            <div className={styles.sectionFilters}>
              {isManager && (
                <div className={styles.filterGroup}>
                  <span className={styles.filterLabel}>Период:</span>
                  {(['30', '60', '360', 'all'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      className={`${styles.filterPill} ${period === p ? styles.activeFilterPill : ''}`}
                      onClick={() => setPeriod(p)}
                    >
                      {p === 'all' ? 'За все время' : `За ${p} дней`}
                    </button>
                  ))}
                </div>
              )}

              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Статус:</span>
                {[
                  { id: 'all', label: 'Все' },
                  { id: 'assembling', label: 'В сборке' },
                  { id: 'out_for_delivery', label: isCourier ? 'К доставке' : 'Выдан курьеру' },
                  { id: 'ready_for_pickup', label: 'Готов к получению' },
                  { id: 'completed', label: 'Выдан' },
                ].map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`${styles.filterPill} ${statusFilter === s.id ? styles.activeFilterPill : ''}`}
                    onClick={() => setStatusFilter(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Orders List */}
            {ordersLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                Загрузка заказов...
              </div>
            ) : orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b' }}>
                Заказов не найдено по выбранным фильтрам
              </div>
            ) : (
              <div className={styles.ordersGrid}>
                {orders.map(order => (
                  <div key={order.id} className={styles.orderCard}>
                    <div className={styles.orderCardHeader}>
                      <div className={styles.orderIdBlock}>
                        <span className={styles.orderNumber}>Заказ №{order.id}</span>
                        <span className={`${styles.statusBadge} ${
                          order.fulfillment_status === 'completed' ? styles.statusCompleted :
                          order.fulfillment_status === 'out_for_delivery' ? styles.statusOutForDelivery :
                          order.fulfillment_status === 'ready_for_pickup' ? styles.statusReady :
                          order.fulfillment_status === 'cancelled' ? styles.statusCancelled :
                          styles.statusAssembling
                        }`}>
                          {order.fulfillment_status === 'completed' ? 'Выдан' :
                           order.fulfillment_status === 'out_for_delivery' ? 'Выдан курьеру' :
                           order.fulfillment_status === 'ready_for_pickup' ? 'Готов к получению' :
                           order.fulfillment_status === 'cancelled' ? 'Отменен' :
                           'В сборке'}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#64748b' }}>
                        {new Date(order.created_at).toLocaleString('ru-RU')}
                      </div>
                    </div>

                    <div className={styles.orderCardBody}>
                      <div>
                        <div className={styles.customerInfoTitle}>Получатель</div>
                        <p className={styles.customerInfoText}>
                          <strong>{order.customer_name}</strong> • {order.customer_phone}
                        </p>
                        <p className={styles.customerInfoText} style={{ color: '#475569' }}>
                          Способ: {order.delivery_method === 'pickup' ? 'Самовывоз (Car City 1 ярус)' : `Доставка: ${order.delivery_address || 'Алматы'}`}
                        </p>
                        {order.kaspi_phone && (
                          <p className={styles.customerInfoText} style={{ color: '#b91c1c' }}>
                            Телефон Kaspi Pay: {order.kaspi_phone}
                          </p>
                        )}

                        <div className={styles.orderItemsList}>
                          {Array.isArray(order.items) && order.items.map((it: any, idx: number) => (
                            <div key={idx} className={styles.orderItemRow}>
                              <span>{it.name || it.title} ({it.quantity} шт)</span>
                              <span>{(Number(it.price) * Number(it.quantity)).toLocaleString('ru-RU')} ₸</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className={styles.orderCardRight}>
                        <div>
                          <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' }}>Сумма к оплате</div>
                          <div className={styles.orderAmountText}>{Number(order.amount).toLocaleString('ru-RU')} ₸</div>
                        </div>

                        <div className={styles.actionButtons}>
                          {order.fulfillment_status !== 'completed' && (
                            <button
                              type="button"
                              className={styles.verifyCodeBtn}
                              onClick={() => {
                                setVerifyingOrder(order);
                                setPickupCodeInput('');
                              }}
                            >
                              <KeyRound size={15} />
                              Ввести 12-значный код
                            </button>
                          )}

                          {isManager && order.delivery_method === 'courier' && order.fulfillment_status !== 'completed' && (
                            <button
                              type="button"
                              className={styles.assignBtn}
                              onClick={() => {
                                setAssigningOrder(order);
                                setSelectedCourierId(order.assigned_courier_id || '');
                              }}
                            >
                              <Truck size={15} />
                              {order.assigned_courier_id ? 'Сменить курьера' : 'Передать курьеру'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PROMOCODES (Director Only) */}
        {activeTab === 'promocodes' && isDirector && (
          <div>
            <div className={styles.sectionFilters} style={{ display: 'block' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-navy)', margin: '0 0 16px 0' }}>
                Создать новый промокод
              </h2>
              <form onSubmit={handleCreatePromocode}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                      Код купона
                    </label>
                    <input
                      type="text"
                      className={styles.inputField}
                      placeholder="Например: KOMA10 или VIP2026"
                      value={promoCode}
                      onChange={e => setPromoCode(e.target.value.toUpperCase())}
                      style={{ textTransform: 'uppercase', fontWeight: 700 }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                      Тип скидки
                    </label>
                    <select
                      className={styles.inputField}
                      value={promoType}
                      onChange={e => setPromoType(e.target.value as any)}
                    >
                      <option value="percent">В процентах (%)</option>
                      <option value="fixed">Фиксированная сумма (₸)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                      Размер скидки: {promoType === 'percent' ? `${promoValue}%` : `${promoValue.toLocaleString()} ₸`}
                    </label>
                    <input
                      type="range"
                      min={promoType === 'percent' ? 1 : 500}
                      max={promoType === 'percent' ? 30 : 50000}
                      step={promoType === 'percent' ? 1 : 500}
                      value={promoValue}
                      onChange={e => setPromoValue(Number(e.target.value))}
                      style={{ width: '100%', marginTop: '8px' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                      Мин. корзина: {minCartTotal.toLocaleString()} ₸
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={150000}
                      step={5000}
                      value={minCartTotal}
                      onChange={e => setMinCartTotal(Number(e.target.value))}
                      style={{ width: '100%', marginTop: '8px' }}
                    />
                  </div>

                  {promoType === 'percent' && (
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                        Потолок скидки: {maxDiscount.toLocaleString()} ₸
                      </label>
                      <input
                        type="range"
                        min={2000}
                        max={100000}
                        step={2000}
                        value={maxDiscount}
                        onChange={e => setMaxDiscount(Number(e.target.value))}
                        style={{ width: '100%', marginTop: '8px' }}
                      />
                    </div>
                  )}

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                      Для кого
                    </label>
                    <select
                      className={styles.inputField}
                      value={promoAudience}
                      onChange={e => setPromoAudience(e.target.value as any)}
                    >
                      <option value="all">Все покупатели</option>
                      <option value="retail">Только Розничные</option>
                      <option value="wholesale">Только Оптовые</option>
                    </select>
                  </div>
                </div>

                {/* Margin Warning */}
                {promoType === 'percent' && promoValue >= 10 && (
                  <div className={styles.warningCallout}>
                    <AlertTriangle size={18} />
                    <span>
                      <strong>Контроль маржинальности:</strong> Скидка {promoValue}% (от 10% и выше) может снизить рентабельность автозапчастей. Убедитесь, что установлен адекватный порог минимальной корзины ({minCartTotal.toLocaleString()} ₸).
                    </span>
                  </div>
                )}

                {/* Exclusive User Selection with Autocomplete */}
                <div className={styles.autocompleteWrapper}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                    Привязать к конкретному пользователю (необязательно)
                  </label>
                  {selectedUser ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px' }}>
                      <span>Выбран: <strong>{selectedUser.email}</strong> ({selectedUser.full_name || 'Без имени'})</span>
                      <button
                        type="button"
                        onClick={() => setSelectedUser(null)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}
                      >
                        Открепить
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        className={styles.inputField}
                        placeholder="Начните вводить email для поиска (например aco)..."
                        value={boundUserSearch}
                        onChange={e => setBoundUserSearch(e.target.value)}
                        style={{ margin: 0 }}
                      />
                      {searchedUsers.length > 0 && (
                        <div className={styles.autocompleteList}>
                          {searchedUsers.map(u => (
                            <div
                              key={u.id}
                              className={styles.autocompleteItem}
                              onClick={() => {
                                setSelectedUser(u);
                                setBoundUserSearch('');
                                setSearchedUsers([]);
                              }}
                            >
                              <span>{u.email} ({u.full_name || 'Покупатель'})</span>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                {u.role === 'wholesale' ? 'Оптовик' : 'Розница'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <button type="submit" className={styles.submitBtn} style={{ marginTop: '10px' }}>
                  Создать промокод
                </button>
              </form>
            </div>

            {/* List of active promocodes */}
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Скидка</th>
                  <th>Мин. заказ</th>
                  <th>Аудитория</th>
                  <th>Привязан к Email</th>
                  <th>Использован</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {promocodes.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.code}</strong></td>
                    <td>{p.type === 'percent' ? `${p.value}%` : `${Number(p.value).toLocaleString()} ₸`}</td>
                    <td>{Number(p.min_cart_total).toLocaleString()} ₸</td>
                    <td>{p.target_audience === 'wholesale' ? 'Оптовики' : p.target_audience === 'retail' ? 'Розница' : 'Все'}</td>
                    <td>{p.bound_user_email || '—'}</td>
                    <td>{p.used_count} раз</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDeletePromocode(p.id)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: USERS (Director Only) */}
        {activeTab === 'users' && isDirector && (
          <div>
            <div className={styles.sectionFilters}>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Аудитория:</span>
                {(['all', 'retail', 'wholesale'] as const).map(a => (
                  <button
                    key={a}
                    type="button"
                    className={`${styles.filterPill} ${userAudienceFilter === a ? styles.activeFilterPill : ''}`}
                    onClick={() => setUserAudienceFilter(a)}
                  >
                    {a === 'all' ? 'Все' : a === 'retail' ? 'Розничные' : 'Оптовые'}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={16} color="#64748b" />
                <input
                  type="text"
                  placeholder="Поиск по email, имени или телефону..."
                  value={userSearchQuery}
                  onChange={e => setUserSearchQuery(e.target.value)}
                  className={styles.inputField}
                  style={{ width: '280px', margin: 0 }}
                />
              </div>
            </div>

            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Email (Username)</th>
                  <th>Имя</th>
                  <th>Телефон</th>
                  <th>Текущая роль</th>
                  <th>Заказов</th>
                  <th>Дата регистрации</th>
                  <th>Сменить роль</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.email}</strong></td>
                    <td>{u.full_name || '—'}</td>
                    <td>{u.phone || '—'}</td>
                    <td>
                      <span className={`${styles.roleBadge} ${roleBadgeClass[u.role as keyof typeof roleBadgeClass] || ''}`}>
                        {roleLabels[u.role as keyof typeof roleLabels] || u.role}
                      </span>
                    </td>
                    <td>{u.orders_count || 0}</td>
                    <td>{new Date(u.created_at).toLocaleDateString('ru-RU')}</td>
                    <td>
                      <select
                        value={u.role}
                        onChange={e => handleChangeUserRole(u.id, e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                      >
                        <option value="customer">Розничный</option>
                        <option value="wholesale">Оптовый</option>
                        <option value="courier">Курьер</option>
                        <option value="manager">Менеджер</option>
                        <option value="director">Директор</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: INVITE TOKENS (Director Only) */}
        {activeTab === 'tokens' && isDirector && (
          <div>
            <div className={styles.sectionFilters} style={{ display: 'block' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-navy)', margin: '0 0 14px 0' }}>
                Сгенерировать 24-значный одноразовый шифр сотрудника
              </h2>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={tokenRole}
                  onChange={e => setTokenRole(e.target.value as any)}
                  className={styles.inputField}
                  style={{ width: '220px', margin: 0 }}
                >
                  <option value="courier">Для Курьера</option>
                  <option value="manager">Для Менеджера</option>
                  <option value="director">Для Директора</option>
                </select>

                <input
                  type="email"
                  placeholder="Опционально: привязать к Email сотрудника..."
                  value={tokenBoundEmail}
                  onChange={e => setTokenBoundEmail(e.target.value)}
                  className={styles.inputField}
                  style={{ width: '320px', margin: 0 }}
                />

                <button type="button" className={styles.submitBtn} onClick={handleGenerateToken}>
                  Сгенерировать шифр
                </button>
              </div>
            </div>

            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>24-значный шифр</th>
                  <th>Роль</th>
                  <th>Привязан к Email</th>
                  <th>Статус</th>
                  <th>Использован</th>
                  <th>Действует до</th>
                  <th>Копировать</th>
                </tr>
              </thead>
              <tbody>
                {tokensList.map(t => (
                  <tr key={t.id}>
                    <td>
                      <code style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-navy)' }}>
                        {t.token}
                      </code>
                    </td>
                    <td>
                      <span className={`${styles.roleBadge} ${roleBadgeClass[t.role as keyof typeof roleBadgeClass] || ''}`}>
                        {roleLabels[t.role as keyof typeof roleLabels] || t.role}
                      </span>
                    </td>
                    <td>{t.bound_email || 'Для любого'}</td>
                    <td>
                      {t.is_revoked ? (
                        <span style={{ color: '#ef4444', fontWeight: 700 }}>Отозван</span>
                      ) : t.used_at ? (
                        <span style={{ color: '#10b981', fontWeight: 700 }}>Использован</span>
                      ) : new Date(t.expires_at) < new Date() ? (
                        <span style={{ color: '#64748b' }}>Истек</span>
                      ) : (
                        <span style={{ color: '#0284c7', fontWeight: 700 }}>Активен (одноразовый)</span>
                      )}
                    </td>
                    <td>{t.used_by_email || '—'}</td>
                    <td>{new Date(t.expires_at).toLocaleDateString('ru-RU')}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(t.token)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                      >
                        {copiedToken === t.token ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        {copiedToken === t.token ? 'Скопировано' : 'Копировать'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* MODAL 1: VERIFY 12-DIGIT PICKUP CODE */}
        {verifyingOrder && (
          <div className={styles.modalOverlay} onClick={() => !isVerifying && setVerifyingOrder(null)}>
            <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Верификация кода получения</h3>
              <p className={styles.modalDesc}>
                Клиент должен показать 12-значный код в электронном чеке на своем смартфоне. Введите эти 12 цифр для сверки:
              </p>

              <form onSubmit={handleVerifyCode}>
                <input
                  type="text"
                  maxLength={14}
                  placeholder="7492 1058 3824"
                  value={pickupCodeInput}
                  onChange={e => {
                    const clean = e.target.value.replace(/\D/g, '').slice(0, 12);
                    setPickupCodeInput(clean);
                  }}
                  className={`${styles.inputField} ${styles.codeInputLarge}`}
                  autoFocus
                  required
                />

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setVerifyingOrder(null)}
                    disabled={isVerifying}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className={styles.submitBtn}
                    disabled={isVerifying || pickupCodeInput.replace(/\D/g, '').length !== 12}
                  >
                    {isVerifying ? 'Сверка...' : 'Подтвердить выдачу'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 2: ASSIGN COURIER */}
        {assigningOrder && (
          <div className={styles.modalOverlay} onClick={() => setAssigningOrder(null)}>
            <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Передать заказ курьеру</h3>
              <p className={styles.modalDesc}>
                Заказ №{assigningOrder.id} ({assigningOrder.customer_name}, {Number(assigningOrder.amount).toLocaleString()} ₸).
                Выберите курьера для назначения:
              </p>

              <select
                className={styles.inputField}
                value={selectedCourierId}
                onChange={e => setSelectedCourierId(e.target.value)}
              >
                <option value="">-- Выберите курьера --</option>
                {couriersList.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.full_name || 'Курьер'} ({c.email}) {c.phone ? `• ${c.phone}` : ''}
                  </option>
                ))}
              </select>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setAssigningOrder(null)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className={styles.submitBtn}
                  disabled={!selectedCourierId}
                  onClick={handleAssignCourier}
                >
                  Закрепить за курьером
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
