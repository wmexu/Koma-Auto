'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Order, OrderStatus, getEffectiveOrderStatus, getOrderStatusLabel } from '@/lib/order-types';
import { fetchUserOrders } from '@/lib/orders';
import styles from './OrdersHistory.module.css';
import {
  Package,
  Clock,
  CheckCircle,
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
} from 'lucide-react';

interface OrdersHistoryProps {
  userId?: string | null;
}

export default function OrdersHistory({ userId }: OrdersHistoryProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
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

  return (
    <div className={styles.ordersContainer}>
      {orders.map((order) => {
        const effectiveStatus = getEffectiveOrderStatus(order);
        const remData = effectiveStatus === 'pending' ? getRemainingTimeData(order) : null;
        const totalItemsCount = order.items.reduce((acc, i) => acc + i.quantity, 0);

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

              <div>
                {effectiveStatus === 'paid' && (
                  <span className={`${styles.statusBadge} ${styles.statusPaid}`}>
                    <CheckCircle size={15} />
                    <span>Оплачен</span>
                  </span>
                )}
                {effectiveStatus === 'pending' && (
                  <span className={`${styles.statusBadge} ${styles.statusPending}`}>
                    <Clock size={15} />
                    <span>Не оплачен {remData ? `(${remData.prefix} ${remData.text})` : ''}</span>
                  </span>
                )}
                {effectiveStatus === 'declined' && (
                  <span className={`${styles.statusBadge} ${styles.statusDeclined}`}>
                    <XCircle size={15} />
                    <span>Отклонен</span>
                  </span>
                )}
              </div>
            </div>

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

            {/* Thumbnails row (WB/Ozon style) */}
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
                <button
                  className={styles.detailsBtn}
                  onClick={() => setSelectedOrder(order)}
                >
                  <span>Состав заказа ({totalItemsCount} шт)</span>
                  <ChevronRight size={16} />
                </button>

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

                {effectiveStatus === 'paid' && (
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
      })}

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
                <div
                  className={styles.timerNoticeBox}
                  style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={18} />
                    <span>Время оплаты (20 минут) истекло либо платёж был отклонён банком</span>
                  </div>
                </div>
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
    </div>
  );
}
