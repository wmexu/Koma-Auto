import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  autoClose?: boolean;
  duration?: number;
  onDismiss?: () => void;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  autoClose: boolean;
  onDismiss?: () => void;
}

interface ToastState {
  toasts: ToastMessage[];
  addToast: (message: string, type?: ToastType, options?: ToastOptions) => string;
  removeToast: (id: string, triggeredByDismiss?: boolean) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (message, type = 'info', options = {}) => {
    const id = Math.random().toString(36).substring(2, 9);
    const autoClose = options.autoClose !== false;
    const duration = options.duration || 3500;

    const newToast: ToastMessage = {
      id,
      message,
      type,
      action: options.action,
      autoClose,
      onDismiss: options.onDismiss,
    };

    set((state) => ({ toasts: [...state.toasts, newToast] }));

    if (autoClose) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }

    return id;
  },
  removeToast: (id, triggeredByDismiss = false) => {
    const toast = get().toasts.find((t) => t.id === id);
    if (toast && triggeredByDismiss && toast.onDismiss) {
      toast.onDismiss();
    }
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
