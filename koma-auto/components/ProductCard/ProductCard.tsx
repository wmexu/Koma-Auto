'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart, Heart } from 'lucide-react';
import { Product } from '../../data/products';
import { useCartStore } from '../../store/useCartStore';
import { useFavoritesStore } from '../../store/useFavoritesStore';
import { useToastStore } from '../../store/useToastStore';
import styles from './ProductCard.module.css';

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const addItemToCart = useCartStore((state) => state.addItem);
  const { toggleFavorite, isFavorite } = useFavoritesStore();
  const addToast = useToastStore((state) => state.addToast);

  const favorite = isFavorite(product.id);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    addItemToCart(product);
    addToast('Товар добавлен в корзину', 'success');
  };

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    toggleFavorite(product);
    if (!favorite) {
      addToast('Добавлено в избранное', 'info');
    } else {
      addToast('Удалено из избранного', 'info');
    }
  };

  const hasMultiplePrices =
    product.minPrice !== undefined &&
    product.maxPrice !== undefined &&
    product.minPrice < product.maxPrice;

  const displayOem = product.oem || product.article;
  const hasMultipleBrands = product.availableBrandsCount && product.availableBrandsCount > 1;

  return (
    <Link href={`/product/${product.id}`} className={styles.card}>
      <div className={styles.imageContainer}>
        {!imageLoaded && <div className={styles.skeleton}></div>}
        <Image
          src={
            product.image ||
            `https://placehold.co/400x400/F5F5F5/060F48?text=${encodeURIComponent(
              product.name.split(' ').slice(0, 2).join('\n')
            )}`
          }
          alt={product.name}
          width={400}
          height={400}
          className={`${styles.image} ${imageLoaded ? styles.loaded : ''}`}
          onLoad={() => setImageLoaded(true)}
          unoptimized
        />
        {product.oldPrice && <div className={styles.badgeSale}>Sale</div>}
        <button
          className={`${styles.favoriteBtn} ${favorite ? styles.active : ''}`}
          onClick={handleToggleFavorite}
          aria-label="Добавить в избранное"
        >
          <Heart size={20} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.meta}>
          <span className={styles.article}>OEM: {displayOem}</span>
          <span className={styles.brand}>
            {hasMultipleBrands ? `Брендов: ${product.availableBrandsCount}` : product.brand}
          </span>
        </div>

        <h3 className={styles.title}>{product.name}</h3>

        <div className={styles.bottom}>
          <div className={styles.priceContainer}>
            <span className={styles.price}>
              {hasMultiplePrices
                ? `от ${product.minPrice?.toLocaleString('ru-RU')} ₸`
                : `${product.price.toLocaleString('ru-RU')} ₸`}
            </span>
            {product.oldPrice && (
              <span className={styles.oldPrice}>
                {product.oldPrice.toLocaleString('ru-RU')} ₸
              </span>
            )}
          </div>

          <button
            className={`${styles.cartBtn} ${!product.inStock ? styles.disabled : ''}`}
            onClick={handleAddToCart}
            disabled={!product.inStock}
            title={product.inStock ? 'В корзину' : 'Нет в наличии'}
          >
            <ShoppingCart size={20} />
          </button>
        </div>

        {!product.inStock && <div className={styles.outOfStock}>Нет в наличии</div>}
      </div>
    </Link>
  );
}
