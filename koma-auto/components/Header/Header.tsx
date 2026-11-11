'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, ShoppingCart, User, Store, Shield } from 'lucide-react';
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
  const { 
    user, 
    userProfile, 
    setUser, 
    setUserProfile, 
    isLoading: isAuthLoading, 
    setLoading: setAuthLoading,
    setProfileLoading,
    setProfileLoaded,
  } = useAuthStore();

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
        setProfileLoading(true);
        setProfileLoaded(false);

        // Immediate authoritative sync to PostgreSQL
        if (currentUser.email) {
          currentUser.getIdToken().then(idToken => {
            if (!idToken) return;
            fetch('/api/user/sync', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-user-id': currentUser.uid,
                'authorization': `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                userId: currentUser.uid,
                email: currentUser.email,
                fullName: currentUser.displayName && !currentUser.displayName.includes('@') ? currentUser.displayName : null,
                phone: currentUser.phoneNumber || null,
                clientType: 'retail',
                isExplicitUpdate: false,
              }),
            }).catch(syncErr => console.warn('[UserSync] Background sync error:', syncErr));
          }).catch(() => {});
        }

        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          let profile = userDoc.exists() ? (userDoc.data() as any) : null;

          // Verify authoritative role from Postgres
          try {
            const idToken = await currentUser.getIdToken().catch(() => null);
            
            // Sync user record to PostgreSQL database
            if (currentUser.email) {
              const hasExplicitProfileName = Boolean(profile?.name && profile.name.trim().length > 0 && profile.name !== 'Покупатель');
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
                  fullName: profile?.name || (currentUser.displayName && !currentUser.displayName.includes('@') ? currentUser.displayName : null),
                  phone: profile?.phone || currentUser.phoneNumber || null,
                  clientType: profile?.clientType || 'retail',
                  isExplicitUpdate: hasExplicitProfileName,
                }),
              }).catch(syncErr => console.warn('[UserSync] Background sync error:', syncErr));
            }

            const roleRes = await fetch(`/api/user/role?userId=${currentUser.uid}`, {
              headers: {
                'x-user-id': currentUser.uid,
                ...(idToken ? { 'authorization': `Bearer ${idToken}` } : {}),
              },
            });
            let dbFullName: string | null = null;
            let dbRole: string | null = null;
            if (roleRes.ok) {
              const roleData = await roleRes.json();
              dbFullName = roleData.fullName || null;
              dbRole = roleData.role || null;
            }

            // Unify: If user document in Firestore does not exist yet or profile is null,
            // construct it immediately from PostgreSQL and Google Auth so user is NEVER left without a profile
            if (!profile) {
              const resolvedName = dbFullName || (currentUser.displayName && !currentUser.displayName.includes('@') ? currentUser.displayName : null) || currentUser.email?.split('@')[0] || 'Пользователь';
              profile = {
                name: resolvedName,
                email: currentUser.email || '',
                dob: '',
                role: dbRole || 'customer',
                clientType: 'retail',
                createdAt: new Date().toISOString(),
              };
              setDoc(doc(db, 'users', currentUser.uid), profile, { merge: true }).catch(() => {});
            } else {
              if (dbRole) {
                profile.role = dbRole;
                setDoc(doc(db, 'users', currentUser.uid), { role: dbRole }, { merge: true }).catch(() => {});
              }
              const isTestName = dbFullName && (
                dbFullName === 'Покупатель' ||
                dbFullName.toLowerCase().includes('тестовый заказ') ||
                dbFullName.toLowerCase() === 'тест'
              );
              if (dbFullName && !isTestName) {
                profile.name = dbFullName;
                setDoc(doc(db, 'users', currentUser.uid), { name: dbFullName }, { merge: true }).catch(() => {});
              }
            }
          } catch (rErr) {
            console.warn('Role sync warning:', rErr);
          }

          setUserProfile(profile);

          // Update cached visual name for instant zero-lag rendering (protect real name from OAuth handles)
          const resolvedName = profile?.name || (currentUser.displayName && !currentUser.displayName.includes('@') ? currentUser.displayName : null) || 'Мой профиль';
          if (resolvedName) {
            setCachedVisualName(resolvedName);
            try { localStorage.setItem('koma_cached_user_name', resolvedName); } catch {}
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
          // Never leave an authenticated user with null profile
          setUserProfile({
            name: (currentUser.displayName && !currentUser.displayName.includes('@') ? currentUser.displayName : null) || currentUser.email?.split('@')[0] || 'Пользователь',
            email: currentUser.email || '',
            dob: '',
            role: 'customer',
            clientType: 'retail',
            createdAt: new Date().toISOString(),
          });
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
              userProfile?.name || user.displayName || user.email || 'Мой профиль'
            ) : (
              'Регистрация / Вход в аккаунт'
            )}
          </span>
        </Link>

        {/* Staff Management Panel Button (Director, Manager, Courier) */}
        {isMounted && Boolean(userProfile?.role && ['director', 'manager', 'courier'].includes(userProfile.role as any)) && (
          <Link href="/admin" className={styles.staffHeaderBtn} title="Перейти в панель управления">
            <Shield size={18} color="#002b49" />
            <span className={styles.staffHeaderBtnText}>Панель управления</span>
          </Link>
        )}

        {/* Cart Block */}
        <Link href="/cart" className={styles.cartBtn} aria-label="Корзина">
          <ShoppingCart size={20} color="#fff" />
          {isMounted && cartItemsCount > 0 && <span className={styles.badge}>{cartItemsCount}</span>}
        </Link>

      </div>
    </header>
  );
}
