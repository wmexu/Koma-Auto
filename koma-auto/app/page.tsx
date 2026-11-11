import Link from 'next/link';
import Image from 'next/image';
import styles from './page.module.css';
import { User, Phone, CarFront, MapPin, ArrowRight, MessageSquareText } from 'lucide-react';
import CarBrands from '../components/CarBrands/CarBrands';
import { getFeaturedProductsFromDb } from '../lib/products-db';
import { Product } from '../data/products';
import SideSlider from '../components/SideSlider/SideSlider';
import HomeConsultationForm from '../components/HomeConsultationForm/HomeConsultationForm';
import LocationMap from '../components/LocationMap/LocationMap';

export const revalidate = 60; // Revalidate every minute to sync featured products and photos promptly

const FEATURED_PRODUCT_IDS = [
  '02bd811c-4e95-11f1-0a80-17ce000b265a', // 1. Стартер 361002G200 mobis Hyundai/Kia
  '28241a2d-4e97-11f1-0a80-17ce000dace8', // 2. Задние тормозные колодки Hyundai/Kia
  '0560c932-4e95-11f1-0a80-17ce000b2828', // 3. Амортизатор задний Chevrolet
  '3d54cce0-4e97-11f1-0a80-17ce000dbe29', // 4. Колодки тормозные задние Hyundai/Kia
  '01d1bd94-4e95-11f1-0a80-17ce000b2613', // 5. Датчик кислородный (лямбдазонд) Hyundai/Kia
];

const FEATURED_FALLBACK_PRODUCTS: Product[] = [
  {
    id: '02bd811c-4e95-11f1-0a80-17ce000b265a',
    moySkladId: '02bd811c-4e95-11f1-0a80-17ce000b265a',
    name: 'Стартер Hyundai/Kia',
    article: '361002G200',
    oem: '361002G200',
    brand: 'Mobis',
    price: 34900,
    inStock: true,
    category: 'Автозапчасти',
    image: '/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F42ca9e3a-09de-4ea6-81c1-9b5432b1b66b',
    images: ['/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F42ca9e3a-09de-4ea6-81c1-9b5432b1b66b'],
    specs: {},
    compatibility: [],
    description: '',
    variants: [],
    availableBrandsCount: 1,
  },
  {
    id: '28241a2d-4e97-11f1-0a80-17ce000dace8',
    moySkladId: '28241a2d-4e97-11f1-0a80-17ce000dace8',
    name: 'Задние тормозные колодки Hyundai/Kia',
    article: '58302G4A30',
    oem: '58302G4A30',
    brand: 'Hi-Q Korea',
    price: 12200,
    inStock: true,
    category: 'Автозапчасти',
    image: '/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F356b3de3-f5c3-457a-88cd-4b3e98cbacae',
    images: ['/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F356b3de3-f5c3-457a-88cd-4b3e98cbacae'],
    specs: {},
    compatibility: [],
    description: '',
    variants: [],
    availableBrandsCount: 1,
  },
  {
    id: '0560c932-4e95-11f1-0a80-17ce000b2828',
    moySkladId: '0560c932-4e95-11f1-0a80-17ce000b2828',
    name: 'Амортизатор задний Chevrolet',
    article: '95967519',
    oem: '95967519',
    brand: 'UzDW',
    price: 9000,
    inStock: true,
    category: 'Автозапчасти',
    image: '/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F38e43e94-75e5-49b8-8f61-8baf0d25af6a',
    images: ['/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F38e43e94-75e5-49b8-8f61-8baf0d25af6a'],
    specs: {},
    compatibility: [],
    description: '',
    variants: [],
    availableBrandsCount: 1,
  },
  {
    id: '3d54cce0-4e97-11f1-0a80-17ce000dbe29',
    moySkladId: '3d54cce0-4e97-11f1-0a80-17ce000dbe29',
    name: 'Колодки тормозные задние Hyundai/Kia',
    article: '58302M0A11HQ',
    oem: '58302M0A11HQ',
    brand: 'Hi-Q Mando',
    price: 4900,
    inStock: true,
    category: 'Автозапчасти',
    image: '/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F739b9002-d0df-4a9e-bb4b-a78fa394418f',
    images: ['/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F739b9002-d0df-4a9e-bb4b-a78fa394418f'],
    specs: {},
    compatibility: [],
    description: '',
    variants: [],
    availableBrandsCount: 1,
  },
  {
    id: '01d1bd94-4e95-11f1-0a80-17ce000b2613',
    moySkladId: '01d1bd94-4e95-11f1-0a80-17ce000b2613',
    name: 'Датчик кислородный (лямбдазонд) Hyundai/Kia',
    article: '3921026620',
    oem: '3921026620',
    brand: 'Mobis',
    price: 12000,
    inStock: true,
    category: 'Автозапчасти',
    image: '/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2Fd666c610-a166-4be6-aebc-cd7d127df97b',
    images: ['/api/images?href=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2Fd666c610-a166-4be6-aebc-cd7d127df97b'],
    specs: {},
    compatibility: [],
    description: '',
    variants: [],
    availableBrandsCount: 1,
  },
];

export default async function Home() {
  let sliderProducts: Product[] = [];
  try {
    // 1. Primary: Direct high-speed Neon Postgres query (<15ms)
    sliderProducts = await getFeaturedProductsFromDb(FEATURED_PRODUCT_IDS);
  } catch (error) {
    console.error("Failed to fetch products for slider:", error);
  }

  // 2. Guaranteed safety fallback: Never let the slider disappear (Zero MoySklad API traffic)
  if (!sliderProducts || sliderProducts.length === 0) {
    sliderProducts = FEATURED_FALLBACK_PRODUCTS;
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
