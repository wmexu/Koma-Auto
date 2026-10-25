import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://koma.com.kz';

  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/catalog',
          '/delivery',
          '/privacy-policy',
          '/terms-of-service',
          '/product/',
        ],
        disallow: [
          '/api/',
          '/checkout',
          '/checkout/*',
          '/cart',
          '/profile',
          '/_next/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
