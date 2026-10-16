'use client';

import { useState, useRef } from 'react';
import { useToastStore, ToastMessage } from '../../store/useToastStore';
import styles from './ToastProvider.module.css';
import { X, CheckCircle, Info, AlertCircle, AlertTriangle, ArrowRight } from 'lucide-react';

interface ToastItemProps {
  toast: ToastMessage;
  onRemove: (id: string, isDismiss: boolean) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDismissing, setIsDismissing] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX;
    // Allow dragging right or left
    setDragOffset(diff);
  };

  const handleTouchEnd = () => {
    if (Math.abs(dragOffset) > 75) {
      setIsDismissing(true);
      setTimeout(() => {
        onRemove(toast.id, true);
      }, 200);
    } else {
      setDragOffset(0);
    }
    setTouchStartX(null);
  };

  return (
    <div
      className={`${styles.toast} ${styles[toast.type]} ${isDismissing ? styles.dismissing : ''}`}
      style={{
        transform: dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined,
        opacity: dragOffset !== 0 ? Math.max(0.2, 1 - Math.abs(dragOffset) / 250) : undefined,
        transition: touchStartX === null ? 'transform 0.25s ease, opacity 0.25s ease' : 'none',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className={styles.icon}>
        {toast.type === 'success' && <CheckCircle size={20} />}
        {toast.type === 'info' && <Info size={20} />}
        {toast.type === 'error' && <AlertCircle size={20} />}
        {toast.type === 'warning' && <AlertTriangle size={20} />}
      </div>
      <div className={styles.contentCol}>
        <div className={styles.message}>{toast.message}</div>
        {toast.action && (
          <button
            className={styles.actionBtn}
            onClick={(e) => {
              e.stopPropagation();
              toast.action?.onClick();
              onRemove(toast.id, false);
            }}
          >
            <span>{toast.action.label}</span>
            <ArrowRight size={14} />
          </button>
        )}
      </div>
      <button
        className={styles.closeBtn}
        onClick={() => onRemove(toast.id, true)}
        aria-label="Закрыть уведомление"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export default function ToastProvider() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className={styles.toastContainer}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
