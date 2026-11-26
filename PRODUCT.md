# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Shoppers:** salons, spas, beauty professionals and individuals across Ghana buying beauty tools and supplies, mostly on a phone.
- **Shop team:** the owner and staff of Deliz Beauty Tools, who run the admin and the in-shop POS on both phone and laptop.

## Product Purpose

Deliz Beauty Tools sells lash products, hair and wig tools, manicure and pedicure supplies, nail accessories, spa equipment and skincare, retail and wholesale. The site is the online store, and its admin is how the shop runs day to day: products, stock, orders, in-shop sales, delivery, customers and promotions. Success is a shopper finding the right tool and paying without friction, and the team keeping prices, stock and orders correct without a developer.

## Positioning

A physical shop at Madina, Ritz Junction, Accra that also delivers nationwide, serving both walk-in and online customers from one stock list.

## Operating Context

- Prices are in Ghana cedis (GH₵).
- Online payment goes through Hubtel and Moolre (Mobile Money and card); the POS takes cash, card and Mobile Money in the shop.
- Customers and staff get SMS updates through Taysend.
- Products can have colour and size options, each with its own price and stock.
- Wholesale price and minimum order quantity can be set per product.

## Capabilities and Constraints

- Next.js app hosted on Vercel, with a hosted Supabase database. Schema changes cannot be run from the app, so new features should prefer existing columns.
- Storefront prices are served by the `/api/storefront/*` routes; the order total is decided on the server at checkout and again at payment.
- Admin access is by role: `admin` sees everything, `staff` sees the screens their role allows.
- Sale and discount rules live in `site_settings.store_pricing` and in product `metadata`; the price column always holds the regular price.

## Brand Commitments

- Name: Deliz Beauty Tools. Tagline: "Beauty meets convenience."
- The storefront and admin use a restrained black, white and grey look with serif product names.

## Evidence on Hand

- Real product catalogue, photos and categories in the database.
- No testimonials, press or benchmarks are recorded here; do not invent any.

## Product Principles

1. The price a shopper sees is the price they pay.
2. The shop team can undo anything they switch on, and prices come back exactly.
3. Phone first for shoppers, phone and laptop for the team.
4. Plain shop language, not software terms.
