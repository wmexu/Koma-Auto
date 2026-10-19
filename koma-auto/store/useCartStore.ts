import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Product } from '../data/products';

export interface CartItem extends Product {
  quantity: number;
}

interface CartState {
  items: CartItem[];
  addItem: (product: Product) => void;
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
      addItem: (product) => {
        if (!product || product.price < 500) return;
        set((state) => {
          const existingItem = state.items.find((item) => item.id === product.id);
          if (existingItem) {
            return {
              items: state.items.map((item) =>
                item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
              ),
            };
          }
          return { items: [...state.items, { ...product, quantity: 1 }] };
        });
      },
      removeItem: (productId) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== productId),
        }));
      },
      updateQuantity: (productId, quantity) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === productId ? { ...item, quantity: Math.max(1, quantity) } : item
          ),
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
