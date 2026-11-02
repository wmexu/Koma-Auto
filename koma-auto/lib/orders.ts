import { Order, OrderStatus } from './order-types';

function getStorageKey(userId?: string | null): string {
  if (userId) return `koma_orders_${userId}`;
  return 'koma_orders_guest';
}

export function getLocalOrders(userId?: string | null): Order[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = getStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const filtered = userId 
        ? parsed.filter((o) => o.userId === userId)
        : parsed.filter((o) => !o.userId);

      return filtered.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
  } catch (e) {
    console.error('Error loading local orders:', e);
  }
  return [];
}

export function getLocalOrderById(orderId: string, userId?: string | null): Order | null {
  if (typeof window === 'undefined') return null;
  // Check user key first if provided
  if (userId) {
    const userOrders = getLocalOrders(userId);
    const found = userOrders.find((o) => o.id === orderId || o.invoiceId === orderId);
    if (found) return found;
  }
  // Check guest orders
  const guestOrders = getLocalOrders(null);
  const foundGuest = guestOrders.find((o) => o.id === orderId || o.invoiceId === orderId);
  if (foundGuest) return foundGuest;

  // Fallback: check legacy unpartitioned key
  try {
    const legacyRaw = localStorage.getItem('koma_orders');
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw);
      if (Array.isArray(parsed)) {
        const found = parsed.find((o: any) => o.id === orderId || o.invoiceId === orderId);
        if (found) return found;
      }
    }
  } catch {}

  return null;
}

export function saveLocalOrder(order: Order): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getStorageKey(order.userId);
    const orders = getLocalOrders(order.userId);
    const existingIndex = orders.findIndex(
      (o) => o.id === order.id || o.invoiceId === order.invoiceId
    );
    if (existingIndex >= 0) {
      orders[existingIndex] = { ...orders[existingIndex], ...order };
    } else {
      orders.unshift(order);
    }
    localStorage.setItem(key, JSON.stringify(orders));
  } catch (e) {
    console.error('Error saving local order:', e);
  }
}

export function updateLocalOrderStatus(orderId: string, status: OrderStatus, userId?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getStorageKey(userId);
    const orders = getLocalOrders(userId);
    let updated = false;
    const newOrders = orders.map((o) => {
      if (o.id === orderId || o.invoiceId === orderId) {
        updated = true;
        return { ...o, status };
      }
      return o;
    });
    if (updated) {
      localStorage.setItem(key, JSON.stringify(newOrders));
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
 * Syncs orders with backend with strict user isolation
 */
export async function fetchUserOrders(userId?: string | null): Promise<Order[]> {
  // If no userId, return only guest orders
  if (!userId) {
    return getLocalOrders(null).filter((o) => !o.userId);
  }

  // Clean legacy shared storage to prevent cross-account leaks
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('koma_orders');
    } catch {}
  }

  try {
    let token: string | null = null;
    try {
      const { auth } = await import('@/lib/firebase');
      if (auth?.currentUser && auth.currentUser.uid === userId) {
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
      
      // Server orders for this specific userId are authoritative.
      // Filter strictly to ensure no orders belonging to other users or null are included.
      const verifiedOrders = Array.isArray(serverOrders)
        ? serverOrders.filter((o) => o.userId === userId)
        : [];

      verifiedOrders.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      // Cache only this user's verified orders in their user-scoped storage key
      if (typeof window !== 'undefined') {
        localStorage.setItem(getStorageKey(userId), JSON.stringify(verifiedOrders));
      }

      return verifiedOrders;
    }
  } catch (e) {
    console.error('Error fetching server orders:', e);
  }

  // Fallback to local user-scoped storage only
  return getLocalOrders(userId).filter((o) => o.userId === userId);
}
