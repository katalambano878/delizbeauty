const PUBLIC_OBJECT = /\/storage\/v1\/object\/public\//i;
const PUBLIC_RENDER = /\/storage\/v1\/render\/image\/public\//i;

type ResizeMode = 'cover' | 'contain';

/**
 * Point self-hosted Supabase public object URLs at the image renderer so
 * product/variant thumbs are not the original 2–4k phone photos.
 */
export function storageImageUrl(
  url: string | null | undefined,
  opts?: { width?: number; height?: number; resize?: ResizeMode }
): string {
  const src = String(url ?? '').trim();
  if (!src) return '';

  const width = opts?.width;
  if (!width || (!PUBLIC_OBJECT.test(src) && !PUBLIC_RENDER.test(src))) {
    return src;
  }

  const height = opts?.height ?? width;
  const resize = opts?.resize === 'contain' ? 'contain' : 'cover';
  const transformed = src.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/'
  );

  try {
    const parsed = new URL(transformed);
    parsed.searchParams.set('width', String(width));
    parsed.searchParams.set('height', String(height));
    parsed.searchParams.set('resize', resize);
    return parsed.toString();
  } catch {
    const joiner = transformed.includes('?') ? '&' : '?';
    return `${transformed}${joiner}width=${width}&height=${height}&resize=${resize}`;
  }
}
