'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import Link from 'next/link';
import { CheckCircle, Shield } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';
import { useToastStore } from '../../store/useToastStore';
import styles from './Checkout.module.css';

declare global {
  interface Window {
    halyk?: {
      pay: (params: any) => void;
      showPaymentWidget: (params: any, callBack: (res: { success: boolean }) => void) => void;
    };
  }
}

const CITIES_LIST = [
  "Актау", "Актобе", "Актюбинск", "Алматы", "Аркалык", "Астана", "Атбасар", "Атырау",
  "Балхаш", "Боровое",
  "Джамбул",
  "Жезказган",
  "Зайсан",
  "Караганда", "Кокшетау", "Костанай", "Кызылорда",
  "Павлодар", "Петропавловск",
  "Риддер",
  "Сарыагаш", "Семипалатинск",
  "Талды-Корган", "Талдыкорган",
  "Уральск", "Усть-Каменогорск",
  "Шымкент",
  "Экибастуз"
];

const groupedCities = CITIES_LIST.reduce((acc, city) => {
  const letter = city[0].toUpperCase();
  if (!acc[letter]) acc[letter] = [];
  acc[letter].push(city);
  return acc;
}, {} as Record<string, string[]>);

const sortedLetters = Object.keys(groupedCities).sort();

export default function CheckoutClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { items, getTotalPrice, clearCart } = useCartStore();
  const { addToast } = useToastStore();
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{name?: string}>({});
  const [isCityModalOpen, setIsCityModalOpen] = useState(false);

  useEffect(() => {
    const status = searchParams.get('status');
    const error = searchParams.get('error');
    if (status === 'fail' || error) {
      addToast('Оплата не была завершена или отклонена банком. Пожалуйста, попробуйте еще раз.', 'error');
    }
  }, [searchParams, addToast]);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    city: '',
    street: '',
    house: '',
    apartment: '',
    entrance: '',
    postalCode: '',
    comment: '',
    deliveryMethod: 'courier',
    paymentMethod: 'online',
  });

  const [agreements, setAgreements] = useState({
    offer: false,
    privacy: false,
    refund: false
  });

  const totalPrice = getTotalPrice();
  
  // Calculate delivery logic
  let deliveryCost = 0;
  let courierAvailable = true;
  let courierMessage = '';

  const normalizedCity = formData.city.trim().toLowerCase();

  if (normalizedCity === '') {
    deliveryCost = 0;
    courierAvailable = true;
  } else if (normalizedCity.includes('алматы') && !normalizedCity.includes('область')) {
    if (totalPrice >= 75000) {
      deliveryCost = 0;
    } else {
      deliveryCost = 6500;
    }
  } else {
    if (totalPrice < 150000) {
      courierAvailable = false;
      courierMessage = 'Для доставки в этот регион закажите от 150.000 тенге. Доставка от этой суммы осуществляется бесплатно';
    } else {
      deliveryCost = 0;
    }
  }

  // Force pickup if courier not available
  useEffect(() => {
    if (!courierAvailable && formData.deliveryMethod === 'courier') {
      setFormData(prev => ({ ...prev, deliveryMethod: 'pickup' }));
    }
  }, [courierAvailable, formData.deliveryMethod]);

  // Adjust payment methods based on delivery
  useEffect(() => {
    if (formData.deliveryMethod === 'pickup') {
      if (formData.paymentMethod !== 'card_receipt' && formData.paymentMethod !== 'cash' && formData.paymentMethod !== 'online') {
        setFormData(prev => ({ ...prev, paymentMethod: 'online' }));
      }
    } else {
      if (formData.paymentMethod !== 'online') {
        setFormData(prev => ({ ...prev, paymentMethod: 'online' }));
      }
    }
  }, [formData.deliveryMethod]);

  const finalPrice = formData.deliveryMethod === 'courier' ? totalPrice + deliveryCost : totalPrice;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateFullName = (fullName: string) => {
    const trimmed = fullName.trim();
    if (!trimmed.includes(' ') || trimmed.length < 8) {
      return 'Пожалуйста, введите Имя и Фамилию через пробел, полным значением (не менее 8 символов)';
    }
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!agreements.offer || !agreements.privacy || !agreements.refund) {
      addToast('Необходимо согласиться со всеми условиями', 'error');
      return;
    }

    const nameError = validateFullName(formData.name);
    if (nameError) {
      setErrors({ name: nameError });
      addToast(nameError, 'error');
      return;
    }

    if (!formData.phone || formData.phone.trim().length < 8) {
      addToast('Пожалуйста, укажите контактный номер телефона', 'error');
      return;
    }

    if (formData.deliveryMethod === 'courier') {
      if (!formData.city) {
        addToast('Пожалуйста, выберите населенный пункт', 'error');
        return;
      }
      if (!formData.street || !formData.house || !formData.apartment) {
        addToast('Пожалуйста, укажите полный адрес доставки (улицу, дом, квартиру)', 'error');
        return;
      }
    }

    if (formData.paymentMethod === 'online') {
      setIsSubmitting(true);
      try {
        const res = await fetch('/api/epay/create-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: finalPrice,
            name: formData.name,
            phone: formData.phone,
            email: formData.email,
            origin: window.location.origin,
            deliveryMethod: formData.deliveryMethod,
            city: formData.city,
            comment: formData.comment,
            items: items.map((item) => ({
              id: item.id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
            })),
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Ошибка при обращении к платёжной системе');
        }

        // Save order invoice to sessionStorage
        try {
          sessionStorage.setItem('lastEpayInvoiceId', data.invoiceId);
        } catch (e) {
          // ignore
        }

        // Redirect to Halyk ePay
        if (typeof window !== 'undefined' && window.halyk && typeof window.halyk.pay === 'function') {
          window.halyk.pay(data.paymentObject);
        } else if (data.paymentUrl) {
          window.location.href = data.paymentUrl;
        } else {
          throw new Error('Не удалось сформировать платёжную ссылку');
        }
      } catch (err: any) {
        console.error('Payment error:', err);
        addToast(err?.message || 'Ошибка подключения к Halyk ePay', 'error');
        setIsSubmitting(false);
      }
      return;
    }

    // For offline/cash payment upon pickup
    setIsSuccess(true);
    clearCart();
  };

  if (isSuccess) {
    return (
      <div className={`container ${styles.successState}`}>
        <CheckCircle size={80} color="var(--color-success)" />
        <h1>Заказ успешно оформлен!</h1>
        <p>Ваш заказ №{Math.floor(Math.random() * 100000)} принят в обработку. Мы свяжемся с вами в ближайшее время.</p>
        <Link href="/" className={styles.homeBtn}>
          Вернуться на главную
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`container ${styles.emptyState}`}>
        <h2>Для оформления заказа добавьте товары в корзину</h2>
        <Link href="/catalog" className={styles.homeBtn}>
          В каталог
        </Link>
      </div>
    );
  }

  return (
    <div className={`container ${styles.checkoutPage}`}>
      <div className={styles.sellerInfo}>
        Продавец: ИП KAMOLDIN, ИИН 860516303365
      </div>
      <h1 className={styles.title}>Оформление заказа</h1>

      <form className={styles.formLayout} onSubmit={handleSubmit}>
        <div className={styles.mainCol}>
          <div className={styles.section}>
            <h2>1. Контактные данные</h2>
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label className={errors.name ? styles.labelError : ''}>Имя и Фамилия *</label>
                <input 
                  required 
                  type="text" 
                  name="name" 
                  value={formData.name} 
                  onChange={(e) => {
                    handleChange(e);
                    if (errors.name) setErrors({});
                  }} 
                  className={errors.name ? styles.inputError : ''}
                />
                {errors.name && <span className={styles.errorText}>{errors.name}</span>}
              </div>
              <div className={styles.inputGroup}>
                <label>Телефон *</label>
                <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} />
              </div>
              <div className={styles.inputGroup}>
                <label>E-mail</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} />
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <h2>2. Адрес доставки</h2>
            <div className={styles.formGrid}>
              <div className={`${styles.inputGroup} ${styles.cityInputWrapper}`}>
                <label>Населенный пункт *</label>
                <input 
                  required 
                  type="text" 
                  name="city" 
                  value={formData.city} 
                  readOnly
                  onClick={() => setIsCityModalOpen(true)}
                  onFocus={() => setIsCityModalOpen(true)}
                  placeholder="Выберите город" 
                  autoComplete="off"
                  style={{ cursor: 'pointer' }}
                />
                {isCityModalOpen && (
                  <>
                    <div className={styles.cityModalOverlay} onClick={() => setIsCityModalOpen(false)} />
                    <div className={styles.cityDropdown}>
                      {sortedLetters.map(letter => (
                        <div key={letter} className={styles.cityGroup}>
                          <div className={styles.cityLetter}>{letter}</div>
                          {groupedCities[letter].map(city => (
                            <div 
                              key={city} 
                              className={styles.cityItem}
                              onClick={() => {
                                setFormData(prev => ({ ...prev, city }));
                                setIsCityModalOpen(false);
                              }}
                            >
                              {city}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className={styles.inputGroup}>
                <label>Улица / Микрорайон *</label>
                <input required type="text" name="street" value={formData.street} onChange={handleChange} />
              </div>
              <div className={styles.inputGroup}>
                <label>Дом / Здание *</label>
                <input required type="text" name="house" value={formData.house} onChange={handleChange} />
              </div>
              <div className={styles.inputGroup}>
                <label>Квартира / Офис *</label>
                <input required type="text" name="apartment" value={formData.apartment} onChange={handleChange} />
              </div>
            </div>
            
            <h3 className={styles.subHeading} style={{ marginTop: '24px', marginBottom: '16px', fontSize: '18px', fontWeight: '500', color: 'var(--color-navy)' }}>Дополнительные данные</h3>
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label>Подъезд / Код / Этаж</label>
                <input type="text" name="entrance" value={formData.entrance} onChange={handleChange} />
              </div>
              <div className={styles.inputGroup}>
                <label>Почтовый индекс</label>
                <input type="text" name="postalCode" value={formData.postalCode} onChange={handleChange} />
              </div>
            </div>
            <div className={styles.inputGroup} style={{ marginTop: '16px' }}>
              <label>Комментарий для курьера</label>
              <textarea name="comment" value={formData.comment} onChange={handleChange} rows={2} />
            </div>
          </div>

          <div className={styles.section}>
            <h2>3. Способ доставки</h2>
            <div className={styles.radioGroup}>
              <label className={`${styles.radioCard} ${!courierAvailable ? styles.disabledCard : ''}`}>
                <input
                  type="radio"
                  name="deliveryMethod"
                  value="courier"
                  checked={formData.deliveryMethod === 'courier'}
                  onChange={handleChange}
                  disabled={!courierAvailable}
                />
                <div className={styles.radioContent}>
                  <span className={styles.radioTitle}>
                    {normalizedCity === ''
                      ? 'Курьером до дома'
                      : normalizedCity.includes('алматы') && !normalizedCity.includes('область')
                        ? 'Курьером до дома по г. Алматы'
                        : 'Курьером по Республике Казахстан'}
                  </span>
                  <span className={styles.radioDesc}>
                    {normalizedCity === '' 
                      ? 'Выберите город для расчета'
                      : normalizedCity.includes('алматы') && !normalizedCity.includes('область')
                        ? '6500 тенге, при сумме корзины 75000 тенге доставка по г. Алматы бесплатно' 
                        : (courierAvailable ? 'Доставка от суммы корзины 150.000 тенге осуществляется бесплатно' : courierMessage)}
                  </span>
                </div>
              </label>
              <label className={styles.radioCard}>
                <input
                  type="radio"
                  name="deliveryMethod"
                  value="pickup"
                  checked={formData.deliveryMethod === 'pickup'}
                  onChange={handleChange}
                />
                <div className={styles.radioContent}>
                  <span className={styles.radioTitle}>Самовывоз</span>
                  <span className={styles.radioDesc}>Из нашего магазина в городе Алматы, торговом центре Car City. Бесплатно.</span>
                </div>
              </label>
            </div>

          </div>

          <div className={styles.section}>
            <h2>4. Способ оплаты</h2>
            <div className={styles.radioGroup}>
              {formData.deliveryMethod === 'pickup' ? (
                <>
                  <label className={styles.radioCard}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="online"
                      checked={formData.paymentMethod === 'online'}
                      onChange={handleChange}
                    />
                    <div className={styles.radioContent}>
                      <span className={styles.radioTitle}>Halyk QR, Kaspi, или картой онлайн</span>
                      <span className={styles.radioDesc}>Оплата на сайте через защищенный платёжный шлюз ePay</span>
                    </div>
                  </label>
                  <label className={styles.radioCard}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="card_receipt"
                      checked={formData.paymentMethod === 'card_receipt'}
                      onChange={handleChange}
                    />
                    <div className={styles.radioContent}>
                      <span className={styles.radioTitle}>Halyk QR/Kaspi QR при получении со склада</span>
                    </div>
                  </label>
                  <label className={styles.radioCard}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="cash"
                      checked={formData.paymentMethod === 'cash'}
                      onChange={handleChange}
                    />
                    <div className={styles.radioContent}>
                      <span className={styles.radioTitle}>Наличными при получении</span>
                    </div>
                  </label>
                </>
              ) : (
                <label className={styles.radioCard}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="online"
                    checked={formData.paymentMethod === 'online'}
                    onChange={handleChange}
                  />
                  <div className={styles.radioContent}>
                    <span className={styles.radioTitle}>Halyk QR, Kaspi, или картой онлайн</span>
                    <span className={styles.radioDesc}>Оплата на сайте через защищенный платёжный шлюз ePay</span>
                  </div>
                </label>
              )}
            </div>
            
            {formData.paymentMethod === 'online' && (
              <div className={styles.securityText}>
                <Shield size={16} color="var(--color-success)" style={{ minWidth: '16px' }} />
                <span>Оплата производится через защищенный платежный шлюз Halyk ePay с поддержкой технологии 3D Secure</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.sideCol}>
          <div className={styles.summaryBox}>
            <h3>Ваш заказ</h3>
            <div className={styles.summaryItems}>
              {items.map((item) => (
                <div key={item.id} className={styles.summaryItem}>
                  <span>{item.name} x{item.quantity}</span>
                  <span>{(item.price * item.quantity).toLocaleString()} ₸</span>
                </div>
              ))}
            </div>
            
            <div className={styles.summaryCalculations}>
              <div className={styles.calcRow}>
                <span>Товары</span>
                <span>{totalPrice.toLocaleString()} ₸</span>
              </div>
              {formData.deliveryMethod === 'courier' ? (
                <div className={styles.calcRow}>
                  <span>Доставка</span>
                  <span>{normalizedCity === '' ? '-' : (deliveryCost === 0 ? 'Бесплатно' : `${deliveryCost.toLocaleString()} ₸`)}</span>
                </div>
              ) : (
                <div className={styles.calcRow}>
                  <span>Самовывоз</span>
                  <span>0 ₸</span>
                </div>
              )}
            </div>

            <div className={styles.totalRow}>
              <span>Итого к оплате</span>
              <span className={styles.totalValue}>{finalPrice.toLocaleString()} ₸</span>
            </div>
            
            <div className={styles.agreementsBlock}>
              <label className={styles.checkboxLabel}>
                <input 
                  type="checkbox" 
                  checked={agreements.offer} 
                  onChange={(e) => setAgreements(prev => ({...prev, offer: e.target.checked}))}
                  required 
                />
                <span>Я ознакомлен с <Link href="/terms-of-service" target="_blank">Договором публичной оферты</Link></span>
              </label>
              <label className={styles.checkboxLabel}>
                <input 
                  type="checkbox" 
                  checked={agreements.privacy} 
                  onChange={(e) => setAgreements(prev => ({...prev, privacy: e.target.checked}))}
                  required 
                />
                <span>Я ознакомлен с <Link href="/privacy-policy" target="_blank">Политикой конфиденциальности и защитой персональных данных</Link></span>
              </label>
              <label className={styles.checkboxLabel}>
                <input 
                  type="checkbox" 
                  checked={agreements.refund} 
                  onChange={(e) => setAgreements(prev => ({...prev, refund: e.target.checked}))}
                  required 
                />
                <span>Я ознакомлен с <Link href="/terms-of-service" target="_blank">Правилами возврата товара и денежных средств</Link></span>
              </label>
            </div>

            <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
              {isSubmitting ? 'Подключение к Halyk ePay...' : 'Перейти к оплате'}
            </button>
          </div>
        </div>
      </form>
      <Script src="https://epay.homebank.kz/payform/payment-api.js" strategy="afterInteractive" />
    </div>
  );
}
