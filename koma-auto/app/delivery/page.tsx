import styles from './Delivery.module.css';

export const metadata = {
  title: 'Доставка и оплата | koma.com.kz',
  description: 'Информация о доставке и оплате автозапчастей в магазине koma.com.kz',
};

export default function DeliveryPage() {
  return (
    <div className={styles.page}>
      <div className="container">
        <h1 className={styles.mainTitle}>Доставка и оплата</h1>
        
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Доставка</h2>
          <div className={styles.content}>
            <p>Мы осуществляем доставку заказов собственным транспортом. Стоимость доставки обсуждается индивидуально. Ниже представлены условия для бесплатной доставки:</p>
            
            <h3 style={{ textAlign: 'center', marginTop: '40px', fontSize: '28px', color: 'var(--color-navy)' }}>Условия бесплатной доставки</h3>
            
            <div className={styles.cardsGrid}>
              <div className={styles.deliveryCard}>
                <div className={styles.cardIcon}>🚚</div>
                <div className={styles.cardPrice}>75 000 ₸</div>
                <div className={styles.cardText}>Бесплатная доставка по г. Алматы при заказе от этой суммы</div>
              </div>
              
              <div className={styles.deliveryCard}>
                <div className={styles.cardIcon}>🚛</div>
                <div className={styles.cardPrice}>150 000 ₸</div>
                <div className={styles.cardText}>Бесплатная доставка по области Алматы при заказе от этой суммы</div>
              </div>
              
              <div className={styles.deliveryCard}>
                <div className={styles.cardIcon}>🌍</div>
                <div className={styles.cardPrice}>200 000 ₸</div>
                <div className={styles.cardText}>Бесплатная доставка по Казахстану, до г. Ташкента и г. Бишкека при заказе от этой суммы</div>
              </div>
            </div>
            
            <p style={{ marginTop: '32px' }}>*Сроки доставки зависят от наличия товара на складе и региона отправки. Точные сроки согласовываются с менеджером при подтверждении заказа.</p>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Оплата</h2>
          <div className={styles.content}>
            <p>Для вашего удобства мы предлагаем следующие способы оплаты:</p>
            <ul>
              <li><strong>Наличными:</strong> При самовывозе из нашего магазина или курьеру при получении заказа (только для Алматы).</li>
              <li><strong>Банковской картой:</strong> Оплата картами Kaspi, Halyk, Freedom.</li>
              <li><strong>Kaspi Gold / Kaspi QR:</strong> Быстрый и удобный способ оплаты через приложение Kaspi.</li>
            </ul>
            <p>Если у вас возникли вопросы по поводу способов оплаты или доставки, пожалуйста, свяжитесь с нами, и наши менеджеры с удовольствием проконсультируют вас.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
