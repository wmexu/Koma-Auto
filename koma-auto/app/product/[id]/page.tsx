import { Metadata } from 'next';
import ProductDetails from './ProductDetails';
import { getProductByIdFromDb } from '@/lib/products-db';
import { products as fallbackProducts } from '@/data/products';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { id } = await params;
    const product = await getProductByIdFromDb(id);

    if (product) {
      return {
        title: `${product.name} - ${product.brand} | koma.com.kz`,
        description: `Купить ${product.name} (OEM: ${product.oem || product.article}) по выгодной цене.`,
      };
    }
  } catch (error) {
    console.error('Error generating metadata:', error);
  }

  return { title: 'Купить автозапчасти | koma.com.kz' };
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  return <ProductDetails id={id} />;
}
