'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Trash2, ArrowRight, Heart, Grid2x2, Rows3, AlertTriangle } from 'lucide-react';
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
  
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    isTestMode: boolean;
    title: string;
    disclaimer: string;
    targetPrice: number;
  } | null>(null);

  useEffect(() => {
    const savedPromo = sessionStorage.getItem('koma_test_promocode');
    if (savedPromo) {
      fetch('/api/promocode/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: savedPromo }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid && data.isTestMode) {
            setAppliedPromo(data);
          } else {
            sessionStorage.removeItem('koma_test_promocode');
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleApplyPromo = async () => {
    const code = promoCodeInput.trim();
    if (!code) {
      addToast('Введите промокод', 'error');
      return;
    }
    setIsApplyingPromo(true);
    try {
      const res = await fetch('/api/promocode/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        addToast(data.error || 'Промокод недействителен', 'error');
        return;
      }

      setAppliedPromo(data);
      sessionStorage.setItem('koma_test_promocode', code);
      setPromoCodeInput('');
      addToast('Тестовый режим успешно активирован! Сумма заказа: 1 ₸', 'success');
    } catch (e: any) {
      addToast('Ошибка при проверке промокода', 'error');
    } finally {
      setIsApplyingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    sessionStorage.removeItem('koma_test_promocode');
    addToast('Тестовый режим отключен', 'info');
  };
  
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

  const validItems = items.filter(item => item && item.price >= 500);
  const validFavoriteItems = favoriteItems.filter(item => item && item.price >= 500);

  const totalPrice = validItems.reduce((acc, item) => acc + item.price * item.quantity, 0);

  // Handle items deletion logic to adjust pages
  const cartTotalPages = Math.ceil(validItems.length / CART_ITEMS_PER_PAGE) || 1;
  const favTotalPages = Math.ceil(validFavoriteItems.length / FAV_ITEMS_PER_PAGE) || 1;

  useEffect(() => {
    if (cartPage > cartTotalPages) {
      setCartPage(cartTotalPages);
    }
  }, [validItems.length, cartTotalPages, cartPage]);

  useEffect(() => {
    if (favPage > favTotalPages) {
      setFavPage(favTotalPages);
    }
  }, [validFavoriteItems.length, favTotalPages, favPage]);

  const currentCartItems = validItems.slice((cartPage - 1) * CART_ITEMS_PER_PAGE, cartPage * CART_ITEMS_PER_PAGE);
  const currentFavItems = validFavoriteItems.slice((favPage - 1) * FAV_ITEMS_PER_PAGE, favPage * FAV_ITEMS_PER_PAGE);

  if (validItems.length === 0) {
    return (
      <div className={`container ${styles.emptyState}`}>
        <h2>Корзина пуста</h2>
        <p>Вы еще не добавили ни одного товара в корзину.</p>
        <Link href="/catalog" className={styles.continueBtn}>
          Перейти в каталог
        </Link>
        
        {validFavoriteItems.length > 0 && (
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
            <span>Товары ({validItems.length})</span>
            <span>{totalPrice.toLocaleString()} ₸</span>
          </div>

          {appliedPromo?.isTestMode && (
            <div className={styles.discountRow}>
              <span>Скидка (Тест-режим)</span>
              <span>-{(totalPrice - (appliedPromo.targetPrice || 10)).toLocaleString()} ₸</span>
            </div>
          )}
          
          {!appliedPromo?.isTestMode ? (
            <div className={styles.promoCode}>
              <input
                type="text"
                placeholder="Промокод"
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApplyPromo();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleApplyPromo}
                disabled={isApplyingPromo}
              >
                {isApplyingPromo ? 'Проверка...' : 'Применить'}
              </button>
            </div>
          ) : (
            <div className={styles.testModeBanner}>
              <div className={styles.testModeBannerHeader}>
                <AlertTriangle size={18} />
                <span>{appliedPromo.title || `РЕЖИМ ТЕСТИРОВАНИЯ (${appliedPromo.targetPrice || 10} ₸)`}</span>
              </div>
              <p className={styles.testModeBannerText}>
                Активирован режим технического тестирования платформы. Сумма заказа снижена до {appliedPromo.targetPrice || 10} ₸ для верификации соединения с платёжным шлюзом ePay.
              </p>
              <div className={styles.testModeBannerLegal}>
                <strong>Юридическое примечание:</strong> Настоящий заказ является демонстрационным техническим тестом и <u>не порождает обязательств</u> Продавца по передаче, комплектации или доставке товаров согласно ст. 447, 449 Гражданского кодекса Республики Казахстан.
              </div>
              <button
                type="button"
                onClick={handleRemovePromo}
                className={styles.testModeRemoveBtn}
              >
                Отменить тест-режим
              </button>
            </div>
          )}

          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <span>К оплате</span>
            <span className={styles.totalPrice}>
              {(appliedPromo?.isTestMode ? (appliedPromo.targetPrice || 10) : totalPrice).toLocaleString()} ₸
            </span>
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
      
      {validFavoriteItems.length > 0 && (
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
