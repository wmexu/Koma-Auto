'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useCartStore } from '../../store/useCartStore';
import { useFavoritesStore } from '../../store/useFavoritesStore';
import { useToastStore } from '../../store/useToastStore';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Product } from '../../data/products';

export default function SyncProvider() {
  const { user } = useAuthStore();
  const isSyncing = useRef(false);
  const prevUser = useRef(user);

  useEffect(() => {
    // Handle logout: clear local stores
    if (prevUser.current && !user) {
      useCartStore.getState().clearCart();
      useFavoritesStore.getState().setItems([]);
      localStorage.removeItem('koma-last-uid');
    }
    prevUser.current = user;

    if (!user) return;

    let unsubscribeSnapshot: (() => void) | null = null;
    let snapshotCounter = 0;

    const startSync = async () => {
      const userRef = doc(db, 'users', user.uid);
      
      unsubscribeSnapshot = onSnapshot(userRef, async (docSnap) => {
        const currentSnapshotId = ++snapshotCounter;
        try {
          const localCart = useCartStore.getState().items;
          const localFavs = useFavoritesStore.getState().items;

          let fbCart: { id: string; quantity: number }[] = [];
          let fbFavs: string[] = [];

          if (docSnap.exists()) {
            const data = docSnap.data();
            fbCart = data.cart || [];
            fbFavs = data.favorites || [];
          }

          const isNewLogin = sessionStorage.getItem('koma-just-logged-in') === 'true';
          
          if (isNewLogin) {
            sessionStorage.removeItem('koma-just-logged-in');
          }

          let mergedCartIds = new Set<string>();
          let mergedFavIds = new Set<string>();
          const cartMap = new Map<string, number>();

          if (isNewLogin) {
            // UNION MERGE (Guest + Firebase)
            fbCart.forEach(item => cartMap.set(item.id, item.quantity));
            localCart.forEach(item => {
              const existingQty = cartMap.get(item.id);
              cartMap.set(item.id, existingQty ? Math.max(existingQty, item.quantity) : item.quantity);
            });
            mergedCartIds = new Set(cartMap.keys());
            
            fbFavs.forEach(id => mergedFavIds.add(id));
            localFavs.forEach(item => mergedFavIds.add(item.id));
          } else {
            // OVERWRITE MERGE (Firebase is truth)
            fbCart.forEach(item => cartMap.set(item.id, item.quantity));
            mergedCartIds = new Set(fbCart.map(i => i.id));
            mergedFavIds = new Set(fbFavs);
          }

          const missingIds = new Set<string>();
          const combinedCartIds = Array.from(mergedCartIds);
          const combinedFavIds = Array.from(mergedFavIds);

          [...combinedCartIds, ...combinedFavIds].forEach(id => {
            if (!localCart.some(i => i.id === id) && !localFavs.some(i => i.id === id)) {
              missingIds.add(id);
            }
          });

          let fetchedProducts: Product[] = [];
          if (missingIds.size > 0) {
            const res = await fetch('/api/products/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: Array.from(missingIds) }),
            });
            if (res.ok) {
              fetchedProducts = await res.json();
            }
          }

          // Abort if a newer snapshot has already fired
          if (currentSnapshotId !== snapshotCounter) {
            return;
          }

          const getFullProduct = (id: string) => {
            return localCart.find(i => i.id === id) || 
                   localFavs.find(i => i.id === id) || 
                   fetchedProducts.find(i => i.id === id);
          };

          const finalCart = combinedCartIds.map(id => {
            const p = getFullProduct(id);
            return (p && p.price >= 500) ? { ...p, quantity: cartMap.get(id)! } : null;
          }).filter(Boolean) as any[];

          const finalFavs = combinedFavIds.map(id => getFullProduct(id)).filter((p): p is Product => Boolean(p && p.price >= 500));

          // Prevent subscriber loop
          isSyncing.current = true;
          useCartStore.getState().setItems(finalCart);
          useFavoritesStore.getState().setItems(finalFavs);
          
          // Small timeout to ensure synchronous subscribers complete before releasing lock
          setTimeout(() => {
            isSyncing.current = false;
          }, 50);

          if (isNewLogin) {
            await setDoc(userRef, {
              cart: finalCart.map(i => ({ id: i.id, quantity: i.quantity })),
              favorites: finalFavs.map(i => i.id)
            }, { merge: true });
          }

        } catch (error) {
          console.error("Error syncing cart/favs:", error);
          isSyncing.current = false;
        }
      });
    };

    startSync();

    return () => {
      if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
  }, [user]);

  // Sync up to Firestore on changes
  useEffect(() => {
    if (!user) return;

    const unsubCart = useCartStore.subscribe((state, prevState) => {
      if (isSyncing.current) return;
      if (state.items !== prevState.items) {
        const cartData = state.items.map(i => ({ id: i.id, quantity: i.quantity }));
        setDoc(doc(db, 'users', user.uid), { cart: cartData }, { merge: true }).catch(err => {
          console.error("Cart sync error:", err);
          useToastStore.getState().addToast(`Ошибка корзины: ${err.message}`, 'error');
        });
      }
    });

    const unsubFavs = useFavoritesStore.subscribe((state, prevState) => {
      if (isSyncing.current) return;
      if (state.items !== prevState.items) {
        const favsData = state.items.map(i => i.id);
        setDoc(doc(db, 'users', user.uid), { favorites: favsData }, { merge: true }).catch(err => {
          console.error("Fav sync error:", err);
          useToastStore.getState().addToast(`Ошибка избранного: ${err.message}`, 'error');
        });
      }
    });

    return () => {
      unsubCart();
      unsubFavs();
    };
  }, [user]);

  return null;
}
