import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Product } from '../data/products';

export interface CartItem extends Product {
  quantity: number;
}

interface CartState {
  items: CartItem[];
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  setItems: (items: CartItem[]) => void;
  getTotalItems: () => number;
  getTotalPrice: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (product, qty = 1) => {
        if (!product || product.price < 500) return;
        set((state) => {
          const existingItem = state.items.find((item) => item.id === product.id);
          const maxStock = product.stock ?? existingItem?.stock ?? 999;
          if (existingItem) {
            const newQty = Math.min(maxStock, existingItem.quantity + Math.max(1, qty));
            return {
              items: state.items.map((item) =>
                item.id === product.id ? { ...item, ...product, quantity: newQty } : item
              ),
            };
          }
          const initialQty = Math.min(maxStock, Math.max(1, qty));
          return { items: [...state.items, { ...product, quantity: initialQty }] };
        });
      },
      removeItem: (productId) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== productId),
        }));
      },
      updateQuantity: (productId, quantity) => {
        set((state) => ({
          items: state.items.map((item) => {
            if (item.id !== productId) return item;
            const maxStock = item.stock ?? 999;
            return { ...item, quantity: Math.min(maxStock, Math.max(1, quantity)) };
          }),
        }));
      },
      clearCart: () => set({ items: [] }),
      setItems: (items) => set({ items: items.filter((item) => item && item.price >= 500) }),
      getTotalItems: () => {
        return get().items.filter((i) => i.price >= 500).reduce((total, item) => total + item.quantity, 0);
      },
      getTotalPrice: () => {
        return get().items.filter((i) => i.price >= 500).reduce((total, item) => total + item.price * item.quantity, 0);
      },
    }),
    {
      name: 'koma-cart-storage',
      merge: (persistedState: any, currentState) => ({
        ...currentState,
        ...persistedState,
        items: (persistedState?.items || []).filter((item: CartItem) => item && item.price >= 500),
      }),
    }
  )
);
