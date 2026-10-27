'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, ShoppingCart, User, Store } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { auth, db } from '../../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import GooeyInput from '../ui/GooeyInput';
import styles from './Header.module.css';

export default function Header() {
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  const cartItemsCount = useCartStore((state) => state.getTotalItems());
  const { user, setUser, setUserProfile, isLoading: isAuthLoading, setLoading: setAuthLoading } = useAuthStore();

  const [isMounted, setIsMounted] = useState(false);
  const [cachedVisualName, setCachedVisualName] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);

    // Initial visual name hydration from localStorage to eliminate 2-3s blank/spinner delay on reload
    try {
      const savedVisualName = localStorage.getItem('koma_cached_user_name');
      if (savedVisualName) {
        setCachedVisualName(savedVisualName);
      }
    } catch {
      // Ignore localStorage errors
    }

    // Listen for custom visual name sync events from profile edits or logout
    const handleNameSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const newName = customEvent.detail;
      if (newName && typeof newName === 'string') {
        setCachedVisualName(newName);
        try { localStorage.setItem('koma_cached_user_name', newName); } catch {}
      } else {
        setCachedVisualName(null);
        try { localStorage.removeItem('koma_cached_user_name'); } catch {}
      }
    };
    window.addEventListener('koma_cached_name_change', handleNameSync);

    // Initial search sync from sessionStorage
    const saved = sessionStorage.getItem('koma_search');
    if (saved) {
      setSearchQuery(saved);
    }

    // Listen for custom search events from catalog or reset buttons
    const handleGlobalSearch = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (typeof customEvent.detail === 'string') {
        setSearchQuery(customEvent.detail);
      }
    };
    window.addEventListener('koma_header_search', handleGlobalSearch);

    // Listen for Firebase Auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          let profile = userDoc.exists() ? (userDoc.data() as any) : null;

            // Verify authoritative role from Postgres
          try {
            const idToken = await currentUser.getIdToken().catch(() => null);
            
            // Sync user record to PostgreSQL database
            if (currentUser.email) {
              fetch('/api/user/sync', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-user-id': currentUser.uid,
                  ...(idToken ? { 'authorization': `Bearer ${idToken}` } : {}),
                },
                body: JSON.stringify({
                  userId: currentUser.uid,
                  email: currentUser.email,
                  fullName: currentUser.displayName || profile?.name || null,
                  phone: currentUser.phoneNumber || profile?.phone || null,
                  clientType: profile?.clientType || 'retail',
                }),
              }).catch(syncErr => console.warn('[UserSync] Background sync error:', syncErr));
            }

            const roleRes = await fetch(`/api/user/role?userId=${currentUser.uid}`, {
              headers: {
                'x-user-id': currentUser.uid,
                ...(idToken ? { 'authorization': `Bearer ${idToken}` } : {}),
              },
            });
            if (roleRes.ok) {
              const roleData = await roleRes.json();
              if (roleData.role) {
                if (!profile) profile = {};
                if (profile.role !== roleData.role) {
                  profile.role = roleData.role;
                  // sync to Firestore
                  setDoc(doc(db, 'users', currentUser.uid), { role: roleData.role }, { merge: true }).catch(() => {});
                }
              }
            }
          } catch (rErr) {
            console.warn('Role sync warning:', rErr);
          }

          setUserProfile(profile);

          // Update cached visual name for instant zero-lag rendering
          const resolvedName = profile?.name || currentUser.displayName || currentUser.email || 'Мой профиль';
          if (resolvedName) {
            setCachedVisualName(resolvedName);
            try { localStorage.setItem('koma_cached_user_name', resolvedName); } catch {}
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
          setUserProfile(null);
        }
      } else {
        setUserProfile(null);
        setCachedVisualName(null);
        try { localStorage.removeItem('koma_cached_user_name'); } catch {}
      }

      setAuthLoading(false);
    });

    return () => {
      window.removeEventListener('koma_header_search', handleGlobalSearch);
      window.removeEventListener('koma_cached_name_change', handleNameSync);
      unsubscribe();
    };
  }, [setUser, setAuthLoading]);

  // Handle immediate catalog redirection on search click
  const handleSearchClick = useCallback(() => {
    if (pathname !== '/catalog') {
      router.push('/catalog');
    }
  }, [pathname, router]);

  // Handle real-time value changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    sessionStorage.setItem('koma_search', value);

    // Broadcast search query to catalog in real-time
    window.dispatchEvent(new CustomEvent('koma_header_search', { detail: value }));

    // If user is not yet on catalog page, immediately redirect
    if (pathname !== '/catalog') {
      router.push('/catalog');
    }
  }, [pathname, router]);

  return (
    <header className={styles.header}>
      <div className={`container ${styles.container}`}>
        
        {/* Logo */}
        <Link href="/" className={styles.logoWrapper}>
          <Image 
            src="/img/KomaAuto.svg" 
            alt="koma.com.kz Auto Parts" 
            width={125} 
            height={51} 
            className={styles.logoImage}
            priority
          />
        </Link>

        {/* Catalog & Search Block */}
        <div className={styles.searchBlock}>
          <button 
            className={styles.catalogBtn}
            onClick={() => router.push('/catalog')}
            aria-label="Открыть каталог"
          >
            <Menu size={20} />
            <span>Каталог</span>
          </button>

          <div className={styles.searchWrap}>
            <GooeyInput
              placeholder="Поиск по названию или OEM номеру детали..."
              value={searchQuery}
              onValueChange={handleSearchChange}
              onSearchClick={handleSearchClick}
            />
          </div>
        </div>

        {/* Mobile Catalog Button */}
        <button 
          className={styles.mobileSearchBtn}
          onClick={() => router.push('/catalog')}
          aria-label="Каталог"
        >
          <Store size={24} color="var(--color-navy)" />
        </button>

        {/* User Block */}
        <Link href="/profile" className={styles.userBlock}>
          <div className={styles.userIconWrapper}>
            <User size={20} color="#fff" />
          </div>
          <span className={styles.userText}>
            {isMounted && cachedVisualName ? (
              cachedVisualName
            ) : isMounted && !isAuthLoading && user ? (
              user.displayName || user.email || 'Мой профиль'
            ) : (
              'Регистрация / Вход в аккаунт'
            )}
          </span>
        </Link>

        {/* Cart Block */}
        <Link href="/cart" className={styles.cartBtn} aria-label="Корзина">
          <ShoppingCart size={20} color="#fff" />
          {isMounted && cartItemsCount > 0 && <span className={styles.badge}>{cartItemsCount}</span>}
        </Link>

      </div>
    </header>
  );
}
