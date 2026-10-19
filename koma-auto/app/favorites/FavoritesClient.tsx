'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import ProductCard from '../../components/ProductCard/ProductCard';
import { useFavoritesStore } from '../../store/useFavoritesStore';
import styles from './Favorites.module.css';

export default function FavoritesClient() {
  const { items } = useFavoritesStore();
  const validItems = items.filter(item => item && item.price >= 500);
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const headerRef = useRef<HTMLHeadingElement>(null);

  const totalPages = Math.ceil(validItems.length / ITEMS_PER_PAGE) || 1;

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [validItems.length, totalPages, page]);

  const currentItems = validItems.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  if (validItems.length === 0) {
    return (
      <div className={`container ${styles.emptyState}`}>
        <h2>В избранном пока ничего нет</h2>
        <p>Добавляйте товары в избранное, чтобы не потерять их.</p>
        <Link href="/catalog" className={styles.continueBtn}>
          Перейти в каталог
        </Link>
      </div>
    );
  }

  return (
    <div className={`container ${styles.favoritesPage}`}>
      <div className={styles.header}>
        <h1 className={styles.title} ref={headerRef}>Избранное</h1>
        <span className={styles.count}>{validItems.length} товаров</span>
      </div>

      <div className={styles.productsGrid}>
        {currentItems.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button 
            className={styles.pageBtn} 
            disabled={page === 1}
            onClick={() => handlePageChange(page - 1)}
          >
            Назад
          </button>
          <span className={styles.pageInfo}>Страница {page} из {totalPages}</span>
          <button 
            className={styles.pageBtn} 
            disabled={page === totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            Вперед
          </button>
        </div>
      )}
    </div>
  );
}
