import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Product } from '../data/products';

interface FavoritesState {
  items: Product[];
  toggleFavorite: (product: Product) => void;
  isFavorite: (productId: string) => boolean;
  setItems: (items: Product[]) => void;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      items: [],
      toggleFavorite: (product) => {
        if (!product || product.price < 500) return;
        set((state) => {
          const isExist = state.items.some((item) => item.id === product.id);
          if (isExist) {
            return { items: state.items.filter((item) => item.id !== product.id) };
          }
          return { items: [product, ...state.items] };
        });
      },
      isFavorite: (productId) => {
        return get().items.some((item) => item.id === productId);
      },
      setItems: (items) => set({ items: items.filter((item) => item && item.price >= 500) }),
    }),
    {
      name: 'koma-favorites-storage',
      merge: (persistedState: any, currentState) => ({
        ...currentState,
        ...persistedState,
        items: (persistedState?.items || []).filter((item: Product) => item && item.price >= 500),
      }),
    }
  )
);
