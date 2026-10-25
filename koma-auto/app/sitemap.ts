import type { MetadataRoute } from 'next';
import { client, isDbConfigured } from '@/db';

export const revalidate = 3600; // Cache sitemap for 1 hour

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://koma.com.kz';

  // 1. Static high-priority pages
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/catalog`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/delivery`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/privacy-policy`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms-of-service`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  // 2. Dynamic product catalog from Neon PostgreSQL
  let productRoutes: MetadataRoute.Sitemap = [];
  if (isDbConfigured() && client) {
    try {
      // Query minimal fields (id, updated_at, in_stock) to maximize throughput (<50ms)
      const rows = await client`
        SELECT id, updated_at, in_stock
        FROM my_sklad_products
        WHERE price >= 500
        ORDER BY in_stock DESC, updated_at DESC;
      `;

      productRoutes = rows.map((r: any) => ({
        url: `${baseUrl}/product/${r.id}`,
        lastModified: r.updated_at ? new Date(r.updated_at) : new Date(),
        changeFrequency: 'weekly' as const,
        priority: r.in_stock ? 0.8 : 0.5,
      }));
    } catch (error) {
      console.error('[Sitemap] Warning: Failed to query products from DB:', error);
    }
  }

  return [...staticRoutes, ...productRoutes];
}
