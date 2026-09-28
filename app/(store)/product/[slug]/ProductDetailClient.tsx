'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { cachedQuery } from '@/lib/query-cache';
import ProductCard from '@/components/ProductCard';
import ProductReviews from '@/components/ProductReviews';
import { StructuredData, generateProductSchema, generateBreadcrumbSchema } from '@/components/SEOHead';
import { notFound } from 'next/navigation';
import { useCart, isPurchasablePrice } from '@/context/CartContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { originalOnError, storageImageUrl } from '@/lib/storage-image';
import ContinueShoppingLink from '@/components/ContinueShoppingLink';

// Map common color names to hex values for the swatch preview
function colorNameToHex(name: string): string {
  const map: Record<string, string> = {
    red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
    orange: '#f97316', purple: '#a855f7', pink: '#ec4899', black: '#111827',
    white: '#ffffff', gray: '#6b7280', grey: '#6b7280', brown: '#92400e',
    navy: '#1e3a5f', gold: '#d4a017', silver: '#c0c0c0', beige: '#f5f5dc',
    maroon: '#800000', teal: '#14b8a6', coral: '#ff7f50', ivory: '#fffff0',
    cream: '#fffdd0', burgundy: '#800020', lavender: '#e6e6fa', cyan: '#06b6d4',
    magenta: '#d946ef', olive: '#84cc16', peach: '#ffcba4', mint: '#98f5e1',
    rose: '#f43f5e', wine: '#722f37', charcoal: '#374151', sky: '#0ea5e9',
  };
  return map[name.toLowerCase().trim()] || '#d1d5db';
}

export default function ProductDetailClient({ slug }: { slug: string }) {
  const [product, setProduct] = useState<any>(null);
  usePageTitle(product?.name || 'Product');
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedVariant, setSelectedVariant] = useState<any>(null);
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState('description');
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [relatedProducts, setRelatedProducts] = useState<any[]>([]);

  const { addToCart } = useCart();

  useEffect(() => {
    async function fetchProduct() {
      try {
        setLoading(true);
        // Fetch via storefront API (service role) so variants always load regardless of RLS
        let dataToTransform: any = null;
        const res = await fetch(`/api/storefront/products/${encodeURIComponent(slug)}`, {
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          dataToTransform = await res.json();
        }
        if (!dataToTransform) {
          // Fallback: client Supabase (e.g. if API not available)
          const { data: fallbackData, error } = await cachedQuery<{ data: any; error: any }>(
            `product:${slug}`,
            async () => {
              let query = supabase
                .from('products')
                .select(`
                  *,
                  categories(name),
                  product_variants(*),
                  product_images(url, position, alt_text, media_type)
                `);
              const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
              if (isUUID) query = query.or(`id.eq.${slug},slug.eq.${slug}`);
              else query = query.eq('slug', slug);
              return query.single() as any;
            },
            2 * 60 * 1000
          );
          if (error || !fallbackData) {
            console.error('Error fetching product:', error);
            setLoading(false);
            return;
          }
          dataToTransform = fallbackData;
        }

        // Transform product data
        // Map variant colors from option2, and extract color_hex from metadata
        const rawVariants = (dataToTransform.product_variants || []).map((v: any) => ({
          ...v,
          color: v.option2 || '',
          colorHex: v.metadata?.color_hex || ''
        }));

        // Build a color-to-hex map from variants (prefer stored hex, fallback to colorNameToHex)
        const colorHexMap: Record<string, string> = {};
        rawVariants.forEach((v: any) => {
          if (v.color) {
            if (!colorHexMap[v.color]) {
              colorHexMap[v.color] = v.colorHex || colorNameToHex(v.color);
            }
          }
        });

        const transformedProduct = {
          ...dataToTransform,
          media: dataToTransform.product_images?.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((img: any) => ({
            url: img.url,
            type: img.media_type || (/\.(mp4|mov|webm)$/i.test(img.url) ? 'video' : 'image'),
          })) || [],
          images: dataToTransform.product_images?.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((img: any) => img.url) || [],
          category: dataToTransform.categories?.name || 'Shop',
          rating: dataToTransform.rating_avg || 0,
          reviewCount: 0,
          stockCount: dataToTransform.quantity,
          moq: dataToTransform.moq || 1,
          colors: [...new Set(rawVariants.map((v: any) => v.color).filter(Boolean))],
          colorHexMap,
          variants: rawVariants,
          sizes: rawVariants.map((v: any) => v.name) || [],
          features: ['Premium Quality', 'Authentic Design'],
          featured: ['Premium Quality', 'Authentic Design'],
          care: 'Handle with care.',
          preorderShipping: dataToTransform.metadata?.preorder_shipping || null
        };

        // Ensure at least one image/placeholder
        if (transformedProduct.images.length === 0) {
          transformedProduct.images = ['https://via.placeholder.com/800x800?text=No+Image'];
        }

        setProduct(transformedProduct);
        setLoading(false);

        // Set initial quantity to MOQ
        if (transformedProduct.moq > 1) {
          setQuantity(transformedProduct.moq);
        }

        // If variants exist, do NOT pre-select — force user to choose
        // Reset variant and color selection
        setSelectedVariant(null);
        setSelectedSize('');
        setSelectedColor('');

        // Fetch related products sharing any category (cached for 5 minutes)
        const relatedCategoryIds = (dataToTransform.product_categories || [])
          .map((row: any) => row?.category_id)
          .filter(Boolean);
        const categoryIdsForRelated = relatedCategoryIds.length > 0
          ? relatedCategoryIds
          : (dataToTransform.category_id ? [dataToTransform.category_id] : []);

        if (categoryIdsForRelated.length > 0) {
          const { data: related } = await cachedQuery<{ data: any; error: any }>(
            `related:${categoryIdsForRelated.join(',')}:${dataToTransform.id}`,
            (async () => {
              const { data: links, error: linksError } = await supabase
                .from('product_categories')
                .select('product_id')
                .in('category_id', categoryIdsForRelated)
                .neq('product_id', dataToTransform.id);

              if (linksError || !links?.length) {
                return { data: [], error: linksError };
              }

              const relatedIds = [...new Set(links.map((row: any) => row.product_id))].slice(0, 4);
              return supabase
                .from('products')
                .select('*, product_images(url, position), product_variants(id, name, price, quantity)')
                .in('id', relatedIds)
                .eq('status', 'active');
            }) as any,
            5 * 60 * 1000
          );

          if (related) {
            setRelatedProducts(related.map((p: any) => {
              const variants = p.product_variants || [];
              const hasVariants = variants.length > 0;
              const minVariantPrice = hasVariants ? Math.min(...variants.map((v: any) => v.price || p.price)) : undefined;
              const totalVariantStock = hasVariants ? variants.reduce((sum: number, v: any) => sum + (v.quantity || 0), 0) : 0;
              const effectiveStock = hasVariants ? totalVariantStock : p.quantity;
              return {
                id: p.id,
                slug: p.slug,
                name: p.name,
                price: p.price,
                image: p.product_images?.[0]?.url || 'https://via.placeholder.com/800?text=No+Image',
                rating: p.rating_avg || 0,
                reviewCount: 0,
                inStock: effectiveStock > 0,
                maxStock: effectiveStock || 50,
                moq: p.moq || 1,
                hasVariants,
                minVariantPrice
              };
            }));
          }
        }

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    if (slug) {
      fetchProduct();
    }
  }, [slug]);

  const hasVariants = product?.variants?.length > 0;
  const hasColors = product?.colors?.length > 0;
  const needsVariantSelection = hasVariants && !selectedVariant;
  const needsColorSelection = hasColors && !selectedColor;

  // Determine the active price: variant price if selected, otherwise base price
  const activePrice = selectedVariant?.price ?? product?.price ?? 0;
  const activeStock = selectedVariant ? (selectedVariant.stock ?? selectedVariant.quantity ?? product?.stockCount ?? 0) : (product?.stockCount ?? 0);
  const hasValidPrice = isPurchasablePrice(activePrice);

  // Returns whether the item was actually added (Buy Now uses this so it
  // never navigates to checkout when the add was blocked).
  const addToCartGuarded = (): boolean => {
    if (!product || needsVariantSelection || !hasValidPrice) return false;

    // Build variant display string: "Color / Name" or just "Name" or just "Color"
    let variantLabel: string | undefined;
    if (selectedVariant) {
      const color = selectedVariant.color || selectedColor || '';
      const name = selectedVariant.name || '';
      variantLabel = color && name ? `${color} / ${name}` : color || name || undefined;
    }

    return addToCart({
      id: product.id,
      name: product.name,
      price: activePrice,
      image: selectedVariant?.image_url || product.images[0],
      quantity: quantity,
      variant: variantLabel,
      variantId: selectedVariant?.id,
      sku: selectedVariant?.sku || product.sku || undefined,
      slug: product.slug,
      maxStock: activeStock,
      moq: product.moq || 1,
    });
  };

  const handleAddToCart = () => {
    addToCartGuarded();
  };

  const handleBuyNow = () => {
    if (addToCartGuarded()) {
      window.location.href = '/checkout';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white py-12 flex justify-center items-center">
        <div className="text-center">
          <i className="ri-loader-4-line text-4xl text-gray-900 animate-spin mb-4 block"></i>
          <p className="text-gray-500">Loading product...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-white py-20 flex justify-center items-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Product Not Found</h2>
          <ContinueShoppingLink className="text-gray-900 hover:underline">Return to Shop</ContinueShoppingLink>
        </div>
      </div>
    );
  }

  const discount = product.compare_at_price ? Math.round((1 - activePrice / product.compare_at_price) * 100) : 0;
  const minVariantPrice = hasVariants ? Math.min(...product.variants.map((v: any) => v.price || product.price)) : product.price;

  const productSchema = generateProductSchema({
    name: product.name,
    description: product.description,
    image: product.images[0],
    price: hasVariants ? minVariantPrice : product.price,
    currency: 'GHS',
    sku: product.sku,
    rating: product.rating,
    reviewCount: product.reviewCount,
    availability: product.quantity > 0 ? 'in_stock' : 'out_of_stock',
    category: product.category
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: 'Home', url: 'https://standardecom.com' },
    { name: 'Shop', url: 'https://standardecom.com/shop' },
    { name: product.category, url: `https://standardecom.com/shop?category=${product.category.toLowerCase().replace(/\s+/g, '-')}` },
    { name: product.name, url: `https://standardecom.com/product/${slug}` }
  ]);

  return (
    <>
      <StructuredData data={productSchema} />
      <StructuredData data={breadcrumbSchema} />

      <main className="min-h-screen bg-white">
        <section className="py-4 border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <nav className="flex items-center gap-x-1.5 gap-y-1 text-[13px] text-gray-500 flex-wrap">
              <Link href="/" className="hover:text-gray-900 transition-colors">Home</Link>
              <i className="ri-arrow-right-s-line text-gray-300"></i>
              <ContinueShoppingLink className="hover:text-gray-900 transition-colors">Shop</ContinueShoppingLink>
              <i className="ri-arrow-right-s-line text-gray-300"></i>
              <Link href="#" className="hover:text-gray-900 transition-colors">{product.category}</Link>
              <i className="ri-arrow-right-s-line text-gray-300"></i>
              <span className="text-gray-900 truncate max-w-[220px]">{product.name}</span>
            </nav>
          </div>
        </section>

        <section className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid lg:grid-cols-2 gap-12">
              <div>
                {/* Main image: show variant image when selected variant has one, otherwise product image */}
                {(() => {
                  const variantImage = selectedVariant?.image_url;
                  const mainSrc = variantImage || product.images[selectedImage];
                  const mainIsVideo = !variantImage && product.media?.[selectedImage]?.type === 'video';
                  return (
                    <div className="relative aspect-square rounded-[1.75rem] overflow-hidden bg-[#f4f1ec] mb-4 border border-black/[0.06] shadow-[0_20px_50px_-28px_rgba(0,0,0,0.45)]">
                      {mainIsVideo ? (
                        <video
                          key={product.images[selectedImage]}
                          src={product.images[selectedImage]}
                          className="w-full h-full object-cover"
                          controls
                          muted
                          loop
                          playsInline
                          preload="none"
                        />
                      ) : mainSrc ? (
                        <img
                          src={storageImageUrl(mainSrc, { width: 900, height: 900 })}
                          alt={product.name}
                          className="absolute inset-0 w-full h-full object-contain object-center p-6 sm:p-10"
                          onError={(event) => originalOnError(event, mainSrc)}
                        />
                      ) : null}
                      {discount > 0 && (
                        <span className="absolute top-6 right-6 bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-full">
                          Save {discount}%
                        </span>
                      )}
                    </div>
                  );
                })()}

                {product.images.length > 1 && (
                  <div className="grid grid-cols-4 gap-4">
                    {product.images.map((image: string, index: number) => {
                      const isVideo = product.media?.[index]?.type === 'video';
                      return (
                        <button
                          key={index}
                          onClick={() => setSelectedImage(index)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${selectedImage === index ? 'border-gray-900 shadow-md' : 'border-gray-200 hover:border-gray-300'
                            }`}
                        >
                          {isVideo ? (
                            <>
                              <video src={image} className="w-full h-full object-cover" muted preload="none" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center">
                                  <i className="ri-play-fill text-gray-900 text-sm"></i>
                                </div>
                              </div>
                            </>
                          ) : (
                            <img
                              src={storageImageUrl(image, { width: 240, height: 240 })}
                              alt={`${product.name} view ${index + 1}`}
                              className="absolute inset-0 w-full h-full object-cover object-center"
                              onError={(event) => originalOnError(event, image)}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="lg:pt-2">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 mb-2">{product.category}</p>
                    <h1 className="font-serif text-[2rem] lg:text-[2.75rem] leading-[1.08] text-gray-950 text-balance">{product.name}</h1>
                  </div>
                  <button
                    onClick={() => setIsWishlisted(!isWishlisted)}
                    aria-label={isWishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
                    className="w-11 h-11 shrink-0 flex items-center justify-center border border-gray-200 hover:border-gray-900 rounded-full transition-colors cursor-pointer"
                  >
                    <i className={`${isWishlisted ? 'ri-heart-fill text-red-600' : 'ri-heart-line text-gray-700'} text-lg`}></i>
                  </button>
                </div>

                {Number(product.rating) > 0 && (
                  <div className="flex items-center mb-5">
                    <div className="flex items-center gap-0.5 mr-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <i
                          key={star}
                          className={`${star <= Math.round(product.rating) ? 'ri-star-fill text-amber-400' : 'ri-star-line text-gray-300'} text-base`}
                        ></i>
                      ))}
                    </div>
                    <span className="text-sm text-gray-600 tabular-nums">{Number(product.rating).toFixed(1)}</span>
                  </div>
                )}

                <div className="flex items-baseline gap-3 mb-6">
                  {hasVariants && !selectedVariant ? (
                    <span className="text-[2rem] font-semibold text-gray-950 tabular-nums tracking-tight">
                      From GH₵{minVariantPrice.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[2rem] font-semibold text-gray-950 tabular-nums tracking-tight">GH₵{activePrice.toFixed(2)}</span>
                  )}
                  {product.compare_at_price && product.compare_at_price > activePrice && (
                    <span className="text-lg text-gray-400 line-through tabular-nums">GH₵{product.compare_at_price.toFixed(2)}</span>
                  )}
                  {discount > 0 && (
                    <span className="text-xs font-semibold uppercase tracking-wide text-red-700 bg-red-50 px-2 py-1 rounded-full">Save {discount}%</span>
                  )}
                </div>

                {String(product.description || '').trim() && (
                  <p className="text-gray-600 leading-relaxed mb-8 text-[15px] text-pretty line-clamp-3">{product.description}</p>
                )}

                {/* ── VARIANT SELECTORS ─────────────────────────────── */}
                {hasVariants && (
                  <div className="mb-6 space-y-5">

                    {/* STEP 1 — Color */}
                    {product.colors.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
                            {product.colors.length > 1 ? 'Step 1 · ' : ''}Color
                          </span>
                          {selectedColor
                            ? <span className="text-sm font-semibold text-gray-900">{selectedColor}</span>
                            : <span className="text-xs text-red-500 font-medium animate-pulse">← Pick a color</span>
                          }
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {product.colors.map((color: string) => {
                            const isSelected = selectedColor === color;
                            const colorVariants = product.variants.filter((v: any) => v.color === color);
                            const colorStock = colorVariants.reduce((sum: number, v: any) => sum + (v.stock ?? v.quantity ?? 0), 0);
                            const isOutOfStock = colorStock === 0 && product.stockCount === 0;
                            const variantImage = colorVariants.find((v: any) => v.image_url)?.image_url;
                            return (
                              <button
                                key={color}
                                onClick={() => {
                                  setSelectedColor(color);
                                  const matching = product.variants.filter((v: any) => v.color === color);
                                  if (matching.length === 1) {
                                    setSelectedVariant(matching[0]);
                                    setSelectedSize(matching[0].name);
                                  } else {
                                    setSelectedVariant(null);
                                    setSelectedSize('');
                                  }
                                }}
                                disabled={isOutOfStock}
                                title={color}
                                className={`relative group flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all duration-150 cursor-pointer select-none
                                  ${isSelected
                                    ? 'border-gray-900 bg-gray-900 text-white shadow-md scale-105'
                                    : isOutOfStock
                                      ? 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed opacity-50'
                                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400 hover:shadow-sm active:scale-95'
                                  }`}
                              >
                                {variantImage ? (
                                  <span className="w-8 h-8 rounded-lg overflow-hidden border border-white/20 flex-shrink-0 bg-gray-100">
                                    <img
                                      src={storageImageUrl(variantImage, { width: 80, height: 80 })}
                                      alt={color}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      decoding="async"
                                      onError={(event) => originalOnError(event, variantImage)}
                                    />
                                  </span>
                                ) : (
                                  <span
                                    className="w-5 h-5 rounded-full flex-shrink-0 border-2 border-white shadow-sm"
                                    style={{ backgroundColor: product.colorHexMap?.[color] || colorNameToHex(color) }}
                                  />
                                )}
                                <span className="text-sm font-medium">{color}</span>
                                {isOutOfStock && <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Out of Stock</span>}
                                {isSelected && <i className="ri-check-line text-xs ml-1 opacity-80"></i>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* STEP 2 — Size / Type */}
                    {(() => {
                      const hasColors = product.colors.length > 0;
                      const visibleVariants = hasColors && selectedColor
                        ? product.variants.filter((v: any) => v.color === selectedColor)
                        : hasColors ? [] : product.variants;

                      const showSelector = visibleVariants.length > 1 || (!hasColors && visibleVariants.length > 0);
                      if (!showSelector) return null;

                      const hasImages = visibleVariants.some((v: any) => v.image_url);
                      const stepLabel = hasColors ? 'Step 2 · ' : '';

                      return (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{stepLabel}Size / Type</span>
                            {selectedVariant
                              ? <span className="text-sm font-semibold text-gray-900">GH₵{(selectedVariant.price || product.price).toFixed(2)}</span>
                              : <span className="text-xs text-red-500 font-medium animate-pulse">← Pick a size</span>
                            }
                          </div>

                          {hasImages ? (
                            /* Image-style variant cards */
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {visibleVariants.map((variant: any) => {
                                const isSelected = selectedVariant?.id === variant.id || selectedVariant?.name === variant.name;
                                const variantStock = variant.stock ?? variant.quantity ?? 0;
                                const isOutOfStock = variantStock === 0 && product.stockCount === 0;
                                return (
                                  <button
                                    key={variant.id || variant.name}
                                    onClick={() => { setSelectedVariant(variant); setSelectedSize(variant.name); }}
                                    disabled={isOutOfStock}
                                    className={`relative rounded-xl overflow-hidden border-2 transition-all duration-150 cursor-pointer flex flex-col active:scale-95
                                      ${isSelected ? 'border-gray-900 shadow-md' : isOutOfStock ? 'border-gray-100 opacity-40 cursor-not-allowed' : 'border-gray-200 hover:border-gray-400 hover:shadow-sm'}`}
                                  >
                                    {variant.image_url ? (
                                      <span className="w-full aspect-square bg-gray-100 block overflow-hidden">
                                        <img
                                          src={storageImageUrl(variant.image_url, { width: 240, height: 240 })}
                                          alt={variant.name}
                                          className="w-full h-full object-cover"
                                          loading="lazy"
                                          decoding="async"
                                          onError={(event) => originalOnError(event, variant.image_url)}
                                        />
                                      </span>
                                    ) : (
                                      <span className="w-full aspect-square bg-gray-100 flex items-center justify-center text-xs text-gray-500 font-medium px-1 text-center">{variant.name}</span>
                                    )}
                                    <span className={`block text-center text-[11px] font-semibold py-1 px-1 truncate ${isSelected ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}>
                                      GH₵{(variant.price || product.price).toFixed(2)}
                                    </span>
                                    {isSelected && (
                                      <span className="absolute top-1 right-1 w-5 h-5 bg-gray-900 rounded-full flex items-center justify-center">
                                        <i className="ri-check-line text-white text-[10px]"></i>
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            /* Text pill variant buttons */
                            <div className="flex flex-wrap gap-2">
                              {visibleVariants.map((variant: any) => {
                                const isSelected = selectedVariant?.id === variant.id || selectedVariant?.name === variant.name;
                                const variantStock = variant.stock ?? variant.quantity ?? 0;
                                const isOutOfStock = variantStock === 0 && product.stockCount === 0;
                                return (
                                  <button
                                    key={variant.id || variant.name}
                                    onClick={() => { setSelectedVariant(variant); setSelectedSize(variant.name); }}
                                    disabled={isOutOfStock}
                                    className={`relative px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all duration-150 cursor-pointer select-none active:scale-95
                                      ${isSelected
                                        ? 'border-gray-900 bg-gray-900 text-white shadow-md'
                                        : isOutOfStock
                                          ? 'border-gray-100 bg-gray-50 text-gray-300 line-through cursor-not-allowed'
                                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400 hover:shadow-sm'
                                      }`}
                                  >
                                    <span>{variant.name}</span>
                                    <span className={`block text-[11px] mt-0.5 ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
                                      GH₵{(variant.price || product.price).toFixed(2)}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                  </div>
                )}
                {/* ── END VARIANT SELECTORS ─────────────────────────── */}

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2.5">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Quantity</label>
                    {activeStock > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <i className="ri-checkbox-circle-fill"></i>
                        In stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                        <i className="ri-close-circle-fill"></i>
                        Out of stock
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="inline-flex items-center border border-gray-200 rounded-full">
                      <button
                        onClick={() => setQuantity(Math.max(product.moq || 1, quantity - 1))}
                        className="w-11 h-11 flex items-center justify-center text-gray-700 hover:bg-gray-50 rounded-full transition-colors cursor-pointer disabled:opacity-30"
                        disabled={activeStock === 0 || quantity <= (product.moq || 1)}
                        aria-label="Decrease quantity"
                      >
                        <i className="ri-subtract-line text-lg"></i>
                      </button>
                      <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(product.moq || 1, Math.min(activeStock, parseInt(e.target.value) || (product.moq || 1))))}
                        className="w-10 h-11 text-center focus:outline-none text-base font-semibold tabular-nums bg-transparent"
                        min={product.moq || 1}
                        max={activeStock}
                        disabled={activeStock === 0}
                      />
                      <button
                        onClick={() => setQuantity(Math.min(activeStock, quantity + 1))}
                        className="w-11 h-11 flex items-center justify-center text-gray-700 hover:bg-gray-50 rounded-full transition-colors cursor-pointer disabled:opacity-30"
                        disabled={activeStock === 0}
                        aria-label="Increase quantity"
                      >
                        <i className="ri-add-line text-lg"></i>
                      </button>
                    </div>
                    {product.moq > 1 && (
                      <span className="text-sm text-gray-500">Minimum {product.moq}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 mb-8">
                  <button
                    disabled={activeStock === 0 || needsVariantSelection || needsColorSelection || !hasValidPrice}
                    className={`flex-1 bg-gray-950 hover:bg-black text-white py-3.5 rounded-full font-semibold transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer active:scale-[0.98] ${(activeStock === 0 || needsVariantSelection || needsColorSelection || !hasValidPrice) ? 'opacity-40 cursor-not-allowed' : ''}`}
                    onClick={handleAddToCart}
                  >
                    <i className="ri-shopping-cart-line text-lg"></i>
                    <span>{activeStock === 0 ? 'Out of Stock' : needsColorSelection ? 'Select a Color' : needsVariantSelection ? 'Select a Variant' : !hasValidPrice ? 'Unavailable' : 'Add to Cart'}</span>
                  </button>
                  {activeStock > 0 && !needsVariantSelection && !needsColorSelection && hasValidPrice && (
                    <button
                      onClick={handleBuyNow}
                      className="sm:w-auto border border-gray-950 bg-white hover:bg-gray-50 text-gray-950 px-8 py-3.5 rounded-full font-semibold transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98]"
                    >
                      Buy Now
                    </button>
                  )}
                </div>

                <div className="grid sm:grid-cols-3 gap-3 border-t border-gray-100 pt-5">
                  <div className="flex items-start gap-2.5 text-sm text-gray-600">
                    <i className="ri-store-2-line text-base text-gray-900 mt-0.5"></i>
                    <span className="text-pretty">Free store pickup</span>
                  </div>
                  <div className="flex items-start gap-2.5 text-sm text-gray-600">
                    <i className="ri-truck-line text-base text-gray-900 mt-0.5"></i>
                    <span className="text-pretty">Delivery in 24–48 hours</span>
                  </div>
                  <div className="flex items-start gap-2.5 text-sm text-gray-600">
                    <i className="ri-shield-check-line text-base text-gray-900 mt-0.5"></i>
                    <span className="text-pretty">Secure payment</span>
                  </div>
                </div>
                {product.sku && (
                  <p className="mt-4 text-[11px] uppercase tracking-[0.16em] text-gray-400">SKU {product.sku}</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="border-b border-gray-300 mb-8">
              <div className="flex space-x-8">
                {['description', 'features', 'care', 'reviews'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`pb-4 font-semibold transition-colors relative whitespace-nowrap cursor-pointer ${activeTab === tab
                      ? 'text-gray-900 border-b-2 border-gray-900'
                      : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {activeTab === 'description' && (
              <div className="prose max-w-none">
                <p className="text-gray-700 text-lg leading-relaxed">{product.description}</p>
              </div>
            )}

            {activeTab === 'features' && (
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Key Features</h3>
                <ul className="grid md:grid-cols-2 gap-4">
                  {product.features.map((feature: string, index: number) => (
                    <li key={index} className="flex items-start">
                      <i className="ri-checkbox-circle-fill text-gray-900 text-xl mr-3 mt-1"></i>
                      <span className="text-gray-700 text-lg">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activeTab === 'care' && (
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Care Instructions</h3>
                <p className="text-gray-700 text-lg leading-relaxed">{product.care}</p>
              </div>
            )}

            {activeTab === 'reviews' && (
              <div id="reviews">
                <ProductReviews productId={product.id} />
              </div>
            )}
          </div>
        </section>

        {relatedProducts.length > 0 && (
          <section className="py-20 bg-white" data-product-shop>
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="text-center mb-12">
                <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">You May Also Like</h2>
                <p className="text-lg text-gray-600">Curated recommendations based on this product</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                {relatedProducts.map((p) => (
                  <ProductCard key={p.id} {...p} />
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
