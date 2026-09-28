'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Search, ShoppingCart, Menu, User, Store } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { auth, db } from '../../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import styles from './Header.module.css';

export default function Header() {
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();

  const cartItemsCount = useCartStore((state) => state.getTotalItems());
  const { user, setUser, setUserProfile, isLoading: isAuthLoading, setLoading: setAuthLoading } = useAuthStore();

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    
    // Listen for Firebase Auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            setUserProfile(userDoc.data() as any);
          } else {
            setUserProfile(null);
          }
        } catch (error) {
          console.error("Error fetching user profile:", error);
          setUserProfile(null);
        }
      } else {
        setUserProfile(null);
      }
      
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [setUser, setAuthLoading]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      sessionStorage.setItem('koma_search', searchQuery);
      if (window.location.pathname === '/catalog') {
        window.dispatchEvent(new CustomEvent('koma_header_search', { detail: searchQuery }));
      } else {
        router.push('/catalog');
      }
    }
  };

  return (
    <header className={styles.header}>
      <div className={`container ${styles.container}`}>
        
        {/* Logo */}
        <Link href="/" className={styles.logoWrapper}>
          <Image 
            src="/img/LogoKomaKZ.png" 
            alt="koma.com.kz Auto Parts" 
            width={120} 
            height={40} 
            className={styles.logoImage}
            priority
          />
        </Link>

        {/* Catalog & Search Block */}
        <div className={styles.searchBlock}>
          <button 
            className={styles.catalogBtn}
            onClick={() => router.push('/catalog')}
          >
            <Menu size={20} />
            Каталог
          </button>
          <form onSubmit={handleSearch} className={styles.searchForm}>
            <input
              type="text"
              placeholder="Введите название или номер запчасти..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
            <button type="submit" className={styles.searchBtn}>
              <Search size={20} color="#888" />
            </button>
          </form>
        </div>

        {/* Mobile Catalog Button */}
        <button 
          className={styles.mobileSearchBtn}
          onClick={() => router.push('/catalog')}
        >
          <Store size={24} color="var(--color-navy)" />
        </button>

        {/* User Block */}
        <Link href="/profile" className={styles.userBlock}>
          <div className={styles.userIconWrapper}>
            <User size={20} color="#fff" />
          </div>
          <span className={styles.userText}>
            {isMounted && !isAuthLoading && user ? (
              user.displayName || user.email || 'Мой профиль'
            ) : (
              'Регистрация / Вход в аккаунт'
            )}
          </span>
        </Link>

        {/* Cart Block */}
        <Link href="/cart" className={styles.cartBtn}>
          <ShoppingCart size={20} color="#fff" />
          {isMounted && cartItemsCount > 0 && <span className={styles.badge}>{cartItemsCount}</span>}
        </Link>

      </div>
    </header>
  );
}
