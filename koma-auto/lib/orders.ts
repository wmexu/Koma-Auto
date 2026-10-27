import { Order, OrderStatus } from './order-types';

const STORAGE_KEY = 'koma_orders';

export function getLocalOrders(): Order[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
  } catch (e) {
    console.error('Error loading local orders:', e);
  }
  return [];
}

export function getLocalOrderById(orderId: string): Order | null {
  const orders = getLocalOrders();
  return orders.find((o) => o.id === orderId || o.invoiceId === orderId) || null;
}

export function saveLocalOrder(order: Order): void {
  if (typeof window === 'undefined') return;
  try {
    const orders = getLocalOrders();
    const existingIndex = orders.findIndex(
      (o) => o.id === order.id || o.invoiceId === order.invoiceId
    );
    if (existingIndex >= 0) {
      orders[existingIndex] = { ...orders[existingIndex], ...order };
    } else {
      orders.unshift(order);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch (e) {
    console.error('Error saving local order:', e);
  }
}

export function updateLocalOrderStatus(orderId: string, status: OrderStatus): void {
  if (typeof window === 'undefined') return;
  try {
    const orders = getLocalOrders();
    let updated = false;
    const newOrders = orders.map((o) => {
      if (o.id === orderId || o.invoiceId === orderId) {
        updated = true;
        return { ...o, status };
      }
      return o;
    });
    if (updated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrders));
    }
  } catch (e) {
    console.error('Error updating local order status:', e);
  }
}

/**
 * Saves or updates order on backend API and Firestore
 */
export async function persistOrder(order: Order): Promise<void> {
  // Always save locally first for instant response
  saveLocalOrder(order);

  try {
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
  } catch (e) {
    console.error('Failed to persist order to server API:', e);
  }
}

/**
 * Syncs orders with backend
 */
export async function fetchUserOrders(userId?: string | null): Promise<Order[]> {
  const localOrders = getLocalOrders();

  if (!userId) {
    return localOrders;
  }

  try {
    let token: string | null = null;
    try {
      const { auth } = await import('@/lib/firebase');
      if (auth?.currentUser) {
        token = await auth.currentUser.getIdToken().catch(() => null);
      }
    } catch {}

    const headers: Record<string, string> = {
      'x-user-id': userId,
    };
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`/api/orders?userId=${encodeURIComponent(userId)}`, {
      headers,
    });
    if (res.ok) {
      const serverOrders: Order[] = await res.json();
      // Merge unique orders
      const orderMap = new Map<string, Order>();
      serverOrders.forEach((o) => orderMap.set(o.id, o));
      localOrders.forEach((o) => {
        if (!orderMap.has(o.id)) {
          orderMap.set(o.id, o);
        } else {
          // If server order has paid status, prefer server
          const sOrder = orderMap.get(o.id)!;
          if (o.status === 'paid' && sOrder.status !== 'paid') {
            orderMap.set(o.id, { ...sOrder, status: 'paid' });
          }
        }
      });
      const merged = Array.from(orderMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      // Update local storage with merged list
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }

      // Background sync: if any local order is missing on the server, sync it
      localOrders.forEach((lo) => {
        if (!serverOrders.some((so) => so.id === lo.id)) {
          fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lo),
          }).catch(() => {});
        }
      });

      return merged;
    }
  } catch (e) {
    console.error('Error fetching server orders:', e);
  }

  return localOrders;
}
