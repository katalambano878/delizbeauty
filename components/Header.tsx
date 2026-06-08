'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import MiniCart from './MiniCart';
import { useCart } from '@/context/CartContext';
import { supabase } from '@/lib/supabase';
import { useCMS } from '@/context/CMSContext';
import AnnouncementBar from './AnnouncementBar';

const NavLink = ({ href, children, isMobile, onClick }: { href: string; children: React.ReactNode; isMobile?: boolean, onClick?: () => void }) => {
  if (isMobile) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className="block px-4 py-4 text-xl font-medium text-gray-800 hover:text-black hover:bg-gray-50/80 rounded-xl transition-all duration-300"
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="relative group px-1 py-2 text-[15px] font-medium tracking-wide text-gray-700 hover:text-black transition-colors"
    >
      <span className="relative z-10">{children}</span>
      <span className="absolute bottom-1 left-1/2 w-0 h-[2px] bg-black transition-all duration-300 ease-out group-hover:w-full group-hover:left-0"></span>
    </Link>
  );
};

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [wishlistCount, setWishlistCount] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<{
    products: Array<{
      id: string;
      slug: string;
      name: string;
      price: number;
      image: string | null;
      categories: string[];
    }>;
    categories: Array<{ id: string; name: string; slug: string }>;
  }>({ products: [], categories: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const { cartCount, isCartOpen, setIsCartOpen } = useCart();
  const { getSetting } = useCMS();

  const siteName = getSetting('site_name') || 'StandardStore';

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 15);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Wishlist logic
    const updateWishlistCount = () => {
      const wishlist = JSON.parse(localStorage.getItem('wishlist') || '[]');
      setWishlistCount(wishlist.length);
    };

    updateWishlistCount();
    window.addEventListener('wishlistUpdated', updateWishlistCount);

    // Auth logic
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
    };

    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('wishlistUpdated', updateWishlistCount);
      subscription.unsubscribe();
    };
  }, []);

  const handleSearch = (e?: React.FormEvent, queryOverride?: string) => {
    e?.preventDefault();
    const query = (queryOverride ?? searchQuery).trim();
    if (query) {
      window.location.href = `/shop?search=${encodeURIComponent(query)}`;
    }
  };

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchSuggestions({ products: [], categories: [] });
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/storefront/search/suggest?q=${encodeURIComponent(query)}&limit=6`);
        const data = await res.json();
        if (res.ok) {
          setSearchSuggestions({
            products: data.products || [],
            categories: data.categories || [],
          });
        }
      } catch (error) {
        console.error('Search suggest error:', error);
      } finally {
        setSearchLoading(false);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const renderSearchSuggestions = (onNavigate?: () => void) => {
    const hasResults =
      searchSuggestions.products.length > 0 || searchSuggestions.categories.length > 0;

    if (searchQuery.trim().length < 2) return null;

    return (
      <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden z-[120]">
        {searchLoading && (
          <div className="px-4 py-3 text-sm text-gray-500">Searching...</div>
        )}

        {!searchLoading && !hasResults && (
          <div className="px-4 py-5 text-sm text-gray-500 text-center">
            No matches yet. Press enter to search everything for &ldquo;{searchQuery.trim()}&rdquo;.
          </div>
        )}

        {!searchLoading && searchSuggestions.categories.length > 0 && (
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Categories</p>
            {searchSuggestions.categories.map((category) => (
              <Link
                key={category.id}
                href={`/shop?category=${encodeURIComponent(category.slug)}`}
                onClick={() => {
                  setShowSuggestions(false);
                  onNavigate?.();
                }}
                className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors"
              >
                <i className="ri-folder-3-line text-gray-400"></i>
                <span className="text-sm font-medium text-gray-900">{category.name}</span>
              </Link>
            ))}
          </div>
        )}

        {!searchLoading && searchSuggestions.products.length > 0 && (
          <div className="px-3 py-2">
            <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Products</p>
            {searchSuggestions.products.map((product) => (
              <Link
                key={product.id}
                href={`/product/${product.slug}`}
                onClick={() => {
                  setShowSuggestions(false);
                  onNavigate?.();
                }}
                className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                  {product.image ? (
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <i className="ri-image-line"></i>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                  {product.categories.length > 0 && (
                    <p className="text-xs text-gray-500 truncate">{product.categories.join(', ')}</p>
                  )}
                </div>
                <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">GH₵{Number(product.price).toFixed(0)}</p>
              </Link>
            ))}
          </div>
        )}

        {!searchLoading && searchQuery.trim().length >= 2 && (
          <button
            type="button"
            onClick={() => {
              handleSearch(undefined, searchQuery);
              onNavigate?.();
            }}
            className="w-full px-4 py-3 text-sm font-semibold text-gray-900 bg-gray-50 hover:bg-gray-100 border-t border-gray-100 transition-colors"
          >
            View all results for &ldquo;{searchQuery.trim()}&rdquo;
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <AnnouncementBar />

      <header
        className={`sticky top-0 z-50 pwa-header transition-all duration-500 ease-in-out border-b ${isScrolled
            ? 'bg-white/80 backdrop-blur-xl border-gray-200/50 shadow-sm py-2'
            : 'bg-white border-transparent py-4'
          }`}
      >
        <div className="safe-area-top" />
        <nav aria-label="Main navigation">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between">

              {/* Left Side: Mobile Menu & Logo */}
              <div className="flex items-center gap-4 flex-1 lg:flex-none">
                <button
                  className="lg:hidden p-2 -ml-2 text-gray-700 hover:text-black rounded-full hover:bg-gray-100/80 transition-all duration-300"
                  onClick={() => setIsMobileMenuOpen(true)}
                  aria-label="Open menu"
                >
                  <i className="ri-menu-4-line text-2xl"></i>
                </button>
                <Link
                  href="/"
                  className="flex items-center group"
                  aria-label="Go to homepage"
                >
                  <img
                    src="/logo1.png"
                    alt={siteName}
                    className="h-6 md:h-7 w-auto object-contain transition-transform duration-500 group-hover:scale-105"
                  />
                </Link>
              </div>

              {/* Center: Desktop Navigation */}
              <div className="hidden lg:flex items-center justify-center space-x-10 flex-1">
                <NavLink href="/shop">Shop</NavLink>
                <NavLink href="/categories">Categories</NavLink>
                <NavLink href="/about">About</NavLink>
                <NavLink href="/contact">Contact</NavLink>
              </div>

              {/* Right Side: Actions */}
              <div className="flex items-center space-x-2 md:space-x-3 flex-1 justify-end">

                {/* Mobile Search Icon */}
                <button
                  className="w-10 h-10 flex items-center justify-center text-gray-700 hover:text-black hover:bg-gray-100/80 rounded-full transition-all duration-300 lg:hidden group"
                  onClick={() => setIsSearchOpen(true)}
                  aria-label="Open search"
                >
                  <i className="ri-search-line text-xl transition-transform group-hover:scale-110"></i>
                </button>

                {/* Desktop Search Input */}
                <div className="hidden lg:block relative group" ref={searchContainerRef}>
                  <input
                    type="search"
                    placeholder="Search for perfection..."
                    className="w-56 focus:w-80 pl-11 pr-4 py-2.5 bg-gray-50/80 hover:bg-gray-100/80 focus:bg-white border border-gray-200/80 focus:border-black rounded-full transition-all duration-500 ease-out text-sm outline-none placeholder-gray-400 font-medium"
                    aria-label="Search products"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setShowSuggestions(false);
                        handleSearch(e);
                      }
                    }}
                  />
                  <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-black transition-colors text-lg"></i>
                  {showSuggestions && renderSearchSuggestions()}
                </div>

                {/* Wishlist */}
                <Link
                  href="/wishlist"
                  className="relative w-10 h-10 flex items-center justify-center text-gray-700 hover:text-black hover:bg-gray-100/80 rounded-full transition-all duration-300 group"
                  aria-label={`Wishlist, ${wishlistCount} items`}
                >
                  <i className="ri-heart-3-line text-xl transition-transform group-hover:scale-110"></i>
                  {wishlistCount > 0 && (
                    <span className="absolute top-0 right-0 w-[18px] h-[18px] bg-black text-white text-[10px] font-bold rounded-full flex items-center justify-center transform scale-100 group-hover:scale-110 transition-transform shadow-md border-2 border-white">
                      {wishlistCount}
                    </span>
                  )}
                </Link>

                {/* Cart */}
                <div className="relative">
                  <button
                    className="relative w-10 h-10 flex items-center justify-center text-gray-700 hover:text-black hover:bg-gray-100/80 rounded-full transition-all duration-300 group"
                    onClick={() => setIsCartOpen(!isCartOpen)}
                    aria-label={`Shopping cart, ${cartCount} items`}
                    aria-expanded={isCartOpen}
                    aria-controls="mini-cart"
                  >
                    <i className="ri-shopping-bag-line text-xl transition-transform group-hover:-translate-y-0.5 group-hover:scale-110"></i>
                    {cartCount > 0 && (
                      <span className="absolute top-0 right-0 w-[18px] h-[18px] bg-black text-white text-[10px] font-bold rounded-full flex items-center justify-center transform scale-100 group-hover:scale-110 transition-transform shadow-md border-2 border-white">
                        {cartCount}
                      </span>
                    )}
                  </button>
                  <MiniCart isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
                </div>

                {/* Account */}
                {user ? (
                  <Link
                    href="/account"
                    className="hidden lg:flex w-10 h-10 items-center justify-center text-gray-700 hover:text-black hover:bg-gray-100/80 rounded-full transition-all duration-300 group"
                    aria-label="My account"
                    title="Account"
                  >
                    <i className="ri-user-smile-line text-xl transition-transform group-hover:scale-110"></i>
                  </Link>
                ) : (
                  <Link
                    href="/auth/login"
                    className="hidden lg:flex w-10 h-10 items-center justify-center text-gray-700 hover:text-black hover:bg-gray-100/80 rounded-full transition-all duration-300 group"
                    aria-label="Login"
                    title="Login"
                  >
                    <i className="ri-user-line text-xl transition-transform group-hover:scale-110"></i>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </nav>
      </header>

      {/* Global Search Modal */}
      {isSearchOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-start justify-center pt-24 transition-opacity duration-300">
          <div
            className="absolute inset-0"
            onClick={() => setIsSearchOpen(false)}
            aria-hidden="true"
          />
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl w-full max-w-2xl mx-4 shadow-2xl relative transform animate-in fade-in slide-in-from-top-10 duration-300">
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-medium tracking-tight text-gray-900">What are you looking for?</h3>
                <button
                  onClick={() => setIsSearchOpen(false)}
                  className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-100 rounded-full transition-all duration-300"
                >
                  <i className="ri-close-line text-2xl"></i>
                </button>
              </div>
              <form onSubmit={handleSearch}>
                <div className="relative group" ref={searchContainerRef}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder="Search products, brands, categories..."
                    className="w-full px-6 py-4 pr-16 bg-gray-50/50 border-2 border-gray-100 rounded-2xl focus:bg-white focus:ring-4 focus:ring-gray-100/50 focus:border-black text-lg transition-all duration-300 outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center text-white bg-black hover:bg-gray-800 rounded-xl transition-all duration-300 shadow-md group-focus-within:bg-black"
                  >
                    <i className="ri-search-line text-xl"></i>
                  </button>
                  {showSuggestions && renderSearchSuggestions(() => setIsSearchOpen(false))}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[110] lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-linear"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute top-0 left-0 bottom-0 w-[85%] max-w-sm bg-white shadow-2xl flex flex-col animate-in slide-in-from-left duration-500 ease-out">
            <div className="px-6 py-5 flex items-center justify-between bg-white relative z-10 border-b border-gray-100/50">
              <Link href="/" onClick={() => setIsMobileMenuOpen(false)}>
                <img src="/logo1.png" alt={siteName} className="h-6 w-auto object-contain" />
              </Link>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-100 rounded-full transition-all duration-300"
                aria-label="Close menu"
              >
                <i className="ri-close-line text-2xl"></i>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto pt-6 pb-20 px-4 space-y-1">
              {[
                { label: 'Home', href: '/' },
                { label: 'Shop', href: '/shop' },
                { label: 'Categories', href: '/categories' },
                { label: 'About', href: '/about' },
                { label: 'Contact', href: '/contact' },
              ].map((link, index) => (
                <div
                  key={link.href}
                  className="animate-in slide-in-from-left-4 fade-in duration-500 fill-mode-both"
                  style={{ animationDelay: `${index * 75}ms` }}
                >
                  <NavLink
                    href={link.href}
                    isMobile
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {link.label}
                  </NavLink>
                </div>
              ))}

              <div className="my-6 space-y-4 px-4 pt-6 border-t border-gray-100">
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('show-pwa-install-guide'));
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-base font-medium text-white bg-black hover:bg-gray-800 rounded-xl transition-all shadow-md active:scale-95"
                >
                  <i className="ri-download-cloud-2-line text-lg"></i>
                  Install App for Better Experience
                </button>
              </div>

              <div className="px-2 space-y-1 pt-4">
                {[
                  { label: 'Track Order', href: '/order-tracking', icon: 'ri-truck-line' },
                  { label: 'Wishlist', href: '/wishlist', icon: 'ri-heart-line' },
                  { label: 'My Account', href: '/account', icon: 'ri-user-line' },
                ].map((link, index) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-3 px-4 py-3 text-[15px] font-medium text-gray-600 hover:text-black hover:bg-gray-50 rounded-xl transition-all duration-300"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <i className={`${link.icon} text-xl text-gray-400`}></i>
                    {link.label}
                  </Link>
                ))}
              </div>
            </nav>

            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-white via-white to-transparent pointer-events-none">
              <p className="text-xs text-center font-medium text-gray-400">
                &copy; {new Date().getFullYear()} {siteName}. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}