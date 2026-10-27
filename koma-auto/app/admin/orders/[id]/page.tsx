import { Metadata } from 'next';
import OrderDetailsClient from './OrderDetailsClient';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Заказ №${id} — Панель управления Koma Auto`,
    robots: { index: false, follow: false },
  };
}

export default async function AdminOrderPage({ params }: Props) {
  const { id } = await params;
  return <OrderDetailsClient orderId={id} />;
}
