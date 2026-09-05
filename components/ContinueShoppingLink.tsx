'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { getContinueShoppingHref, markShopRestore } from '@/lib/browse-return';

type Props = {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
};

export default function ContinueShoppingLink({ className, children, onClick }: Props) {
  const [href, setHref] = useState('/shop');

  useEffect(() => {
    setHref(getContinueShoppingHref());
  }, []);

  return (
    <Link
      href={href}
      scroll={false}
      className={className}
      onClick={() => {
        markShopRestore();
        onClick?.();
      }}
    >
      {children}
    </Link>
  );
}
