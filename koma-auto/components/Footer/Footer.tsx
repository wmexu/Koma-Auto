import Link from 'next/link';
import Image from 'next/image';
import { Phone, Mail, MapPin } from 'lucide-react';
import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.container}`}>
        <div className={styles.column}>
          <Link href="/" className={styles.logoWrapper}>
            <Image
              src="/img/LogoKomaKZ.png"
              alt="koma.com.kz Auto Parts"
              width={150}
              height={50}
              className={styles.logoImage}
            />
          </Link>
          <p className={styles.desc}>
            Ваш надежный партнер в мире автозапчастей. Широкий ассортимент, быстрая доставка и гарантия качества.
          </p>
        </div>

        <div className={styles.column}>
          <h3 className={styles.title}>Покупателям</h3>
          <ul className={styles.list}>
            <li><Link href="/">Главная</Link></li>
            <li><Link href="/catalog">Каталог товаров</Link></li>
            <li><Link href="/cart">Корзина</Link></li>
            <li><Link href="/delivery">Доставка и оплата</Link></li>
          </ul>
        </div>

        <div className={styles.column}>
          <h3 className={styles.title}>Юридическая информация</h3>
          <ul className={styles.list}>
            <li><Link href="/terms-of-service">Пользовательское соглашение</Link></li>
            <li><Link href="/privacy-policy">Политика конфиденциальности</Link></li>
            <li><Link href="/terms-of-service">Договор оферты</Link></li>
          </ul>
        </div>

        <div className={styles.column}>
          <h3 className={styles.title}>Контакты</h3>
          <ul className={styles.contactList}>
            <li>
              <Phone size={18} className={styles.contactIcon} />
              <a href="tel:+77079194462">+7 707 919 4462</a>
            </li>
            <li>
              <Mail size={18} className={styles.contactIcon} />
              <a href="mailto:koma.auto.kz@gmail.com">koma.auto.kz@gmail.com</a>
            </li>
            <li>
              <MapPin size={18} className={styles.contactIcon} />
              <span>Республика Казахстан, г. Алматы, ТЦ Car City, 1 ярус, 111 бутик</span>
            </li>
          </ul>
        </div>
      </div>
      <div className={styles.bottom}>
        <div className="container">
          <p>&copy; {new Date().getFullYear()} koma.com.kz &middot; ИП «KAMOLDIN», ИИН 860516303365. Все права защищены.</p>
        </div>
      </div>
    </footer>
  );
}
