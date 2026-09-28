import { Metadata } from 'next';
import CartClient from './CartClient';

export const metadata: Metadata = {
  title: 'Корзина - koma.com.kz',
};

export default function CartPage() {
  return <CartClient />;
}
