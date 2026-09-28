import type { Metadata } from "next";
import Script from "next/script";
import { Pacifico, Playfair_Display, Inter } from "next/font/google";
import { CartProvider } from "@/context/CartContext";
import { WishlistProvider } from "@/context/WishlistContext";
import "./globals.css";

const pacifico = Pacifico({ weight: "400", subsets: ["latin"], variable: "--font-pacifico" });
const playfair = Playfair_Display({
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-playfair",
});
const inter = Inter({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-inter",
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://delizbeautytools.com';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Deliz Beauty Tools | Premium Beauty Essentials in Ghana",
    template: "%s | Deliz Beauty Tools"
  },
  description: "Ghana's trusted destination for premium beauty essentials. Lash products, hair & wig tools, pedicure & manicure supplies, nail accessories, spa equipment & skincare. Madina, Accra. Nationwide delivery.",
  keywords: [
    "Deliz Beauty Tools",
    "beauty supplies Ghana",
    "lash products",
    "hair and wig tools",
    "manicure pedicure",
    "nail accessories",
    "spa equipment",
    "skincare Ghana",
    "beauty salon supplies",
    "Madina Accra"
  ],
  authors: [{ name: "Deliz Beauty Tools" }],
  creator: "Deliz Beauty Tools",
  publisher: "Deliz Beauty Tools",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Deliz Beauty Tools',
  },
  formatDetection: {
    telephone: true,
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || '',
  },
  openGraph: {
    type: "website",
    locale: "en",
    url: siteUrl,
    title: "Deliz Beauty Tools | Premium Beauty Essentials in Ghana",
    description: "Ghana's trusted destination for premium beauty essentials. Lash, hair, nail, spa & skincare. Madina, Accra. Nationwide delivery.",
    siteName: "Deliz Beauty Tools",
  },
  twitter: {
    card: "summary_large_image",
    title: "Deliz Beauty Tools | Premium Beauty Essentials in Ghana",
    description: "Ghana's trusted destination for premium beauty essentials. Nationwide delivery.",
    creator: "@delizbeautytools",
  },
  alternates: {
    canonical: siteUrl,
  },
};

// Google Analytics Measurement ID
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
// Google reCAPTCHA v3 Site Key
const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* PWA Meta Tags */}
        <meta name="theme-color" content="#171717" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Deliz Beauty Tools" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-TileColor" content="#171717" />
        <meta name="msapplication-tap-highlight" content="no" />

        {/* Apple Touch Icons */}
        <link rel="apple-touch-icon" href="/icons/icon-152x152.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="384x384" href="/icons/icon-384x384.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icons/icon-512x512.png" />

        {/* Apple Splash Screens */}
        <link rel="apple-touch-startup-image" href="/icons/icon-512x512.png" />

        <link
          href="https://cdn.jsdelivr.net/npm/remixicon@4.1.0/fonts/remixicon.css"
          rel="stylesheet"
        />

        {/* Structured Data - Organization */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Deliz Beauty Tools",
              "url": "https://delizbeautytools.com",
              "logo": "https://delizbeautytools.com/logo1.png",
              "description": "Ghana's trusted destination for premium beauty essentials. Lash products, hair & wig tools, manicure & pedicure supplies, nail accessories, spa equipment and skincare.",
              "address": {
                "@type": "PostalAddress",
                "addressCountry": "GH",
                "addressLocality": "Madina, Ritz Junction, Accra"
              },
              "contactPoint": {
                "@type": "ContactPoint",
                "contactType": "customer service",
                "telephone": "+233278549831",
                "availableLanguage": "English"
              }
            })
          }}
        />
      </head>

      {/* Google Analytics */}
      {GA_MEASUREMENT_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_MEASUREMENT_ID}', {
                page_path: window.location.pathname,
              });
            `}
          </Script>
        </>
      )}

      {/* Google reCAPTCHA v3 */}
      {RECAPTCHA_SITE_KEY && (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`}
          strategy="afterInteractive"
        />
      )}

      <body className={`antialiased overflow-x-hidden pwa-body ${pacifico.variable} ${playfair.variable} ${inter.variable} font-sans`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[10000] focus:px-6 focus:py-3 focus:bg-gray-900 focus:text-white focus:rounded-lg focus:font-semibold focus:shadow-lg"
        >
          Skip to main content
        </a>
        <CartProvider>
          <WishlistProvider>
            <div id="main-content">
              {children}
            </div>
          </WishlistProvider>
        </CartProvider>
      </body>
    </html>
  );
}
