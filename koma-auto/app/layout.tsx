import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import ToastProvider from "../components/ui/ToastProvider";
import Header from "../components/Header/Header";
import Footer from "../components/Footer/Footer";
import SyncProvider from "../components/SyncProvider/SyncProvider";
import { Analytics } from "@vercel/analytics/next";

const geistSans = localFont({
  src: "../Geist/Geist-VariableFont_wght.ttf",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://koma.com.kz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Koma Auto — Автозапчасти в Алматы и по Казахстану | ТЦ Car City",
    template: "%s | Koma Auto",
  },
  description:
    "Интернет-магазин автозапчастей Koma Auto. Более 17 000 оригинальных деталей и дубликатов в наличии на складе Car City (Алматы). Быстрая доставка по РК, самовывоз, оплата картой и Kaspi.",
  keywords: [
    "Koma Auto",
    "Кома Авто",
    "автозапчасти Алматы",
    "автозапчасти Казахстан",
    "запчасти Car City",
    "Car City подвал",
    "купить автозапчасти",
    "запчасти по OEM",
    "koma.com.kz",
  ],
  authors: [{ name: "Koma Auto" }],
  creator: "Koma Auto",
  publisher: "Koma Auto",
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: "Koma Auto — Автозапчасти в Алматы и по Казахстану | ТЦ Car City",
    description:
      "Более 17 000 автозапчастей в наличии на складе Car City в Алматы. Доставка по Казахстану, самовывоз, гарантия.",
    url: SITE_URL,
    siteName: "Koma Auto",
    locale: "ru_KZ",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "AutoPartsStore",
  "name": "Koma Auto",
  "alternateName": ["Кома Авто", "Koma", "koma.com.kz"],
  "url": "https://koma.com.kz",
  "logo": "https://koma.com.kz/icon.png",
  "description": "Интернет-магазин автозапчастей Koma Auto в Алматы. Складское наличие в ТЦ Car City, доставка по всему Казахстану.",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "ТЦ Car City, 1 ярус, Подвал",
    "addressLocality": "Алматы",
    "addressCountry": "KZ"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": "43.238949",
    "longitude": "76.851248"
  },
  "openingHoursSpecification": {
    "@type": "OpeningHoursSpecification",
    "dayOfWeek": [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday"
    ],
    "opens": "09:00",
    "closes": "18:00"
  },
  "telephone": "+77079194462",
  "priceRange": "₸₸"
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={geistSans.variable}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
      </head>
      <body className={geistSans.className}>
        <Header />
        <main className="main-content">
          {children}
        </main>
        <Footer />
        <ToastProvider />
        <SyncProvider />
        <Analytics />
      </body>
    </html>
  );
}
