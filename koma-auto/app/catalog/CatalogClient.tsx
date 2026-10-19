'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import ProductCard from '../../components/ProductCard/ProductCard';
import { Product } from '../../data/products';
import { Filter, X, Loader2, Search as SearchIcon, Grid2x2, Rows3 } from 'lucide-react';
import styles from './Catalog.module.css';

interface Category {
  id: string;
  name: string;
}

export default function CatalogClient() {
  const searchParams = useSearchParams();
  const initialCategory = searchParams?.get('category') || '';
  const initialSearch = searchParams?.get('search') || '';

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const [search, setSearch] = useState(initialSearch);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [sort, setSort] = useState('popular');
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [mobileGridColumns, setMobileGridColumns] = useState<1 | 2>(2);

  useEffect(() => {
    const saved = localStorage.getItem('catalogGridColumns');
    if (saved) setMobileGridColumns(Number(saved) as 1 | 2);

    const savedSearch = sessionStorage.getItem('koma_search');
    if (savedSearch) {
      setSearch(savedSearch);
      setSelectedCategory('');
      sessionStorage.removeItem('koma_search');
    }

    const handleGlobalSearch = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setSearch(customEvent.detail);
        setSelectedCategory('');
      }
    };

    window.addEventListener('koma_header_search', handleGlobalSearch);
    return () => window.removeEventListener('koma_header_search', handleGlobalSearch);
  }, []);

  const handleGridChange = (cols: 1 | 2) => {
    setMobileGridColumns(cols);
    localStorage.setItem('catalogGridColumns', cols.toString());
  };

  // Pagination State
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const limit = 24;

  const observerTarget = useRef<HTMLDivElement>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    setProducts([]);
    setOffset(0);
    setHasMore(true);
  }, [debouncedSearch, selectedCategory, showOutOfStock, sort]);

  // Fetch Categories ONCE on mount
  useEffect(() => {
    fetch('/api/categories')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setCategories(data);
      })
      .catch(console.error);
  }, []);

  // Fetch Products
  const fetchProducts = useCallback(async (currentOffset: number) => {
    try {
      if (currentOffset === 0) {
        setIsLoading(true);
      } else {
        setIsFetchingMore(true);
      }

      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: currentOffset.toString(),
        inStockOnly: showOutOfStock ? 'false' : 'true'
      });

      if (debouncedSearch) params.append('search', debouncedSearch);
      if (selectedCategory) params.append('category', selectedCategory);

      const url = `/api/products?${params.toString()}`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.products) {
        const cleanList = data.products.filter(
          (p: Product) => p.price >= 500 && (p.minPrice === undefined || p.minPrice >= 500)
        );
        setProducts(prev => {
          if (currentOffset === 0) return cleanList;
          
          // Avoid duplicates if API returns overlapping items
          const existingIds = new Set(prev.map(p => p.id));
          const newProducts = cleanList.filter((p: Product) => !existingIds.has(p.id));
          return [...prev, ...newProducts];
        });
        
        // Use the hasMore flag from backend to determine if we reached the end,
        // because local filtering might reduce data.products.length below limit
        if (data.hasMore === false) {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Failed to fetch catalog data:', error);
      setHasMore(false);
    } finally {
      setIsLoading(false);
      setIsFetchingMore(false);
    }
  }, [debouncedSearch, selectedCategory, showOutOfStock]);

  // Initial fetch and on filter changes
  useEffect(() => {
    if (offset === 0) {
      fetchProducts(0);
    }
  }, [offset, fetchProducts]);

  // Intersection Observer for Infinite Scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading && !isFetchingMore) {
          const nextOffset = offset + limit;
          setOffset(nextOffset);
          fetchProducts(nextOffset);
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, isLoading, isFetchingMore, offset, fetchProducts, limit, products.length]);

  // Local Sort logic (Note: Since pagination is server-side, this only sorts the currently loaded products. 
  // For true global sort, it would need to be passed to the API)
  const displayedProducts = [...products];
  if (sort === 'price_asc') {
    displayedProducts.sort((a, b) => a.price - b.price);
  } else if (sort === 'price_desc') {
    displayedProducts.sort((a, b) => b.price - a.price);
  }

  return (
    <div className={`container ${styles.catalogPage}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>Каталог товаров</h1>
        
        <div className={styles.topSearch}>
          <div className={styles.searchIconWrapper}>
            <SearchIcon size={20} color="#888" />
          </div>
          <input
            type="text"
            placeholder="Поиск по названию или OEM коду (напр. 31112B1000)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.topSearchInput}
          />
        </div>

        <div className={styles.headerActions}>
          <div className={styles.mobileActionsGroup}>
            <button
              className={styles.mobileFilterBtn}
              onClick={() => setIsMobileFiltersOpen(true)}
            >
              <Filter size={20} /> Фильтры
            </button>
            
            <div className={styles.gridToggle}>
              <button 
                className={`${styles.gridToggleBtn} ${mobileGridColumns === 1 ? styles.active : ''}`}
                onClick={() => handleGridChange(1)}
              >
                <Rows3 size={20} />
              </button>
              <button 
                className={`${styles.gridToggleBtn} ${mobileGridColumns === 2 ? styles.active : ''}`}
                onClick={() => handleGridChange(2)}
              >
                <Grid2x2 size={20} />
              </button>
            </div>
          </div>
          
          <div className={styles.sort}>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className={styles.sortSelect}
            >
              <option value="popular">По популярности</option>
            </select>
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        {/* Mobile Overlay */}
        {isMobileFiltersOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsMobileFiltersOpen(false)} />
        )}

        {/* Filters Sidebar */}
        <aside className={`${styles.sidebar} ${isMobileFiltersOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarHeader}>
            <h3>Фильтры</h3>
            <button className={styles.closeBtn} onClick={() => setIsMobileFiltersOpen(false)}>
              <X size={24} />
            </button>
          </div>

          <div className={styles.filterGroup}>
            <h4 className={styles.filterTitle}>Наличие</h4>
            <div className={styles.originalsToggle}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={showOutOfStock}
                  onChange={(e) => setShowOutOfStock(e.target.checked)}
                />
                Показывать отсутствующие
              </label>
            </div>
          </div>

          <div className={styles.filterGroup}>
            <h4 className={styles.filterTitle}>Категория</h4>
            <div className={styles.radioList}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="category"
                  checked={selectedCategory === ''}
                  onChange={() => setSelectedCategory('')}
                />
                Все категории
              </label>
              {categories.map((c) => (
                <label key={c.id} className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="category"
                    checked={selectedCategory === c.name || selectedCategory === c.id}
                    onChange={() => setSelectedCategory(c.name)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </aside>

        {/* Products Grid */}
        <div className={styles.content}>
          {isLoading ? (
            <div className={styles.loadingState}>
              <Loader2 className={styles.spinner} size={48} />
              <p>Загрузка товаров...</p>
            </div>
          ) : displayedProducts.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>Товары не найдены</h3>
              <p>Попробуйте изменить параметры фильтрации</p>
              <button
                className={styles.resetBtn}
                onClick={() => {
                  setSearch('');
                  setSelectedCategory('');
                  setShowOutOfStock(false);
                }}
              >
                Сбросить фильтры
              </button>
            </div>
          ) : (
            <div className={`${styles.productsGrid} ${mobileGridColumns === 1 ? styles.grid1 : styles.grid2}`}>
              {displayedProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
              
              {/* Infinite Scroll Target */}
              {hasMore && (
                <div 
                  ref={observerTarget} 
                  style={{ gridColumn: '1 / -1', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '20px' }}
                >
                  {isFetchingMore && <Loader2 className={styles.spinner} size={28} style={{ color: 'var(--color-navy)' }} />}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
