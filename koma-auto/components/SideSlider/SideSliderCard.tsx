import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart } from 'lucide-react';
import { Product } from '../../data/products';
import { useCartStore } from '../../store/useCartStore';
import { useToastStore } from '../../store/useToastStore';
import styles from './SideSlider.module.css';
import { useState } from 'react';

export default function SideSliderCard({ product }: { product: Product }) {
  const addItemToCart = useCartStore((state) => state.addItem);
  const addToast = useToastStore((state) => state.addToast);
  const [imageLoaded, setImageLoaded] = useState(false);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!product.inStock || (product.stock !== undefined && product.stock <= 0)) {
      addToast('Товара нет в наличии', 'error');
      return;
    }
    addItemToCart(product);
    addToast('Товар добавлен в корзину', 'success');
  };

  return (
    <Link href={`/product/${product.id}`} className={styles.sliderCard}>
      <div className={styles.cardImageWrapper}>
        {!imageLoaded && <div className={styles.skeleton}></div>}
        <Image
          src={product.image || `https://placehold.co/200x200/F5F5F5/060F48?text=${encodeURIComponent(product.name.split(' ').slice(0, 2).join('\n'))}`}
          alt={product.name}
          width={160}
          height={160}
          className={`${styles.cardImage} ${imageLoaded ? styles.loaded : ''}`}
          onLoad={() => setImageLoaded(true)}
          unoptimized
        />
      </div>
      <div className={styles.cardInfo}>
        <div className={styles.cardHeader}>
          <span className={styles.cardArticle}>OEM: {product.oem || product.article}</span>
          <span className={styles.cardBrand}>{product.brand}</span>
        </div>
        <h4 className={styles.cardTitle} title={product.name}>{product.name}</h4>
        
        <div className={styles.cardBottom}>
          <div className={styles.cardPrices}>
            {product.oldPrice && (
              <span className={styles.cardOldPrice}>{product.oldPrice.toLocaleString()} ₸</span>
            )}
            <span className={styles.cardPrice}>
              {product.minPrice !== undefined && product.maxPrice !== undefined && product.minPrice < product.maxPrice
                ? `от ${product.minPrice.toLocaleString()} ₸`
                : `${product.price.toLocaleString()} ₸`}
            </span>
          </div>
          <button
            className={`${styles.cartBtn} ${!product.inStock ? styles.disabled : ''}`}
            onClick={handleAddToCart}
            disabled={!product.inStock}
            title={product.inStock ? 'В корзину' : 'Нет в наличии'}
          >
            <ShoppingCart size={18} className={styles.cartIcon} />
          </button>
        </div>
      </div>
    </Link>
  );
}
