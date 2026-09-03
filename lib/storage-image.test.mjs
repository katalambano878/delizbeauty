import { test } from 'node:test';
import assert from 'node:assert/strict';

function storageImageUrl(url, opts) {
  const PUBLIC_OBJECT = /\/storage\/v1\/object\/public\//i;
  const PUBLIC_RENDER = /\/storage\/v1\/render\/image\/public\//i;
  const src = String(url ?? '').trim();
  if (!src) return '';
  const width = opts?.width;
  if (!width || (!PUBLIC_OBJECT.test(src) && !PUBLIC_RENDER.test(src))) return src;
  const height = opts?.height ?? width;
  const resize = opts?.resize === 'contain' ? 'contain' : 'cover';
  const transformed = src.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const parsed = new URL(transformed);
  parsed.searchParams.set('width', String(width));
  parsed.searchParams.set('height', String(height));
  parsed.searchParams.set('resize', resize);
  return parsed.toString();
}

test('rewrites public object URLs to the renderer', () => {
  const out = storageImageUrl(
    'https://supabase.doctorbarns.com/storage/v1/object/public/products/cat-1.jpeg',
    { width: 64, height: 64 }
  );
  assert.match(out, /\/storage\/v1\/render\/image\/public\/products\/cat-1.jpeg/);
  assert.match(out, /width=64/);
  assert.match(out, /height=64/);
});

test('leaves non-storage URLs alone', () => {
  assert.equal(storageImageUrl('https://via.placeholder.com/80', { width: 64 }), 'https://via.placeholder.com/80');
});

test('returns empty string for missing urls', () => {
  assert.equal(storageImageUrl('', { width: 64 }), '');
  assert.equal(storageImageUrl(null, { width: 64 }), '');
});
