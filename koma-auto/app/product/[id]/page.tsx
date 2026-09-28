import { Metadata } from 'next';
import ProductDetails from './ProductDetails';
import { getProduct, mapMoySkladToProduct } from '../../../lib/moysklad';
import { products as fallbackProducts } from '../../../data/products';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  
  try {
    const productRes = await getProduct(id);
    
    const product = mapMoySkladToProduct(productRes);

    return {
      title: `${product.name} - ${product.brand} | koma.com.kz`,
      description: `Купить ${product.name} (код: ${product.article}) по выгодной цене.`,
    };
  } catch (error) {
    const product = fallbackProducts.find((p) => p.id === id || p.moySkladId === id);
    if (product) {
      return {
        title: `${product.name} - ${product.brand} | koma.com.kz`,
        description: `Купить ${product.name} (код: ${product.article}) по выгодной цене.`,
      };
    }
    return { title: 'Товар не найден' };
  }
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  return <ProductDetails id={id} />;
}
