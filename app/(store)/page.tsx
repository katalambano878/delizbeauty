'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import ProductCard, { type ColorVariant, getColorHex } from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/skeletons/ProductCardSkeleton';
import AnimatedSection, { AnimatedGrid } from '@/components/AnimatedSection';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function Home() {
  usePageTitle('');
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      image: '/delizbeautybg.jpg.jpeg',
      tagline: 'Trending Now',
      headline: 'Discover Your Ultimate Beauty Glow',
      subheadline: 'Transform your daily routine into a spa-like experience. Fast shipping nationwide on all premium skincare products.',
      primaryButtonText: 'Explore Skincare',
      primaryButtonLink: '/shop?category=skincare',
    },
    {
      image: '/hero-nail-colors.png',
      tagline: 'Nail Collection',
      headline: 'Over 100 Shades — Find Your Perfect Nail Color',
      subheadline: 'Explore our premium gel polish collection. From subtle nudes to bold hues, we have every color for every mood.',
      primaryButtonText: 'Shop Nail Colors',
      primaryButtonLink: '/shop?category=nail',
    },
    {
      image: '/hero-nail-lamp.png',
      tagline: 'Pro Equipment',
      headline: 'Professional UV/LED Nail Lamps for Perfect Results',
      subheadline: 'Cure your gel nails in seconds with our high-powered salon-grade lamps. Fast, even curing every time.',
      primaryButtonText: 'Shop Equipment',
      primaryButtonLink: '/shop?category=equipment',
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [slides.length]);

  // Config State - Managed in Code
  const config = {
    hero: {
      secondaryButtonText: 'Our Story',
      secondaryButtonLink: '/about',
    },
    banners: [
      { text: '🚚 Nationwide delivery across Ghana', active: false },
      { text: '✨ Lash, hair, nail, spa & skincare — all in one place', active: false },
      { text: '💳 Secure payments via Mobile Money & Card', active: false }
    ]
  };

  useEffect(() => {
    async function fetchData() {
      try {
        // Featured products from API (service role) so product_images always load
        const res = await fetch('/api/storefront/products?featured=true&limit=32');
        if (res.ok) {
          const productsData = await res.json();
          setFeaturedProducts(Array.isArray(productsData) ? productsData : []);
        }

        // Fetch featured categories (featured is stored in metadata JSONB)
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('id, name, slug, image_url, metadata')
          .eq('status', 'active')
          .order('name');

        if (categoriesError) throw categoriesError;

        // Filter by metadata.featured = true on client side
        const featuredCategories = (categoriesData || []).filter(
          (cat: any) => cat.metadata?.featured === true
        );
        setCategories(featuredCategories);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const features = [
    { icon: 'ri-store-2-line', title: 'Free Store Pickup', desc: 'Pick up at our store' },
    { icon: 'ri-truck-line', title: 'Fast Delivery', desc: 'Delivers in 24 - 48 hours' },
    { icon: 'ri-customer-service-2-line', title: '24/7 Support', desc: 'Dedicated service' },
    { icon: 'ri-shield-check-line', title: 'Secure Payment', desc: 'Safe checkout' },
  ];

  const renderBanners = () => {
    const activeBanners = config.banners?.filter(b => b.active) || [];
    if (activeBanners.length === 0) return null;

    return (
      <div className="bg-gray-900 text-white py-2 overflow-hidden relative">
        <div className="flex animate-marquee whitespace-nowrap">
          {activeBanners.concat(activeBanners).map((banner, index) => (
            <span key={index} className="mx-8 text-sm font-medium tracking-wide flex items-center">
              {banner.text}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <main className="flex-col items-center justify-between min-h-screen">
      {renderBanners()}

      {/* Hero Section */}
      <section className="relative w-full overflow-hidden bg-black">

        {/* Full Background Image with Gradient Overlay */}
        <div className="absolute inset-0 z-0">
          {slides.map((slide, index) => (
            <Image
              key={slide.image}
              src={slide.image}
              fill
              className={`object-cover transition-opacity duration-1000 ${index === currentSlide ? 'opacity-100' : 'opacity-0'}`}
              alt={`Hero Background ${index + 1}`}
              priority={index === 0}
              sizes="100vw"
              quality={75}
            />
          ))}
          <div className="absolute inset-0 bg-gradient-to-t lg:bg-gradient-to-r from-black/90 lg:from-black/80 via-black/40 lg:via-black/30 to-black/10 lg:to-transparent"></div>

          {/* Slider Controls */}
          <div className="absolute bottom-8 lg:bottom-12 left-0 right-0 w-full z-30">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-center lg:justify-end space-x-4">
              <div className="flex space-x-3">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentSlide(index)}
                    className={`h-2 rounded-full transition-all duration-500 ease-out ${index === currentSlide ? 'bg-white w-8 shadow-[0_0_10px_rgba(255,255,255,0.7)]' : 'bg-white/40 w-2 hover:bg-white/70'
                      }`}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 min-h-[85vh] flex flex-col justify-end lg:justify-center pb-24 lg:pb-0 z-10 pt-20">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center flex-1">

            {/* Content Column - White text everywhere on top of background */}
            <div key={currentSlide} className="text-center lg:text-left transition-colors duration-300 w-full mt-auto lg:mt-0">

              <div className="inline-flex items-center space-x-2 mb-4 lg:mb-6 justify-center lg:justify-start animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
                <span className="h-px w-8 bg-white/70"></span>
                <span className="text-white text-sm font-semibold tracking-widest uppercase drop-shadow-md">
                  {slides[currentSlide].tagline}
                </span>
                <span className="h-px w-8 bg-white/70 lg:hidden"></span>
              </div>

              <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl lg:text-[4rem] xl:text-5xl text-white leading-[1.15] mb-4 lg:mb-6 drop-shadow-lg animate-fade-in-up mx-auto lg:mx-0" style={{ animationDelay: '0.2s' }}>
                {slides[currentSlide].headline}
              </h1>

              <p className="text-lg text-white/90 leading-relaxed max-w-md mx-auto lg:mx-0 font-light mb-8 lg:mb-10 drop-shadow-md animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
                {slides[currentSlide].subheadline}
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start px-4 lg:px-0 animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
                <Link href={slides[currentSlide].primaryButtonLink} className="inline-flex items-center justify-center bg-white text-gray-900 hover:bg-gray-100 px-10 py-4 rounded-full font-medium transition-all text-lg shadow-xl hover:shadow-2xl hover:-translate-y-1 btn-animate">
                  {slides[currentSlide].primaryButtonText}
                </Link>
                <Link href="/shop" className="inline-flex items-center justify-center bg-white/20 backdrop-blur-md border border-white/50 text-white hover:bg-white/30 px-10 py-4 rounded-full font-medium transition-colors text-lg btn-animate gap-2">
                  <i className="ri-search-line"></i>
                  Search Products
                </Link>
              </div>

            </div>

            {/* Empty right column to keep the text on the left */}
            <div className="hidden lg:flex flex-col justify-end items-end relative h-full pb-10">
            </div>

          </div>
        </div>
      </section>

      {/* Categories Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <AnimatedSection className="flex items-end justify-between mb-12">
            <div>
              <h2 className="font-serif text-4xl md:text-5xl text-gray-900 mb-4">Shop by Category</h2>
              <p className="text-gray-600 text-lg max-w-md">Explore our carefully curated collections</p>
            </div>
            <Link href="/categories" className="hidden md:flex items-center text-gray-900 font-medium hover:text-gray-700 transition-colors">
              View All <i className="ri-arrow-right-line ml-2"></i>
            </Link>
          </AnimatedSection>

          <AnimatedGrid className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8">
            {categories.map((category) => (
              <Link href={{ pathname: '/shop', query: { category: category.slug } }} key={category.id} className="group outline-none block">
                <div className="relative aspect-[3/4] sm:aspect-[4/5] rounded-2xl sm:rounded-[2rem] overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]">
                  <Image
                    src={category.image || category.image_url || 'https://via.placeholder.com/600x800?text=' + encodeURIComponent(category.name)}
                    alt={category.name}
                    fill
                    className="object-cover transform transition-transform duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover:scale-[1.03]"
                    sizes="(max-width: 768px) 50vw, 25vw"
                    quality={85}
                  />

                  {/* Subtle darkening for text contrast */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]" />
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]" />

                  {/* Elegant text layout resting at the bottom */}
                  <div className="absolute inset-0 flex flex-col justify-end p-5 md:p-8">
                    <div className="transform translate-y-3 group-hover:translate-y-0 transition-transform duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]">
                      <h3 className="font-serif text-2xl md:text-3xl lg:text-[1.75rem] text-white font-medium drop-shadow-sm mb-1.5 md:mb-2 leading-tight">
                        {category.name}
                      </h3>

                      <div className="overflow-hidden">
                        <div className="flex items-center gap-3 transform translate-y-full opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] delay-[50ms]">
                          <span className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] text-white/90">
                            View Collection
                          </span>
                          <div className="h-[1px] w-6 sm:w-8 bg-white/70" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </AnimatedGrid>

          <div className="mt-8 text-center md:hidden">
            <Link href="/categories" className="inline-flex items-center text-gray-900 font-medium hover:text-gray-700 transition-colors">
              View All <i className="ri-arrow-right-line ml-2"></i>
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-24 bg-stone-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <h2 className="font-serif text-4xl md:text-5xl text-gray-900 mb-4">Featured Products</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Handpicked for you</p>
          </AnimatedSection>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 md:gap-8">
              {[...Array(4)].map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <AnimatedGrid className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 lg:gap-8">
              {featuredProducts.map((product) => {
                const variants = product.product_variants || [];
                const hasVariants = variants.length > 0;
                const minVariantPrice = hasVariants ? Math.min(...variants.map((v: any) => v.price || product.price)) : undefined;
                const totalVariantStock = hasVariants ? variants.reduce((sum: number, v: any) => sum + (v.quantity || 0), 0) : 0;
                const effectiveStock = hasVariants ? totalVariantStock : product.quantity;

                // Extract unique colors from option2
                const colorVariants: ColorVariant[] = [];
                const seenColors = new Set<string>();
                for (const v of variants) {
                  const colorName = (v as any).option2;
                  if (colorName && !seenColors.has(colorName.toLowerCase().trim())) {
                    const hex = getColorHex(colorName);
                    if (hex) {
                      seenColors.add(colorName.toLowerCase().trim());
                      colorVariants.push({ name: colorName.trim(), hex });
                    }
                  }
                }

                return (
                  <ProductCard
                    key={product.id}
                    id={product.id}
                    slug={product.slug}
                    name={product.name}
                    price={product.price}
                    originalPrice={product.compare_at_price}
                    image={(Array.isArray(product.product_images) ? [...product.product_images].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))[0]?.url : product.product_images?.[0]?.url) || 'https://via.placeholder.com/400x500'}
                    rating={product.rating_avg || 5}
                    reviewCount={product.review_count || 0}
                    badge={product.featured ? 'Featured' : undefined}
                    inStock={effectiveStock > 0}
                    maxStock={effectiveStock || 50}
                    moq={product.moq || 1}
                    hasVariants={hasVariants}
                    minVariantPrice={minVariantPrice}
                    colorVariants={colorVariants}
                  />
                );
              })}
            </AnimatedGrid>
          )}

          <div className="text-center mt-16">
            <Link
              href="/shop"
              className="inline-flex items-center justify-center bg-gray-900 text-white px-10 py-4 rounded-full font-medium hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 btn-animate"
            >
              View All Products
            </Link>
          </div>
        </div>
      </section>


      {/* Trust Features */}
      <section className="py-24 relative bg-slate-50/50 border-t border-gray-100 overflow-hidden">
        {/* Subtle Decorative Background Elements */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gray-200/20 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-gray-100/50 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
            {features.map((feature, i) => (
              <AnimatedSection key={i} delay={i * 100} className="group flex flex-col items-center text-center p-8 rounded-[2rem] hover:bg-white hover:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] transition-all duration-500 cursor-default border border-transparent hover:border-gray-100/60 relative overflow-hidden">

                <div className="relative w-20 h-20 mb-8 flex items-center justify-center">
                  {/* Animated Background Offset Box */}
                  <div className="absolute inset-0 bg-gray-100/80 rounded-2xl transform rotate-6 group-hover:rotate-12 group-hover:scale-105 transition-all duration-500 ease-out"></div>

                  {/* Foreground Glass Container */}
                  <div className="absolute inset-0 bg-white/90 backdrop-blur-md shadow-sm border border-white rounded-2xl transform -rotate-3 group-hover:-rotate-0 group-hover:-translate-y-2 transition-all duration-500 ease-out flex items-center justify-center z-10 overflow-hidden">
                    {/* Shine Effect inside Icon Box */}
                    <div className="absolute top-0 -inset-full h-full w-1/2 z-5 block transform -skew-x-12 bg-gradient-to-r from-transparent to-white opacity-40 group-hover:animate-shine" />
                    <i className={`${feature.icon} text-3xl text-gray-700 group-hover:text-black transform group-hover:scale-110 transition-all duration-500 relative z-20`}></i>
                  </div>
                </div>

                <h3 className="font-serif text-[22px] font-bold text-gray-900 mb-3 tracking-tight group-hover:text-black transition-colors">{feature.title}</h3>
                <p className="text-gray-500 font-medium text-[15px] leading-relaxed group-hover:text-gray-600 transition-colors px-2">{feature.desc}</p>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
