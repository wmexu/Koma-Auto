import { Metadata } from 'next';
import UserClientDetails from './UserClientDetails';

export const metadata: Metadata = {
  title: 'Профиль пользователя | CRM Koma Auto',
  description: 'Просмотр профиля клиента, истории заказов и управление доступом в CRM Koma Auto.',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <UserClientDetails userId={id} />;
}
