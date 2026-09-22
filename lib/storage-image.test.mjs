import { test } from 'node:test';
import assert from 'node:assert/strict';

function storageImageUrl(url) {
  const PUBLIC_RENDER = /\/storage\/v1\/render\/image\/public\//i;
  const src = String(url ?? '').trim();
  if (!src || !PUBLIC_RENDER.test(src)) return src;
  const objectUrl = src.replace('/storage/v1/render/image/public/', '/storage/v1/object/public/');
  const parsed = new URL(objectUrl);
  parsed.searchParams.delete('width');
  parsed.searchParams.delete('height');
  parsed.searchParams.delete('resize');
  parsed.searchParams.delete('quality');
  const query = parsed.searchParams.toString();
  return query ? `${parsed.origin}${parsed.pathname}?${query}` : `${parsed.origin}${parsed.pathname}`;
}

test('keeps stored product files on the direct URL', () => {
  const src = 'https://supabase.doctorbarns.com/storage/v1/object/public/products/cat-1.jpeg';
  assert.equal(storageImageUrl(src, { width: 64, height: 64 }), src);
});

test('sends resizer URLs back to the stored file', () => {
  const out = storageImageUrl(
    'https://supabase.doctorbarns.com/storage/v1/render/image/public/products/cat-1.jpeg?width=900&height=900&resize=cover'
  );
  assert.equal(out, 'https://supabase.doctorbarns.com/storage/v1/object/public/products/cat-1.jpeg');
});

test('leaves non-storage URLs alone', () => {
  assert.equal(storageImageUrl('https://via.placeholder.com/80', { width: 64 }), 'https://via.placeholder.com/80');
});

test('returns empty string for missing urls', () => {
  assert.equal(storageImageUrl('', { width: 64 }), '');
  assert.equal(storageImageUrl(null, { width: 64 }), '');
});
