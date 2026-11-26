'use client';

import { useEffect, useState } from 'react';
import PageHero from '@/components/PageHero';
import ProductCard, { getColorHex, type ColorVariant } from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/skeletons/ProductCardSkeleton';
import ContinueShoppingLink from '@/components/ContinueShoppingLink';
import { usePageTitle } from '@/hooks/usePageTitle';

type SaleProduct = {
  id: string;
  slug: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating: number;
  inStock: boolean;
  maxStock: number;
  moq: number;
  hasVariants: boolean;
  minVariantPrice?: number;
  colorVariants: ColorVariant[];
};

function toCard(p: any): SaleProduct {
  const variants: any[] = p.product_variants || [];
  const hasVariants = variants.length > 0;
  const stock = hasVariants ? variants.reduce((sum, v) => sum + (v.quantity || 0), 0) : p.quantity;
  const colorVariants: ColorVariant[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    const name = String(v.option2 || '').trim();
    const hex = name ? getColorHex(name) : null;
    if (name && hex && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      colorVariants.push({ name, hex });
    }
  }
  const images = [...(p.product_images || [])].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: p.price,
    originalPrice: p.compare_at_price || undefined,
    image: images[0]?.url || 'https://via.placeholder.com/800x800?text=No+Image',
    rating: p.rating_avg || 0,
    inStock: stock > 0,
    maxStock: stock || 50,
    moq: p.moq || 1,
    hasVariants,
    minVariantPrice: hasVariants ? Math.min(...variants.map((v) => v.price || p.price)) : undefined,
    colorVariants,
  };
}

export default function SalePage() {
  usePageTitle('Sale');
  const [products, setProducts] = useState<SaleProduct[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/storefront/sale')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((json) => {
        if (!cancelled) setProducts((json.products || []).map(toCard));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <PageHero title="Sale" subtitle="Beauty tools at lower prices, while the sale lasts" image="/hero-nail-lamp.png" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {failed ? (
          <div className="py-16 text-center">
            <p className="text-lg font-medium text-gray-900">The sale could not load.</p>
            <p className="mt-1 text-gray-600">Check your connection and open this page again.</p>
          </div>
        ) : products === null ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-lg font-medium text-gray-900">Nothing is on sale right now.</p>
            <p className="mt-1 text-gray-600">Sale prices show here as soon as they start.</p>
            <ContinueShoppingLink className="mt-5 inline-block rounded-lg bg-gray-900 px-5 py-3 text-sm font-medium text-white hover:bg-black">
              Shop all products
            </ContinueShoppingLink>
          </div>
        ) : (
          <>
            <p className="mb-6 text-sm text-gray-600">
              {products.length} product{products.length === 1 ? '' : 's'} on sale
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6">
              {products.map((p) => (
                <ProductCard key={p.id} {...p} badge="Sale" />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
