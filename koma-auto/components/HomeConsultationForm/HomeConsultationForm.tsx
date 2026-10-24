'use client';

import { useState } from 'react';
import { User, Phone, CarFront, MessageSquareText, Loader2, CheckCircle } from 'lucide-react';
import styles from '../../app/page.module.css';
import { useToastStore } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';

export default function HomeConsultationForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vin, setVin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState<{name?: string, phone?: string, vin?: string}>({});
  
  const { addToast } = useToastStore();
  const { user, userProfile } = useAuthStore();

  const validateName = (nameStr: string) => {
    const trimmed = nameStr.trim();
    if (trimmed.length < 2) {
      return 'Имя должно содержать не менее 2 символов';
    }
    return '';
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let digits = e.target.value.replace(/\D/g, '');
    if ((digits.startsWith('7') || digits.startsWith('8')) && digits.length > 10) {
      digits = digits.slice(1);
    }
    digits = digits.slice(0, 10);

    let formatted = '';
    if (digits.length === 0) {
      formatted = '';
    } else if (digits.length <= 3) {
      formatted = `(${digits}`;
    } else if (digits.length <= 6) {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else if (digits.length <= 8) {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
    }

    setPhone(formatted);
    if (errors.phone) setErrors(prev => ({ ...prev, phone: undefined }));
  };

  const handleVinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.toUpperCase();
    if (/[А-Яа-яЁё]/.test(rawVal)) {
      setErrors(prev => ({ ...prev, vin: 'Используйте латинские буквы' }));
    } else if (errors.vin === 'Используйте латинские буквы') {
      setErrors(prev => ({ ...prev, vin: undefined }));
    }

    let val = rawVal.replace(/[^A-Z0-9]/g, '');
    if (val.length > 17) val = val.slice(0, 17);
    setVin(val);
    if (errors.vin && errors.vin !== 'Используйте латинские буквы') {
      setErrors(prev => ({ ...prev, vin: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: {name?: string, phone?: string, vin?: string} = {};
    let hasEmptyFields = false;

    const trimmedName = name.trim();
    const cleanDigits = phone.replace(/\D/g, '');

    if (!trimmedName) { newErrors.name = 'Заполните это поле'; hasEmptyFields = true; }
    if (!cleanDigits) { newErrors.phone = 'Заполните это поле'; hasEmptyFields = true; }
    if (!vin.trim()) { newErrors.vin = 'Заполните это поле'; hasEmptyFields = true; }

    if (trimmedName) {
      const nameError = validateName(trimmedName);
      if (nameError) newErrors.name = nameError;
    }

    if (cleanDigits && cleanDigits.length < 10) {
      newErrors.phone = 'Введите полный номер телефона';
    }

    if (vin && (vin.length < 11 || vin.length > 17)) {
      newErrors.vin = 'VIN код должен содержать от 11 до 17 символов';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      if (hasEmptyFields) {
        addToast('Пожалуйста, заполните все обязательные поля', 'error');
      } else {
        addToast('Пожалуйста, исправьте ошибки в форме', 'error');
      }
      return;
    }

    setIsLoading(true);

    try {
      let clientInfo = 'Клиент: Гость';
      if (user) {
        const typeStr = userProfile?.clientType === 'wholesale' ? 'Оптовый клиент' : 'Розничный клиент';
        const dobStr = userProfile?.dob || 'Не указана';
        const createdAtStr = userProfile?.createdAt ? new Date(userProfile.createdAt).toLocaleDateString('ru-RU') : 'Не указана';
        
        clientInfo = `Клиент: ${typeStr}\nИмя и Фамилия: ${userProfile?.name || trimmedName}\nДата рождения: ${dobStr}\nДата регистрации: ${createdAtStr}\nEmail адрес: ${user.email}`;
      }

      const fullPhone = cleanDigits.length === 10
        ? `+7${cleanDigits}`
        : (phone.startsWith('+') ? phone : `+7${cleanDigits}`);

      const response = await fetch('/api/consultation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedName, phone: fullPhone, vin: vin.trim(), clientInfo }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit consultation request');
      }

      setIsSuccess(true);
      setName('');
      setPhone('');
      setVin('');
      addToast('Заявка успешно отправлена! Мы скоро свяжемся с вами.', 'success');
      
      // Reset success state after a while
      setTimeout(() => {
        setIsSuccess(false);
      }, 5000);
    } catch (error) {
      console.error('Consultation form error:', error);
      addToast('Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const getErrorStyle = (error?: string) => {
    return error ? { borderColor: '#e53e3e', backgroundColor: '#fef2f2' } : {};
  };

  const getIconColor = (error?: string) => {
    return error ? '#e53e3e' : undefined;
  };

  return (
    <div className={styles.infoCard}>
      <h3 className={styles.infoTitle} style={{ marginBottom: '20px' }}>Онлайн консультация для подбора автозапчастей:</h3>
      
      {isSuccess ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--color-navy)', padding: '40px 0' }}>
          <CheckCircle size={48} color="#10B981" />
          <h3 style={{ fontSize: '20px', fontWeight: 600 }}>Заявка принята!</h3>
          <p>Ожидайте звонка от нашего специалиста.</p>
        </div>
      ) : (
        <form className={styles.formGroup} onSubmit={handleSubmit} noValidate>
          <div>
            <div className={styles.inputWrapper} style={getErrorStyle(errors.name)}>
              <User size={32} className={styles.inputIcon} color={getIconColor(errors.name)} />
              <input 
                type="text" 
                placeholder="Введите ваше Имя" 
                className={styles.infoInput} 
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
                }}
                required
                style={errors.name ? { backgroundColor: 'transparent', color: '#e53e3e' } : {}}
              />
            </div>
            {errors.name && <span style={{ color: '#e53e3e', fontSize: '14px', marginTop: '4px', display: 'block' }}>{errors.name}</span>}
          </div>

          <div>
            <div className={styles.inputWrapper} style={getErrorStyle(errors.phone)}>
              <Phone size={32} className={styles.inputIcon} color={getIconColor(errors.phone)} />
              <span className={styles.consultationPhonePrefix}>+7</span>
              <input 
                type="tel" 
                placeholder="(707) 000-00-00" 
                className={`${styles.infoInput} ${styles.phoneInfoInput}`} 
                value={phone}
                onChange={handlePhoneChange}
                required
                style={errors.phone ? { backgroundColor: 'transparent', color: '#e53e3e' } : {}}
              />
            </div>
            {errors.phone && <span style={{ color: '#e53e3e', fontSize: '14px', marginTop: '4px', display: 'block' }}>{errors.phone}</span>}
          </div>

          <div>
            <div className={styles.inputWrapper} style={getErrorStyle(errors.vin)}>
              <CarFront size={32} className={styles.inputIcon} color={getIconColor(errors.vin)} />
              <input 
                type="text" 
                placeholder="Введите VIN-код" 
                className={styles.infoInput} 
                value={vin}
                onChange={handleVinChange}
                required
                style={errors.vin ? { backgroundColor: 'transparent', color: '#e53e3e' } : {}}
              />
            </div>
            {errors.vin && <span style={{ color: '#e53e3e', fontSize: '14px', marginTop: '4px', display: 'block' }}>{errors.vin}</span>}
          </div>

          <button 
            type="submit" 
            className={styles.fullWidthSubmitBtn}
            disabled={isLoading}
          >
            <span className={styles.fullWidthBtnText}>
              {isLoading ? 'Отправка...' : 'Отправить'}
            </span>
            {isLoading ? (
              <Loader2 size={20} className={`${styles.submitBtnIcon} animate-spin`} />
            ) : (
              <MessageSquareText size={20} className={styles.submitBtnIcon} />
            )}
          </button>
        </form>
      )}
    </div>
  );
}
