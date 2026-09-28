'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useState, useEffect } from 'react';
import { getContinueShoppingHref, markShopRestore } from '@/lib/browse-return';

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { cartCount } = useCart();
  const { wishlistCount } = useWishlist();
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [shopHref, setShopHref] = useState('/shop');

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  useEffect(() => {
    setShopHref(getContinueShoppingHref());
  }, [pathname]);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      // Hide on scroll down, show on scroll up (only when scrolled far enough)
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsVisible(false);
      } else {
        setIsVisible(true);
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const navItems = [
    {
      href: '/',
      label: 'Home',
      iconActive: 'ri-home-5-fill',
      iconInactive: 'ri-home-5-line',
    },
    {
      href: shopHref,
      label: 'Shop',
      iconActive: 'ri-store-3-fill',
      iconInactive: 'ri-store-3-line',
    },
    {
      href: '/cart',
      label: 'Cart',
      iconActive: 'ri-shopping-cart-fill',
      iconInactive: 'ri-shopping-cart-line',
      badge: cartCount,
    },
    {
      href: '/wishlist',
      label: 'Wishlist',
      iconActive: 'ri-heart-3-fill',
      iconInactive: 'ri-heart-3-line',
      badge: wishlistCount,
    },
    {
      href: '/account',
      label: 'Account',
      iconActive: 'ri-user-3-fill',
      iconInactive: 'ri-user-3-line',
    },
  ];

  return (
    <nav
      className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-out ${
        isVisible ? 'translate-y-0' : 'translate-y-full'
      }`}
      aria-label="Mobile navigation"
    >
      <div className="bg-white/95 backdrop-blur-xl border-t border-black/[0.06] shadow-[0_-8px_30px_-18px_rgba(0,0,0,0.35)] pb-[max(0.45rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-5 gap-1 px-2 pt-2">
          {navItems.map((item) => {
            const pathOnly = item.href.split('?')[0];
            const active = item.label === 'Shop' ? pathname.startsWith('/shop') : isActive(pathOnly);
            return (
              <Link
                key={item.label}
                href={item.href}
                scroll={item.label === 'Shop' ? false : true}
                onClick={() => {
                  if (item.label === 'Shop') markShopRestore();
                }}
                className="flex flex-col items-center justify-center gap-1 min-h-11 py-1 active:scale-[0.96] transition-transform"
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <span className={`relative flex h-8 w-12 items-center justify-center rounded-full transition-colors ${
                  active ? 'bg-gray-950 text-white' : 'text-gray-400'
                }`}>
                  <i className={`${active ? item.iconActive : item.iconInactive} text-[18px]`} />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
                      active ? 'bg-white text-gray-950' : 'bg-gray-950 text-white'
                    }`}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </span>
                <span className={`text-[10px] leading-none tracking-wide ${
                  active ? 'font-semibold text-gray-950' : 'font-medium text-gray-400'
                }`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
