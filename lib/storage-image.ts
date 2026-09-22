const PUBLIC_RENDER = /\/storage\/v1\/render\/image\/public\//i;

type ResizeMode = 'cover' | 'contain';

/**
 * Product files are already resized before they are stored.
 * The on-server resizer is uncached and slow on this host, and it
 * refuses very large phone photos, which showed up as a broken image.
 * Always use the stored file. If a URL still points at the resizer,
 * send it back to the stored file.
 */
export function storageImageUrl(
  url: string | null | undefined,
  _opts?: { width?: number; height?: number; resize?: ResizeMode }
): string {
  const src = String(url ?? '').trim();
  if (!src || !PUBLIC_RENDER.test(src)) return src;

  const objectUrl = src.replace(
    '/storage/v1/render/image/public/',
    '/storage/v1/object/public/'
  );

  try {
    const parsed = new URL(objectUrl);
    parsed.searchParams.delete('width');
    parsed.searchParams.delete('height');
    parsed.searchParams.delete('resize');
    parsed.searchParams.delete('quality');
    const query = parsed.searchParams.toString();
    return query ? `${parsed.origin}${parsed.pathname}?${query}` : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return objectUrl.split('?')[0];
  }
}

/** If a derived URL fails, show the original file instead of a broken image. */
export function originalOnError(
  event: { currentTarget: HTMLImageElement },
  original: string | null | undefined
) {
  const img = event.currentTarget;
  const fallback = String(original ?? '').trim();
  if (!fallback || img.dataset.fallback === '1') return;
  img.dataset.fallback = '1';
  if (img.src !== fallback) img.src = fallback;
}
