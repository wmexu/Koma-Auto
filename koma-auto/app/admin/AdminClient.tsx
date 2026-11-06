'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { 
  Shield, Package, Truck, Users, Tag, Settings, KeyRound, 
  ArrowLeft, CheckCircle, AlertTriangle, Search, Copy, Check, Clock, Eye,
  MoreVertical, Archive, XCircle, X, RotateCcw, Trash2, Lock, RefreshCw,
  Calendar, ChevronLeft, ChevronRight, CreditCard
} from 'lucide-react';
import { formatPickupCode, getOrderPickupCode } from '@/lib/pickup-code';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import styles from './Admin.module.css';

export default function AdminClient() {
  const router = useRouter();
  const { user, userProfile, setUserProfile } = useAuthStore();
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
  const [period, setPeriod] = useState<'30' | '60' | '360' | 'all' | 'custom'>('30');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [couriersList, setCouriersList] = useState<any[]>([]);
  const [courierSearchQuery, setCourierSearchQuery] = useState('');
  const [isLoadingCouriers, setIsLoadingCouriers] = useState(false);

  // Orders search & sub-tab state (Default is 'active', 2nd tab as requested)
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderSubTab, setOrderSubTab] = useState<'active' | 'kaspi' | 'pending_payment' | 'cancelled' | 'archive'>('active');
  const [activeMenuOrderId, setActiveMenuOrderId] = useState<string | null>(null);

  // Live timer for 20-minute payment countdown
  const [currentTime, setCurrentTime] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatOrderRemainingTime = (createdAt: string) => {
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

  // Date range picker modal state (Default reference today is 05.11.2026)
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [pickerStartDate, setPickerStartDate] = useState<Date | null>(new Date(2026, 10, 1));
  const [pickerEndDate, setPickerEndDate] = useState<Date | null>(new Date(2026, 10, 5));
  const [appliedDateRange, setAppliedDateRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [scrollRatio, setScrollRatio] = useState(0);

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);

  // Generate 5 years (60 months) from November 2026 back to December 2021
  const monthsList = React.useMemo(() => {
    const list: Array<{ year: number; month: number; name: string }> = [];
    let y = 2026;
    let m = 10;
    for (let i = 0; i < 60; i++) {
      const d = new Date(y, m, 1);
      const name = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/^./, str => str.toUpperCase());
      list.push({ year: y, month: m, name });
      m--;
      if (m < 0) {
        m = 11;
        y--;
      }
    }
    return list;
  }, []);

  const handleContainerScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll > 0) {
      setScrollRatio(scrollTop / maxScroll);
    } else {
      setScrollRatio(0);
    }
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!trackRef.current || !scrollContainerRef.current) return;

    const trackRect = trackRef.current.getBoundingClientRect();
    const updateScroll = (clientY: number) => {
      const relY = clientY - trackRect.top;
      const ratio = Math.max(0, Math.min(1, relY / trackRect.height));
      setScrollRatio(ratio);
      if (scrollContainerRef.current) {
        const maxScroll = scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight;
        scrollContainerRef.current.scrollTop = ratio * maxScroll;
      }
    };

    updateScroll(e.clientY);

    const handlePointerMove = (ev: PointerEvent) => {
      updateScroll(ev.clientY);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleDayClick = (year: number, month: number, day: number) => {
    const clickedDate = new Date(year, month, day, 0, 0, 0);

    if (!pickerStartDate || (pickerStartDate && pickerEndDate)) {
      setPickerStartDate(clickedDate);
      setPickerEndDate(null);
    } else {
      if (clickedDate < pickerStartDate) {
        setPickerEndDate(pickerStartDate);
        setPickerStartDate(clickedDate);
      } else {
        setPickerEndDate(new Date(year, month, day, 23, 59, 59));
      }
    }
  };

  // Deleted orders & settings view
  const [settingsSubView, setSettingsSubView] = useState<'general' | 'deleted'>('general');
  const [deletedOrders, setDeletedOrders] = useState<any[]>([]);
  const [deletedOrdersLoading, setDeletedOrdersLoading] = useState(false);

  // Modals state
  const [verifyingOrder, setVerifyingOrder] = useState<any | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const [assigningOrder, setAssigningOrder] = useState<any | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState('');

  // Kill Switch & Warehouse state
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [isKillSwitchModalOpen, setIsKillSwitchModalOpen] = useState(false);
  const [activeWarehouse, setActiveWarehouse] = useState('Car City 1 ярус Подвал');

  // Promocodes state
  const [promocodes, setPromocodes] = useState<any[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoType, setPromoType] = useState<'percent' | 'fixed'>('percent');
  const [promoValue, setPromoValue] = useState<number>(1);
  const [minCartTotal, setMinCartTotal] = useState<number>(15000);
  const [maxCartTotal, setMaxCartTotal] = useState<number | ''>('');
  const [maxDiscount, setMaxDiscount] = useState<number>(15000);
  const [promoAudience, setPromoAudience] = useState<'all' | 'retail' | 'wholesale'>('all');
  const [boundUserSearch, setBoundUserSearch] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<any[]>([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [searchedUsers, setSearchedUsers] = useState<any[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [isBoundSearchFocused, setIsBoundSearchFocused] = useState(false);
  const [isPromoConfigModalOpen, setIsPromoConfigModalOpen] = useState(false);

  // Users state
  const [usersList, setUsersList] = useState<any[]>([]);
  const [userAudienceFilter, setUserAudienceFilter] = useState<'all' | 'retail' | 'wholesale' | 'courier' | 'manager' | 'director'>('all');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [isSyncingFirebase, setIsSyncingFirebase] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  // Tokens state
  const [tokensList, setTokensList] = useState<any[]>([]);
  const [tokenRole, setTokenRole] = useState<'courier' | 'manager' | 'director'>('courier');
  const [tokenBoundEmail, setTokenBoundEmail] = useState('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Authenticated fetch helper for admin / staff CRM endpoints with Google ID token
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

  // Fetch initial system settings
  useEffect(() => {
    adminFetch('/api/admin/settings')
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
  }, [user?.uid]);

  // Fetch couriers list for assignment
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
      console.error('[AdminClient] Failed to load couriers:', err);
    } finally {
      setIsLoadingCouriers(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (isManager && user?.uid) {
      loadCouriers();
    }
  }, [isManager, user?.uid, loadCouriers]);

  // Load orders (supports silent background reload without UI flicker)
  const loadOrders = async (silent = false) => {
    if (!user?.uid) return;
    if (!silent) setOrdersLoading(true);
    try {
      const url = appliedDateRange.start
        ? `/api/admin/orders?period=custom&startDate=${encodeURIComponent(appliedDateRange.start)}&endDate=${encodeURIComponent(appliedDateRange.end || appliedDateRange.start)}&role=${userRole}&userId=${user?.uid || ''}&status=${statusFilter}&includeDeleted=true`
        : `/api/admin/orders?period=${period}&role=${userRole}&userId=${user?.uid || ''}&status=${statusFilter}&includeDeleted=true`;
      const res = await adminFetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.orders)) {
        setOrders(prev => {
          if (JSON.stringify(prev) === JSON.stringify(data.orders)) {
            return prev;
          }
          return data.orders;
        });
      }
    } catch (e) {
      console.error('Failed to load orders:', e);
    } finally {
      if (!silent) setOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (isStaff && user?.uid) {
      loadOrders();
      loadDeletedOrders();
    }
  }, [isStaff, period, statusFilter, userRole, user?.uid, appliedDateRange.start, appliedDateRange.end]);

  // Live global server search for orders across all time and all statuses (including deleted)
  useEffect(() => {
    const cleanQ = orderSearchQuery.trim();
    if (!cleanQ || cleanQ.length < 2 || !isStaff || !user?.uid) return;

    const timer = setTimeout(async () => {
      try {
        const res = await adminFetch(`/api/admin/orders?q=${encodeURIComponent(cleanQ)}&role=${userRole}&userId=${user?.uid || ''}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.orders)) {
          setOrders(prev => {
            const map = new Map<string, any>();
            prev.forEach((o: any) => map.set(o.id, o));
            data.orders.forEach((o: any) => map.set(o.id, o));
            return Array.from(map.values());
          });
        }
      } catch (err) {
        console.warn('Orders search fetch error:', err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [orderSearchQuery, isStaff, user?.uid, userRole]);

  // Real-time auto-refresh: poll every 5 seconds & on window focus/tab visibility
  useEffect(() => {
    if (!isStaff || !user?.uid) return;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (activeTab === 'orders') {
          loadOrders(true);
        } else if (activeTab === 'users' && isDirector) {
          loadUsers();
        }
      }
    }, 5000);

    const handleFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (activeTab === 'orders') {
          loadOrders(true);
        } else if (activeTab === 'users' && isDirector) {
          loadUsers();
        }
      }
    };

    window.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isStaff, isDirector, activeTab, user?.uid, period, statusFilter, userRole, userAudienceFilter, userSearchQuery]);

  // Load promocodes when on tab
  useEffect(() => {
    if (activeTab === 'promocodes' && isDirector && user?.uid) {
      adminFetch('/api/admin/promocodes')
        .then(res => res.json())
        .then(data => {
          if (data.success) setPromocodes(data.promocodes || []);
        });
    }
  }, [activeTab, isDirector, user?.uid]);

  // Batch discovery and sync of users from Firebase Firestore into Neon PostgreSQL
  const handleSyncFromFirebase = async (showToast = true) => {
    if (!isDirector || !user?.uid) return;
    setIsSyncingFirebase(true);

    try {
      // 1. Direct discovery from Firestore users collection
      const usersSnap = await getDocs(collection(db, 'users'));
      const foundUsers: any[] = [];
      usersSnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data && data.email) {
          foundUsers.push({
            id: docSnap.id,
            email: data.email,
            fullName: data.name || data.fullName || null,
            phone: data.phone || null,
            role: data.role || (data.clientType === 'wholesale' ? 'wholesale' : 'customer'),
            createdAt: data.createdAt || null,
          });
        }
      });

      if (foundUsers.length > 0) {
        const res = await adminFetch('/api/admin/users/sync-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ users: foundUsers }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (showToast) {
            addToast(`Синхронизировано ${data.processed} пользователей из Firebase!`, 'success');
          }
        } else if (showToast) {
          addToast(data.error || 'Ошибка синхронизации пользователей', 'error');
        }
      } else if (showToast) {
        addToast('Новых пользователей в Firebase не обнаружено', 'info');
      }

      await loadUsers();
    } catch (err: any) {
      console.warn('[SyncFromFirebase Error]:', err);
      if (showToast) {
        addToast('Ошибка синхронизации Firebase: ' + (err?.message || 'Ошибка доступа'), 'error');
      }
      await loadUsers();
    } finally {
      setIsSyncingFirebase(false);
    }
  };

  // Load users from PostgreSQL
  const loadUsers = async () => {
    if (!isDirector || !user?.uid) return;

    adminFetch(`/api/admin/users?audience=${userAudienceFilter}&q=${encodeURIComponent(userSearchQuery)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setUsersList(data.users || []);
      })
      .catch(console.error);
  };

  useEffect(() => {
    if (activeTab === 'users' && isDirector && user?.uid) {
      loadUsers();
    }
  }, [activeTab, userAudienceFilter, userSearchQuery, isDirector, user?.uid]);

  // Load tokens when on tab
  const loadTokens = () => {
    if (!isDirector || !user?.uid) return;
    adminFetch('/api/admin/tokens')
      .then(res => res.json())
      .then(data => {
        if (data.success) setTokensList(data.tokens || []);
      });
  };

  useEffect(() => {
    if (activeTab === 'tokens' && isDirector && user?.uid) {
      loadTokens();
    }
  }, [activeTab, isDirector, user?.uid]);

  // Autocomplete search for user email in promocodes
  useEffect(() => {
    if (!user?.uid || !isDirector || activeTab !== 'promocodes') {
      return;
    }
    const timer = setTimeout(() => {
      setIsSearchingUsers(true);
      const queryParam = boundUserSearch.trim() ? `?q=${encodeURIComponent(boundUserSearch.trim())}` : '';
      adminFetch(`/api/admin/users${queryParam}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            // Filter out users already selected
            const filtered = (data.users || []).filter((u: any) => !selectedUsers.some(su => su.id === u.id));
            setSearchedUsers(filtered);
          }
        })
        .catch(console.warn)
        .finally(() => setIsSearchingUsers(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [boundUserSearch, selectedUsers, user?.uid, isDirector, activeTab]);

  // Handle Verify Order (visual code match confirmed by staff)
  const handleVerifyCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!verifyingOrder) return;

    setIsVerifying(true);
    try {
      const res = await adminFetch('/api/orders/verify-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: verifyingOrder.id,
          staffUserId: user?.uid,
          confirmMatch: true,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ошибка проверки кода');
      }

      addToast('Заказ успешно верифицирован и выдан клиенту!', 'success');
      setVerifyingOrder(null);
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка верификации заказа', 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  // Handle Confirm Kaspi Pay Payment
  const handleConfirmKaspiPayment = async (order: any) => {
    setActiveMenuOrderId(null);
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
      loadOrders(true);
    } catch (err: any) {
      addToast(err.message || 'Не удалось подтвердить оплату', 'error');
    }
  };

  // Handle Kaspi Pay Status change (pending, invoiced, paid)
  const handleSetKaspiStatus = async (order: any, targetStatus: 'pending' | 'invoiced' | 'paid') => {
    setActiveMenuOrderId(null);
    if (targetStatus === 'paid') {
      return handleConfirmKaspiPayment(order);
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
      loadOrders(true);
    } catch (err: any) {
      addToast(err.message || 'Не удалось изменить статус', 'error');
    }
  };

  // Handle Assign courier
  const handleAssignCourier = async () => {
    if (!assigningOrder || !selectedCourierId) return;

    const courier = couriersList.find(c => c.id === selectedCourierId);
    try {
      const res = await adminFetch('/api/admin/orders', {
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

  // Handle Unassign courier
  const handleUnassignCourier = async () => {
    if (!assigningOrder) return;
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unassign_courier',
          orderId: assigningOrder.id,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка снятия курьера');

      addToast(data.message || 'Курьер успешно снят с заказа', 'success');
      setAssigningOrder(null);
      setSelectedCourierId('');
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка снятия курьера', 'error');
    }
  };

  // Handle Cancel Order (three-dots menu)
  const handleCancelOrder = async (order: any) => {
    setActiveMenuOrderId(null);
    const confirmed = window.confirm(`Вы уверены, что хотите отклонить заказ №${order.id}? Заказ будет перемещен в архив.`);
    if (!confirmed) return;

    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel_order',
          orderId: order.id,
          staffUserId: user?.uid,
          reason: 'Отклонен менеджером/директором в CRM',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка отклонения заказа');

      addToast(data.message || 'Заказ успешно отклонен и перемещен в архив', 'success');
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка отклонения заказа', 'error');
    }
  };

  // Handle Archive Order (three-dots menu)
  const handleArchiveOrder = async (order: any) => {
    setActiveMenuOrderId(null);
    const confirmed = window.confirm(`Перенести заказ №${order.id} в архив?`);
    if (!confirmed) return;

    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archive_order',
          orderId: order.id,
          staffUserId: user?.uid,
          reason: 'Перенесен в архив менеджером/директором в CRM',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка переноса в архив');

      addToast(data.message || 'Заказ перемещен в архив', 'success');
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка архивации заказа', 'error');
    }
  };

  // Handle Change Order Status directly from card
  const handleChangeOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_fulfillment_status',
          orderId,
          status: newStatus,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка смены статуса');

      addToast(data.message || 'Статус заказа успешно обновлен', 'success');
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка обновления статуса', 'error');
    }
  };

  // Handle Restore Order to Active (three-dots menu)
  const handleRestoreToActive = async (order: any) => {
    setActiveMenuOrderId(null);
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
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка восстановления заказа');

      addToast(data.message || 'Заказ успешно возвращен в активные', 'success');
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка восстановления заказа', 'error');
    }
  };

  // Handle Move to Deleted (three-dots menu)
  const handleMoveToDeleted = async (order: any) => {
    setActiveMenuOrderId(null);
    const confirmed = window.confirm(`Перенести заказ №${order.id} в раздел «Удаленные»?`);
    if (!confirmed) return;

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
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка удаления заказа');

      addToast(data.message || 'Заказ перемещен в раздел «Удаленные»', 'success');
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка удаления заказа', 'error');
    }
  };

  // Load deleted orders
  const loadDeletedOrders = async () => {
    if (!user?.uid) return;
    setDeletedOrdersLoading(true);
    try {
      const res = await adminFetch(`/api/admin/orders?status=deleted&role=${userRole}&userId=${user?.uid || ''}`);
      const data = await res.json();
      if (data.success) {
        setDeletedOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Failed to load deleted orders:', err);
    } finally {
      setDeletedOrdersLoading(false);
    }
  };

  // Restore deleted order from Settings
  const handleRestoreDeletedOrder = async (orderId: string) => {
    try {
      const res = await adminFetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore_to_active',
          orderId,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка восстановления');

      addToast(data.message || 'Заказ успешно восстановлен в активные!', 'success');
      loadDeletedOrders();
      loadOrders();
    } catch (err: any) {
      addToast(err.message || 'Ошибка восстановления заказа', 'error');
    }
  };

  // Close three dots dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = () => setActiveMenuOrderId(null);
    if (activeMenuOrderId) {
      window.addEventListener('click', handleOutsideClick);
    }
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [activeMenuOrderId]);

  // Handle Kill Switch Toggle
  const handleToggleKillSwitch = async () => {
    const nextState = !killSwitchActive;
    try {
      const res = await adminFetch('/api/admin/settings', {
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

  // Handle Warehouse Selection
  const handleUpdateWarehouse = async (warehouseName: string) => {
    setActiveWarehouse(warehouseName);
    try {
      await adminFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'active_warehouse',
          value: { id: warehouseName === 'Car City 1 ярус Подвал' ? 'car_city_podval' : 'severnoye_koltso', name: warehouseName },
          staffUserId: user?.uid,
        }),
      });
      addToast(`Основной склад обновлен: ${warehouseName}`, 'success');
    } catch {
      addToast('Ошибка сохранения склада', 'error');
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
      const res = await adminFetch('/api/admin/promocodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: promoCode,
          type: promoType,
          value: promoValue,
          minCartTotal,
          maxCartTotal: maxCartTotal ? Number(maxCartTotal) : null,
          maxDiscount: promoType === 'percent' ? maxDiscount : null,
          targetAudience: promoAudience,
          boundUserId: selectedUsers.length === 1 ? selectedUsers[0].id : null,
          boundEmails: selectedUsers.map(u => u.email),
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка');

      addToast(data.message || 'Промокод создан!', 'success');
      setPromoCode('');
      setSelectedUsers([]);
      setIsAddingUser(false);
      setBoundUserSearch('');
      // Refresh list
      adminFetch('/api/admin/promocodes').then(r => r.json()).then(d => setPromocodes(d.promocodes || []));
    } catch (err: any) {
      addToast(err.message || 'Ошибка создания промокода', 'error');
    }
  };

  // Handle Delete Promocode
  const handleDeletePromocode = async (id: string) => {
    if (!confirm('Удалить данный промокод?')) return;
    try {
      const res = await adminFetch(`/api/admin/promocodes?id=${id}&staffUserId=${user?.uid}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        addToast('Промокод удален', 'success');
        setPromocodes(prev => prev.filter(p => p.id !== id));
      }
    } catch {
      addToast('Ошибка удаления', 'error');
    }
  };

  // Handle Change User Role with optimistic feedback and server synchronization
  const handleChangeUserRole = async (targetUserId: string, newRole: string) => {
    const prevUsers = [...usersList];

    // Optimistic UI update: instantly update local list
    setUsersList(prev => prev.map(u => u.id === targetUserId ? { ...u, role: newRole } : u));
    setUpdatingRoleId(targetUserId);

    try {
      const res = await adminFetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId,
          newRole,
          staffUserId: user?.uid,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        addToast(data.message || 'Роль пользователя успешно обновлена', 'success');
        if (targetUserId === user?.uid && userProfile) {
          setUserProfile({ ...userProfile, role: newRole });
        }
        await loadUsers();
        loadCouriers();
      } else {
        // Rollback optimistic update on server error
        setUsersList(prevUsers);
        addToast(data.error || 'Ошибка изменения роли: доступ ограничен', 'error');
      }
    } catch (err: any) {
      setUsersList(prevUsers);
      addToast(err?.message || 'Ошибка сети при изменении роли', 'error');
    } finally {
      setUpdatingRoleId(null);
    }
  };

  // Handle Generate 24-character Token
  const handleGenerateToken = async () => {
    try {
      const res = await adminFetch('/api/admin/tokens', {
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
            <h1 style={{ fontFamily: "var(--font-geist-sans), 'Geist', sans-serif", fontSize: '24px', fontWeight: 800, color: 'var(--color-navy)', margin: '0 0 6px 0', letterSpacing: '-0.02em' }}>
              Панель управления
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

          {(isDirector || isManager) && (
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === 'settings' ? styles.activeTabBtn : ''}`}
              onClick={() => {
                setActiveTab('settings');
                setSettingsSubView('general');
              }}
            >
              <Settings size={16} />
              Настройки
            </button>
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
                      className={`${styles.filterPill} ${period === p && !appliedDateRange.start ? styles.activeFilterPill : ''}`}
                      onClick={() => {
                        setPeriod(p);
                        setAppliedDateRange({ start: null, end: null });
                      }}
                    >
                      {p === 'all' ? 'За все время' : `За ${p} дней`}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`${styles.filterPill} ${period === 'custom' || appliedDateRange.start ? styles.activeFilterPill : ''}`}
                    onClick={() => setIsDatePickerOpen(true)}
                  >
                    {appliedDateRange.start
                      ? `${new Date(appliedDateRange.start).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} — ${new Date(appliedDateRange.end || appliedDateRange.start).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`
                      : 'Выбрать период'}
                  </button>
                </div>
              )}

              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Статус:</span>
                {[
                  { id: 'all', label: 'Все' },
                  { id: 'assembling', label: 'В сборке' },
                  { id: 'packaging', label: 'Упаковывается' },
                  { id: 'out_for_delivery', label: isCourier ? 'К доставке' : 'Выдан курьеру' },
                  { id: 'ready_for_pickup', label: 'Готов к получению' },
                  { id: 'delivered', label: 'Доставлен' },
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

            {/* Search Bar & Order Sub-Tabs */}
            {(() => {
              const isOrderDeleted = (o: any) => o.fulfillment_status === 'deleted';

              const isOrderCancelled = (o: any) => {
                if (isOrderDeleted(o)) return false;
                return (
                  o.fulfillment_status === 'cancelled' || 
                  o.payment_status === 'declined' || 
                  o.payment_status === 'cancelled' || 
                  o.payment_status === 'failed' ||
                  o.status === 'declined' ||
                  o.status === 'cancelled'
                );
              };

              const isOrderCompleted = (o: any) => {
                if (isOrderDeleted(o) || isOrderCancelled(o)) return false;
                return o.fulfillment_status === 'completed' || o.fulfillment_status === 'delivered';
              };

              const isOrderKaspiPending = (o: any) => {
                if (isOrderDeleted(o) || isOrderCancelled(o) || isOrderCompleted(o)) return false;
                return o.payment_method === 'kaspi_pay' && o.payment_status !== 'paid';
              };

              const isOrderPendingPayment = (o: any) => {
                if (isOrderDeleted(o) || isOrderCancelled(o) || isOrderCompleted(o)) return false;
                if (o.payment_method === 'kaspi_pay') return false;
                return o.payment_status === 'pending' || o.status === 'pending_payment';
              };

              const isOrderActive = (o: any) => {
                if (isOrderDeleted(o) || isOrderCancelled(o) || isOrderCompleted(o)) return false;
                if (o.payment_method === 'kaspi_pay' && o.payment_status !== 'paid') return false;
                return !isOrderPendingPayment(o);
              };

              const kaspiOrdersCount = orders.filter(isOrderKaspiPending).length;
              const activeOrdersCount = orders.filter(isOrderActive).length;
              const pendingOrdersCount = orders.filter(isOrderPendingPayment).length;
              const cancelledOrdersCount = orders.filter(isOrderCancelled).length;
              const archivedOrdersCount = orders.filter(isOrderCompleted).length;

              const cleanSearch = orderSearchQuery.trim().toLowerCase();
              let displayedOrders = orders;

              if (cleanSearch) {
                // COMMON GLOBAL SEARCH: searches all orders across all time and all statuses
                // Merge orders with deletedOrders so deleted orders always appear in search
                const poolMap = new Map<string, any>();
                orders.forEach(o => poolMap.set(o.id, o));
                deletedOrders.forEach(o => {
                  if (!poolMap.has(o.id)) poolMap.set(o.id, o);
                });
                const pool = Array.from(poolMap.values());

                displayedOrders = pool
                  .filter(o => {
                    const idMatch = String(o.id || '').toLowerCase().includes(cleanSearch);
                    const invoiceMatch = String(o.invoice_id || '').toLowerCase().includes(cleanSearch);
                    const nameMatch = String(o.customer_name || '').toLowerCase().includes(cleanSearch);
                    const phoneMatch = String(o.customer_phone || '').replace(/\D/g, '').includes(cleanSearch.replace(/\D/g, ''));
                    const emailMatch = String(o.customer_email || '').toLowerCase().includes(cleanSearch);
                    return idMatch || invoiceMatch || nameMatch || phoneMatch || emailMatch;
                  })
                  .sort((a, b) => {
                    const aId = String(a.id || '').toLowerCase();
                    const bId = String(b.id || '').toLowerCase();
                    const aExact = aId === cleanSearch || String(a.invoice_id || '').toLowerCase() === cleanSearch;
                    const bExact = bId === cleanSearch || String(b.invoice_id || '').toLowerCase() === cleanSearch;
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                    const aStarts = aId.startsWith(cleanSearch);
                    const bStarts = bId.startsWith(cleanSearch);
                    if (aStarts && !bStarts) return -1;
                    if (!aStarts && bStarts) return 1;
                    const aIncludes = aId.includes(cleanSearch);
                    const bIncludes = bId.includes(cleanSearch);
                    if (aIncludes && !bIncludes) return -1;
                    if (!aIncludes && bIncludes) return 1;
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                  });
              } else {
                if (orderSubTab === 'kaspi') {
                  displayedOrders = orders.filter(isOrderKaspiPending);
                } else if (orderSubTab === 'pending_payment') {
                  displayedOrders = orders.filter(isOrderPendingPayment);
                } else if (orderSubTab === 'cancelled') {
                  displayedOrders = orders.filter(isOrderCancelled);
                } else if (orderSubTab === 'archive') {
                  displayedOrders = orders.filter(isOrderCompleted);
                } else {
                  displayedOrders = orders.filter(isOrderActive);
                }
              }

              // Apply in-memory custom date range if selected
              if (appliedDateRange.start) {
                const startMs = new Date(appliedDateRange.start).getTime();
                const endMs = new Date(appliedDateRange.end || appliedDateRange.start).getTime();
                displayedOrders = displayedOrders.filter(o => {
                  const oTime = new Date(o.created_at).getTime();
                  return oTime >= startMs && oTime <= endMs;
                });
              }

              return (
                <>
                  <div className={styles.searchBarContainer}>
                    <div className={styles.searchInputWrapper}>
                      <Search size={18} className={styles.searchIcon} />
                      <input
                        type="text"
                        className={styles.ordersSearchInput}
                        placeholder="Поиск по номеру заказа, ФИО покупателя, телефону..."
                        value={orderSearchQuery}
                        onChange={e => setOrderSearchQuery(e.target.value)}
                      />
                      {orderSearchQuery && (
                        <button
                          type="button"
                          className={styles.clearSearchBtn}
                          onClick={() => setOrderSearchQuery('')}
                          title="Очистить поиск"
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>

                    <div className={styles.orderSubTabs}>
                      {isCourier ? (
                        <>
                          <button
                            type="button"
                            className={`${styles.subTabBtn} ${orderSubTab === 'active' ? styles.subTabBtnActive : ''}`}
                            onClick={() => setOrderSubTab('active')}
                          >
                            Активные заказы
                            <span className={styles.subTabBadge}>{activeOrdersCount}</span>
                          </button>

                          <button
                            type="button"
                            className={`${styles.subTabBtn} ${orderSubTab === 'cancelled' ? styles.subTabBtnActive : ''}`}
                            onClick={() => setOrderSubTab('cancelled')}
                          >
                            Отмененные заказы
                            <span className={styles.subTabBadge}>{cancelledOrdersCount}</span>
                          </button>

                          <button
                            type="button"
                            className={`${styles.subTabBtn} ${orderSubTab === 'archive' ? styles.subTabBtnActive : ''}`}
                            onClick={() => setOrderSubTab('archive')}
                          >
                            Архив заказов
                            <span className={styles.subTabBadge}>{archivedOrdersCount}</span>
                          </button>
                        </>
                      ) : (
                        <>
                          {kaspiOrdersCount > 0 && (
                            <button
                              type="button"
                              className={`${styles.subTabBtn} ${orderSubTab === 'kaspi' ? styles.subTabBtnActive : ''}`}
                              onClick={() => setOrderSubTab('kaspi')}
                            >
                              <CreditCard size={15} />
                              Kaspi Pay
                              <span className={styles.subTabBadge}>
                                {kaspiOrdersCount}
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            className={`${styles.subTabBtn} ${orderSubTab === 'active' ? styles.subTabBtnActive : ''}`}
                            onClick={() => setOrderSubTab('active')}
                          >
                            Активные заказы
                            <span className={styles.subTabBadge}>{activeOrdersCount}</span>
                          </button>

                          {pendingOrdersCount > 0 && (
                            <button
                              type="button"
                              className={`${styles.subTabBtn} ${orderSubTab === 'pending_payment' ? styles.subTabBtnActive : ''}`}
                              onClick={() => setOrderSubTab('pending_payment')}
                            >
                              Ожидает оплаты
                              <span className={styles.subTabBadge}>{pendingOrdersCount}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            className={`${styles.subTabBtn} ${orderSubTab === 'cancelled' ? styles.subTabBtnActive : ''}`}
                            onClick={() => setOrderSubTab('cancelled')}
                          >
                            Отмененные заказы
                            <span className={styles.subTabBadge}>{cancelledOrdersCount}</span>
                          </button>

                          <button
                            type="button"
                            className={`${styles.subTabBtn} ${orderSubTab === 'archive' ? styles.subTabBtnActive : ''}`}
                            onClick={() => setOrderSubTab('archive')}
                          >
                            Архив заказов
                            <span className={styles.subTabBadge}>{archivedOrdersCount}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Orders List */}
                  {ordersLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      Загрузка заказов...
                    </div>
                  ) : displayedOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b' }}>
                      {cleanSearch ? 'Заказов не найдено по поисковому запросу' : 'В данном разделе нет заказов'}
                    </div>
                  ) : (
                    <div className={styles.ordersGrid}>
                      {displayedOrders.map(order => {
                        const isCancelled = isOrderCancelled(order);
                        const isCompleted = isOrderCompleted(order);
                        const isPendingPayment = isOrderPendingPayment(order);
                        const isKaspiOrder = order.payment_method === 'kaspi_pay' && order.payment_status !== 'paid';
                        const isKaspiInvoiced = isKaspiOrder && order.payment_status === 'invoiced';
                        const isDeleted = isOrderDeleted(order);

                        return (
                          <div
                            key={order.id}
                            className={`${styles.orderCard} ${styles.orderCardClickable}`}
                            onClick={() => router.push(`/admin/orders/${order.id}`)}
                          >
                            <div className={styles.orderCardHeader}>
                              <div className={styles.orderIdBlock}>
                                <span className={styles.orderNumber}>Заказ №{order.id}</span>
                                {isDeleted ? (
                                  <span
                                    className={styles.statusBadge}
                                    style={{
                                      background: '#fee2e2',
                                      color: '#991b1b',
                                      border: '1px solid #fecaca',
                                      fontWeight: 800,
                                    }}
                                  >
                                    Удален
                                  </span>
                                ) : isManager && !isCompleted && !isCancelled ? (
                                  <div className={styles.cardStatusSelectWrapper} onClick={e => e.stopPropagation()}>
                                    <select
                                      className={styles.cardStatusSelect}
                                      value={order.fulfillment_status || 'assembling'}
                                      onChange={e => {
                                        e.stopPropagation();
                                        handleChangeOrderStatus(order.id, e.target.value);
                                      }}
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
                                ) : (
                                  <span className={`${styles.statusBadge} ${
                                    isCompleted ? styles.statusCompleted :
                                    isCancelled ? styles.statusCancelled :
                                    isPendingPayment ? styles.statusPending :
                                    order.fulfillment_status === 'out_for_delivery' ? styles.statusOutForDelivery :
                                    order.fulfillment_status === 'ready_for_pickup' ? styles.statusReady :
                                    order.fulfillment_status === 'packaging' ? styles.statusPackaging :
                                    styles.statusAssembling
                                  }`}>
                                    {isCompleted ? 'Выдан' :
                                     isCancelled ? 'Отменен менеджером' :
                                     isPendingPayment ? 'Ожидает оплаты' :
                                     order.fulfillment_status === 'out_for_delivery' ? (isCourier ? 'К доставке' : 'Выдан курьеру') :
                                     order.fulfillment_status === 'ready_for_pickup' ? 'Готов к получению' :
                                     order.fulfillment_status === 'packaging' ? 'Упаковывается' :
                                     'На складе'}
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <div style={{ fontSize: '13px', color: '#64748b' }}>
                                  {new Date(order.created_at).toLocaleString('ru-RU')}
                                </div>
                                {isPendingPayment && (
                                  <span className={styles.timerBadge}>
                                    <Clock size={12} />
                                    <span>Осталось: {formatOrderRemainingTime(order.created_at)}</span>
                                  </span>
                                )}
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
                                  {Array.isArray(order.items) && order.items.map((it: any, idx: number) => {
                                    const itemLink = it.id ? `/product/${it.id}` : null;
                                    return (
                                      <div key={idx} className={styles.orderItemRow}>
                                        {itemLink ? (
                                          <Link
                                            href={itemLink}
                                            target="_blank"
                                            className={styles.orderItemRowLink}
                                            onClick={(e) => e.stopPropagation()}
                                            title="Открыть товар в новой вкладке"
                                          >
                                            <span>{it.name || it.title} ({it.quantity} шт)</span>
                                          </Link>
                                        ) : (
                                          <span>{it.name || it.title} ({it.quantity} шт)</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className={styles.orderCardRight}>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' }}>Сумма к оплате</div>
                                  <div className={styles.orderAmountText}>{Number(order.amount).toLocaleString('ru-RU')} ₸</div>
                                </div>

                                <div className={styles.actionButtons} onClick={e => e.stopPropagation()}>
                                  {!isKaspiOrder && order.fulfillment_status !== 'completed' && !isCancelled && !isDeleted && (
                                    <button
                                      type="button"
                                      className={styles.verifyCodeBtn}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setVerifyingOrder(order);
                                      }}
                                    >
                                      <KeyRound size={15} />
                                      <span>Перейти к выдаче заказа</span>
                                    </button>
                                  )}

                                  {isManager && isKaspiOrder && !isCancelled && !isDeleted && (
                                    <>
                                      {order.payment_status !== 'invoiced' ? (
                                        <button
                                          type="button"
                                          className={styles.verifyCodeBtn}
                                          style={{
                                            backgroundColor: '#ffffff',
                                            border: '1px solid var(--color-navy, #060F48)',
                                            color: 'var(--color-navy, #060F48)',
                                            boxShadow: 'none',
                                            fontWeight: 500,
                                            fontSize: '13px',
                                            borderRadius: '8px',
                                            padding: '7px 14px',
                                            cursor: 'pointer',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSetKaspiStatus(order, 'invoiced');
                                          }}
                                          title="Подтвердить выставление счёта в приложении Kaspi"
                                        >
                                          <span>Подтвердить выставление счёта</span>
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className={styles.verifyCodeBtn}
                                          style={{
                                            backgroundColor: '#ffffff',
                                            border: '1px solid #cbd5e1',
                                            color: '#475569',
                                            boxShadow: 'none',
                                            fontWeight: 500,
                                            fontSize: '13px',
                                            borderRadius: '8px',
                                            padding: '7px 14px',
                                            cursor: 'pointer',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSetKaspiStatus(order, 'pending');
                                          }}
                                          title="Вернуть статус в «Ожидает выставления»"
                                        >
                                          <span>Вернуть в ожидание</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className={styles.verifyCodeBtn}
                                        style={{
                                          background: 'var(--color-navy-gradient)',
                                          color: '#ffffff',
                                          border: 'none',
                                          boxShadow: 'none',
                                          fontWeight: 500,
                                          fontSize: '13px',
                                          borderRadius: '8px',
                                          padding: '7px 14px',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '6px',
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSetKaspiStatus(order, 'paid');
                                        }}
                                        title="Подтвердить оплату счёта клиентом"
                                      >
                                        <Check size={15} />
                                        <span>Подтвердить оплату счёта клиентом</span>
                                      </button>
                                    </>
                                  )}

                                  {!isKaspiOrder && isManager && order.delivery_method === 'courier' && order.fulfillment_status !== 'completed' && !isCancelled && !isDeleted && (
                                    <button
                                      type="button"
                                      className={styles.assignBtn}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAssigningOrder(order);
                                        setSelectedCourierId(order.assigned_courier_id || '');
                                        setCourierSearchQuery('');
                                        loadCouriers();
                                      }}
                                    >
                                      <Truck size={15} />
                                      <span>{order.assigned_courier_id ? 'Сменить курьера' : 'Передать курьеру'}</span>
                                    </button>
                                  )}

                                  {/* Three dots (⋮) menu for Manager / Director */}
                                  {isManager && (
                                    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        className={styles.moreOptionsBtn}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveMenuOrderId(activeMenuOrderId === order.id ? null : order.id);
                                        }}
                                        title="Действия с заказом"
                                      >
                                        <MoreVertical size={17} />
                                      </button>

                                      {activeMenuOrderId === order.id && (
                                        <div className={styles.optionsDropdown} onClick={e => e.stopPropagation()}>
                                          {isDeleted ? (
                                            <>
                                              <button
                                                type="button"
                                                className={styles.dropdownItem}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleRestoreToActive(order);
                                                }}
                                              >
                                                <RotateCcw size={15} color="#0284c7" />
                                                <span>Восстановить в активные</span>
                                              </button>
                                              <button
                                                type="button"
                                                className={styles.dropdownItem}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleArchiveOrder(order);
                                                }}
                                              >
                                                <Archive size={15} color="#64748b" />
                                                <span>Восстановить в архив</span>
                                              </button>
                                              <button
                                                type="button"
                                                className={styles.dropdownItem}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setActiveMenuOrderId(null);
                                                  setVerifyingOrder(order);
                                                }}
                                              >
                                                <KeyRound size={15} color="var(--color-navy)" />
                                                <span>Посмотреть код получения</span>
                                              </button>
                                            </>
                                          ) : (isCompleted || isCancelled) ? (
                                            <>
                                              <button
                                                type="button"
                                                className={styles.dropdownItem}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setActiveMenuOrderId(null);
                                                  setVerifyingOrder(order);
                                                }}
                                              >
                                                <KeyRound size={15} color="var(--color-navy)" />
                                                <span>Посмотреть код получения</span>
                                              </button>
                                              <button
                                                type="button"
                                                className={styles.dropdownItem}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleRestoreToActive(order);
                                                }}
                                              >
                                                <RotateCcw size={15} color="#0284c7" />
                                                <span>Перенести в Активные заказы</span>
                                              </button>
                                              <button
                                                type="button"
                                                className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleMoveToDeleted(order);
                                                }}
                                              >
                                                <Trash2 size={15} />
                                                <span>Перенести в удаленные</span>
                                              </button>
                                            </>
                                          ) : (
                                            <>
                                              {order.payment_method === 'kaspi_pay' && order.payment_status !== 'paid' && (
                                                <>
                                                  {order.payment_status !== 'invoiced' ? (
                                                    <button
                                                      type="button"
                                                      className={styles.dropdownItem}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSetKaspiStatus(order, 'invoiced');
                                                      }}
                                                      style={{ color: '#2563eb', fontWeight: 600 }}
                                                    >
                                                      <CreditCard size={15} color="#2563eb" />
                                                      <span>Выставить счет Kaspi</span>
                                                    </button>
                                                  ) : (
                                                    <button
                                                      type="button"
                                                      className={styles.dropdownItem}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSetKaspiStatus(order, 'pending');
                                                      }}
                                                    >
                                                      <Clock size={15} />
                                                      <span>Вернуть: Ожидает выставления</span>
                                                    </button>
                                                  )}
                                                  <button
                                                    type="button"
                                                    className={styles.dropdownItem}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleSetKaspiStatus(order, 'paid');
                                                    }}
                                                    style={{ color: '#15803d', fontWeight: 600 }}
                                                  >
                                                    <CheckCircle size={15} color="#15803d" />
                                                    <span>Подтвердить оплату (Kaspi Pay)</span>
                                                  </button>
                                                </>
                                              )}
                                              <button
                                                type="button"
                                                className={styles.dropdownItem}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setActiveMenuOrderId(null);
                                                  setVerifyingOrder(order);
                                                }}
                                              >
                                                <KeyRound size={15} color="var(--color-navy)" />
                                                <span>Посмотреть код получения</span>
                                              </button>
                                              <button
                                                type="button"
                                                className={styles.dropdownItem}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleArchiveOrder(order);
                                                }}
                                              >
                                                <Archive size={15} />
                                                <span>Перенести в архив</span>
                                              </button>
                                              <button
                                                type="button"
                                                className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleCancelOrder(order);
                                                }}
                                              >
                                                <XCircle size={15} />
                                                <span>Отклонить заказ</span>
                                              </button>
                                              <button
                                                type="button"
                                                className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleMoveToDeleted(order);
                                                }}
                                              >
                                                <Trash2 size={15} />
                                                <span>Перенести в удаленные</span>
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
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
                      style={{
                        fontFamily: "var(--font-geist-sans), 'Geist', sans-serif !important",
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                      }}
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
                      style={{ fontFamily: "var(--font-geist-sans), 'Geist', sans-serif !important" }}
                    >
                      <option value="percent">В процентах (%)</option>
                      <option value="fixed">Фиксированная сумма (₸)</option>
                    </select>
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                        Размер скидки:
                      </label>
                      <button
                        type="button"
                        className={styles.clickableValuePill}
                        onClick={() => setIsPromoConfigModalOpen(true)}
                        title="Нажмите для точного ручного ввода суммы"
                      >
                        {promoType === 'percent' ? `${promoValue}%` : `${promoValue.toLocaleString()} ₸`}
                        <span style={{ fontSize: '11px', opacity: 0.7 }}>✎</span>
                      </button>
                    </div>
                    <input
                      type="range"
                      min={promoType === 'percent' ? 1 : 500}
                      max={promoType === 'percent' ? 30 : 50000}
                      step={promoType === 'percent' ? 1 : 500}
                      value={Math.min(promoValue, promoType === 'percent' ? 30 : 50000)}
                      onChange={e => setPromoValue(Number(e.target.value))}
                      style={{ width: '100%', marginTop: '8px' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                        Мин. корзина:
                      </label>
                      <button
                        type="button"
                        className={styles.clickableValuePill}
                        onClick={() => setIsPromoConfigModalOpen(true)}
                        title="Нажмите для точного ручного ввода суммы"
                      >
                        {minCartTotal.toLocaleString()} ₸
                        <span style={{ fontSize: '11px', opacity: 0.7 }}>✎</span>
                      </button>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={150000}
                      step={5000}
                      value={Math.min(minCartTotal, 150000)}
                      onChange={e => setMinCartTotal(Number(e.target.value))}
                      style={{ width: '100%', marginTop: '8px' }}
                    />
                  </div>

                  {promoType === 'percent' && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                          Потолок скидки:
                        </label>
                        <button
                          type="button"
                          className={styles.clickableValuePill}
                          onClick={() => setIsPromoConfigModalOpen(true)}
                          title="Нажмите для точного ручного ввода суммы"
                        >
                          {maxDiscount.toLocaleString()} ₸
                          <span style={{ fontSize: '11px', opacity: 0.7 }}>✎</span>
                        </button>
                      </div>
                      <input
                        type="range"
                        min={2000}
                        max={150000}
                        step={2000}
                        value={Math.min(maxDiscount, 150000)}
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
                      style={{ fontFamily: 'var(--font-geist-sans), sans-serif' }}
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

                {/* Exclusive User Selection with Autocomplete and Smooth Disappearance */}
                <div className={styles.autocompleteWrapper}>
                  {selectedUsers.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                        Привязанные покупатели ({selectedUsers.length}):
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                        {selectedUsers.map(u => (
                          <div key={u.id} className={styles.boundUserTag}>
                            <span><strong>{u.email}</strong> {u.full_name ? `(${u.full_name})` : ''}</span>
                            <button
                              type="button"
                              className={styles.boundUserTagUnpinBtn}
                              onClick={() => {
                                setSelectedUsers(prev => prev.filter(x => x.id !== u.id));
                              }}
                              title="Удалить привязку"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Search box & Dropdown: permanently visible, allowing instant user selection */}
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                      {selectedUsers.length > 0 
                        ? 'Добавить ещё покупателя (поиск по email или имени):' 
                        : 'Для кого (выбор): привязать к конкретным покупателям'}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className={styles.inputField}
                        placeholder="Введите email или имя покупателя для поиска..."
                        value={boundUserSearch}
                        onChange={e => {
                          setBoundUserSearch(e.target.value);
                          setIsBoundSearchFocused(true);
                        }}
                        onFocus={() => setIsBoundSearchFocused(true)}
                        onBlur={() => {
                          setTimeout(() => setIsBoundSearchFocused(false), 250);
                        }}
                        style={{ margin: 0, fontFamily: 'var(--font-geist-sans), sans-serif' }}
                      />
                      {isSearchingUsers && (
                        <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#94a3b8' }}>
                          Поиск...
                        </span>
                      )}
                      {isBoundSearchFocused && searchedUsers.length > 0 && (
                        <div className={styles.autocompleteList}>
                          {searchedUsers.map(u => (
                            <div
                              key={u.id}
                              className={styles.autocompleteItem}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                if (!selectedUsers.some(x => x.id === u.id)) {
                                  setSelectedUsers(prev => [...prev, u]);
                                }
                                setBoundUserSearch('');
                              }}
                            >
                              <span><strong>{u.email}</strong> {u.full_name ? `(${u.full_name})` : ''}</span>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                {u.role === 'wholesale' ? 'Оптовик' : 'Розница'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <button type="submit" className={styles.submitBtn} style={{ marginTop: '10px' }}>
                  Создать промокод
                </button>
              </form>
            </div>

            {/* List of active promocodes */}
            <div className={styles.tableResponsiveWrapper}>
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
                      <td>
                        {p.bound_emails && Array.isArray(p.bound_emails) && p.bound_emails.length > 0
                          ? p.bound_emails.join(', ')
                          : (p.bound_user_email || '—')}
                      </td>
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
          </div>
        )}

        {/* TAB 3: USERS (Director Only) */}
        {activeTab === 'users' && isDirector && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, color: '#0f172a' }}>
                  Клиенты и Пользователи ({usersList.length})
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '2px 0 0 0' }}>
                  База пользователей синхронизируется автоматически при каждом входе, регистрации и заказе.
                </p>
              </div>
            </div>

            <div className={styles.sectionFilters}>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Аудитория:</span>
                {[
                  { id: 'all', label: 'Все' },
                  { id: 'retail', label: 'Розничные' },
                  { id: 'wholesale', label: 'Оптовые' },
                  { id: 'courier', label: 'Курьеры' },
                  { id: 'manager', label: 'Менеджеры' },
                  { id: 'director', label: 'Директоры' },
                ].map(a => (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.filterPill} ${userAudienceFilter === a.id ? styles.activeFilterPill : ''}`}
                    onClick={() => setUserAudienceFilter(a.id as any)}
                  >
                    {a.label}
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

            <div className={styles.tableResponsiveWrapper}>
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
                    <tr
                      key={u.id}
                      className={styles.userTableRowClickable}
                      onClick={() => router.push(`/admin/users/${u.id}`)}
                      title="Нажмите для просмотра профиля и заказов пользователя"
                    >
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
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <select
                            value={u.role}
                            disabled={updatingRoleId === u.id || (u.id === 'ohwKkhkKHmdaI5CkbcGJcunNuID2' && u.role === 'director')}
                            title={u.id === 'ohwKkhkKHmdaI5CkbcGJcunNuID2' ? 'Основной аккаунт директора защищен' : undefined}
                            onClick={e => e.stopPropagation()}
                            onChange={e => {
                              e.stopPropagation();
                              handleChangeUserRole(u.id, e.target.value);
                            }}
                            style={{
                              padding: '5px 8px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              fontSize: '12px',
                              cursor: updatingRoleId === u.id ? 'wait' : (u.id === 'ohwKkhkKHmdaI5CkbcGJcunNuID2' ? 'not-allowed' : 'pointer'),
                              backgroundColor: updatingRoleId === u.id ? '#f1f5f9' : '#ffffff',
                              fontWeight: 500,
                            }}
                          >
                            <option value="customer">Розничный</option>
                            <option value="wholesale">Оптовый</option>
                            <option value="courier">Курьер</option>
                            <option value="manager">Менеджер</option>
                            <option value="director">Директор</option>
                          </select>
                          {updatingRoleId === u.id && (
                            <span style={{ fontSize: '11px', color: '#0ea5e9' }}>...</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

            <div className={styles.tableResponsiveWrapper}>
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
          </div>
        )}

        {/* TAB 5: SETTINGS / УПРАВЛЕНИЕ */}
        {activeTab === 'settings' && (isDirector || isManager) && (
          <div>
            {settingsSubView === 'general' ? (
              <>
                <div className={`${styles.settingsCard} ${!isDirector ? styles.disabledSection : ''}`}>
                  {!isDirector && (
                    <div className={styles.managerNoticeBadge}>
                      <Lock size={14} />
                      <span>Управление приёмом заказов и складом доступно только Директору</span>
                    </div>
                  )}
                  <h2 className={styles.settingsCardTitle}>Системное управление приёмом заказов</h2>

                  <div className={styles.settingsRow}>
                    <div className={styles.settingsRowLeft}>
                      <div className={styles.settingsRowTitle}>
                        Приём заказов:{' '}
                        {killSwitchActive ? (
                          <span style={{ color: '#d97706', fontWeight: 800 }}>Приостановлен</span>
                        ) : (
                          <span style={{ color: '#10b981', fontWeight: 800 }}>Открыто</span>
                        )}
                      </div>
                      <div className={styles.settingsRowDesc}>
                        {killSwitchActive
                          ? 'Приём новых заказов на сайте временно отключён. Покупатели видят предупреждение в корзине.'
                          : 'Покупатели могут свободно оформлять заказы с доставкой или самовывозом.'}
                      </div>
                    </div>

                    {/* Animated Toggle Switch */}
                    <label
                      className={styles.toggleSwitch}
                      onClick={(e) => {
                        e.preventDefault();
                        if (isDirector) setIsKillSwitchModalOpen(true);
                      }}
                      title={isDirector ? "Нажмите для переключения режима работы магазина" : "Доступно только Директору"}
                    >
                      <input type="checkbox" checked={!killSwitchActive} readOnly disabled={!isDirector} />
                      <span className={styles.toggleSlider}></span>
                    </label>
                  </div>

                  {/* Warehouse selector */}
                  <div className={styles.settingsRow} style={{ marginTop: '16px' }}>
                    <div className={styles.settingsRowLeft}>
                      <div className={styles.settingsRowTitle}>Основной склад отгрузки</div>
                      <div className={styles.settingsRowDesc}>
                        Укажите склад, из которого осуществляется комплектация и выдача товаров
                      </div>
                    </div>
                    <select
                      value={activeWarehouse}
                      onChange={e => isDirector && handleUpdateWarehouse(e.target.value)}
                      disabled={!isDirector}
                      className={styles.inputField}
                      style={{ width: '280px', margin: 0, fontFamily: 'var(--font-geist-sans), sans-serif' }}
                    >
                      <option value="Car City 1 ярус Подвал">Car City 1 ярус Подвал</option>
                      <option value="Склад Северное Кольцо">Склад Северное Кольцо</option>
                    </select>
                  </div>
                </div>

                {/* Section for Deleted Orders */}
                <div className={styles.settingsCard} style={{ marginTop: '20px' }}>
                  <div className={styles.settingsCardHeaderFlex}>
                    <div>
                      <h2 className={styles.settingsCardTitle} style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                        <Trash2 size={20} color="#dc2626" />
                        Удаленные заказы
                      </h2>
                      <p className={styles.settingsRowDesc} style={{ margin: '6px 0 0 0' }}>
                        Корзина заказов, перемещенных в удаленные. Доступна для просмотра и восстановления менеджерами и директором.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={styles.goToDeletedBtn}
                      onClick={() => {
                        setSettingsSubView('deleted');
                        loadDeletedOrders();
                      }}
                    >
                      Перейти в удаленные →
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.settingsCard}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                  <button
                    type="button"
                    className={styles.backBtn}
                    onClick={() => setSettingsSubView('general')}
                  >
                    <ArrowLeft size={16} />
                    Назад к настройкам
                  </button>
                  <h2 className={styles.settingsCardTitle} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Trash2 size={20} color="#dc2626" />
                    Корзина удаленных заказов ({deletedOrders.length})
                  </h2>
                </div>

                {deletedOrdersLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                    Загрузка удаленных заказов...
                  </div>
                ) : deletedOrders.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b' }}>
                    В корзине удаленных заказов пусто
                  </div>
                ) : (
                  <div className={styles.tableResponsiveWrapper}>
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          <th>Номер</th>
                          <th>Дата создания</th>
                          <th>Покупатель</th>
                          <th>Телефон</th>
                          <th>Сумма</th>
                          <th>Действие</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deletedOrders.map(delOrder => (
                          <tr key={delOrder.id}>
                            <td>
                              <strong>Заказ №{delOrder.id}</strong>
                            </td>
                            <td>{new Date(delOrder.created_at).toLocaleString('ru-RU')}</td>
                            <td>{delOrder.customer_name || '—'}</td>
                            <td>{delOrder.customer_phone || '—'}</td>
                            <td style={{ fontWeight: 700, color: 'var(--color-navy)' }}>
                              {Number(delOrder.amount).toLocaleString('ru-RU')} ₸
                            </td>
                            <td>
                              <button
                                type="button"
                                className={styles.restoreBtn}
                                onClick={() => handleRestoreDeletedOrder(delOrder.id)}
                                title="Восстановить в активные заказы"
                              >
                                <RotateCcw size={14} />
                                <span>Восстановить в активные</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* MODAL 1: ISSUE ORDER (VERIFY CODE) */}
        {verifyingOrder && (() => {
          const isCompletedOrCancelled = verifyingOrder.fulfillment_status === 'completed' || 
                                          verifyingOrder.fulfillment_status === 'cancelled' ||
                                          verifyingOrder.payment_status === 'declined' ||
                                          verifyingOrder.payment_status === 'cancelled' ||
                                          verifyingOrder.status === 'declined';
          return (
            <div className={styles.modalOverlay} onClick={() => !isVerifying && setVerifyingOrder(null)}>
              <div className={styles.modalCard} onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
                <h3 className={styles.modalTitle} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <KeyRound size={20} color="var(--color-navy)" />
                  {isCompletedOrCancelled ? `Код получения заказа №${verifyingOrder.id}` : `Выдача заказа №${verifyingOrder.id}`}
                </h3>
                <p className={styles.modalDesc} style={{ marginBottom: '14px' }}>
                  Покупатель: <strong>{verifyingOrder.customer_name || 'Не указан'}</strong> {verifyingOrder.customer_phone ? `(${verifyingOrder.customer_phone})` : ''} • Сумма: <strong>{Number(verifyingOrder.amount).toLocaleString('ru-RU')} ₸</strong>
                </p>

                <div className={styles.modalPickupCodeBox}>
                  <div className={styles.modalPickupCodeLabel}>
                    Код подтверждения в системе
                  </div>
                  <div className={styles.modalPickupCodeValue}>
                    {formatPickupCode(verifyingOrder.pickup_code || getOrderPickupCode(verifyingOrder.id))}
                  </div>
                  <div className={styles.modalPickupCodeHint}>
                    {isCompletedOrCancelled 
                      ? '12-значный код верификации заказа' 
                      : 'Сверьте данный 12-значный код с кодом в электронном чеке на телефоне клиента (или запросите устно)'}
                  </div>
                </div>

                <div className={styles.modalFooter} style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  {isCompletedOrCancelled ? (
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      onClick={() => setVerifyingOrder(null)}
                    >
                      Закрыть
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.cancelBtn}
                        onClick={() => setVerifyingOrder(null)}
                        disabled={isVerifying}
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        className={styles.submitBtn}
                        onClick={() => handleVerifyCode()}
                        disabled={isVerifying}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: '#15803d',
                          padding: '10px 22px',
                          fontWeight: 700,
                        }}
                      >
                        <CheckCircle size={16} />
                        {isVerifying ? 'Завершение...' : 'Выдать'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* MODAL 2: ASSIGN COURIER */}
        {assigningOrder && (
          <div className={styles.modalOverlay} onClick={() => setAssigningOrder(null)}>
            <div className={styles.courierModalCard} onClick={e => e.stopPropagation()}>
              <h3 className={styles.modalTitle} style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-navy)' }}>
                Передать курьеру
              </h3>
              <p className={styles.modalDesc} style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b' }}>
                Заказ №{assigningOrder.id} ({assigningOrder.customer_name}, {Number(assigningOrder.amount).toLocaleString('ru-RU')} ₸).
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
                        onClick={() => setSelectedCourierId(prev => prev === c.id ? '' : c.id)}
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

              <div className={styles.modalFooter} style={{ borderTop: '1px solid #f1f5f9', paddingTop: '16px', display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setAssigningOrder(null)}
                  style={{ flex: 1 }}
                >
                  Отмена
                </button>
                {assigningOrder.assigned_courier_id && !selectedCourierId ? (
                  <button
                    type="button"
                    onClick={handleUnassignCourier}
                    style={{
                      flex: 1,
                      backgroundColor: '#fee2e2',
                      color: '#b91c1c',
                      border: '1px solid #fca5a5',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '10px 16px',
                      borderRadius: '8px',
                      fontSize: '14px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Снять курьера
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.submitBtn}
                    disabled={!selectedCourierId}
                    onClick={handleAssignCourier}
                    style={{ flex: 1 }}
                  >
                    {assigningOrder.assigned_courier_id && selectedCourierId !== assigningOrder.assigned_courier_id
                      ? 'Сменить курьера'
                      : 'Передать курьеру'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODAL 3: KILL-SWITCH CONFIRMATION MODAL */}
        {isKillSwitchModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsKillSwitchModalOpen(false)}>
            <div className={styles.modalCard} onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <h3 className={styles.modalTitle}>
                {killSwitchActive ? 'Возобновить приём заказов?' : 'Приостановить приём заказов?'}
              </h3>
              <p className={styles.modalDesc} style={{ fontSize: '14px', lineHeight: 1.5, color: '#475569' }}>
                {killSwitchActive
                  ? 'Вы действительно хотите возобновить приём заказов на сайте? Покупатели снова смогут оформлять покупки с доставкой и самовывозом, а корзина станет активной.'
                  : 'Вы действительно хотите приостановить приём заказов на сайте? Пользователи увидят сервисное уведомление в корзине и не смогут оформлять новые покупки.'}
              </p>
              <div className={styles.modalFooter} style={{ marginTop: '24px' }}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setIsKillSwitchModalOpen(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className={styles.submitBtn}
                  style={{
                    background: killSwitchActive ? 'var(--color-navy-gradient)' : '#d97706',
                  }}
                  onClick={async () => {
                    await handleToggleKillSwitch();
                    setIsKillSwitchModalOpen(false);
                  }}
                >
                  Подтвердить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 4: PROMOCODE CONFIGURATION & MANUAL INPUT MODAL */}
        {isPromoConfigModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsPromoConfigModalOpen(false)}>
            <div className={styles.modalCard} onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
              <h3 className={styles.modalTitle}>Настройка параметров скидки</h3>
              <p className={styles.modalDesc} style={{ fontSize: '13px', marginBottom: '20px' }}>
                Вы можете регулировать значения ползунками или вводить точные суммы в поля справа:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* 1. Размер скидки */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-navy)' }}>
                      Размер скидки ({promoType === 'percent' ? '%' : '₸'})
                    </label>
                    <input
                      type="number"
                      min={promoType === 'percent' ? 1 : 500}
                      max={promoType === 'percent' ? 100 : 150000}
                      value={promoValue}
                      onChange={e => setPromoValue(Math.max(1, Number(e.target.value)))}
                      className={styles.manualInputBox}
                    />
                  </div>
                  <input
                    type="range"
                    min={promoType === 'percent' ? 1 : 500}
                    max={promoType === 'percent' ? 30 : 50000}
                    step={promoType === 'percent' ? 1 : 500}
                    value={Math.min(promoValue, promoType === 'percent' ? 30 : 50000)}
                    onChange={e => setPromoValue(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* 2. Минимальная корзина */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-navy)' }}>
                      Мин. корзина (₸)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={150000}
                      step={1000}
                      value={minCartTotal}
                      onChange={e => setMinCartTotal(Math.max(0, Number(e.target.value)))}
                      className={styles.manualInputBox}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={150000}
                    step={5000}
                    value={Math.min(minCartTotal, 150000)}
                    onChange={e => setMinCartTotal(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* 2b. Максимальная сумма корзины (до) */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-navy)' }}>
                      Макс. корзина (до ₸, опционально)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={500000}
                      step={1000}
                      placeholder="Без ограничений"
                      value={maxCartTotal}
                      onChange={e => setMaxCartTotal(e.target.value ? Number(e.target.value) : '')}
                      className={styles.manualInputBox}
                    />
                  </div>
                </div>

                {/* 3. Потолок скидки */}
                {promoType === 'percent' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-navy)' }}>
                        Потолок скидки (₸)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={150000}
                        step={1000}
                        value={maxDiscount}
                        onChange={e => setMaxDiscount(Math.max(0, Number(e.target.value)))}
                        className={styles.manualInputBox}
                      />
                    </div>
                    <input
                      type="range"
                      min={1000}
                      max={150000}
                      step={2000}
                      value={Math.min(maxDiscount, 150000)}
                      onChange={e => setMaxDiscount(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}
              </div>

              <div className={styles.modalFooter} style={{ marginTop: '28px' }}>
                <button
                  type="button"
                  className={styles.submitBtn}
                  style={{ width: '100%' }}
                  onClick={() => setIsPromoConfigModalOpen(false)}
                >
                  Готово
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DATE RANGE PICKER MODAL */}
        {isDatePickerOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsDatePickerOpen(false)}>
            <div className={styles.datePickerModalCard} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className={styles.datePickerHeader}>
                <h3 className={styles.datePickerTitle}>
                  <Calendar size={18} color="var(--color-navy)" />
                  Выбрать дату
                </h3>
                <button
                  type="button"
                  className={styles.datePickerCloseBtn}
                  onClick={() => setIsDatePickerOpen(false)}
                  title="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body: Scrollable Months + Draggable Circle Slider */}
              <div className={styles.datePickerBody}>
                <div
                  ref={scrollContainerRef}
                  className={styles.calendarScrollContainer}
                  onScroll={handleContainerScroll}
                >
                  {monthsList.map(({ year, month, name }) => {
                    const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const blanks = Array.from({ length: firstDayOfWeek });
                    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

                    return (
                      <div key={`${year}-${month}`} className={styles.monthBlock}>
                        <div className={styles.monthTitle}>{name}</div>
                        <div className={styles.weekdaysGrid}>
                          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(wd => (
                            <span key={wd}>{wd}</span>
                          ))}
                        </div>
                        <div className={styles.daysGrid}>
                          {blanks.map((_, bIdx) => (
                            <div key={`blank-${bIdx}`} style={{ width: 36, height: 36 }} />
                          ))}
                          {days.map(dNum => {
                            const thisDate = new Date(year, month, dNum);
                            // Reference today is 05.11.2026: Nov 2026 days > 5 are disabled
                            const isFuture = (year === 2026 && month === 10 && dNum > 5) || (year === 2026 && month > 10) || year > 2026;
                            const isSelectable = !isFuture;

                            const isStart = pickerStartDate && (
                              pickerStartDate.getFullYear() === year &&
                              pickerStartDate.getMonth() === month &&
                              pickerStartDate.getDate() === dNum
                            );

                            const isEnd = pickerEndDate && (
                              pickerEndDate.getFullYear() === year &&
                              pickerEndDate.getMonth() === month &&
                              pickerEndDate.getDate() === dNum
                            );

                            const isInRange = Boolean(
                              pickerStartDate && pickerEndDate &&
                              thisDate > pickerStartDate && thisDate < pickerEndDate
                            );

                            let dayClasses = `${styles.calendarDay} `;
                            if (isSelectable) {
                              dayClasses += `${styles.daySelectable} `;
                            } else {
                              dayClasses += `${styles.dayDisabled} `;
                            }
                            if (isStart || isEnd) {
                              dayClasses += `${styles.daySelected} `;
                            } else if (isInRange) {
                              dayClasses += `${styles.dayInRange} `;
                            }

                            return (
                              <button
                                key={dNum}
                                type="button"
                                disabled={!isSelectable}
                                className={dayClasses}
                                onClick={() => isSelectable && handleDayClick(year, month, dNum)}
                              >
                                {dNum}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Draggable Circle Slider (Only track + circle thumb, NO text, NO labels) */}
                <div
                  ref={trackRef}
                  className={styles.sliderTrackWrapper}
                  onPointerDown={handleTrackPointerDown}
                  title="Перетащите ползунок для прокрутки"
                >
                  <div className={styles.sliderRail} />
                  <div
                    className={styles.sliderThumbCircle}
                    style={{
                      top: `${scrollRatio * 100}%`,
                      transform: `translateY(-${scrollRatio * 100}%)`,
                    }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className={styles.datePickerFooter}>
                <div className={styles.dateRangeSummary}>
                  {pickerStartDate ? (
                    <span>
                      Выбрано: <strong>{pickerStartDate.toLocaleDateString('ru-RU')}</strong>
                      {pickerEndDate ? ` — ` : ''}
                      {pickerEndDate && <strong>{pickerEndDate.toLocaleDateString('ru-RU')}</strong>}
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Выберите период</span>
                  )}
                </div>

                <div className={styles.datePickerActions}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => {
                      setPickerStartDate(null);
                      setPickerEndDate(null);
                      setAppliedDateRange({ start: null, end: null });
                      setPeriod('30');
                      setIsDatePickerOpen(false);
                    }}
                  >
                    Сбросить
                  </button>
                  <button
                    type="button"
                    className={styles.submitBtn}
                    disabled={!pickerStartDate}
                    onClick={() => {
                      if (!pickerStartDate) return;
                      const startIso = pickerStartDate.toISOString();
                      const endIso = (pickerEndDate || new Date(pickerStartDate.getTime() + 24 * 60 * 60 * 1000 - 1)).toISOString();
                      setAppliedDateRange({ start: startIso, end: endIso });
                      setPeriod('custom');
                      setIsDatePickerOpen(false);
                      addToast(`Период выбран: ${pickerStartDate.toLocaleDateString('ru-RU')} — ${(pickerEndDate || pickerStartDate).toLocaleDateString('ru-RU')}`, 'success');
                    }}
                  >
                    Применить
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
