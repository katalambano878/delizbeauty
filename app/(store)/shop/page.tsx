'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePageTitle } from '@/hooks/usePageTitle';
import ProductCard, { type ColorVariant } from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/skeletons/ProductCardSkeleton';
import { getColorHex } from '@/components/ProductCard';
import { cachedQuery } from '@/lib/query-cache';
import PageHero from '@/components/PageHero';

const PRODUCTS_PER_PAGE = 12;

type ShopProduct = {
  id: string;
  slug: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating: number;
  reviewCount: number;
  badge?: string;
  inStock: boolean;
  maxStock: number;
  moq: number;
  category?: string;
  hasVariants: boolean;
  minVariantPrice?: number;
  colorVariants: ColorVariant[];
};

function formatProduct(p: any): ShopProduct {
  const variants = p.product_variants || [];
  const hasVariants = variants.length > 0;
  const minVariantPrice = hasVariants ? Math.min(...variants.map((v: any) => v.price || p.price)) : undefined;
  const totalVariantStock = hasVariants ? variants.reduce((sum: number, v: any) => sum + (v.quantity || 0), 0) : 0;
  const effectiveStock = hasVariants ? totalVariantStock : p.quantity;
  const colorVariants: ColorVariant[] = [];
  const seenColors = new Set<string>();
  for (const v of variants) {
    const colorName = v.option2;
    if (colorName && !seenColors.has(colorName.toLowerCase().trim())) {
      const hex = getColorHex(colorName);
      if (hex) {
        seenColors.add(colorName.toLowerCase().trim());
        colorVariants.push({ name: colorName.trim(), hex });
      }
    }
  }
  const images = Array.isArray(p.product_images) ? [...p.product_images].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)) : [];
  const firstImageUrl = images.find((img: any) => Number(img.position) === 0)?.url || images[0]?.url || 'https://via.placeholder.com/800x800?text=No+Image';

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: p.price,
    originalPrice: p.compare_at_price,
    image: firstImageUrl,
    rating: p.rating_avg || 0,
    reviewCount: 0,
    badge: p.compare_at_price > p.price ? 'Sale' : undefined,
    inStock: effectiveStock > 0,
    maxStock: effectiveStock || 50,
    moq: p.moq || 1,
    category: p.categories?.name,
    hasVariants,
    minVariantPrice,
    colorVariants,
  };
}

function ShopContent() {
  usePageTitle('Shop All Products');
  const searchParams = useSearchParams();

  const resolveCategorySlug = (rawCategory: string, list: any[]) => {
    if (!rawCategory || !Array.isArray(list) || list.length === 0) return rawCategory;

    const safeDecode = (value: string) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    const candidates = Array.from(
      new Set(
        [rawCategory, safeDecode(rawCategory), rawCategory.replace(/\+/g, ' '), safeDecode(rawCategory).replace(/\+/g, ' ')]
          .map((v) => v.trim())
          .filter(Boolean)
      )
    );

    const match = list.find((category: any) => {
      const slug = String(category?.slug || '').trim();
      const name = String(category?.name || '').trim();
      return candidates.some((candidate) =>
        slug === candidate ||
        name === candidate ||
        slug.toLowerCase() === candidate.toLowerCase() ||
        name.toLowerCase() === candidate.toLowerCase()
      );
    });

    return match?.slug || rawCategory;
  };

  // State
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [categories, setCategories] = useState<any[]>([{ id: 'all', name: 'All Products', count: 0 }]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [priceRange, setPriceRange] = useState([0, 5000]);
  const [selectedRating, setSelectedRating] = useState(0);
  const [sortBy, setSortBy] = useState('popular');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Refs for infinite scroll guards (avoid stale closures + duplicate requests)
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightPageRef = useRef<number>(0);
  const fetchKeyRef = useRef<string>('');

  // Initialize from URL params
  useEffect(() => {
    const category = searchParams.get('category');
    const sort = searchParams.get('sort');

    if (category) {
      const resolvedCategory = resolveCategorySlug(category, categories);
      setSelectedCategory((prev) => (prev === resolvedCategory ? prev : resolvedCategory));
    } else {
      setSelectedCategory((prev) => (prev === 'all' ? prev : 'all'));
    }

    if (sort) setSortBy(sort);
  }, [searchParams, categories]);

  // Fetch Categories from cached API
  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch('/api/storefront/categories');
        if (res.ok) {
          const data = await res.json();
          if (data) setCategories(data);
        }
      } catch (err) {
        console.error('Error fetching categories:', err);
      }
    }
    fetchCategories();
  }, []);

  // Build a deterministic key for current filters (excluding page).
  // When this key changes, products are reset and pagination restarts.
  const search = searchParams.get('search') || '';
  const fetchKey = `${selectedCategory}::${search}::${priceRange.join('-')}::${selectedRating}::${sortBy}`;

  const loadProducts = useCallback(
    async (targetPage: number, replace: boolean) => {
      // Avoid duplicate concurrent requests for the same page+filters
      if (inFlightPageRef.current === targetPage && fetchKeyRef.current === fetchKey) return;

      // Cancel any previous request before starting a new one
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inFlightPageRef.current = targetPage;
      fetchKeyRef.current = fetchKey;

      if (replace) setInitialLoading(true);
      else setLoadingMore(true);

      try {
        let categorySlugs = 'all';
        if (selectedCategory !== 'all') {
          const categoryObj = categories.find((c: any) => c.slug === selectedCategory);
          if (categoryObj) {
            const childSlugs = categories
              .filter((c: any) => c.parent_id === categoryObj.id)
              .map((c: any) => c.slug);
            categorySlugs = [selectedCategory, ...childSlugs].join(',');
          } else {
            categorySlugs = selectedCategory;
          }
        }

        const cacheKey = `shop:${selectedCategory}:${search}:${priceRange.join('-')}:${selectedRating}:${sortBy}:${targetPage}`;
        const { data, count } = await cachedQuery<{ data: any[]; count: number }>(
          cacheKey,
          async () => {
            const params = new URLSearchParams({
              search,
              categorySlugs,
              priceMin: String(priceRange[0]),
              priceMax: String(priceRange[1]),
              rating: String(selectedRating),
              sortBy,
              page: String(targetPage),
              limit: String(PRODUCTS_PER_PAGE),
            });
            const res = await fetch(`/api/storefront/shop?${params}`, { signal: controller.signal });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || 'Failed to load products');
            }
            return res.json();
          },
          30 * 1000
        );

        if (controller.signal.aborted) return;

        const formatted = (data || []).map(formatProduct);
        const totalCount = count || 0;

        setTotalProducts(totalCount);
        setProducts((prev) => {
          if (replace) return formatted;
          // Dedupe in case a request races the user
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...formatted.filter((p) => !seen.has(p.id))];
        });

        const loadedSoFar = (replace ? 0 : products.length) + formatted.length;
        setHasMore(loadedSoFar < totalCount && formatted.length > 0);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Error fetching products:', err);
        }
      } finally {
        if (!controller.signal.aborted) {
          if (replace) setInitialLoading(false);
          setLoadingMore(false);
          inFlightPageRef.current = 0;
        }
      }
    },
    [fetchKey, selectedCategory, search, priceRange, selectedRating, sortBy, categories, products.length]
  );

  // Reset & load page 1 whenever filters change
  useEffect(() => {
    setPage(1);
    setProducts([]);
    setHasMore(true);
    loadProducts(1, true);
    // We intentionally only depend on fetchKey; loadProducts is captured fresh via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // Load subsequent pages when `page` advances (triggered by IntersectionObserver)
  useEffect(() => {
    if (page > 1) loadProducts(page, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // IntersectionObserver — triggers next page slightly before the user reaches the bottom
  useEffect(() => {
    if (!sentinelRef.current) return;
    if (!hasMore) return;
    if (initialLoading) return;

    const target = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !loadingMore && hasMore) {
          setPage((prev) => prev + 1);
        }
      },
      { rootMargin: '600px 0px', threshold: 0 }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, initialLoading, loadingMore]);

  return (
    <main className="min-h-screen bg-white">
      <PageHero
        title="Shop All Products"
        subtitle="Discover our curated collection of premium goods"
        image="/hero-nail-lamp.png"
      />

      {/* Mobile Filter Toggle */}
      <div className="lg:hidden bg-white border-b border-gray-200 py-4 px-4 sticky top-[72px] z-20">
        <div className="flex justify-between items-center">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className="flex items-center space-x-2 text-gray-900 font-medium"
          >
            <i className="ri-filter-3-line text-xl"></i>
            <span>Filters & Sort</span>
          </button>
          <span className="text-sm text-gray-500">{totalProducts} Products</span>
        </div>
      </div>

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex gap-8">
            <aside className={`${isFilterOpen ? 'fixed inset-0 z-50 bg-white overflow-y-auto' : 'hidden'} lg:block lg:w-64 lg:flex-shrink-0`}>
              <div className="lg:sticky lg:top-24">
                <div className="bg-white lg:bg-transparent p-6 lg:p-0">
                  <div className="flex items-center justify-between mb-6 lg:hidden">
                    <h2 className="text-xl font-bold text-gray-900">Filters</h2>
                    <button
                      onClick={() => setIsFilterOpen(false)}
                      className="w-10 h-10 flex items-center justify-center text-gray-700"
                    >
                      <i className="ri-close-line text-2xl"></i>
                    </button>
                  </div>

                  <div className="space-y-8">
                    {/* Categories */}
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-4">Categories</h3>
                      <div className="space-y-1">
                        <button
                          onClick={() => {
                            setSelectedCategory('all');
                            setIsFilterOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${selectedCategory === 'all'
                            ? 'bg-gray-100 text-gray-900 font-medium'
                            : 'text-gray-700 hover:bg-gray-100'
                            }`}
                        >
                          All Products
                        </button>

                        {/* Parent Categories */}
                        {categories.filter(c => !c.parent_id && c.id !== 'all').map(parent => {
                          const subcategories = categories.filter(c => c.parent_id === parent.id);
                          const isSelected = selectedCategory === parent.slug;
                          const isChildSelected = subcategories.some(sub => sub.slug === selectedCategory);
                          const isOpen = isSelected || isChildSelected; // Auto-expand if selected

                          return (
                            <div key={parent.id} className="space-y-1">
                              <button
                                onClick={() => {
                                  setSelectedCategory(parent.slug);
                                  // Don't close filter immediately if exploring hierarchy
                                }}
                                className={`w-full text-left px-4 py-2 rounded-lg transition-colors flex justify-between items-center ${isSelected
                                  ? 'bg-gray-100 text-gray-900 font-medium'
                                  : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                              >
                                <span>{parent.name}</span>
                              </button>

                              {/* Subcategories */}
                              {subcategories.length > 0 && (
                                <div className="ml-4 border-l-2 border-gray-100 pl-2 space-y-1">
                                  {subcategories.map(child => (
                                    <button
                                      key={child.id}
                                      onClick={() => {
                                        setSelectedCategory(child.slug);
                                        setIsFilterOpen(false);
                                      }}
                                      className={`w-full text-left px-4 py-1.5 rounded-lg text-sm transition-colors ${selectedCategory === child.slug
                                        ? 'text-gray-900 font-medium bg-gray-100'
                                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                        }`}
                                    >
                                      {child.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Price Range */}
                    <div className="border-t border-gray-200 pt-8">
                      <h3 className="font-semibold text-gray-900 mb-4">Max Price: GH₵{priceRange[1]}</h3>
                      <div className="space-y-4">
                        <input
                          type="range"
                          min="0"
                          max="5000"
                          step="50"
                          value={priceRange[1]}
                          onChange={(e) => {
                            setPriceRange([0, parseInt(e.target.value)]);
                          }}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
                        />
                        <div className="flex items-center justify-between text-sm text-gray-600">
                          <span>GH₵0</span>
                          <span>GH₵5000+</span>
                        </div>
                      </div>
                    </div>

                    {/* Rating */}
                    <div className="border-t border-gray-200 pt-8">
                      <h3 className="font-semibold text-gray-900 mb-4">Rating</h3>
                      <div className="space-y-2">
                        {[4, 3, 2, 1].map(rating => (
                          <button
                            key={rating}
                            onClick={() => {
                              setSelectedRating(rating === selectedRating ? 0 : rating);
                            }}
                            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${selectedRating === rating
                              ? 'bg-gray-100 text-gray-900'
                              : 'text-gray-700 hover:bg-gray-100'
                              }`}
                          >
                            <div className="flex items-center space-x-2">
                              {[1, 2, 3, 4, 5].map(star => (
                                <i
                                  key={star}
                                  className={`${star <= rating ? 'ri-star-fill text-amber-400' : 'ri-star-line text-gray-300'} text-sm`}
                                ></i>
                              ))}
                              <span className="text-sm">& Up</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        // Re-fetch handled by effect dependencies
                        setIsFilterOpen(false);
                      }}
                      className="w-full bg-gray-900 hover:bg-gray-800 text-white py-3 rounded-lg font-medium transition-colors whitespace-nowrap"
                    >
                      Show Results
                    </button>
                  </div>
                </div>
              </div>
            </aside>

            <div className="flex-1">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
                <p className="text-gray-600">
                  Showing <span className="font-semibold text-gray-900">{products.length}</span> of <span className="font-semibold text-gray-900">{totalProducts}</span> products
                </p>

                <div className="flex items-center space-x-3">
                  <label className="text-sm text-gray-600 whitespace-nowrap">Sort by:</label>
                  <select
                    value={sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value);
                    }}
                    className="px-4 py-2 pr-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 text-sm bg-white cursor-pointer"
                  >
                    <option value="popular">Most Popular</option>
                    <option value="new">Newest</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    <option value="rating">Highest Rated</option>
                  </select>
                </div>
              </div>

              {initialLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-x-4 gap-y-8 md:gap-8">
                  {[...Array(6)].map((_, i) => (
                    <ProductCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-8 md:gap-8" data-product-shop>
                    {products.map(product => (
                      <ProductCard key={product.id} {...product} />
                    ))}
                    {loadingMore && [...Array(3)].map((_, i) => (
                      <ProductCardSkeleton key={`more-${i}`} />
                    ))}
                  </div>

                  {products.length === 0 && (
                    <div className="text-center py-20">
                      <div className="w-20 h-20 flex items-center justify-center mx-auto mb-6 bg-gray-100 rounded-full">
                        <i className="ri-inbox-line text-4xl text-gray-400"></i>
                      </div>
                      <h3 className="text-2xl font-bold text-gray-900 mb-2">No Products Found</h3>
                      <p className="text-gray-600 mb-8">Try adjusting your filters to find what you're looking for</p>
                      <button
                        onClick={() => {
                          setSelectedCategory('all');
                          setPriceRange([0, 5000]);
                          setSelectedRating(0);
                        }}
                        className="inline-flex items-center bg-gray-900 hover:bg-gray-800 text-white px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap"
                      >
                        Clear All Filters
                      </button>
                    </div>
                  )}

                  {/* Infinite scroll sentinel — observed by IntersectionObserver */}
                  {hasMore && products.length > 0 && (
                    <div ref={sentinelRef} aria-hidden="true" className="h-10 w-full" />
                  )}

                  {!hasMore && products.length > 0 && (
                    <div className="mt-12 text-center text-sm text-gray-500">
                      You&apos;ve reached the end &middot; {totalProducts} products
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-12 h-12 border-4 border-gray-900 border-t-transparent rounded-full animate-spin"></div></div>}>
      <ShopContent />
    </Suspense>
  );
}