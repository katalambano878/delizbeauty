'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { storageImageUrl } from '@/lib/storage-image';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  onLoad?: () => void;
  sizes?: string;
}

export default function LazyImage({
  src,
  alt,
  className = '',
  width,
  height,
  priority = false,
  onLoad,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
}: LazyImageProps) {
  const resized = storageImageUrl(src, { width: width && width > 0 ? width : 720, height: height && height > 0 ? height : 960 });
  const [currentSrc, setCurrentSrc] = useState(resized);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setCurrentSrc(resized);
    setIsLoaded(false);
    setHasError(false);
  }, [resized]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    if (currentSrc !== src && src) {
      setCurrentSrc(src);
      setIsLoaded(false);
      return;
    }
    setHasError(true);
    setIsLoaded(true);
    onLoad?.();
  };

  // Fallback for invalid/empty URLs
  if (!src || hasError) {
    return (
      <div className={`relative overflow-hidden bg-gray-200 flex items-center justify-center ${className}`} style={{ width, height }}>
        <span className="text-gray-400 text-xs">No Image</span>
      </div>
    );
  }

  // Use unoptimized for external URLs (Supabase storage, placeholders) so they always load
  const isExternal = /^https?:\/\//.test(src);
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ width, height }}>
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse z-10"></div>
      )}
      <Image
        src={currentSrc}
        alt={alt}
        fill
        sizes={sizes}
        className={`object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={handleLoad}
        onError={handleError}
        priority={priority}
        quality={75}
        unoptimized={isExternal}
      />
    </div>
  );
}
