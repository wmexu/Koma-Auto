'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Trash2, ArrowRight, Heart, Grid2x2, Rows3 } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';
import { useFavoritesStore } from '../../store/useFavoritesStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useToastStore } from '../../store/useToastStore';
import { useRouter } from 'next/navigation';
import ProductCard from '../../components/ProductCard/ProductCard';
import styles from './Cart.module.css';

export default function CartClient() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { addToast } = useToastStore();
  const { items, removeItem, updateQuantity, clearCart, getTotalPrice } = useCartStore();
  const { toggleFavorite, isFavorite, items: favoriteItems } = useFavoritesStore();

  const [cartGridColumns, setCartGridColumns] = useState<1 | 2>(1);
  const [favGridColumns, setFavGridColumns] = useState<1 | 2>(2);

  const [cartPage, setCartPage] = useState(1);
  const [favPage, setFavPage] = useState(1);
  
  const CART_ITEMS_PER_PAGE = 6;
  const FAV_ITEMS_PER_PAGE = 10;

  const cartHeaderRef = useRef<HTMLHeadingElement>(null);
  const favHeaderRef = useRef<HTMLHeadingElement>(null);

  const handleCartPageChange = (newPage: number) => {
    setCartPage(newPage);
    cartHeaderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleFavPageChange = (newPage: number) => {
    setFavPage(newPage);
    favHeaderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const savedCart = localStorage.getItem('cartGridColumns');
    if (savedCart) setCartGridColumns(Number(savedCart) as 1 | 2);

    const savedFav = localStorage.getItem('favGridColumns');
    if (savedFav) setFavGridColumns(Number(savedFav) as 1 | 2);
  }, []);

  const handleCartGridChange = (cols: 1 | 2) => {
    setCartGridColumns(cols);
    localStorage.setItem('cartGridColumns', cols.toString());
  };

  const handleFavGridChange = (cols: 1 | 2) => {
    setFavGridColumns(cols);
    localStorage.setItem('favGridColumns', cols.toString());
  };

  const totalPrice = getTotalPrice();

  // Handle items deletion logic to adjust pages
  const cartTotalPages = Math.ceil(items.length / CART_ITEMS_PER_PAGE) || 1;
  const favTotalPages = Math.ceil(favoriteItems.length / FAV_ITEMS_PER_PAGE) || 1;

  useEffect(() => {
    if (cartPage > cartTotalPages) {
      setCartPage(cartTotalPages);
    }
  }, [items.length, cartTotalPages, cartPage]);

  useEffect(() => {
    if (favPage > favTotalPages) {
      setFavPage(favTotalPages);
    }
  }, [favoriteItems.length, favTotalPages, favPage]);

  const currentCartItems = items.slice((cartPage - 1) * CART_ITEMS_PER_PAGE, cartPage * CART_ITEMS_PER_PAGE);
  const currentFavItems = favoriteItems.slice((favPage - 1) * FAV_ITEMS_PER_PAGE, favPage * FAV_ITEMS_PER_PAGE);

  if (items.length === 0) {
    return (
      <div className={`container ${styles.emptyState}`}>
        <h2>Корзина пуста</h2>
        <p>Вы еще не добавили ни одного товара в корзину.</p>
        <Link href="/catalog" className={styles.continueBtn}>
          Перейти в каталог
        </Link>
        
        {favoriteItems.length > 0 && (
          <div className={styles.favoritesSectionEmpty}>
            <div className={styles.favoritesHeader}>
              <h2 className={styles.favoritesTitle}>Ваши избранные товары</h2>
              <div className={styles.gridToggle}>
                <button 
                  className={`${styles.gridToggleBtn} ${favGridColumns === 1 ? styles.active : ''}`}
                  onClick={() => handleFavGridChange(1)}
                >
                  <Rows3 size={20} />
                </button>
                <button 
                  className={`${styles.gridToggleBtn} ${favGridColumns === 2 ? styles.active : ''}`}
                  onClick={() => handleFavGridChange(2)}
                >
                  <Grid2x2 size={20} />
                </button>
              </div>
            </div>
            <div className={`${styles.favoritesGrid} ${favGridColumns === 1 ? styles.grid1 : styles.grid2}`}>
              {currentFavItems.map(item => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
            
            {favTotalPages > 1 && (
              <div className={styles.pagination}>
                <button 
                  className={styles.pageBtn} 
                  disabled={favPage === 1}
                  onClick={() => handleFavPageChange(favPage - 1)}
                >
                  Назад
                </button>
                <span className={styles.pageInfo}>Страница {favPage} из {favTotalPages}</span>
                <button 
                  className={styles.pageBtn} 
                  disabled={favPage === favTotalPages}
                  onClick={() => handleFavPageChange(favPage + 1)}
                >
                  Вперед
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`container ${styles.cartPage}`}>
      <div className={styles.header}>
        <h1 className={styles.title} ref={cartHeaderRef}>Корзина</h1>
        <div className={styles.headerActions}>
          <div className={styles.gridToggle}>
            <button 
              className={`${styles.gridToggleBtn} ${cartGridColumns === 1 ? styles.active : ''}`}
              onClick={() => handleCartGridChange(1)}
            >
              <Rows3 size={20} />
            </button>
            <button 
              className={`${styles.gridToggleBtn} ${cartGridColumns === 2 ? styles.active : ''}`}
              onClick={() => handleCartGridChange(2)}
            >
              <Grid2x2 size={20} />
            </button>
          </div>
          <button onClick={clearCart} className={styles.clearBtn}>
            Очистить корзину
          </button>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.itemsListContainer}>
          <div className={`${styles.itemsList} ${cartGridColumns === 1 ? styles.grid1 : styles.grid2}`}>
            {currentCartItems.map((item) => (
              <div key={item.id} className={styles.cartItem}>
                <Link href={`/product/${item.id}`} className={styles.itemImageWrapper}>
                  <Image
                    src={item.image || `https://placehold.co/400x400/F5F5F5/060F48?text=${encodeURIComponent(item.name.split(' ').slice(0, 2).join('\n'))}`}
                    alt={item.name}
                    width={100}
                    height={100}
                    className={styles.itemImage}
                    unoptimized
                  />
                </Link>
                
                <div className={styles.itemInfo}>
                  <Link href={`/product/${item.id}`} className={styles.itemName}>
                    {item.name}
                  </Link>
                  <div className={styles.itemMeta}>OEM: {item.oem || item.article} | {item.brand}</div>
                </div>

                <div className={styles.itemActions}>
                  <div className={styles.quantity}>
                    <button onClick={() => updateQuantity(item.id, item.quantity - 1)}>-</button>
                    <input type="number" value={item.quantity} readOnly />
                    <span className={styles.quantityText}>{item.quantity} шт.</span>
                    <button onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button>
                  </div>
                  
                  <div className={styles.itemPrice}>
                    {(item.price * item.quantity).toLocaleString()} ₸
                  </div>

                  <div className={styles.itemActionsRight}>
                    <button
                      className={`${styles.cartFavoriteBtn} ${isFavorite(item.id) ? styles.active : ''}`}
                      onClick={() => toggleFavorite(item)}
                      aria-label="В избранное"
                    >
                      <Heart size={20} fill={isFavorite(item.id) ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeItem(item.id)}
                      aria-label="Удалить"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {cartTotalPages > 1 && (
            <div className={styles.pagination}>
              <button 
                className={styles.pageBtn} 
                disabled={cartPage === 1}
                onClick={() => handleCartPageChange(cartPage - 1)}
              >
                Назад
              </button>
              <span className={styles.pageInfo}>Страница {cartPage} из {cartTotalPages}</span>
              <button 
                className={styles.pageBtn} 
                disabled={cartPage === cartTotalPages}
                onClick={() => handleCartPageChange(cartPage + 1)}
              >
                Вперед
              </button>
            </div>
          )}
        </div>

        <div className={styles.summary}>
          <h3>Итого</h3>
          <div className={styles.summaryRow}>
            <span>Товары ({items.length})</span>
            <span>{totalPrice.toLocaleString()} ₸</span>
          </div>
          
          <div className={styles.promoCode}>
            <input type="text" placeholder="Промокод" />
            <button>Применить</button>
          </div>

          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <span>К оплате</span>
            <span className={styles.totalPrice}>{totalPrice.toLocaleString()} ₸</span>
          </div>

          <button 
            className={styles.checkoutBtn} 
            onClick={() => {
              if (!user) {
                addToast('Чтобы заказывать товары, зарегистрируйтесь/войдите в аккаунт.', 'error');
              } else {
                router.push('/checkout');
              }
            }}
          >
            Перейти к оформлению <ArrowRight size={20} />
          </button>
        </div>
      </div>
      
      {favoriteItems.length > 0 && (
        <div className={styles.favoritesSection}>
          <div className={styles.favoritesHeader}>
            <h2 className={styles.favoritesTitle} ref={favHeaderRef}>Ваши избранные товары</h2>
            <div className={styles.gridToggle}>
              <button 
                className={`${styles.gridToggleBtn} ${favGridColumns === 1 ? styles.active : ''}`}
                onClick={() => handleFavGridChange(1)}
              >
                <Rows3 size={20} />
              </button>
              <button 
                className={`${styles.gridToggleBtn} ${favGridColumns === 2 ? styles.active : ''}`}
                onClick={() => handleFavGridChange(2)}
              >
                <Grid2x2 size={20} />
              </button>
            </div>
          </div>
          <div className={`${styles.favoritesGrid} ${favGridColumns === 1 ? styles.grid1 : styles.grid2}`}>
            {currentFavItems.map(item => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>

          {favTotalPages > 1 && (
            <div className={styles.pagination}>
              <button 
                className={styles.pageBtn} 
                disabled={favPage === 1}
                onClick={() => handleFavPageChange(favPage - 1)}
              >
                Назад
              </button>
              <span className={styles.pageInfo}>Страница {favPage} из {favTotalPages}</span>
              <button 
                className={styles.pageBtn} 
                disabled={favPage === favTotalPages}
                onClick={() => handleFavPageChange(favPage + 1)}
              >
                Вперед
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
