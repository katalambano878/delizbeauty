'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  browseKey,
  consumeBrowseBack,
  consumeShopRestore,
  markBrowseBack,
  readBrowseScroll,
  saveBrowseScroll,
} from '@/lib/browse-return';

/**
 * Save/restore window scroll when moving between pages.
 * Forward navigation starts at the top. Back/return to a listing
 * restores the previous position so shoppers do not lose their place.
 */
export default function ScrollToTop() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = browseKey(pathname, searchParams.toString() ? `?${searchParams.toString()}` : '');
  const keyRef = useRef(key);

  useEffect(() => {
    const onPopState = () => markBrowseBack();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    keyRef.current = key;
    const returning = consumeBrowseBack() || (pathname === '/shop' && consumeShopRestore());
    const saved = returning ? readBrowseScroll(key) : null;

    const apply = () => {
      if (saved != null && saved > 0) {
        window.scrollTo({ top: saved, behavior: 'instant' });
      } else if (!returning) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    };

    const frame = window.requestAnimationFrame(apply);
    return () => {
      window.cancelAnimationFrame(frame);
      saveBrowseScroll(keyRef.current, window.scrollY);
    };
  }, [key, pathname]);

  useEffect(() => {
    const persist = () => saveBrowseScroll(keyRef.current, window.scrollY);
    window.addEventListener('scroll', persist, { passive: true });
    window.addEventListener('pagehide', persist);
    return () => {
      window.removeEventListener('scroll', persist);
      window.removeEventListener('pagehide', persist);
    };
  }, []);

  return null;
}
