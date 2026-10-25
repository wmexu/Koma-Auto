import { Metadata } from 'next';
import AdminClient from './AdminClient';

export const metadata: Metadata = {
  title: 'Управляющая панель CRM | Koma Auto',
  description: 'Панель управления заказами, курьерами и промокодами Koma Auto',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPage() {
  return <AdminClient />;
}
