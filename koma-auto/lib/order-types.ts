export type OrderStatus = 'pending' | 'paid' | 'declined';

export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  article?: string;
}

export interface OrderCustomer {
  name: string;
  phone: string;
  email?: string;
  comment?: string;
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
  paymentMethod: 'online' | 'cash' | 'card_receipt';
  paymentUrl?: string; // Halyk ePay direct link
  receiptUrl?: string;
  userId?: string | null;
  items: OrderItem[];
  moySkladOrderId?: string;
  moySkladTaskId?: string;
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
