import { test } from 'node:test';
import assert from 'node:assert/strict';

// Keep the resolver in TypeScript for the app. These tests exercise the same
// matching rules against a local copy so `node --test` works without tsx.
function norm(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function nonEmpty(value) {
  return String(value ?? '').trim();
}
function variantLabels(variant) {
  const name = nonEmpty(variant.name);
  const option1 = nonEmpty(variant.option1);
  const option2 = nonEmpty(variant.option2);
  return [
    name,
    option1,
    option2,
    option2 && name ? `${option2} / ${name}` : '',
    name && option2 ? `${name} / ${option2}` : '',
    option1 && name && option1 !== name ? `${option1} / ${name}` : '',
    name && option1 && option1 !== name ? `${name} / ${option1}` : '',
    option2 && option1 ? `${option2} / ${option1}` : '',
    option1 && option2 ? `${option1} / ${option2}` : '',
  ].filter(Boolean);
}
function matchProductVariant(variants, variantName, variantId) {
  const list = Array.isArray(variants) ? variants : [];
  if (variantId) {
    const byId = list.find((variant) => variant.id === variantId);
    if (byId) return byId;
  }
  const wanted = norm(variantName);
  if (!wanted) return null;
  return list.find((variant) => variantLabels(variant).some((label) => norm(label) === wanted)) || null;
}
function resolveOrderItemImage(item) {
  const variants = [
    ...(Array.isArray(item.product_variants) ? item.product_variants : item.product_variants ? [item.product_variants] : []),
    ...(item.products?.product_variants || []),
  ];
  const variant = matchProductVariant(variants, item.variant_name, item.variant_id);
  if (nonEmpty(variant?.image_url)) return variant.image_url;
  if (nonEmpty(item.metadata?.image)) return item.metadata.image;
  const images = [...(item.products?.product_images || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return images.find((image) => nonEmpty(image.url))?.url || null;
}

const tweezers = [
  { id: 'v3', name: 'Option 3', option1: 'Option 3', image_url: 'https://img/opt3.jpg', sku: 'TW-3' },
  { id: 'v5', name: 'Option 5', option1: 'Option 5', image_url: 'https://img/opt5.jpg', sku: 'TW-5' },
  { id: 'v6', name: 'Option 6', option1: 'Option 6', image_url: 'https://img/opt6.jpg', sku: 'TW-6' },
];

test('matches Option N variants and prefers that photo over the product gallery', () => {
  const image = resolveOrderItemImage({
    variant_name: 'Option 5',
    metadata: { image: 'https://img/cart-copy.jpg' },
    products: {
      product_images: [{ url: 'https://img/group.jpg', position: 0 }],
      product_variants: tweezers,
    },
  });
  assert.equal(image, 'https://img/opt5.jpg');
});

test('matches Color / Name labels like Pink / Pink', () => {
  const variant = matchProductVariant(
    [{ id: 'pink', name: 'Pink', option2: 'Pink', image_url: 'https://img/pink.jpg' }],
    'Pink / Pink'
  );
  assert.equal(variant?.id, 'pink');
});

test('falls back to stored cart image when the variant has no photo', () => {
  const image = resolveOrderItemImage({
    variant_name: 'Pink / Pink',
    metadata: { image: 'https://img/group.jpg' },
    products: {
      product_images: [{ url: 'https://img/group.jpg', position: 0 }],
      product_variants: [{ name: 'Pink', option2: 'Pink', image_url: '' }],
    },
  });
  assert.equal(image, 'https://img/group.jpg');
});

test('uses variant_id when present even if the label is messy', () => {
  const variant = matchProductVariant(tweezers, 'whatever', 'v3');
  assert.equal(variant?.image_url, 'https://img/opt3.jpg');
});
