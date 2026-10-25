export type OrderStatus = 'pending' | 'paid' | 'declined';

export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  article?: string;
  oem?: string;
  brand?: string;
}

export interface OrderCustomer {
  name: string;
  phone: string;
  email?: string;
  comment?: string;
}

export interface UserAccountDetails {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  phone?: string | null;
}

export interface Order {
  id: string; // e.g. "176819032"
  invoiceId: string;
  createdAt: string; // ISO string
  expiresAt: string; // ISO string (createdAt + 20 minutes)
  status: OrderStatus;
  amount: number; // Final total with delivery
  itemsPrice: number;
  deliveryCost: number;
  deliveryMethod: 'courier' | 'pickup';
  address: string;
  city?: string;
  customer: OrderCustomer;
  paymentMethod: 'online' | 'cash' | 'card_receipt' | 'kaspi_pay';
  kaspiPhone?: string;
  paymentUrl?: string; // Halyk ePay direct link
  receiptUrl?: string;
  userId?: string | null;
  userAccountDetails?: UserAccountDetails | null;
  items: OrderItem[];
  moySkladOrderId?: string;
  moySkladTaskId?: string;
  isTestOrder?: boolean;
  promoCode?: string;
  notificationSent?: boolean;
  // Cancellation and refund attributes
  cancelledAt?: string;
  cancelledBy?: 'admin' | 'user' | 'system';
  cancellationReason?: string;
  refundStatus?: 'completed' | 'pending' | 'failed' | 'manual_required' | 'not_applicable';
  refundAmount?: number;
  refundTransactionId?: string;
  refundMessage?: string;
  // CRM & Verification attributes
  pickupCode?: string;
  pickupCodeHash?: string;
  fulfillmentStatus?: OrderFulfillmentStatus;
  assignedCourierId?: string;
  assignedCourierName?: string;
  completedAt?: string;
  completedByUserId?: string;
  warehouseId?: string;
}

export type OrderFulfillmentStatus = 
  | 'assembling'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled';

export function getFulfillmentStatusLabel(status?: OrderFulfillmentStatus): string {
  switch (status) {
    case 'assembling':
      return 'В сборке';
    case 'ready_for_pickup':
      return 'Готов к получению';
    case 'out_for_delivery':
      return 'Выдан курьеру';
    case 'completed':
      return 'Выдан';
    case 'cancelled':
      return 'Отменен';
    default:
      return 'В сборке';
  }
}

/**
 * Returns effective status taking 20-minute expiry into account
 */
export function getEffectiveOrderStatus(order: Order): OrderStatus {
  if (order.status === 'paid') return 'paid';
  if (order.status === 'declined') return 'declined';

  if (order.status === 'pending') {
    if (order.expiresAt && new Date() > new Date(order.expiresAt)) {
      return 'declined';
    }
    return 'pending';
  }

  return order.status;
}

/**
 * Formats status for UI display in Russian
 */
export function getOrderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'paid':
      return 'Оплачен';
    case 'pending':
      return 'Не оплачен';
    case 'declined':
      return 'Отклонен';
    default:
      return 'Не оплачен';
  }
}
