'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingCart, Heart, Box, Truck, CornerUpLeft, Loader2, ChevronLeft, ChevronRight, Rows3, Grid2x2 } from 'lucide-react';
import { Product, ProductVariant } from '../../../data/products';
import { useCartStore } from '../../../store/useCartStore';
import { useFavoritesStore } from '../../../store/useFavoritesStore';
import { useToastStore } from '../../../store/useToastStore';
import ProductCard from '../../../components/ProductCard/ProductCard';
import styles from './ProductDetails.module.css';

interface DromFitmentModel {
  carName: string;
  generations: Array<{ title: string; code?: string }>;
}

function formatDromCompatibility(compatibility?: string[]): {
  models: DromFitmentModel[];
  engines: string[];
} {
  if (!compatibility || compatibility.length === 0) {
    return { models: [], engines: [] };
  }

  const modelMap = new Map<string, Array<{ title: string; code?: string }>>();
  const engineSet = new Set<string>();

  for (const raw of compatibility) {
    if (!raw || typeof raw !== 'string') continue;
    const str = raw.trim();
    if (!str) continue;

    if (str.toLowerCase().startsWith('для двигателей:') || str.toLowerCase().startsWith('двигатели:')) {
      const engStr = str.split(':')[1] || '';
      engStr.split(',').forEach((e) => {
        const clean = e.trim();
        if (clean) engineSet.add(clean);
      });
      continue;
    }

    let carName = '';
    let genTitle = '';
    let code = '';

    if (str.includes('\n')) {
      const lines = str.split('\n').map((l) => l.trim()).filter(Boolean);
      carName = lines[0] || '';
      genTitle = lines[1] || '';
      code = lines[2] || '';
    } else if (str.includes('|')) {
      const parts = str.split('|').map((p) => p.trim());
      carName = parts[0] || '';
      genTitle = parts[1] || '';
      code = parts[2] || '';
    } else {
      const match = str.match(/^([^(]+)(?:\(([^)]+)\))?(.*)$/);
      if (match) {
        carName = match[1].trim();
        const paren = (match[2] || '').trim();
        const rest = (match[3] || '').trim();
        if (paren) {
          genTitle = paren;
        }
        if (rest) {
          code = rest;
        }
      } else {
        carName = str;
      }
    }

    if (!carName) continue;

    if (!modelMap.has(carName)) {
      modelMap.set(carName, []);
    }

    modelMap.get(carName)!.push({
      title: genTitle,
      code: code || undefined,
    });
  }

  const models: DromFitmentModel[] = [];
  modelMap.forEach((generations, carName) => {
    models.push({ carName, generations });
  });

  return { models, engines: Array.from(engineSet) };
}

export default function ProductDetails({ id }: { id: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mobileGridColumns, setMobileGridColumns] = useState<1 | 2>(2);

  const [activeTab, setActiveTab] = useState('specs');
  const [quantity, setQuantity] = useState(1);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  
  const addItemToCart = useCartStore((state) => state.addItem);
  const { toggleFavorite, isFavorite } = useFavoritesStore();
  const addToast = useToastStore((state) => state.addToast);

  useEffect(() => {
    const saved = localStorage.getItem('catalog_grid_pref');
    if (saved === '1' || saved === '2') {
      setMobileGridColumns(parseInt(saved, 10) as 1 | 2);
    }
  }, []);

  const handleGridChange = (cols: 1 | 2) => {
    setMobileGridColumns(cols);
    localStorage.setItem('catalog_grid_pref', cols.toString());
  };

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`/api/products/${id}`);
        const data = await res.json();
        setProduct(data);

        if (data && data.variants && data.variants.length > 0) {
          setSelectedVariantId(data.variants[0].id);
        }
        
        // Fetch similar products intelligently:
        let foundSimilar: Product[] = [];
        const isCurrentShock = (data.name || '').toLowerCase().includes('амортизатор');

        // 1. Try by category if category is valid and not 'other'
        if (data && data.category && data.category !== 'other') {
          try {
            const simRes = await fetch(`/api/products?category=${encodeURIComponent(data.category)}&limit=10`);
            const simData = await simRes.json();
            if (simData && simData.products) {
              foundSimilar = simData.products.filter(
                (p: Product) => p.id !== data.id && p.oem !== data.oem && p.price >= 500
              );
            }
          } catch (e) {
            console.error('Failed to fetch similar by category:', e);
          }
        }

        // 2. If fewer than 4 items, search by key terms from product name (e.g. "Фильтр", "Свечи", "Датчик")
        if (foundSimilar.length < 4 && data.name) {
          const cleanName = data.name.replace(/\b(Chevrolet|Hyundai|Kia|Daewoo|GM|UZ)\b/gi, '').trim();
          const words = cleanName.split(/\s+/).filter((w: string) => w.length > 2 && !w.startsWith('(') && !w.endsWith(')'));
          const searchKeyword = words.slice(0, 2).join(' ') || words[0] || '';

          if (searchKeyword && searchKeyword.length >= 3) {
            try {
              const kwRes = await fetch(`/api/products?search=${encodeURIComponent(searchKeyword)}&limit=10`);
              const kwData = await kwRes.json();
              if (kwData && kwData.products) {
                const kwProducts = kwData.products.filter(
                  (p: Product) =>
                    p.id !== data.id &&
                    p.oem !== data.oem &&
                    p.price >= 500 &&
                    !foundSimilar.some((s) => s.id === p.id)
                );
                foundSimilar = [...foundSimilar, ...kwProducts];
              }
            } catch (e) {
              console.error('Failed to fetch similar by keyword:', e);
            }
          }
        }

        // 3. If still fewer than 4, search by brand (e.g. "Hyundai" or "Chevrolet")
        if (foundSimilar.length < 4 && data.brand) {
          try {
            const brandRes = await fetch(`/api/products?search=${encodeURIComponent(data.brand)}&limit=15`);
            const brandData = await brandRes.json();
            if (brandData && brandData.products) {
              const brandProducts = brandData.products.filter(
                (p: Product) =>
                  p.id !== data.id &&
                  p.oem !== data.oem &&
                  p.price >= 500 &&
                  !foundSimilar.some((s) => s.id === p.id) &&
                  (isCurrentShock || !p.name.toLowerCase().includes('амортизатор'))
              );
              foundSimilar = [...foundSimilar, ...brandProducts];
            }
          } catch (e) {
            console.error('Failed to fetch similar by brand:', e);
          }
        }

        // Never show shock absorbers for a non-shock-absorber product
        if (!isCurrentShock) {
          foundSimilar = foundSimilar.filter((p) => !p.name.toLowerCase().includes('амортизатор'));
        }

        setSimilarProducts(foundSimilar.slice(0, 4));
      } catch (error) {
        console.error('Failed to fetch product:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProduct();
  }, [id]);

  if (isLoading) {
    return (
      <div className={`container ${styles.loadingState}`}>
        <Loader2 className={styles.spinner} size={48} />
        <p>Загрузка товара...</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container" style={{ padding: '60px 0', textAlign: 'center' }}>
        <h1>Товар не найден</h1>
        <Link href="/catalog" style={{ color: 'var(--color-navy)', marginTop: '20px', display: 'inline-block' }}>
          Вернуться в каталог
        </Link>
      </div>
    );
  }

  const effectiveVariants: ProductVariant[] =
    product.variants && product.variants.length > 0
      ? product.variants
      : [
          {
            id: product.id,
            name: product.name,
            code: product.oem || product.article || '',
            brand: product.brand || 'Hyundai',
            tier: 1,
            price: product.price,
            oldPrice: product.oldPrice,
            stock: product.inStock ? 1 : 0,
            inStock: product.inStock,
            images: product.images,
            image: product.image,
            article: product.oem || product.article,
            oem: product.oem || product.article,
            description: product.description,
          },
        ];

  const activeVariant: ProductVariant =
    effectiveVariants.find((v) => v.id === selectedVariantId) || effectiveVariants[0];

  const displayOem = activeVariant?.oem || product.oem || product.article || '';
  const currentPrice = activeVariant ? activeVariant.price : product.price;
  const currentOldPrice = activeVariant ? activeVariant.oldPrice : product.oldPrice;
  const isItemInStock = activeVariant ? activeVariant.inStock : product.inStock;
  const displayBrand = activeVariant ? activeVariant.brand : product.brand;

  const displayPrice = currentPrice * quantity;
  const displayOldPrice = currentOldPrice ? currentOldPrice * quantity : undefined;

  const favorite = isFavorite(activeVariant ? activeVariant.id : product.id);

  const handleAddToCart = () => {
    const target = activeVariant || product;
    const itemToAdd: Product = {
      ...product,
      id: target.id,
      moySkladId: ('moySkladId' in target && target.moySkladId) ? target.moySkladId : target.id,
      name: target.name || product.name,
      brand: target.brand || product.brand,
      price: target.price,
      oldPrice: target.oldPrice,
      inStock: target.inStock,
      article: ('oem' in target && target.oem) ? target.oem : (product.oem || product.article),
      oem: ('oem' in target && target.oem) ? target.oem : (product.oem || product.article),
    };
    for (let i = 0; i < quantity; i++) {
      addItemToCart(itemToAdd);
    }
    addToast(`${target.brand} добавлен в корзину`, 'success');
  };

  const handleToggleFavorite = () => {
    const target = activeVariant || product;
    const itemToToggle: Product = {
      ...product,
      id: target.id,
      name: target.name || product.name,
      brand: target.brand || product.brand,
      price: target.price,
      article: ('oem' in target && target.oem) ? target.oem : (product.oem || product.article),
      oem: ('oem' in target && target.oem) ? target.oem : (product.oem || product.article),
    };
    toggleFavorite(itemToToggle);
    if (!favorite) {
      addToast('Добавлено в избранное', 'info');
    } else {
      addToast('Удалено из избранного', 'info');
    }
  };

  const variantImages = (activeVariant?.images && activeVariant.images.length > 0)
    ? activeVariant.images
    : (activeVariant?.image ? [activeVariant.image] : null);

  const images = (variantImages && variantImages.length > 0)
    ? variantImages
    : (product.images && product.images.length > 0 ? product.images : (product.image ? [product.image] : []));
  const currentImage = images.length > 0 ? images[currentImageIndex] : `https://placehold.co/600x600/F5F5F5/060F48?text=${encodeURIComponent(product.name.split(' ').slice(0, 2).join('\n'))}`;

  const nextImage = () => setCurrentImageIndex(prev => (prev === images.length - 1 ? 0 : prev + 1));
  const prevImage = () => setCurrentImageIndex(prev => (prev === 0 ? images.length - 1 : prev - 1));

  const dromData = formatDromCompatibility(product.compatibility);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;
    
    if (isLeftSwipe && images.length > 1) {
      nextImage();
    }
    if (isRightSwipe && images.length > 1) {
      prevImage();
    }
    
    setTouchStart(0);
    setTouchEnd(0);
  };

  return (
    <div className={`container ${styles.productPage}`}>
      <div className={styles.breadcrumbs}>
        <Link href="/">Главная</Link>
        <span>/</span>
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        <span className={styles.current}>{product.name}</span>
      </div>

      <div className={styles.main}>
        <div className={styles.gallery}>
          <div 
            className={styles.imageWrapper}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {!imageLoaded && <div className={styles.skeleton}></div>}
            {images.length > 0 ? (
              images.map((imgSrc, index) => (
                <Image
                  key={index}
                  src={imgSrc}
                  alt={`${product.name} - Фото ${index + 1}`}
                  fill
                  className={`${styles.image} ${index === currentImageIndex ? styles.activeImage : styles.hiddenImage} ${imageLoaded ? styles.loaded : ''}`}
                  onLoad={() => setImageLoaded(true)}
                  priority={index === 0}
                  unoptimized
                />
              ))
            ) : (
              <Image
                src={`https://placehold.co/600x600/F5F5F5/060F48?text=${encodeURIComponent(product.name.split(' ').slice(0, 2).join('\n'))}`}
                alt={product.name}
                fill
                className={`${styles.image} ${styles.activeImage} ${imageLoaded ? styles.loaded : ''}`}
                onLoad={() => setImageLoaded(true)}
                priority
                unoptimized
              />
            )}
            
            {images.length > 1 && (
              <>
                <div className={styles.sliderArrows}>
                  <button className={styles.arrowBtn} onClick={prevImage} aria-label="Предыдущее фото">
                    <ChevronLeft size={24} />
                  </button>
                  <button className={styles.arrowBtn} onClick={nextImage} aria-label="Следующее фото">
                    <ChevronRight size={24} />
                  </button>
                </div>
                <div className={styles.dots}>
                  {images.map((_, index) => (
                    <button
                      key={index}
                      className={`${styles.dot} ${index === currentImageIndex ? styles.active : ''}`}
                      onClick={() => setCurrentImageIndex(index)}
                      aria-label={`Перейти к фото ${index + 1}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.info}>
          <div className={styles.meta}>
            <span className={styles.article}>OEM: {displayOem}</span>
            <span className={styles.brand}>{displayBrand}</span>
          </div>

          <h1 className={styles.title}>{product.name}</h1>

          <div className={styles.status}>
            {isItemInStock ? (
              <span className={styles.inStock}>В наличии</span>
            ) : (
              <span className={styles.outOfStock}>Нет в наличии</span>
            )}
          </div>

          <div className={styles.priceBlock}>
            <div className={styles.prices}>
              <span className={styles.price}>{displayPrice.toLocaleString()} ₸</span>
              {displayOldPrice && (
                <span className={styles.oldPrice}>{displayOldPrice.toLocaleString()} ₸</span>
              )}
            </div>
          </div>

          {effectiveVariants.length > 0 && (
            <div className={styles.brandPickerSection}>
              <div className={styles.brandPickerHeader}>
                <span className={styles.brandPickerTitle}>
                  {effectiveVariants.length > 1 ? 'Выберите производителя' : 'Производитель'}
                </span>
                <span className={styles.brandPickerCount}>
                  {effectiveVariants.length > 1 ? `Вариантов: ${effectiveVariants.length}` : '1 вариант'}
                </span>
              </div>
              <div className={styles.brandGrid}>
                {effectiveVariants.map((v) => {
                  const isSelected = activeVariant ? v.id === activeVariant.id : true;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className={`${styles.brandOption} ${isSelected ? styles.brandOptionActive : ''} ${!v.inStock ? styles.brandOptionOutOfStock : ''}`}
                      onClick={() => setSelectedVariantId(v.id)}
                    >
                      <div className={styles.brandOptionMain}>
                        <span className={styles.brandOptionName}>{v.brand}</span>
                        <span className={styles.brandOptionPrice}>{v.price.toLocaleString('ru-RU')} ₸</span>
                      </div>
                      <div className={styles.brandOptionStatus}>
                        {v.inStock ? (
                          <span className={styles.variantBadgeInStock}>В наличии</span>
                        ) : (
                          <span className={styles.variantBadgeOutOfStock}>Нет в наличии</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <div className={styles.quantity}>
              <button onClick={() => setQuantity(Math.max(1, quantity - 1))}>-</button>
              <input type="number" value={quantity} readOnly />
              <button onClick={() => setQuantity(quantity + 1)}>+</button>
            </div>
            
            <button
              className={`${styles.addToCartBtn} ${!isItemInStock ? styles.disabled : ''}`}
              onClick={handleAddToCart}
              disabled={!isItemInStock}
            >
              <ShoppingCart size={20} />
              В корзину
            </button>

            <button
              className={`${styles.favoriteBtn} ${favorite ? styles.active : ''}`}
              onClick={handleToggleFavorite}
            >
              <Heart size={24} fill={favorite ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className={styles.benefits}>
            <div className={styles.benefit}>
              <Box size={24} />
              <div>
                <h4>Новая запчасть</h4>
                <p>Поставляется в транспортировочной упаковке</p>
              </div>
            </div>
            <div className={styles.benefit}>
              <Truck size={24} />
              <div>
                <h4>Доставка</h4>
                <p>От 1 дня по РК</p>
              </div>
            </div>
            <div className={styles.benefit}>
              <CornerUpLeft size={24} />
              <div>
                <h4>Возврат</h4>
                <p>14 дней на возврат, после установки запчасти возврат невозможен</p>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.tabsSection}>
          <div className={styles.tabsHeader}>
            <button
              className={`${styles.tabBtn} ${activeTab === 'specs' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('specs')}
            >
              Характеристики
            </button>
          </div>

          <div className={styles.tabContent}>
            {activeTab === 'specs' && (
              <div className={styles.specsList}>
                {displayOem && (
                  <div className={styles.specRow}>
                    <span className={styles.specName}>OEM номер</span>
                    <span className={styles.specValue}>{displayOem}</span>
                  </div>
                )}
                {displayBrand && (
                  <div className={styles.specRow}>
                    <span className={styles.specName}>Производитель</span>
                    <span className={styles.specValue}>{displayBrand}</span>
                  </div>
                )}
                {product.description && (
                  <div className={styles.specDescription}>
                    {product.description}
                  </div>
                )}
                {product.specs && Object.keys(product.specs).length > 0 && (
                  Object.entries(product.specs).map(([key, value]) => (
                    <div key={key} className={styles.specRow}>
                      <span className={styles.specName}>{key}</span>
                      <span className={styles.specValue}>{value}</span>
                    </div>
                  ))
                )}
                {!product.description && (!product.specs || Object.keys(product.specs).length === 0) && (
                  <p className={styles.specsEmpty}>Характеристики не указаны</p>
                )}

                {dromData.models.length > 0 && (
                  <div className={styles.dromCompatibility}>
                    <h3 className={styles.dromTitle}>Подходит</h3>
                    {dromData.models.map((model, idx) => (
                      <div key={idx} className={styles.dromGroup}>
                        <div className={styles.dromCarName}>{model.carName}</div>
                        <div className={styles.dromGenerations}>
                          {model.generations.map((gen, gIdx) => (
                            <div key={gIdx} className={styles.dromGenItem}>
                              {gen.title && <div className={styles.dromGenTitle}>{gen.title}</div>}
                              {gen.code && <div className={styles.dromGenCode}>{gen.code}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {dromData.engines.length > 0 && (
                      <div className={styles.dromEnginesRow}>
                        <div className={styles.dromEnginesLabel}>Для двигателей</div>
                        <div className={styles.dromEnginesValue}>{dromData.engines.join(', ')}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {similarProducts.length > 0 && (
        <div className={styles.similar}>
          <div className={styles.similarHeader}>
            <h2 className={styles.similarTitle}>Похожие товары</h2>
            <div className={styles.gridToggle}>
              <button
                type="button"
                className={`${styles.gridToggleBtn} ${mobileGridColumns === 1 ? styles.active : ''}`}
                onClick={() => handleGridChange(1)}
                aria-label="1 колонка"
              >
                <Rows3 size={20} />
              </button>
              <button
                type="button"
                className={`${styles.gridToggleBtn} ${mobileGridColumns === 2 ? styles.active : ''}`}
                onClick={() => handleGridChange(2)}
                aria-label="2 колонки"
              >
                <Grid2x2 size={20} />
              </button>
            </div>
          </div>
          <div className={`${styles.similarGrid} ${mobileGridColumns === 1 ? styles.grid1 : styles.grid2}`}>
            {similarProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
