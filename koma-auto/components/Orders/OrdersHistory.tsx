'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Order, OrderStatus, getEffectiveOrderStatus, getOrderStatusLabel } from '@/lib/order-types';
import { fetchUserOrders } from '@/lib/orders';
import { formatPickupCode, getOrderPickupCode } from '@/lib/pickup-code';
import styles from './OrdersHistory.module.css';
import {
  Package,
  Clock,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Truck,
  MapPin,
  ExternalLink,
  Receipt,
  CreditCard,
  ChevronRight,
  X,
  Printer,
  Calendar,
  Phone,
  User,
  AlertCircle,
  KeyRound,
  Layers,
  Ban,
} from 'lucide-react';

interface OrdersHistoryProps {
  userId?: string | null;
  sectionOrder?: 'active_first' | 'closed_first' | 'cancelled_first';
  onActiveCountChange?: (count: number) => void;
}

function WhatsAppIcon({ size = 16, color = '#10B981', className = '' }: { size?: number; color?: string; className?: string }) {
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

export default function OrdersHistory({ userId, sectionOrder = 'active_first', onActiveCountChange }: OrdersHistoryProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [locationModalOrder, setLocationModalOrder] = useState<Order | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // 1. Load orders on mount and sync
  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      const list = await fetchUserOrders(userId);
      if (mounted) {
        setOrders(list);
        setIsLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [userId]);

  // 2. Timer ticker for live 20-minute payment countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Split into Active, Closed, and Cancelled orders according to user specification
  const isOrderCancelled = (o: Order) => {
    const eff = getEffectiveOrderStatus(o);
    return o.fulfillmentStatus === 'cancelled' || eff === 'declined';
  };

  const isOrderClosed = (o: Order) => {
    return !isOrderCancelled(o) && (o.fulfillmentStatus === 'completed' || (getEffectiveOrderStatus(o) as any) === 'completed');
  };

  const isOrderActive = (o: Order) => {
    return !isOrderCancelled(o) && !isOrderClosed(o);
  };

  // Strict sorting: Newest orders ALWAYS appear first at the top
  const activeOrders = orders
    .filter(isOrderActive)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const closedOrders = orders
    .filter(isOrderClosed)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const cancelledOrders = orders
    .filter(isOrderCancelled)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Top-level hook: Always runs before any early returns to strictly satisfy React Rules of Hooks
  useEffect(() => {
    onActiveCountChange?.(activeOrders.length);
  }, [activeOrders.length, onActiveCountChange]);

  // Format date helper
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return isoString;
    }
  };

  // Remaining time helper (handles days, hours, and minutes)
  const getRemainingTimeData = (order: Order) => {
    if (!order.expiresAt) return null;
    const expiresMs = new Date(order.expiresAt).getTime();
    const diff = expiresMs - currentTime;
    if (diff <= 0) return null;

    const totalSeconds = Math.floor(diff / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    if (days >= 1) {
      if (days % 10 === 1 && days % 100 !== 11) {
        return { text: `${days} день`, prefix: 'остался' };
      } else if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) {
        return { text: `${days} дня`, prefix: 'осталось' };
      } else {
        return { text: `${days} дней`, prefix: 'осталось' };
      }
    }

    if (totalHours >= 1) {
      const remainingMinutes = totalMinutes % 60;
      let hourStr = '';
      if (totalHours % 10 === 1 && totalHours % 100 !== 11) {
        hourStr = `${totalHours} час`;
      } else if ([2, 3, 4].includes(totalHours % 10) && ![12, 13, 14].includes(totalHours % 100)) {
        hourStr = `${totalHours} часа`;
      } else {
        hourStr = `${totalHours} часов`;
      }

      if (remainingMinutes > 0) {
        return { text: `${hourStr} ${remainingMinutes} мин.`, prefix: 'осталось' };
      }
      return { text: hourStr, prefix: 'осталось' };
    }

    const secs = totalSeconds % 60;
    return { text: `${totalMinutes}:${secs < 10 ? '0' : ''}${secs}`, prefix: 'осталось' };
  };

  if (isLoading) {
    return (
      <div className={styles.orderCard} style={{ textAlign: 'center', padding: '36px' }}>
        <p style={{ color: 'var(--color-navy)', fontSize: '15px' }}>Загрузка истории заказов...</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className={styles.emptyState} style={{ padding: '40px 20px', textAlign: 'center' }}>
        <Package size={44} color="#94a3b8" style={{ marginBottom: '12px' }} />
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-navy)', margin: '0 0 4px' }}>
          У вас пока нет заказов
        </h3>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px' }}>
          История покупок и статус доставки появятся здесь после оформления заказа
        </p>
        <Link
          href="/catalog"
          className={styles.payBtn}
          style={{ textDecoration: 'none', display: 'inline-flex' }}
        >
          Перейти в каталог
        </Link>
      </div>
    );
  }

  const renderStatusBadge = (order: Order) => {
    const effectiveStatus = getEffectiveOrderStatus(order);
    const isCancelled = isOrderCancelled(order);
    const isCompleted = order.fulfillmentStatus === 'completed';

    if (isCompleted) {
      return (
        <span className={`${styles.statusBadge} ${styles.statusCompleted}`}>
          <CheckCircle size={15} />
          <span>Выдан</span>
        </span>
      );
    }

    if (isCancelled) {
      const isStaffCancelled =
        (order as any).cancelledBy === 'admin' ||
        (order as any).cancelledBy === 'staff' ||
        (order as any).customStatusText === 'Отменен менеджером' ||
        (order.cancellationReason && order.cancellationReason.toLowerCase().includes('менеджер'));

      return (
        <span className={`${styles.statusBadge} ${styles.statusDeclined}`}>
          <XCircle size={15} />
          <span>{isStaffCancelled ? 'Отменен менеджером' : 'Отклонен'}</span>
        </span>
      );
    }

    if (effectiveStatus === 'pending') {
      const remData = getRemainingTimeData(order);
      return (
        <span className={`${styles.statusBadge} ${styles.statusPending}`}>
          <Clock size={15} />
          <span>Не оплачен {remData ? `(${remData.prefix} ${remData.text})` : ''}</span>
        </span>
      );
    }

    if ((order as any).customStatusText) {
      return (
        <span className={`${styles.statusBadge} ${styles.statusAssembling}`}>
          <Clock size={15} />
          <span>{(order as any).customStatusText}</span>
        </span>
      );
    }

    if ((order.fulfillmentStatus as any) === 'packaging') {
      return (
        <span className={`${styles.statusBadge} ${styles.statusAssembling}`}>
          <Package size={15} />
          <span>Упаковывается</span>
        </span>
      );
    }

    if ((order.fulfillmentStatus as any) === 'delivered') {
      return (
        <span className={`${styles.statusBadge} ${styles.statusReady}`}>
          <CheckCircle size={15} />
          <span>Доставлен по адресу</span>
        </span>
      );
    }

    if (order.fulfillmentStatus === 'ready_for_pickup' || (order as any).customStatusText === 'Готов к получению') {
      return (
        <span className={`${styles.statusBadge} ${styles.statusReady}`}>
          <Package size={15} />
          <span>Готов к получению</span>
        </span>
      );
    }

    if (order.fulfillmentStatus === 'out_for_delivery') {
      return (
        <span className={`${styles.statusBadge} ${styles.statusOutForDelivery}`}>
          <Truck size={15} />
          <span>Передан в доставку</span>
        </span>
      );
    }

    // Default paid / in assembly
    return (
      <span className={`${styles.statusBadge} ${styles.statusAssembling}`}>
        <Clock size={15} />
        <span>На складе</span>
      </span>
    );
  };

  const renderOrderCard = (order: Order) => {
    const effectiveStatus = getEffectiveOrderStatus(order);
    const totalItemsCount = order.items.reduce((acc, i) => acc + i.quantity, 0);
    const isPickupReady =
      order.deliveryMethod === 'pickup' &&
      (order.fulfillmentStatus === 'ready_for_pickup' || (order as any).customStatusText === 'Готов к получению');

    return (
      <div key={order.id} className={styles.orderCard}>
        {/* Header: Number, Date, Status */}
        <div className={styles.orderHeader}>
          <div className={styles.orderTitleCol}>
            <div className={styles.orderNumber}>Заказ №{order.id}</div>
            <div className={styles.orderDate}>
              <Calendar size={14} />
              <span>{formatDate(order.createdAt)}</span>
            </div>
          </div>

          <div>{renderStatusBadge(order)}</div>
        </div>

        {/* Admin cancellation banner on order card */}
        {(effectiveStatus === 'declined' || order.fulfillmentStatus === 'cancelled') && (order.cancellationReason || order.refundMessage) && (
          <div className={styles.cancellationBanner}>
            <div className={styles.cancellationHeader}>
              <AlertCircle size={15} />
              <span>Заказ отменен магазином</span>
            </div>
            {order.cancellationReason && (
              <div className={styles.cancellationReason}>
                <strong>Причина:</strong> {order.cancellationReason}
              </div>
            )}
            {order.refundMessage && (
              <div className={styles.cancellationRefund}>
                💳 {order.refundMessage}
              </div>
            )}
          </div>
        )}

        {/* Delivery address / method */}
        <div className={styles.deliveryBanner}>
          {order.deliveryMethod === 'courier' ? (
            <Truck size={16} color="var(--color-navy)" />
          ) : (
            <MapPin size={16} color="var(--color-navy)" />
          )}
          <span style={{ fontWeight: 500 }}>
            {order.deliveryMethod === 'courier' ? 'Доставка: ' : 'Самовывоз: '}
          </span>
          <span style={{ color: '#334155' }}>{order.address}</span>
        </div>

        {/* Thumbnails row */}
        <div className={styles.thumbnailsRow}>
          {order.items.slice(0, 4).map((item, idx) => (
            <div key={idx} className={styles.thumbnailBox} title={`${item.name} (${item.quantity} шт)`}>
              {item.image ? (
                <img src={item.image} alt={item.name} className={styles.thumbnailImg} />
              ) : (
                <Package size={22} color="#94a3b8" />
              )}
            </div>
          ))}
          {order.items.length > 4 && (
            <div className={styles.moreItemsBox}>
              +{order.items.length - 4}
            </div>
          )}
        </div>

        {/* Footer with Price and Actions */}
        <div className={styles.orderFooter}>
          <div className={styles.totalCol}>
            <span className={styles.totalLabel}>Итого</span>
            <span className={styles.totalAmount}>
              {order.amount.toLocaleString('ru-RU')} ₸
            </span>
          </div>

          <div className={styles.actionsGroup}>
            <a
              href={`https://wa.me/77079194462?text=${encodeURIComponent(
                `Здраствуйте, я хочу задать вопрос насчёт моего заказа на сайте koma.com.kz: Заказ №${order.id}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.whatsappOrderBtn}
              title="Задать вопрос по заказу в WhatsApp"
            >
              <WhatsAppIcon size={16} color="#10B981" />
              <span>Задать вопрос</span>
            </a>

            <button
              className={styles.detailsBtn}
              onClick={() => setSelectedOrder(order)}
            >
              <span>Состав заказа ({totalItemsCount} шт)</span>
              <ChevronRight size={16} />
            </button>

            {isPickupReady && (
              <button
                type="button"
                className={styles.locationBtn}
                onClick={() => setLocationModalOrder(order)}
                title="Посмотреть адрес и график работы пункта выдачи"
              >
                <MapPin size={16} />
                <span>Где получить</span>
              </button>
            )}

            {effectiveStatus === 'pending' && order.paymentUrl && (
              <button
                className={styles.payBtn}
                onClick={() => {
                  if (order.paymentUrl) {
                    window.location.href = order.paymentUrl;
                  }
                }}
              >
                <CreditCard size={16} />
                <span>Оплатить (Halyk ePay)</span>
              </button>
            )}

            {(effectiveStatus === 'paid' || order.fulfillmentStatus === 'completed' || isPickupReady) && (
              <button
                className={styles.receiptBtn}
                onClick={() => setReceiptOrder(order)}
              >
                <Receipt size={16} />
                <span>Электронный чек</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const sectionGroups = [
    {
      id: 'active',
      title: 'Активные заказы',
      icon: <Layers size={20} color="var(--color-navy)" />,
      orders: activeOrders,
    },
    {
      id: 'closed',
      title: 'Закрытые заказы',
      icon: <CheckCircle2 size={20} color="var(--color-navy)" />,
      orders: closedOrders,
    },
    {
      id: 'cancelled',
      title: 'Отмененные заказы',
      icon: <XCircle size={20} color="#ef4444" />,
      orders: cancelledOrders,
    },
  ];

  let orderedSections = sectionGroups;
  if (sectionOrder === 'closed_first') {
    orderedSections = [sectionGroups[1], sectionGroups[0], sectionGroups[2]];
  } else if (sectionOrder === 'cancelled_first') {
    orderedSections = [sectionGroups[2], sectionGroups[0], sectionGroups[1]];
  }

  const hasAnyOrders = activeOrders.length > 0 || closedOrders.length > 0 || cancelledOrders.length > 0;

  return (
    <div className={styles.ordersContainer}>
      {!hasAnyOrders ? (
        <div style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b' }}>
          У вас пока нет оформленных заказов
        </div>
      ) : (
        orderedSections.map((sec, idx) => {
          if (sec.orders.length === 0) return null;
          return (
            <section key={sec.id} className={styles.ordersSection}>
              <div className={`${styles.sectionHeader} ${idx === 0 ? styles.sectionHeaderFirst : ''}`}>
                <h2 className={styles.sectionTitle}>
                  <span className={styles.sectionTitleIcon}>{sec.icon}</span>
                  <span>{sec.title}</span>
                  <span className={styles.sectionCount}>({sec.orders.length})</span>
                </h2>
              </div>
              <div className={styles.ordersListGrid}>
                {sec.orders.map(renderOrderCard)}
              </div>
            </section>
          );
        })
      )}

      {/* 3. ORDER DETAILS MODAL (WB / Ozon style) */}
      {selectedOrder && (
        <div className={styles.modalOverlay} onClick={() => setSelectedOrder(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderTitle}>
                <span>Заказ №{selectedOrder.id}</span>
                {getEffectiveOrderStatus(selectedOrder) === 'paid' && (
                  <span className={`${styles.statusBadge} ${styles.statusPaid}`}>Оплачен</span>
                )}
                {getEffectiveOrderStatus(selectedOrder) === 'pending' && (
                  <span className={`${styles.statusBadge} ${styles.statusPending}`}>Не оплачен</span>
                )}
                {getEffectiveOrderStatus(selectedOrder) === 'declined' && (
                  <span className={`${styles.statusBadge} ${styles.statusDeclined}`}>Отклонен</span>
                )}
              </div>
              <button
                className={styles.closeIconBtn}
                onClick={() => setSelectedOrder(null)}
                aria-label="Закрыть"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className={styles.modalBody}>
              {/* Payment Timer Notice for pending orders */}
              {getEffectiveOrderStatus(selectedOrder) === 'pending' && (() => {
                const modalRem = getRemainingTimeData(selectedOrder);
                const isLongExpiry = selectedOrder.expiresAt && selectedOrder.createdAt &&
                  (new Date(selectedOrder.expiresAt).getTime() - new Date(selectedOrder.createdAt).getTime() > 3600000);
                return (
                  <div className={styles.timerNoticeBox}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={18} />
                      <span>{isLongExpiry ? 'Срок резерва заказа' : 'Сессия онлайн-оплаты активна 20 минут с момента оформления'}</span>
                    </div>
                    {modalRem && (
                      <div className={styles.timerCountdown}>
                        {modalRem.prefix === 'остался' ? 'Остался' : 'Осталось'}: {modalRem.text}
                      </div>
                    )}
                  </div>
                );
              })()}

              {getEffectiveOrderStatus(selectedOrder) === 'declined' && (
                selectedOrder.cancellationReason || selectedOrder.refundMessage ? (
                  <div className={styles.cancellationBanner} style={{ margin: '0 0 16px' }}>
                    <div className={styles.cancellationHeader}>
                      <AlertCircle size={17} />
                      <span style={{ fontSize: '14px' }}>Заказ отменен администратором магазина</span>
                    </div>
                    {selectedOrder.cancellationReason && (
                      <div className={styles.cancellationReason} style={{ fontSize: '13px' }}>
                        <strong>Причина отмены:</strong> {selectedOrder.cancellationReason}
                      </div>
                    )}
                    {selectedOrder.refundMessage && (
                      <div className={styles.cancellationRefund} style={{ fontSize: '13px' }}>
                        💳 {selectedOrder.refundMessage}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className={styles.timerNoticeBox}
                    style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertCircle size={18} />
                      <span>Время оплаты (20 минут) истекло либо платёж был отклонён банком</span>
                    </div>
                  </div>
                )
              )}

              {/* Items List */}
              <div>
                <h4 className={styles.modalSectionTitle}>
                  <Package size={17} color="var(--color-navy)" />
                  <span>Товары в заказе ({selectedOrder.items.length})</span>
                </h4>
                <div className={styles.itemsList}>
                  {selectedOrder.items.map((item, idx) => (
                    <Link
                      key={idx}
                      href={`/product/${item.id}`}
                      className={styles.itemRow}
                      title={`Перейти к товару: ${item.name}`}
                    >
                      <div className={styles.itemInfo}>
                        <div className={styles.itemThumb}>
                          {item.image ? (
                            <img src={item.image} alt={item.name} className={styles.thumbnailImg} />
                          ) : (
                            <Package size={22} color="#94a3b8" />
                          )}
                        </div>
                        <div className={styles.itemDetails}>
                          <div className={styles.itemName}>{item.name}</div>
                          {item.article && (
                            <div className={styles.itemArticle}>OEM: {item.article}</div>
                          )}
                        </div>
                      </div>
                      <div className={styles.itemPricing}>
                        <span className={styles.itemSubtotal}>
                          {(item.price * item.quantity).toLocaleString('ru-RU')} ₸
                        </span>
                        <span className={styles.itemQuantityPrice}>
                          {item.quantity} шт × {item.price.toLocaleString('ru-RU')} ₸
                        </span>
                      </div>
                      <ChevronRight size={16} className={styles.itemArrow} />
                    </Link>
                  ))}
                </div>
              </div>

              {/* Delivery info */}
              <div>
                <h4 className={styles.modalSectionTitle}>
                  <Truck size={17} color="var(--color-navy)" />
                  <span>Детали доставки и получатель</span>
                </h4>
                <div className={styles.summaryBox}>
                  <div className={styles.summaryRow}>
                    <span>Способ получения:</span>
                    <strong style={{ color: 'var(--color-navy)' }}>
                      {selectedOrder.deliveryMethod === 'courier' ? 'Курьерская доставка' : 'Самовывоз из магазина'}
                    </strong>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>Адрес:</span>
                    <span style={{ textAlign: 'right', maxWidth: '300px' }}>{selectedOrder.address}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>Получатель:</span>
                    <span>{selectedOrder.customer.name}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>Телефон:</span>
                    <span>{selectedOrder.customer.phone}</span>
                  </div>
                  {selectedOrder.customer.email && (
                    <div className={styles.summaryRow}>
                      <span>Email:</span>
                      <span>{selectedOrder.customer.email}</span>
                    </div>
                  )}
                  {selectedOrder.customer.comment && (
                    <div className={styles.summaryRow}>
                      <span>Комментарий:</span>
                      <span style={{ fontStyle: 'italic' }}>{selectedOrder.customer.comment}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Summary and Price breakdown */}
              <div>
                <h4 className={styles.modalSectionTitle}>
                  <CreditCard size={17} color="var(--color-navy)" />
                  <span>Оплата</span>
                </h4>
                <div className={styles.summaryBox}>
                  <div className={styles.summaryRow}>
                    <span>Стоимость товаров:</span>
                    <span>{selectedOrder.itemsPrice.toLocaleString('ru-RU')} ₸</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>Доставка:</span>
                    <span>
                      {selectedOrder.deliveryCost > 0
                        ? `${selectedOrder.deliveryCost.toLocaleString('ru-RU')} ₸`
                        : 'Бесплатно'}
                    </span>
                  </div>
                  <div className={styles.summaryTotalRow}>
                    <span>Итого к оплате:</span>
                    <span>{selectedOrder.amount.toLocaleString('ru-RU')} ₸</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer with Actions */}
            <div className={styles.modalFooter}>
              {getEffectiveOrderStatus(selectedOrder) === 'pending' && selectedOrder.paymentUrl && (
                <button
                  className={styles.payBtn}
                  onClick={() => {
                    if (selectedOrder.paymentUrl) {
                      window.location.href = selectedOrder.paymentUrl;
                    }
                  }}
                >
                  <CreditCard size={16} />
                  <span>Перейти к оплате (Halyk ePay)</span>
                </button>
              )}

              {getEffectiveOrderStatus(selectedOrder) === 'paid' && (
                <button
                  className={styles.receiptBtn}
                  onClick={() => {
                    setReceiptOrder(selectedOrder);
                    setSelectedOrder(null);
                  }}
                >
                  <Receipt size={16} />
                  <span>Электронный чек</span>
                </button>
              )}

              {selectedOrder.deliveryMethod === 'pickup' && (
                <button
                  type="button"
                  className={styles.locationBtn}
                  onClick={() => setLocationModalOrder(selectedOrder)}
                  title="Посмотреть адрес и график работы пункта выдачи"
                >
                  <MapPin size={16} />
                  <span>Где получить</span>
                </button>
              )}

              <a
                href={`https://wa.me/77079194462?text=${encodeURIComponent(
                  `Здраствуйте, я хочу задать вопрос насчёт моего заказа на сайте koma.com.kz: Заказ №${selectedOrder.id}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.whatsappOrderBtn}
                title="Задать вопрос по заказу в WhatsApp"
              >
                <WhatsAppIcon size={16} color="#10B981" />
                <span>Задать вопрос</span>
              </a>

              <button className={styles.detailsBtn} onClick={() => setSelectedOrder(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. ELECTRONIC RECEIPT MODAL */}
      {receiptOrder && (
        <div className={styles.modalOverlay} onClick={() => setReceiptOrder(null)}>
          <div className={styles.receiptContainer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.receiptHeader}>
              <div className={styles.receiptLogo}>KOMA AUTO</div>
              <div className={styles.receiptSub}>ЭЛЕКТРОННЫЙ ЧЕК ПРОДАЖИ</div>
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                Продавец: ИП KAMOLDIN • ИИН: 860516303365
              </div>
            </div>

            <div className={styles.receiptMeta}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Заказ №:</span>
                <strong>{receiptOrder.id}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Терминал ePay:</span>
                <span>92250071</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Дата и время:</span>
                <span>{formatDate(receiptOrder.createdAt)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Статус оплаты:</span>
                <strong style={{ color: '#15803d' }}>ОПЛАЧЕНО (УСПЕШНО)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Платежная система:</span>
                <span>Halyk Bank ePay</span>
              </div>
            </div>

            <table className={styles.receiptTable}>
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th style={{ textAlign: 'center' }}>Кол-во</th>
                  <th style={{ textAlign: 'right' }}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {receiptOrder.items.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <div>{item.name}</div>
                      {item.article && <small style={{ color: '#64748b' }}>OEM: {item.article}</small>}
                    </td>
                    <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                    <td style={{ textAlign: 'right' }}>
                      {(item.price * item.quantity).toLocaleString('ru-RU')} ₸
                    </td>
                  </tr>
                ))}
                {receiptOrder.deliveryCost > 0 && (
                  <tr>
                    <td>Доставка курьером</td>
                    <td style={{ textAlign: 'center' }}>1</td>
                    <td style={{ textAlign: 'right' }}>
                      {receiptOrder.deliveryCost.toLocaleString('ru-RU')} ₸
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className={styles.receiptTotalRow}>
              <span>Итого к оплате:</span>
              <span>{receiptOrder.amount.toLocaleString('ru-RU')} ₸</span>
            </div>

            {/* 12-digit Secure Pickup Verification Code */}
            <div className={styles.pickupCodeSection}>
              <div className={styles.pickupCodeHeader}>
                <KeyRound size={17} />
                <span>Код верификации получения</span>
              </div>
              <p className={styles.pickupCodeDesc}>
                Предъявите этот код сотруднику магазина в Car City или курьеру при получении заказа
              </p>
              
              <div className={styles.codeRevealBox}>
                <div className={styles.codeNumber}>
                  {formatPickupCode(getOrderPickupCode(receiptOrder.id, receiptOrder.pickupCode))}
                </div>
                <div className={styles.codeWarning}>
                  Код активен для сверки сотрудником магазина / курьером
                </div>
              </div>
            </div>

            <div className={styles.receiptFooterActions}>
              <button
                className={styles.printBtn}
                onClick={() => {
                  if (typeof window !== 'undefined') window.print();
                }}
              >
                <Printer size={16} />
                <span>Распечатать чек</span>
              </button>
              <button className={styles.detailsBtn} onClick={() => setReceiptOrder(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. "Где получить" (Location & Schedule) MODAL */}
      {locationModalOrder && (
        <div className={styles.modalOverlay} onClick={() => setLocationModalOrder(null)}>
          <div className={`${styles.modalCard} ${styles.locationModalCard}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MapPin size={20} color="var(--color-navy)" />
                <h3 className={styles.modalTitle} style={{ margin: 0 }}>Где получить заказ</h3>
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setLocationModalOrder(null)}
                aria-label="Закрыть"
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.locationModalBody}>
              <div className={styles.locationStoreInfo}>
                <div className={styles.locationStoreBadge}>Пункт самовывоза KOMA AUTO</div>
                <div className={styles.locationAddressText}>
                  Республика Казахстан, г. Алматы, Ауэзовский район, мкр. Баянауыл 57а, ТЦ Car City, 1 ярус, 111 бутик
                </div>
              </div>

              <div className={styles.locationHoursBox}>
                <div className={styles.locationHoursTitle}>
                  <Clock size={16} />
                  <span>График работы:</span>
                </div>
                <div className={styles.locationHoursGrid}>
                  <div className={styles.locationHoursRow}>
                    <span className={styles.locationHoursDay}>Понедельник — Суббота:</span>
                    <span className={styles.locationHoursTime}>09:00 – 18:00</span>
                  </div>
                  <div className={styles.locationHoursRow}>
                    <span className={styles.locationHoursDay}>Воскресенье:</span>
                    <span className={styles.locationHoursTime}>09:00 – 18:00</span>
                  </div>
                  <div className={styles.locationHoursRow} style={{ color: '#b91c1c' }}>
                    <span className={styles.locationHoursDay}>Первый понедельник месяца:</span>
                    <span className={styles.locationHoursTime}>Закрыто (санитарный день)</span>
                  </div>
                </div>
              </div>

              <div className={styles.locationMapWrap}>
                <iframe
                  src="https://widgets.2gis.com/widget?type=firmsonmap&options=%7B%22pos%22%3A%7B%22lat%22%3A43.23943484010419%2C%22lon%22%3A76.82228565216066%2C%22zoom%22%3A16%7D%2C%22opt%22%3A%7B%22city%22%3A%22almaty%22%7D%2C%22org%22%3A%2270000001018022676%22%7D"
                  width="100%"
                  height="260"
                  style={{ border: 0, borderRadius: '10px', display: 'block' }}
                  title="Схема проезда 2GIS"
                  allowFullScreen
                  loading="lazy"
                />
              </div>

              <div className={styles.locationModalActions}>
                <a
                  href="https://2gis.kz/almaty/firm/70000001018022676"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.openMapBtn}
                >
                  <ExternalLink size={16} />
                  <span>Открыть в 2GIS</span>
                </a>
                <button
                  type="button"
                  className={styles.detailsBtn}
                  onClick={() => setLocationModalOrder(null)}
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
