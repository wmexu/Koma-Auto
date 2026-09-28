import { Metadata } from 'next';
import FavoritesClient from './FavoritesClient';

export const metadata: Metadata = {
  title: 'Избранное - koma.com.kz',
};

export default function FavoritesPage() {
  return <FavoritesClient />;
}
