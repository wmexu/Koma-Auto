import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import ToastProvider from "../components/ui/ToastProvider";
import Header from "../components/Header/Header";
import Footer from "../components/Footer/Footer";
import SyncProvider from "../components/SyncProvider/SyncProvider";

const geistSans = localFont({
  src: "../Geist/Geist-VariableFont_wght.ttf",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "koma.com.kz - Автозапчасти",
  description: "Интернет-магазин автозапчастей",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={geistSans.variable}>
      <body className={geistSans.className}>
        <Header />
        <main className="main-content">
          {children}
        </main>
        <Footer />
        <ToastProvider />
        <SyncProvider />
      </body>
    </html>
  );
}
