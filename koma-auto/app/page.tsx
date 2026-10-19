import Link from 'next/link';
import Image from 'next/image';
import styles from './page.module.css';
import { User, Phone, CarFront, MapPin, ArrowRight, MessageSquareText } from 'lucide-react';
import CarBrands from '../components/CarBrands/CarBrands';
import { getProductsByIds } from '../lib/moysklad';
import { Product } from '../data/products';
import SideSlider from '../components/SideSlider/SideSlider';
import HomeConsultationForm from '../components/HomeConsultationForm/HomeConsultationForm';
import LocationMap from '../components/LocationMap/LocationMap';

export const revalidate = 3600; // Revalidate every hour to shuffle featured products

const FEATURED_PRODUCT_IDS = [
  '055306c7-4e95-11f1-0a80-17ce000b2820', // Амортизатор задний Chevrolet
  '01d1bd94-4e95-11f1-0a80-17ce000b2613', // Датчик кислородный (лямбдазонд) Hyundai/Kia
  '010a27ae-4e95-11f1-0a80-17ce000b25c1', // Фильтр воздушный Hyundai/Kia
  '02bd811c-4e95-11f1-0a80-17ce000b265a', // Стартер Hyundai/Kia
  '05f6cd65-4e97-11f1-0a80-17ce000d8d3e', // Моторчик (насос) омывателя Hyundai/Kia
  '0554b0f2-4e96-11f1-0a80-17ce000c555e', // Генератор Hyundai/Kia
];

export default async function Home() {
  let sliderProducts: Product[] = [];
  try {
    sliderProducts = (await getProductsByIds(FEATURED_PRODUCT_IDS)).filter(
      (p) => p.price >= 500 && (p.minPrice === undefined || p.minPrice >= 500)
    );
  } catch (error) {
    console.error("Failed to fetch products for slider:", error);
  }

  const originalParts = [
    { name: 'Топливный насос высокого давления', img: '/img/Original-products-page-images/Originals1.png', searchQuery: 'Топливный насос' },
    { name: 'Свечи зажигания', img: '/img/Original-products-page-images/Originals2.png', searchQuery: 'Свечи зажигание' },
    { name: 'Форсунки впрыска топлива', img: '/img/Original-products-page-images/Originals3.png', searchQuery: 'Форсунка' },
    { name: 'Датчики ABS', img: '/img/Original-products-page-images/Originals4.png', searchQuery: 'Датчик ABS' },
    { name: 'Дроссельные заслонки', img: '/img/Original-products-page-images/Originals5.png', searchQuery: 'Дроссельная' },
    { name: 'Фильтры воздушные', img: '/img/Original-products-page-images/airfilter.png', searchQuery: 'Фильтр воздушный' },
    { name: 'Датчик кислородный', img: '/img/Original-products-page-images/oxygensensor.png', searchQuery: 'Датчик кислородный' },
    { name: 'Стартер двигателя', img: '/img/Original-products-page-images/starterengine.png', searchQuery: 'Стартер' },
    { name: 'Амортизаторы', img: '/img/Original-products-page-images/suspension.png', searchQuery: 'Амортизатор' },
    { name: 'Стойки стабилизатора', img: '/img/Original-products-page-images/stoikastabilisator.png', searchQuery: 'Стойка стабилизатора' },
    { name: 'Тормозные колодки', img: '/img/Original-products-page-images/brakepads.png', searchQuery: 'Колодки тормозные' },
    { name: 'Все разделы автозапчастей', img: '/img/Original-products-page-images/Originals6.png', href: '/catalog' },
  ];

  return (
    <div className={styles.home}>
      <div className="container">

        {/* Top Banners */}
        <section className={styles.bannersSection}>
          <div className={styles.mainBanner}>
            <div className={styles.mainBannerContent}>
              <h1 className={styles.mainBannerTitle}>
                Koma Auto - магазин<br />автозапчастей на<br />Hyundai/Kia, Chevrolet
              </h1>
              <p className={styles.mainBannerSubtitle}>Доставка по всему Казахстану</p>
            </div>
            <div className={styles.mainBannerImageWrapper}>
              <Image
                src="/img/komakz-shopofautopartsforhyundaikia.png"
                alt="Автозапчасти"
                width={400}
                height={250}
                className={styles.mainBannerImage}
                priority
              />
            </div>
          </div>

          <div className={styles.sideBannerWrapper}>
            <SideSlider products={sliderProducts} />
          </div>
        </section>

        {/* Original Parts */}
        <section className={styles.originalPartsSection}>
          <h2 className={styles.sectionTitle}>Разделы автозапчастей</h2>
          <div className={styles.originalPartsGrid}>
            {originalParts.map((part, index) => (
              <Link href={part.href || `/catalog?search=${encodeURIComponent(part.searchQuery || part.name)}`} key={index} className={styles.partCard}>
                <div className={styles.partImageWrapper}>
                  <Image
                    src={part.img}
                    alt={part.name}
                    width={150}
                    height={150}
                    className={styles.partImage}
                  />
                </div>
                <h3 className={styles.partName}>{part.name}</h3>
              </Link>
            ))}
          </div>
        </section>

        {/* Car Brands Section */}
        <CarBrands />

        {/* Bottom Info Section */}
        <section className={styles.bottomInfoSection}>
          {/* Consultation Form Block */}
          <div className={styles.infoBlock}>
            <HomeConsultationForm />
          </div>

          {/* Store Location Block */}
          <div className={styles.infoBlock}>
            <div className={styles.infoCard}>
              <h3 className={styles.storeTitle}>Koma Auto - у нас есть более 17.000 позиций!</h3>
              <div className={styles.locationContent}>
                <div className={styles.locationTextWrapper}>
                  <MapPin size={32} className={styles.locationIcon} />
                  <div className={styles.locationText}>
                    <strong>Наше местоположение:</strong>
                    <span>г. Алматы, ТЦ Car City, 111 Бутик, <br className={styles.desktopBr} /> 1 Ярус</span>
                  </div>
                </div>
                <div className={styles.carCityLogoWrapper}>
                  <Image
                    src="/img/carcity.png"
                    alt="Car City"
                    width={240}
                    height={75}
                    className={styles.carCityLogo}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Location Map and Hours Section */}
        <LocationMap />

      </div>
    </div>
  );
}
