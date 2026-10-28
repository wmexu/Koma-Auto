'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import Link from 'next/link';
import { CheckCircle, Shield, Package, AlertTriangle, Smartphone, X } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';
import { useToastStore } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Order, getEffectiveOrderStatus } from '@/lib/order-types';
import { persistOrder, getLocalOrderById } from '@/lib/orders';
import styles from './Checkout.module.css';

declare global {
  interface Window {
    halyk?: {
      pay: (params: any) => void;
      showPaymentWidget: (params: any, callBack: (res: { success: boolean }) => void) => void;
    };
  }
}

function WhatsAppIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ minWidth: size }}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

const CITIES_LIST = [
  "Алматы", "Актау", "Актобе", "Актюбинск", "Аркалык", "Астана", "Атбасар", "Атырау",
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

if (groupedCities['А']) {
  groupedCities['А'] = [
    'Алматы',
    ...groupedCities['А'].filter(c => c !== 'Алматы')
  ];
}

const sortedLetters = Object.keys(groupedCities).sort();

const formatKazakhPhone = (val: string) => {
  let digits = val.replace(/\D/g, '');
  if ((digits.startsWith('7') || digits.startsWith('8')) && digits.length > 10) {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);

  if (digits.length === 0) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  if (digits.length <= 8) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
};

export default function CheckoutClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { items, getTotalPrice, clearCart } = useCartStore();
  const { addToast } = useToastStore();
  const { user, userProfile } = useAuthStore();
  const [isSuccess, setIsSuccess] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ lastName?: string; firstName?: string; phone?: string }>({});
  const [isCityModalOpen, setIsCityModalOpen] = useState(false);
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    type?: 'percent' | 'fixed';
    value?: number;
    discountAmount?: number;
    minCartTotal?: number;
    maxCartTotal?: number;
    maxDiscount?: number;
    title?: string;
    message?: string;
    isTestMode?: boolean;
    targetPrice?: number;
    disclaimer?: string;
  } | null>(null);

  const totalPrice = getTotalPrice();

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.settings) {
          setKillSwitchActive(Boolean(data.settings.killSwitchActive));
        }
      })
      .catch(() => {});

    const savedPromoRaw = sessionStorage.getItem('koma_promocode') || sessionStorage.getItem('koma_test_promocode');
    let codeToVerify = '';
    if (savedPromoRaw) {
      try {
        const parsed = JSON.parse(savedPromoRaw);
        codeToVerify = parsed.code || savedPromoRaw;
      } catch {
        codeToVerify = savedPromoRaw;
      }
    }

    if (codeToVerify) {
      fetch('/api/promocode/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: codeToVerify,
          cartTotal: totalPrice,
          userEmail: user?.email || '',
          userId: user?.uid || null,
          clientType: userProfile?.clientType || 'retail',
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            setAppliedPromo(data);
          } else {
            sessionStorage.removeItem('koma_promocode');
            sessionStorage.removeItem('koma_test_promocode');
          }
        })
        .catch(() => {});
    }
  }, [user?.email, user?.uid, userProfile?.clientType]);

  // Reactive verification: when cart price changes, check if promo requirements are still met
  useEffect(() => {
    if (appliedPromo && !appliedPromo.isTestMode && totalPrice > 0) {
      if (appliedPromo.minCartTotal && totalPrice < appliedPromo.minCartTotal) {
        addToast(
          `Сумма вашей корзины слишком маленькая (минимум ${appliedPromo.minCartTotal.toLocaleString('ru-RU')} тенге). Промокод ${appliedPromo.code} не применен`,
          'error'
        );
        setAppliedPromo(null);
        sessionStorage.removeItem('koma_promocode');
      } else if (appliedPromo.maxCartTotal && totalPrice > appliedPromo.maxCartTotal) {
        addToast(
          `Сумма вашей корзины слишком большая (до ${appliedPromo.maxCartTotal.toLocaleString('ru-RU')} тенге). Промокод ${appliedPromo.code} не применен`,
          'error'
        );
        setAppliedPromo(null);
        sessionStorage.removeItem('koma_promocode');
      }
    }
  }, [totalPrice, appliedPromo]);

  const handleApplyPromo = async () => {
    const code = promoCodeInput.trim().toUpperCase();
    if (!code) {
      addToast('Введите промокод', 'error');
      return;
    }
    setIsApplyingPromo(true);
    try {
      const res = await fetch('/api/promocode/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code,
          cartTotal: totalPrice,
          userEmail: user?.email || formData.email || '',
          userId: user?.uid || null,
          clientType: userProfile?.clientType || 'retail',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        addToast(data.error || 'Промокод недействителен', 'error');
        return;
      }

      setAppliedPromo(data);
      sessionStorage.setItem('koma_promocode', JSON.stringify({ code: data.code, timestamp: Date.now() }));
      setPromoCodeInput('');
      addToast(data.message || 'Промокод успешно применен!', 'success');
    } catch (e: any) {
      addToast('Ошибка при проверке промокода', 'error');
    } finally {
      setIsApplyingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    const promoName = appliedPromo?.code || '';
    setAppliedPromo(null);
    sessionStorage.removeItem('koma_promocode');
    sessionStorage.removeItem('koma_test_promocode');
    addToast(appliedPromo?.isTestMode ? 'Тестовый режим отключен' : `Промокод ${promoName} отменен`, 'info');
  };

  useEffect(() => {
    const status = searchParams.get('status');
    const error = searchParams.get('error');
    const orderId = searchParams.get('orderId') || (typeof window !== 'undefined' ? sessionStorage.getItem('lastEpayInvoiceId') : null);

    if (status === 'fail' || error) {
      const localOrder = orderId ? getLocalOrderById(orderId) : null;
      const paymentUrl = localOrder?.paymentUrl;

      if (localOrder && paymentUrl && getEffectiveOrderStatus(localOrder) === 'pending') {
        addToast(
          'Оплата ещё не была завершена. Ваш заказ ожидает оплаты.',
          'warning',
          {
            autoClose: false,
            action: {
              label: 'Вернуться к оплате',
              onClick: () => {
                window.location.href = paymentUrl;
              },
            },
            onDismiss: () => {
              addToast(
                'Вы всегда можете вернуться к оплате в профиле (в разделе «Мои заказы»)',
                'info',
                { autoClose: true, duration: 5000 }
              );
            },
          }
        );
      } else {
        addToast('Оплата не была завершена или отклонена банком. Пожалуйста, попробуйте еще раз.', 'error');
      }
    }
  }, [searchParams, addToast]);

  const [formData, setFormData] = useState({
    lastName: '',
    firstName: '',
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

  const [lastPaymentMethod, setLastPaymentMethod] = useState<'kaspi_pay' | 'online'>('online');
  const [isPhoneFocused, setIsPhoneFocused] = useState(false);
  const [customKaspiPhone, setCustomKaspiPhone] = useState<string>('');
  const [isKaspiModalOpen, setIsKaspiModalOpen] = useState(false);
  const [kaspiModalPhone, setKaspiModalPhone] = useState('');
  const [isKaspiModalFocused, setIsKaspiModalFocused] = useState(false);

  const handleOpenKaspiModal = () => {
    setKaspiModalPhone(customKaspiPhone || formData.phone || '');
    setIsKaspiModalOpen(true);
  };

  const handleSaveKaspiPhone = () => {
    const digits = kaspiModalPhone.replace(/\D/g, '');
    if (digits.length > 0 && digits.length < 10) {
      addToast('Пожалуйста, введите полный номер телефона (10 цифр)', 'error');
      return;
    }
    setCustomKaspiPhone(kaspiModalPhone);
    setIsKaspiModalOpen(false);
    if (digits.length >= 10) {
      addToast('Номер телефона для счета Kaspi обновлен', 'success');
    }
  };

  const [agreements, setAgreements] = useState({
    offer: false,
    privacy: false,
    refund: false
  });

  useEffect(() => {
    // Authoritatively prioritize userProfile.name (what the customer explicitly configured)
    const authoritativeName = (userProfile?.name || '').trim();
    const fallbackName = (user?.displayName && !user.displayName.includes('@') ? user.displayName : '').trim();
    const fullNameToUse = authoritativeName || fallbackName;

    let initialFirst = '';
    let initialLast = '';

    if (fullNameToUse) {
      const parts = fullNameToUse.split(/\s+/);
      if (parts.length >= 2) {
        // Standard convention: "Фамилия Имя" (e.g. "Манкусов Алан")
        initialLast = parts[0];
        initialFirst = parts.slice(1).join(' ');
      } else {
        initialFirst = parts[0] || '';
      }
    }

    const emailToUse = userProfile?.email || user?.email || '';
    const rawPhone = userProfile?.phone || user?.phoneNumber || '';
    const phoneToUse = rawPhone ? formatKazakhPhone(rawPhone) : '';

    setFormData((prev) => ({
      ...prev,
      firstName: prev.firstName || initialFirst,
      lastName: prev.lastName || initialLast,
      email: prev.email || emailToUse,
      phone: prev.phone || phoneToUse,
    }));
  }, [user, userProfile]);
  
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

  const isTestMode = Boolean(appliedPromo?.isTestMode);
  const testPrice = appliedPromo?.targetPrice ?? 10;

  let promoDiscount = 0;
  if (appliedPromo && !appliedPromo.isTestMode) {
    if (appliedPromo.type === 'percent' && appliedPromo.value) {
      let d = Math.round((totalPrice * appliedPromo.value) / 100);
      if (appliedPromo.maxDiscount && d > appliedPromo.maxDiscount) {
        d = appliedPromo.maxDiscount;
      }
      promoDiscount = d;
    } else if (appliedPromo.type === 'fixed' && appliedPromo.value) {
      promoDiscount = Math.min(totalPrice, appliedPromo.value);
    }
  }

  const itemsDiscountedPrice = Math.max(0, totalPrice - promoDiscount);
  const calculatedDelivery = isTestMode ? 0 : deliveryCost;
  const finalPrice = isTestMode
    ? testPrice
    : (formData.deliveryMethod === 'courier' ? itemsDiscountedPrice + deliveryCost : itemsDiscountedPrice);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === 'lastName' && errors.lastName) {
      setErrors((prev) => ({ ...prev, lastName: undefined }));
    }
    if (name === 'firstName' && errors.firstName) {
      setErrors((prev) => ({ ...prev, firstName: undefined }));
    }
  };

  const rawKaspi = (customKaspiPhone || formData.phone || '').replace(/\D/g, '');
  const kaspiFormattedDigits = rawKaspi.length >= 10 ? rawKaspi.slice(-10) : rawKaspi;
  const displayKaspiPhone = kaspiFormattedDigits.length === 10
    ? `+7${kaspiFormattedDigits}`
    : (kaspiFormattedDigits.length > 0 ? `+7${kaspiFormattedDigits}` : '+7 (укажите в контактах)');

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatKazakhPhone(e.target.value);
    setFormData((prev) => ({ ...prev, phone: formatted }));
    if (errors.phone) {
      setErrors((prev) => ({ ...prev, phone: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (killSwitchActive) {
      addToast('Приём заказов на сайте временно приостановлен администрацией магазина', 'error');
      return;
    }

    if (!agreements.offer || !agreements.privacy || !agreements.refund) {
      addToast('Необходимо согласиться со всеми условиями', 'error');
      return;
    }

    const lastName = formData.lastName.trim();
    const firstName = formData.firstName.trim();
    const cleanPhoneDigits = formData.phone.replace(/\D/g, '');
    const newErrors: { lastName?: string; firstName?: string; phone?: string } = {};

    if (!lastName || lastName.length < 2) {
      newErrors.lastName = 'Пожалуйста, введите вашу Фамилию';
    }
    if (!firstName || firstName.length < 2) {
      newErrors.firstName = 'Пожалуйста, введите ваше Имя';
    }
    if (cleanPhoneDigits.length < 10) {
      newErrors.phone = 'Пожалуйста, укажите контактный номер телефона';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      addToast(newErrors.lastName || newErrors.firstName || newErrors.phone || 'Заполните обязательные поля', 'error');
      return;
    }

    const fullName = `${lastName} ${firstName}`.trim();
    const formattedPhone = cleanPhoneDigits.length === 10
      ? `+7${cleanPhoneDigits}`
      : (formData.phone.startsWith('+') ? formData.phone : `+7${cleanPhoneDigits}`);

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

    if (formData.paymentMethod === 'kaspi_pay') {
      setIsSubmitting(true);
      try {
        const kaspiOrderId = Math.floor(10000000 + Math.random() * 90000000).toString();
        const fullAddress = formData.deliveryMethod === 'courier'
          ? `г. ${formData.city}, ул. ${formData.street}, д. ${formData.house}${formData.apartment ? `, кв. ${formData.apartment}` : ''}${formData.entrance ? `, подъезд ${formData.entrance}` : ''}${formData.postalCode ? `, инд. ${formData.postalCode}` : ''}`
          : 'Самовывоз: г. Алматы, Car City 1 ярус Подвал';

        const kaspiOrder: Order = {
          id: kaspiOrderId,
          invoiceId: kaspiOrderId,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          status: 'pending',
          amount: finalPrice,
          itemsPrice: totalPrice,
          deliveryCost: calculatedDelivery,
          deliveryMethod: formData.deliveryMethod as 'courier' | 'pickup',
          address: fullAddress,
          city: formData.city || 'Алматы',
          customer: {
            name: fullName,
            phone: formattedPhone,
            email: formData.email,
            comment: `Номер телефона для отправки платежа Kaspi: ${displayKaspiPhone.startsWith('+7') && !displayKaspiPhone.includes('(') ? displayKaspiPhone : formattedPhone}\r\nЗаказ KASPI PAY (счет на номер ${displayKaspiPhone.startsWith('+7') && !displayKaspiPhone.includes('(') ? displayKaspiPhone : formattedPhone}). ${isTestMode ? 'ТЕСТОВЫЙ ЗАКАЗ' : (formData.comment || '')}`.trim(),
          },
          kaspiPhone: displayKaspiPhone.startsWith('+7') && !displayKaspiPhone.includes('(') ? displayKaspiPhone : formattedPhone,
          paymentMethod: 'kaspi_pay',
          items: items.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            image: item.image || (item.images && item.images[0]) || '',
            article: item.article || item.oem || '',
            oem: item.oem || item.article || '',
            brand: item.brand || '',
          })),
          userId: user?.uid || null,
          userAccountDetails: user
            ? {
                uid: user.uid,
                email: user.email || formData.email || null,
                displayName: userProfile?.name || fullName || user.displayName || null,
                phone: user.phoneNumber || formattedPhone || null,
              }
            : null,
          isTestOrder: isTestMode,
          promoCode: appliedPromo?.code || undefined,
        };

        await persistOrder(kaspiOrder);
        setLastOrderId(kaspiOrderId);
        setLastPaymentMethod('kaspi_pay');
        setIsSuccess(true);
        clearCart();
        addToast('Заказ принят! Менеджер сформирует счет в Kaspi Pay.', 'success');
      } catch (err: any) {
        console.error('Kaspi order error:', err);
        addToast(err?.message || 'Ошибка оформления заказа. Пожалуйста, попробуйте еще раз.', 'error');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (formData.paymentMethod === 'online') {
      setIsSubmitting(true);
      try {
        const fullAddress = formData.deliveryMethod === 'courier'
          ? `г. ${formData.city}, ул. ${formData.street}, д. ${formData.house}${formData.apartment ? `, кв. ${formData.apartment}` : ''}${formData.entrance ? `, подъезд ${formData.entrance}` : ''}${formData.postalCode ? `, инд. ${formData.postalCode}` : ''}`
          : 'Самовывоз: г. Алматы, Car City 1 ярус Подвал';

        const res = await fetch('/api/epay/create-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: finalPrice,
            itemsPrice: totalPrice,
            deliveryCost: calculatedDelivery,
            promoCode: appliedPromo?.code || undefined,
            name: fullName,
            phone: formattedPhone,
            email: formData.email,
            origin: window.location.origin,
            deliveryMethod: formData.deliveryMethod,
            city: formData.city,
            address: fullAddress,
            userId: user?.uid || null,
            comment: isTestMode
              ? 'ТЕСТОВЫЙ ЗАКАЗ. ИГНОРИРУЙТЕ'
              : formData.comment,
            items: items.map((item) => ({
              id: item.id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              article: item.article || item.oem || '',
              oem: item.oem || item.article || '',
              brand: item.brand || '',
              image: item.image || (item.images && item.images[0]) || '',
            })),
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Ошибка при обращении к платёжной системе');
        }

        const order: Order = {
          id: data.invoiceId,
          invoiceId: data.invoiceId,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
          status: 'pending',
          amount: finalPrice,
          itemsPrice: totalPrice,
          deliveryCost: calculatedDelivery,
          deliveryMethod: formData.deliveryMethod as 'courier' | 'pickup',
          address: fullAddress,
          city: formData.city,
          customer: {
            name: fullName,
            phone: formattedPhone,
            email: formData.email,
            comment: isTestMode
              ? 'ТЕСТОВЫЙ ЗАКАЗ. ИГНОРИРУЙТЕ'
              : formData.comment,
          },
          paymentMethod: 'online',
          paymentUrl: data.paymentUrl,
          items: items.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            image: item.image || (item.images && item.images[0]) || '',
            article: item.article || item.oem || '',
            oem: item.oem || item.article || '',
            brand: item.brand || '',
          })),
          userId: user?.uid || null,
          userAccountDetails: user
            ? {
                uid: user.uid,
                email: user.email || formData.email || null,
                displayName: userProfile?.name || fullName || user.displayName || null,
                phone: user.phoneNumber || formattedPhone || null,
              }
            : null,
          isTestOrder: isTestMode,
          promoCode: appliedPromo?.code || undefined,
        };

        // Persist order locally & to server API
        await persistOrder(order);

        // Save order invoice to sessionStorage
        try {
          sessionStorage.setItem('lastEpayInvoiceId', data.invoiceId);
        } catch (e) {
          // ignore
        }

        // Clear cart now that order is securely registered
        clearCart();

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
    const offlineOrderId = Math.floor(10000000 + Math.random() * 90000000).toString();
    const offlineOrder: Order = {
      id: offlineOrderId,
      invoiceId: offlineOrderId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'pending',
      amount: finalPrice,
      itemsPrice: totalPrice,
      deliveryCost: calculatedDelivery,
      deliveryMethod: 'pickup',
      address: 'Самовывоз: г. Алматы, Car City 1 ярус Подвал',
      city: formData.city || 'Алматы',
      customer: {
        name: fullName,
        phone: formattedPhone,
        email: formData.email,
        comment: isTestMode
          ? 'ТЕСТОВЫЙ ЗАКАЗ. ИГНОРИРУЙТЕ'
          : formData.comment,
      },
      paymentMethod: formData.paymentMethod as 'cash' | 'card_receipt',
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        image: item.image || (item.images && item.images[0]) || '',
        article: item.article || '',
      })),
      userId: user?.uid || null,
      isTestOrder: isTestMode,
      promoCode: appliedPromo?.code || undefined,
    };

    await persistOrder(offlineOrder);
    setLastOrderId(offlineOrderId);
    setIsSuccess(true);
    clearCart();
  };

  if (isSuccess) {
    const isKaspi = lastPaymentMethod === 'kaspi_pay';
    const cleanPhone = (customKaspiPhone || formData.phone || '').replace(/\D/g, '');
    const phoneFormatted = cleanPhone.length === 10 ? `+7${cleanPhone}` : (formData.phone || '');
    const whatsappKaspiUrl = `https://wa.me/77079194462?text=${encodeURIComponent(
      `Здравствуйте! Я оформил заказ №${lastOrderId} на сумму ${finalPrice.toLocaleString()} ₸ через Kaspi Pay.\nМой номер для счета Kaspi: ${phoneFormatted}.\nИмя: ${formData.lastName} ${formData.firstName}`
    )}`;

    return (
      <div className={`container ${styles.successState}`}>
        <CheckCircle size={84} color="var(--color-success)" strokeWidth={2} />
        <h1>Заказ №{lastOrderId} успешно оформлен!</h1>
        {isKaspi ? (
          <div className={styles.kaspiSuccessCard}>
            <p className={styles.kaspiSuccessLead}>
              Способ оплаты: <strong>Kaspi Pay</strong> &middot; Сумма к оплате: <strong>{finalPrice.toLocaleString()} ₸</strong>
            </p>
            <p className={styles.kaspiSuccessText}>
              Менеджер магазина Koma Auto сейчас сформирует и выставит удаленный счет на оплату в приложении Kaspi на ваш номер <strong>{phoneFormatted}</strong>.
            </p>
            <a
              href={whatsappKaspiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.whatsappSuccessBtn}
            >
              <WhatsAppIcon size={22} className={styles.whatsappIcon} />
              <span>Написать в WhatsApp для ускорения счета</span>
            </a>
          </div>
        ) : (
          <p>Ваш заказ №{lastOrderId} принят в обработку. Мы свяжемся с вами в ближайшее время.</p>
        )}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '24px' }}>
          <Link href="/profile" className={styles.homeBtn} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Package size={18} />
            Перейти в мои заказы
          </Link>
          <Link href="/" className={styles.homeBtn} style={{ backgroundColor: '#f0f2f5', color: 'var(--color-navy)' }}>
            На главную
          </Link>
        </div>
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
          {killSwitchActive && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '20px',
              color: '#92400e',
              fontSize: '14px',
              lineHeight: 1.5,
            }}>
              <AlertTriangle size={24} style={{ color: '#d97706', flexShrink: 0 }} />
              <div>
                <strong style={{ display: 'block', fontSize: '15px', color: '#78350f', marginBottom: '2px' }}>
                  Приём новых заказов временно приостановлен
                </strong>
                Оформление покупок отключено администрацией магазина. Пожалуйста, возвращайтесь позже.
              </div>
            </div>
          )}

          <div className={styles.section}>
            <h2>1. Контактные данные</h2>
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label className={errors.lastName ? styles.labelError : ''}>Фамилия *</label>
                <input 
                  required 
                  type="text" 
                  name="lastName" 
                  value={formData.lastName} 
                  placeholder="Введите вашу Фамилию"
                  onChange={handleChange} 
                  className={errors.lastName ? styles.inputError : ''}
                />
                {errors.lastName && <span className={styles.errorText}>{errors.lastName}</span>}
              </div>
              <div className={styles.inputGroup}>
                <label className={errors.firstName ? styles.labelError : ''}>Имя *</label>
                <input 
                  required 
                  type="text" 
                  name="firstName" 
                  value={formData.firstName} 
                  placeholder="Введите ваше Имя"
                  onChange={handleChange} 
                  className={errors.firstName ? styles.inputError : ''}
                />
                {errors.firstName && <span className={styles.errorText}>{errors.firstName}</span>}
              </div>
              <div className={styles.inputGroup}>
                <label className={errors.phone ? styles.labelError : ''}>Телефон *</label>
                <div className={`${styles.phoneInputContainer} ${errors.phone ? styles.inputError : ''}`}>
                  <span className={`${styles.phonePrefix} ${(isPhoneFocused || Boolean(formData.phone)) ? styles.phonePrefixActive : ''}`}>
                    +7
                  </span>
                  <input 
                    required 
                    type="tel" 
                    name="phone" 
                    value={formData.phone} 
                    onFocus={() => setIsPhoneFocused(true)}
                    onBlur={() => setIsPhoneFocused(false)}
                    onChange={handlePhoneChange} 
                    placeholder="(707) 000-00-00"
                    className={styles.phoneInput}
                  />
                </div>
                {errors.phone && <span className={styles.errorText}>{errors.phone}</span>}
              </div>
              <div className={styles.inputGroup}>
                <label>E-mail</label>
                <input 
                  type="email" 
                  name="email" 
                  value={formData.email} 
                  onChange={handleChange} 
                  placeholder="name@example.com"
                />
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
                <input 
                  required 
                  type="text" 
                  name="street" 
                  value={formData.street} 
                  onChange={handleChange} 
                  placeholder="Например: ул. Абая или мкр. Самал-2"
                />
              </div>
              <div className={styles.inputGroup}>
                <label>Дом / Здание *</label>
                <input 
                  required 
                  type="text" 
                  name="house" 
                  value={formData.house} 
                  onChange={handleChange} 
                  placeholder="Например: 15/2"
                />
              </div>
              <div className={styles.inputGroup}>
                <label>Квартира / Офис *</label>
                <input 
                  required 
                  type="text" 
                  name="apartment" 
                  value={formData.apartment} 
                  onChange={handleChange} 
                  placeholder="Например: 42"
                />
              </div>
            </div>
            
            <h3 className={styles.subHeading} style={{ marginTop: '24px', marginBottom: '16px', fontSize: '18px', fontWeight: '500', color: 'var(--color-navy)' }}>Дополнительные данные</h3>
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label>Подъезд / Код / Этаж</label>
                <input 
                  type="text" 
                  name="entrance" 
                  value={formData.entrance} 
                  onChange={handleChange} 
                  placeholder="Например: 2 подъезд, 4 этаж"
                />
              </div>
              <div className={styles.inputGroup}>
                <label>Почтовый индекс</label>
                <input 
                  type="text" 
                  name="postalCode" 
                  value={formData.postalCode} 
                  onChange={handleChange} 
                  placeholder="Например: 050000"
                />
              </div>
            </div>
            <div className={styles.inputGroup} style={{ marginTop: '16px' }}>
              <label>Комментарий для курьера</label>
              <textarea 
                name="comment" 
                value={formData.comment} 
                onChange={handleChange} 
                rows={2} 
                placeholder="Например: позвонить за 30 минут, оставить у консьержа..."
              />
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

            {formData.deliveryMethod === 'pickup' && (
              <div className={styles.pickupNotice}>
                <AlertTriangle size={18} />
                <span>
                  Товары хранятся на складе 14 дней. По истечению срока заказ будет отменен, а деньги будут возвращены на карту в течении 1-5 дней.
                </span>
              </div>
            )}
          </div>

          <div className={styles.section}>
            <h2>4. Способ оплаты</h2>
            <div className={styles.radioGroup}>
              <label className={`${styles.radioCard} ${formData.paymentMethod === 'online' ? styles.activeRadioCard : ''}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="online"
                  checked={formData.paymentMethod === 'online'}
                  onChange={handleChange}
                />
                <div className={styles.radioContent}>
                  <span className={styles.radioTitle}>Halyk QR, или картой онлайн</span>
                  <span className={styles.radioDesc}>
                    Оплата сразу при заказе через защищенный платёжный шлюз ePay
                  </span>
                </div>
              </label>

              <label className={`${styles.radioCard} ${formData.paymentMethod === 'kaspi_pay' ? styles.activeRadioCard : ''}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="kaspi_pay"
                  checked={formData.paymentMethod === 'kaspi_pay'}
                  onChange={handleChange}
                />
                <div className={styles.radioContent}>
                  <span className={styles.radioTitle}>Kaspi Pay</span>
                  <span className={styles.radioDesc}>
                    Дистанционная оплата по номеру телефона
                  </span>
                </div>
              </label>
            </div>
            
            {formData.paymentMethod === 'online' && (
              <div className={styles.securityText}>
                <Shield size={16} color="var(--color-navy)" style={{ minWidth: '16px' }} />
                <span>Оплата производится через защищенный платежный шлюз Halyk ePay с поддержкой технологии 3D Secure</span>
              </div>
            )}
            
            {formData.paymentMethod === 'kaspi_pay' && (
              <div className={styles.kaspiInfoBox}>
                <Smartphone size={16} color="var(--color-navy)" style={{ minWidth: '16px', marginTop: '2px' }} />
                <span>
                  Менеджер Koma Auto выставит счёт на ваш Kaspi счёт. Убедитесь, что номер{' '}
                  <strong>{displayKaspiPhone}</strong> принадлежит вашему Kaspi счёту, либо вы можете его{' '}
                  <button
                    type="button"
                    onClick={handleOpenKaspiModal}
                    className={styles.changeKaspiPhoneBtn}
                  >
                    Изменить
                  </button>
                  .
                </span>
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
              {isTestMode && (
                <div className={styles.discountRow}>
                  <span>Скидка (Тест-режим)</span>
                  <span>-{(totalPrice - testPrice).toLocaleString()} ₸</span>
                </div>
              )}
              {formData.deliveryMethod === 'courier' ? (
                <div className={styles.calcRow}>
                  <span>Доставка</span>
                  <span>{isTestMode ? '0 ₸ (Тест)' : (normalizedCity === '' ? '-' : (deliveryCost === 0 ? 'Бесплатно' : `${deliveryCost.toLocaleString()} ₸`))}</span>
                </div>
              ) : (
                <div className={styles.calcRow}>
                  <span>Самовывоз</span>
                  <span>0 ₸</span>
                </div>
              )}
            </div>

            {promoDiscount > 0 && !appliedPromo?.isTestMode && (
              <div className={styles.calcRow} style={{ color: '#16a34a', fontWeight: 600 }}>
                <span>Скидка по промокоду ({appliedPromo?.code})</span>
                <span>-{promoDiscount.toLocaleString('ru-RU')} ₸</span>
              </div>
            )}

            {!isTestMode ? (
              <>
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
                    {isApplyingPromo ? '...' : 'Применить'}
                  </button>
                </div>

                {appliedPromo && (
                  <div className={styles.activePromoTag}>
                    <div className={styles.activePromoInfo}>
                      <span>{appliedPromo.code}:</span>
                      <span className={styles.activePromoDiscount}>
                        Скидка -{promoDiscount.toLocaleString('ru-RU')} ₸
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.activePromoRemoveBtn}
                      onClick={handleRemovePromo}
                      title="Отменить промокод"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.testModeBanner}>
                <div className={styles.testModeBannerHeader}>
                  <AlertTriangle size={18} />
                  <span>{appliedPromo?.title || `РЕЖИМ ТЕСТИРОВАНИЯ (${testPrice} ₸)`}</span>
                </div>
                <p className={styles.testModeBannerText}>
                  Активирован режим технического тестирования платформы. Сумма заказа снижена до {testPrice} ₸ для верификации шлюза Halyk ePay.
                </p>
                <div className={styles.testModeBannerLegal}>
                  <strong>Юридическое примечание:</strong> Настоящий заказ носит исключительно проверочный характер и <u>не порождает обязательств Продавца</u> по передаче, комплектации или доставке товаров согласно ст. 447, 449 Гражданского кодекса Республики Казахстан. Ввод данного служебного кода подтверждает согласие с данными условиями.
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

            <div className={styles.totalRow}>
              <span>Итого к оплате</span>
              <div className={styles.totalValue}>
                {promoDiscount > 0 ? (
                  <>
                    <span className={styles.oldPriceCrossed}>
                      {(formData.deliveryMethod === 'courier' ? totalPrice + deliveryCost : totalPrice).toLocaleString('ru-RU')} ₸
                    </span>
                    <span className={styles.finalPayAmount}>
                      {finalPrice.toLocaleString('ru-RU')} ₸
                    </span>
                  </>
                ) : (
                  <span className={styles.finalPayAmount}>
                    {finalPrice.toLocaleString('ru-RU')} ₸
                  </span>
                )}
              </div>
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

            <button 
              type="submit" 
              className={styles.submitBtn} 
              disabled={isSubmitting || killSwitchActive}
              style={killSwitchActive ? { opacity: 0.6, cursor: 'not-allowed', filter: 'grayscale(0.6)' } : {}}
            >
              {killSwitchActive
                ? 'Приём заказов приостановлен'
                : isSubmitting 
                ? 'Оформление заказа...' 
                : formData.paymentMethod === 'kaspi_pay'
                ? `Оформить заказ (${finalPrice.toLocaleString()} ₸)`
                : 'Перейти к оплате'}
            </button>
          </div>
        </div>
      </form>
      <Script src="https://epay.homebank.kz/payform/payment-api.js" strategy="afterInteractive" />
    
      {isKaspiModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsKaspiModalOpen(false)}>
          <div className={styles.kaspiModalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.kaspiModalHeader}>
              <h3 className={styles.kaspiModalTitle}>Номер телефона привязанного к вашему Kaspi Gold</h3>
              <button
                type="button"
                className={styles.kaspiModalCloseBtn}
                onClick={() => setIsKaspiModalOpen(false)}
                aria-label="Закрыть"
              >
                <X size={20} />
              </button>
            </div>
            <p className={styles.kaspiModalSub}>
              Укажите номер телефона, на который менеджер выставит счет в приложении Kaspi Pay.
            </p>
            <div className={styles.phoneInputContainer}>
              <span className={`${styles.phonePrefix} ${(isKaspiModalFocused || Boolean(kaspiModalPhone)) ? styles.phonePrefixActive : ''}`}>
                +7
              </span>
              <input
                type="tel"
                value={kaspiModalPhone}
                onFocus={() => setIsKaspiModalFocused(true)}
                onBlur={() => setIsKaspiModalFocused(false)}
                onChange={(e) => setKaspiModalPhone(formatKazakhPhone(e.target.value))}
                placeholder="(707) 000-00-00"
                className={styles.phoneInput}
                autoFocus
              />
            </div>
            <div className={styles.kaspiModalActions}>
              <button
                type="button"
                onClick={handleSaveKaspiPhone}
                className={styles.kaspiModalSubmitBtn}
              >
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}