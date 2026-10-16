'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './GooeyInput.module.css';

export interface GooeyInputClassNames {
  root?: string;
  pill?: string;
  input?: string;
  trigger?: string;
}

export interface GooeyInputProps {
  placeholder?: string;
  className?: string;
  classNames?: GooeyInputClassNames;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  onSearchClick?: () => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  name?: string;
}

export function GooeyInput({
  placeholder = 'Поиск по названию или OEM...',
  className,
  classNames,
  value: valueProp,
  defaultValue = '',
  onValueChange,
  onOpenChange,
  disabled = false,
  onSearchClick,
  onFocus,
  onBlur,
  onKeyDown,
  autoFocus,
  name,
}: GooeyInputProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const isControlled = valueProp !== undefined;
  const rawValue = isControlled ? valueProp : internalValue;
  const hasValue = Boolean(rawValue && rawValue.trim().length > 0);

  const handlePillClick = () => {
    if (disabled) return;
    inputRef.current?.focus();
    onSearchClick?.();
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    onOpenChange?.(true);
    onSearchClick?.();
    onFocus?.(e);
  };

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    onOpenChange?.(false);
    onBlur?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!isControlled) {
      setInternalValue(val);
    }
    onValueChange?.(val);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isControlled) {
      setInternalValue('');
    }
    onValueChange?.('');
    inputRef.current?.focus();
  };

  return (
    <div className={cn(styles.container, className, classNames?.root)}>
      <div
        onClick={handlePillClick}
        className={cn(
          styles.pill,
          disabled && 'opacity-60 cursor-not-allowed',
          classNames?.pill
        )}
      >
        <div className={cn(styles.searchIconWrapper, classNames?.trigger)}>
          <Search size={19} />
        </div>

        <input
          ref={inputRef}
          type="text"
          name={name}
          placeholder={placeholder}
          disabled={disabled}
          value={rawValue}
          autoFocus={autoFocus}
          onChange={handleChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={onKeyDown}
          className={cn(styles.input, classNames?.input)}
        />

        <AnimatePresence>
          {hasValue && (
            <motion.button
              type="button"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              onClick={handleClear}
              className={styles.clearBtn}
              aria-label="Очистить поиск"
            >
              <X size={14} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default GooeyInput;
