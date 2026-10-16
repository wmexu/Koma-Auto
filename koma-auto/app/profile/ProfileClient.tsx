'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToastStore } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  updatePassword,
  deleteUser
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { User as UserIcon, Mail, Calendar, Briefcase, Clock, LogOut, Package, Pencil, Eye, EyeOff } from 'lucide-react';
import OrdersHistory from '@/components/Orders/OrdersHistory';
import styles from './Profile.module.css';

export default function ProfileClient() {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [clientType, setClientType] = useState('retail');
  const [isLoading, setIsLoading] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isNameInitialized, setIsNameInitialized] = useState(false);
  const [completePassword, setCompletePassword] = useState('');
  const [completeConfirmPassword, setCompleteConfirmPassword] = useState('');
  const [isConsentAccepted, setIsConsentAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isReauthModalOpen, setIsReauthModalOpen] = useState(false);
  
  // Edit state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editClientType, setEditClientType] = useState('retail');

  // Validation errors state
  const [errors, setErrors] = useState<{name?: string, dob?: string, email?: string, password?: string, confirmPassword?: string}>({});

  const { user, userProfile, isLoading: isAuthLoading, setUserProfile } = useAuthStore();
  const { addToast } = useToastStore();
  const router = useRouter();

  const validateFullName = (fullName: string) => {
    const trimmed = fullName.trim();
    if (!trimmed.includes(' ') || trimmed.length < 8) {
      return 'Пожалуйста, введите Имя и Фамилию через пробел, полным значением (не менее 8 символов)';
    }
    if (trimmed.length > 50) {
      return 'Длина имени не должна превышать 50 символов';
    }
    return '';
  };

  const getMin18Date = () => {
    const today = new Date();
    today.setFullYear(today.getFullYear() - 18);
    return today.toISOString().split('T')[0];
  };

  const validateDob = (dobString: string) => {
    if (!dobString) return '';
    const dobDate = new Date(dobString);
    const min18Date = new Date();
    min18Date.setFullYear(min18Date.getFullYear() - 18);
    if (dobDate > min18Date) {
      return 'Вам должно быть не менее 18 лет.';
    }
    return '';
  };

  useEffect(() => {
    if (user && user.displayName && !isNameInitialized) {
      setName(user.displayName);
      setIsNameInitialized(true);
    }
  }, [user, isNameInitialized]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    // If user is logged in but profile is not complete, start 5 min timer
    if (user && !userProfile) {
      timeoutId = setTimeout(async () => {
        try {
          await signOut(auth);
          addToast('Время на завершение регистрации истекло. Пожалуйста, авторизуйтесь заново.', 'error');
        } catch (e) {
          console.error(e);
        }
      }, 5 * 60 * 1000); // 5 minutes
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [user, userProfile, addToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (activeTab === 'register' && !isConsentAccepted) {
      addToast('Необходимо принять условия Пользовательского соглашения и Политики конфиденциальности', 'error');
      return;
    }

    // Custom empty field validation
    const newErrors: {name?: string, dob?: string, email?: string, password?: string, confirmPassword?: string} = {};
    let hasEmptyFields = false;

    if (activeTab === 'login') {
      if (!email.trim()) { newErrors.email = 'Заполните это поле'; hasEmptyFields = true; }
      if (!password) { newErrors.password = 'Заполните это поле'; hasEmptyFields = true; }
    } else {
      if (!name.trim()) { newErrors.name = 'Заполните это поле'; hasEmptyFields = true; }
      if (!dob) { newErrors.dob = 'Заполните это поле'; hasEmptyFields = true; }
      if (!email.trim()) { newErrors.email = 'Заполните это поле'; hasEmptyFields = true; }
      if (!password) { newErrors.password = 'Заполните это поле'; hasEmptyFields = true; }
      if (!confirmPassword) { newErrors.confirmPassword = 'Заполните это поле'; hasEmptyFields = true; }

      if (password && confirmPassword && password !== confirmPassword) {
        newErrors.confirmPassword = 'Пароли не совпадают';
      }

      if (name.trim()) {
        const nameErr = validateFullName(name);
        if (nameErr) newErrors.name = nameErr;
      }
      
      if (dob) {
        const dobErr = validateDob(dob);
        if (dobErr) newErrors.dob = dobErr;
      }
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
      if (activeTab === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
        sessionStorage.setItem('koma-just-logged-in', 'true');
        addToast('Вы успешно вошли в аккаунт!', 'success');
        setEmail('');
        setPassword('');
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        if (name) {
          await updateProfile(user, { displayName: name });
        }

        const profileData = {
          name: name || '',
          email: user.email,
          dob: dob || '',
          clientType: clientType || 'retail',
          createdAt: new Date().toISOString()
        };

        // Save extra data to Firestore
        await setDoc(doc(db, 'users', user.uid), profileData);
        setUserProfile(profileData as any);

        sessionStorage.setItem('koma-just-logged-in', 'true');
        addToast('Аккаунт успешно создан!', 'success');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setName('');
        setDob('');
        setClientType('retail');
      }
    } catch (error: any) {
      console.error('Firebase Auth Error:', error);
      let errorMessage = 'Произошла ошибка при авторизации.';
      if (error.code === 'auth/email-already-in-use') errorMessage = 'Этот Email уже используется.';
      if (error.code === 'auth/invalid-credential') errorMessage = 'Неверный Email или пароль.';
      if (error.code === 'auth/weak-password') errorMessage = 'Слишком слабый пароль.';
      addToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      // Note: we do NOT save to Firestore here anymore.
      // The Header listener will fetch the doc, find it missing, and set userProfile to null,
      // which will trigger the "incomplete registration" form.

      sessionStorage.setItem('koma-just-logged-in', 'true');
      addToast('Вы успешно вошли через Google!', 'success');
    } catch (error: any) {
      console.error('Google Auth Error:', error);
      if (error.code !== 'auth/popup-closed-by-user') {
        addToast('Ошибка при входе через Google', 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Не указано';
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(date);
    } catch {
      return dateString;
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      addToast('Вы вышли из аккаунта', 'success');
    } catch (error) {
      addToast('Ошибка при выходе', 'error');
    }
  };

  const handleCancelIncompleteRegistration = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      await deleteUser(user);
      addToast('Регистрация отменена', 'success');
    } catch (error: any) {
      console.error('Error deleting user:', error);
      if (error.code === 'auth/requires-recent-login') {
        await signOut(auth);
        addToast('Регистрация прервана', 'success');
      } else {
        addToast('Ошибка при отмене регистрации', 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!isConsentAccepted) {
      addToast('Необходимо принять условия Пользовательского соглашения и Политики конфиденциальности', 'error');
      return;
    }
    
    const newErrors: {name?: string, dob?: string, password?: string, confirmPassword?: string} = {};
    let hasEmptyFields = false;

    if (!name.trim()) { newErrors.name = 'Заполните это поле'; hasEmptyFields = true; }
    if (!dob) { newErrors.dob = 'Заполните это поле'; hasEmptyFields = true; }
    if (!completePassword) { newErrors.password = 'Заполните это поле'; hasEmptyFields = true; }
    if (!completeConfirmPassword) { newErrors.confirmPassword = 'Заполните это поле'; hasEmptyFields = true; }

    if (completePassword && completeConfirmPassword && completePassword !== completeConfirmPassword) {
      newErrors.confirmPassword = 'Пароли не совпадают';
    }

    if (name.trim()) {
      const nameErr = validateFullName(name);
      if (nameErr) newErrors.name = nameErr;
    }
    
    if (dob) {
      const dobErr = validateDob(dob);
      if (dobErr) newErrors.dob = dobErr;
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
      if (completePassword) {
        await updatePassword(user, completePassword);
      }

      const profileData = {
        name: name || '',
        email: user.email,
        dob: dob || '',
        clientType: clientType || 'retail',
        createdAt: new Date().toISOString()
      };
      
      await setDoc(doc(db, 'users', user.uid), profileData);
      setUserProfile(profileData as any);
      setIsLogoutModalOpen(false);
      addToast('Регистрация успешно завершена!', 'success');
    } catch (error: any) {
      console.error('Error completing registration:', error);
      if (error.code === 'auth/requires-recent-login') {
        setIsReauthModalOpen(true);
      } else {
        addToast('Ошибка при сохранении данных', 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenEditModal = () => {
    if (!user || !userProfile) return;
    setEditName(userProfile.name || user.displayName || '');
    setEditDob(userProfile.dob || '');
    setEditClientType(userProfile.clientType || 'retail');
    setIsEditModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !userProfile) return;
    
    const newErrors: {name?: string, dob?: string} = {};
    let hasEmptyFields = false;

    if (!editName.trim()) { newErrors.name = 'Заполните это поле'; hasEmptyFields = true; }
    if (!editDob) { newErrors.dob = 'Заполните это поле'; hasEmptyFields = true; }

    if (editName.trim()) {
      const nameErr = validateFullName(editName);
      if (nameErr) newErrors.name = nameErr;
    }
    
    if (editDob) {
      const dobErr = validateDob(editDob);
      if (dobErr) newErrors.dob = dobErr;
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
      if (editName && editName !== user.displayName) {
        await updateProfile(user, { displayName: editName });
      }

      const updatedProfile = {
        ...userProfile,
        name: editName,
        dob: editDob,
        clientType: editClientType
      };
      
      await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
      setUserProfile(updatedProfile as any);
      setIsEditModalOpen(false);
      addToast('Данные успешно обновлены!', 'success');
    } catch (error) {
      console.error('Error updating profile:', error);
      addToast('Ошибка при обновлении профиля', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthLoading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.authCard} style={{ alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
          <p style={{ color: 'var(--color-navy)' }}>Проверка авторизации...</p>
        </div>
      </div>
    );
  }

  // If user is logged in, show their profile info
  if (user) {
    if (!userProfile) {
      return (
        <div className={styles.pageContainer}>
          <div className={styles.authCard}>
            <h1 className={styles.title}>Остался один шаг</h1>
            <p style={{ textAlign: 'center', marginBottom: '24px', color: 'var(--color-dark-gray)' }}>
              Пожалуйста, заполните недостающие данные для завершения регистрации.
            </p>
            <form className={styles.form} onSubmit={handleCompleteRegistration} noValidate>
              <div className={styles.inputGroup}>
                <label htmlFor="complete-name" className={`${styles.label} ${errors.name ? styles.labelError : ''}`}>Имя и Фамилия</label>
                <input
                  id="complete-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
                  }}
                  placeholder="Как к вам обращаться?"
                  className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                  maxLength={50}
                  required
                />
                {errors.name && <span className={styles.errorText}>{errors.name}</span>}
              </div>
              
              <div className={styles.inputGroup}>
                <label htmlFor="complete-dob" className={`${styles.label} ${errors.dob ? styles.labelError : ''}`}>Дата рождения</label>
                <input
                  id="complete-dob"
                  type="date"
                  value={dob}
                  onChange={(e) => {
                    setDob(e.target.value);
                    if (errors.dob) setErrors(prev => ({ ...prev, dob: undefined }));
                  }}
                  min="1900-01-01"
                  max={getMin18Date()}
                  className={`${styles.input} ${errors.dob ? styles.inputError : ''}`}
                  required
                />
                {errors.dob && <span className={styles.errorText}>{errors.dob}</span>}
              </div>
              <div className={styles.inputGroup}>
                <label htmlFor="complete-password" className={`${styles.label} ${errors.password ? styles.labelError : ''}`}>Создайте пароль</label>
                <div className={styles.passwordWrapper}>
                  <input
                    id="complete-password"
                    type={showPassword ? "text" : "password"}
                    value={completePassword}
                    onChange={(e) => {
                      setCompletePassword(e.target.value);
                      if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                    }}
                    placeholder="Введите пароль"
                    className={`${styles.input} ${styles.passwordInput} ${errors.password ? styles.inputError : ''}`}
                    required
                  />
                  <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && <span className={styles.errorText}>{errors.password}</span>}
              </div>
              
              <div className={styles.inputGroup}>
                <label htmlFor="complete-confirmPassword" className={`${styles.label} ${errors.confirmPassword ? styles.labelError : ''}`}>Подтвердите пароль</label>
                <input
                  id="complete-confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={completeConfirmPassword}
                  onChange={(e) => {
                    setCompleteConfirmPassword(e.target.value);
                    if (errors.confirmPassword) setErrors(prev => ({ ...prev, confirmPassword: undefined }));
                  }}
                  placeholder="Подтвердите пароль"
                  className={`${styles.input} ${errors.confirmPassword ? styles.inputError : ''}`}
                  required
                />
                {errors.confirmPassword && <span className={styles.errorText}>{errors.confirmPassword}</span>}
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="complete-clientType" className={styles.label}>Укажите тип клиента:</label>
                <select
                  id="complete-clientType"
                  value={clientType}
                  onChange={(e) => setClientType(e.target.value)}
                  className={styles.select}
                >
                  <option value="retail">Розничный клиент</option>
                  <option value="wholesale">Оптовый клиент</option>
                </select>
              </div>

              <div className={styles.consentGroup}>
                <input 
                  type="checkbox" 
                  id="consent-complete" 
                  className={styles.consentCheckbox}
                  checked={isConsentAccepted}
                  onChange={(e) => setIsConsentAccepted(e.target.checked)}
                />
                <label htmlFor="consent-complete" className={styles.consentText}>
                  Я принимаю условия <Link href="/terms-of-service" className={styles.consentLink} target="_blank">Пользовательского соглашения</Link> и <Link href="/privacy-policy" className={styles.consentLink} target="_blank">Политики конфиденциальности</Link>, а также даю согласие на обработку персональных данных.
                </label>
              </div>

              <button 
                type="submit" 
                className={styles.submitBtn}
                disabled={isLoading}
              >
                {isLoading ? 'Сохранение...' : 'Завершить регистрацию'}
              </button>
              
              <button 
                type="button" 
                onClick={handleCancelIncompleteRegistration}
                disabled={isLoading}
                style={{
                  width: '100%',
                  marginTop: '12px',
                  padding: '16px',
                  backgroundColor: 'transparent',
                  color: 'var(--color-navy)',
                  border: '1px solid #dcdfe6',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: 600,
                  fontSize: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--color-navy)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = '#dcdfe6'}
              >
                Выйти
              </button>
            </form>
          </div>

          {/* Reauth Modal */}
          {isReauthModalOpen && (
            <div className={styles.modalOverlay} onClick={() => setIsReauthModalOpen(false)}>
              <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <h3 className={styles.modalTitle}>Сессия устарела</h3>
                <p className={styles.modalText}>
                  В целях безопасности Firebase требует недавней авторизации для установки пароля. Пожалуйста, войдите снова (это займёт пару секунд), чтобы завершить регистрацию.
                </p>
                <div className={styles.modalActions}>
                  <button 
                    className={styles.modalConfirmBtn} 
                    onClick={async () => {
                      setIsReauthModalOpen(false);
                      await handleSignOut();
                    }}
                    style={{ width: '100%' }}
                  >
                    Понятно, перезайти
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className={styles.dashboardContainer}>
        <div className={styles.dashboardHeader}>
          <div>
            <h1 className={styles.dashboardTitle}>Личный кабинет</h1>
            <p className={styles.dashboardSubtitle}>Добро пожаловать, {userProfile.name || user.displayName || 'Пользователь'}!</p>
          </div>
          <button type="button" className={styles.logoutBtn} onClick={() => setIsLogoutModalOpen(true)}>
            <LogOut size={16} />
            Выйти
          </button>
        </div>

        <div className={styles.dashboardLayout}>
          <div className={styles.dashboardTopRow}>
            {/* Main Info Column */}
            <div className={`${styles.infoCard} ${styles.flexCard}`}>
              <div className={styles.infoCardTitle} style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <UserIcon size={20} />
                  Личные данные
                </div>
                <button className={styles.editBtn} onClick={handleOpenEditModal} title="Редактировать">
                  <Pencil size={16} />
                </button>
              </div>
              
              <div className={styles.infoList}>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Имя и Фамилия</span>
                  <span className={styles.infoValue}>{userProfile.name || user.displayName || 'Не указано'}</span>
                </div>
                
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Email адрес</span>
                  <span className={styles.infoValue} style={{ wordBreak: 'break-all' }}>
                    <Mail size={16} color="#888" />
                    {userProfile.email || user.email}
                  </span>
                </div>

                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Дата рождения</span>
                  <span className={styles.infoValue}>
                    <Calendar size={16} color="#888" />
                    {formatDate(userProfile.dob)}
                  </span>
                </div>
              </div>
            </div>

            {/* Secondary Column */}
            <div className={`${styles.infoCard} ${styles.flexCard}`}>
              <h2 className={styles.infoCardTitle}>
                <Briefcase size={20} />
                Статус аккаунта
              </h2>
              
              <div className={styles.infoList}>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Тип клиента</span>
                  <div>
                    {userProfile.clientType === 'wholesale' ? (
                      <span className={styles.badgeWholesale}>Оптовый клиент</span>
                    ) : (
                      <span className={styles.badgeRetail}>Розничный клиент</span>
                    )}
                  </div>
                </div>

                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Дата регистрации</span>
                  <span className={styles.infoValue} style={{ fontSize: '14px' }}>
                    <Clock size={16} color="#888" />
                    {formatDate(userProfile.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.infoCard}>
            <h2 className={styles.infoCardTitle}>
              <Package size={20} />
              Мои заказы
            </h2>
            <OrdersHistory userId={user.uid} />
          </div>
        </div>

        {/* Logout Confirmation Modal */}
        {isLogoutModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsLogoutModalOpen(false)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Вы уверены?</h3>
              <p className={styles.modalText}>Вы действительно хотите выйти из аккаунта?</p>
              <div className={styles.modalActions}>
                <button 
                  className={styles.modalCancelBtn} 
                  onClick={() => setIsLogoutModalOpen(false)}
                >
                  Отмена
                </button>
                <button 
                  className={styles.modalConfirmBtn} 
                  onClick={handleSignOut}
                >
                  Выйти
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Profile Modal */}
        {isEditModalOpen && (
          <div className={styles.modalOverlay} onClick={() => !isLoading && setIsEditModalOpen(false)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left' }}>
              <h3 className={styles.modalTitle} style={{ marginBottom: '20px' }}>Редактирование профиля</h3>
              <form className={styles.form} onSubmit={handleSaveProfile} noValidate>
                <div className={styles.inputGroup}>
                  <label htmlFor="edit-name" className={`${styles.label} ${errors.name ? styles.labelError : ''}`}>Имя и Фамилия</label>
                  <input
                    id="edit-name"
                    type="text"
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
                    }}
                    className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                    maxLength={50}
                    required
                  />
                  {errors.name && <span className={styles.errorText}>{errors.name}</span>}
                </div>
                
                <div className={styles.inputGroup}>
                  <label htmlFor="edit-dob" className={`${styles.label} ${errors.dob ? styles.labelError : ''}`}>Дата рождения</label>
                  <input
                    id="edit-dob"
                    type="date"
                    value={editDob}
                    onChange={(e) => {
                      setEditDob(e.target.value);
                      if (errors.dob) setErrors(prev => ({ ...prev, dob: undefined }));
                    }}
                    min="1900-01-01"
                    max={getMin18Date()}
                    className={`${styles.input} ${errors.dob ? styles.inputError : ''}`}
                    required
                  />
                  {errors.dob && <span className={styles.errorText}>{errors.dob}</span>}
                </div>

                <div className={styles.inputGroup}>
                  <label htmlFor="edit-clientType" className={styles.label}>Укажите тип клиента:</label>
                  <select
                    id="edit-clientType"
                    value={editClientType}
                    onChange={(e) => setEditClientType(e.target.value)}
                    className={styles.select}
                  >
                    <option value="retail">Розничный клиент</option>
                    <option value="wholesale">Оптовый клиент</option>
                  </select>
                </div>

                <div className={styles.modalActions} style={{ marginTop: '30px' }}>
                  <button 
                    type="button"
                    className={styles.modalCancelBtn} 
                    onClick={() => setIsEditModalOpen(false)}
                    disabled={isLoading}
                  >
                    Отмена
                  </button>
                  <button 
                    type="submit"
                    className={styles.submitBtn} 
                    style={{ flex: 1, margin: 0 }}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.authCard}>
        <h1 className={styles.title}>Личный кабинет</h1>
        
        <div className={styles.tabs}>
          <button 
            className={`${styles.tab} ${activeTab === 'login' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('login')}
          >
            Вход
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'register' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('register')}
          >
            Регистрация
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {activeTab === 'register' && (
            <>
              <div className={styles.inputGroup}>
                <label htmlFor="name" className={`${styles.label} ${errors.name ? styles.labelError : ''}`}>Имя и Фамилия</label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
                  }}
                  placeholder="Как к вам обращаться?"
                  className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                  maxLength={50}
                  required
                />
                {errors.name && <span className={styles.errorText}>{errors.name}</span>}
              </div>
              
              <div className={styles.inputGroup}>
                <label htmlFor="dob" className={`${styles.label} ${errors.dob ? styles.labelError : ''}`}>Дата рождения</label>
                <input
                  id="dob"
                  type="date"
                  value={dob}
                  onChange={(e) => {
                    setDob(e.target.value);
                    if (errors.dob) setErrors(prev => ({ ...prev, dob: undefined }));
                  }}
                  min="1900-01-01"
                  max={getMin18Date()}
                  className={`${styles.input} ${errors.dob ? styles.inputError : ''}`}
                  required
                />
                {errors.dob && <span className={styles.errorText}>{errors.dob}</span>}
              </div>
            </>
          )}

          <div className={styles.inputGroup}>
            <label htmlFor="email" className={`${styles.label} ${errors.email ? styles.labelError : ''}`}>Email или телефон</label>
            <input
              id="email"
              type="text"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors(prev => ({ ...prev, email: undefined }));
              }}
              placeholder="example@mail.ru"
              className={`${styles.input} ${errors.email ? styles.inputError : ''}`}
              required
            />
            {errors.email && <span className={styles.errorText}>{errors.email}</span>}
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="password" className={`${styles.label} ${errors.password ? styles.labelError : ''}`}>Пароль</label>
            <div className={styles.passwordWrapper}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                }}
                placeholder="Введите пароль"
                className={`${styles.input} ${styles.passwordInput} ${errors.password ? styles.inputError : ''}`}
                required
              />
              <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {errors.password && <span className={styles.errorText}>{errors.password}</span>}
          </div>

          {activeTab === 'register' && (
            <>
              <div className={styles.inputGroup}>
                <label htmlFor="confirmPassword" className={`${styles.label} ${errors.confirmPassword ? styles.labelError : ''}`}>Подтвердите пароль</label>
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errors.confirmPassword) setErrors(prev => ({ ...prev, confirmPassword: undefined }));
                  }}
                  placeholder="Подтвердите пароль"
                  className={`${styles.input} ${errors.confirmPassword ? styles.inputError : ''}`}
                  required
                />
                {errors.confirmPassword && <span className={styles.errorText}>{errors.confirmPassword}</span>}
              </div>
              
              <div className={styles.thinDivider}></div>
              
              <div className={styles.inputGroup}>
                <label htmlFor="clientType" className={styles.label}>Укажите тип клиента:</label>
                <select
                  id="clientType"
                  value={clientType}
                  onChange={(e) => setClientType(e.target.value)}
                  className={styles.select}
                >
                  <option value="retail">Розничный клиент</option>
                  <option value="wholesale">Оптовый клиент</option>
                </select>
              </div>
            </>
          )}

          {activeTab === 'login' && (
            <a href="#" className={styles.forgotPassword} onClick={(e) => e.preventDefault()}>
              Забыли пароль?
            </a>
          )}

          {activeTab === 'register' && (
            <div className={styles.consentGroup}>
              <input 
                type="checkbox" 
                id="consent-main" 
                className={styles.consentCheckbox}
                checked={isConsentAccepted}
                onChange={(e) => setIsConsentAccepted(e.target.checked)}
              />
              <label htmlFor="consent-main" className={styles.consentText}>
                Я принимаю условия <Link href="/terms-of-service" className={styles.consentLink} target="_blank">Пользовательского соглашения</Link> и <Link href="/privacy-policy" className={styles.consentLink} target="_blank">Политики конфиденциальности</Link>, а также даю согласие на обработку персональных данных.
              </label>
            </div>
          )}

          <button 
            type="submit" 
            className={styles.submitBtn}
            disabled={isLoading}
          >
            {isLoading ? 'Загрузка...' : (activeTab === 'login' ? 'Войти в аккаунт' : 'Зарегистрироваться')}
          </button>
        </form>

        <div className={styles.divider}>или</div>

        <button className={styles.socialBtn} type="button" onClick={handleGoogleSignIn} disabled={isLoading}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Войти через Google
        </button>

        <div style={{ marginTop: '28px', width: '100%', borderTop: '1px solid #eef2f6', paddingTop: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-navy)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Package size={17} />
            Заказы на этом устройстве
          </h3>
          <OrdersHistory userId={null} />
        </div>

      </div>
    </div>
  );
}
