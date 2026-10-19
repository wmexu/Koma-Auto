'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Product } from '../../data/products';
import SideSliderCard from './SideSliderCard';
import styles from './SideSlider.module.css';

interface SideSliderProps {
  products: Product[];
}

export default function SideSlider({ products }: SideSliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { clientWidth } = scrollRef.current;
      const scrollAmount = direction === 'left' ? -clientWidth : clientWidth;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const validProducts = (products || []).filter(
    (p) => p.price >= 500 && (p.minPrice === undefined || p.minPrice >= 500)
  );

  if (validProducts.length === 0) {
    return null; // Fallback handled by parent if necessary
  }

  return (
    <div className={styles.sliderContainer}>
      <div className={styles.header}>
        <h3 className={styles.title}>Специально для вас</h3>
        <div className={styles.controls}>
          <button className={styles.controlBtn} onClick={() => scroll('left')} aria-label="Previous">
            <ChevronLeft size={20} />
          </button>
          <button className={styles.controlBtn} onClick={() => scroll('right')} aria-label="Next">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className={styles.scrollArea} ref={scrollRef}>
        {validProducts.map((product) => (
          <div key={product.id} className={styles.slideItem}>
            <SideSliderCard product={product} />
          </div>
        ))}
      </div>
    </div>
  );
}
