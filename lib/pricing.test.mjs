import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Node 20 cannot import TypeScript, so the real file is compiled in memory first.
const source = readFileSync(new URL('./pricing.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  parseStorePricing,
  pricingMode,
  priceProduct,
  resolveLinePrice,
  resolvePrice,
  storePricingFor,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const OFF = storePricingFor('off');
const SALE = storePricingFor('sale');
const BULK20 = storePricingFor('bulk', 20);

test('no sale: regular price, and compare-at only when it is higher', () => {
  assert.deepEqual(resolvePrice({ regular: 100, compareAt: 120, pricing: OFF }), { price: 100, compareAt: 120, rule: null });
  assert.deepEqual(resolvePrice({ regular: 100, compareAt: 80, pricing: OFF }), { price: 100, compareAt: null, rule: null });
});

test('sale price shows only while the sale is on, and only when it is lower', () => {
  assert.equal(resolvePrice({ regular: 100, salePrice: 70, pricing: OFF }).price, 100);
  assert.deepEqual(resolvePrice({ regular: 100, salePrice: 70, pricing: SALE }), { price: 70, compareAt: 100, rule: 'sale' });
  assert.equal(resolvePrice({ regular: 100, salePrice: 130, pricing: SALE }).price, 100);
});

test('percentage off everything ignores sale prices and product discounts', () => {
  const r = resolvePrice({ regular: 40, salePrice: 35, markdown: { type: 'fixed', value: 30 }, pricing: BULK20 });
  assert.deepEqual(r, { price: 32, compareAt: 40, rule: 'bulk' });
});

test('a product discount beats the sale price and never stacks with it', () => {
  const r = resolvePrice({ regular: 200, salePrice: 150, markdown: { type: 'percent', value: 10 }, pricing: SALE });
  assert.deepEqual(r, { price: 180, compareAt: 200, rule: 'markdown' });
});

test('a discount that would leave nothing to charge is skipped', () => {
  assert.deepEqual(resolvePrice({ regular: 10, markdown: { type: 'fixed', value: 10 }, pricing: OFF }), { price: 10, compareAt: null, rule: null });
});

test('prices round to pesewas', () => {
  assert.equal(resolvePrice({ regular: 19.99, markdown: { type: 'percent', value: 15 }, pricing: OFF }).price, 16.99);
});

test('malformed settings mean no sale', () => {
  assert.equal(pricingMode(parseStorePricing(null)), 'off');
  assert.equal(pricingMode(parseStorePricing({ sales_active: 'yes' })), 'off');
  assert.equal(pricingMode(parseStorePricing({ sales_active: true, strict_discount: true, discount_percent: 100 })), 'off');
  assert.equal(pricingMode(parseStorePricing({ sales_active: true, strict_discount: true, discount_percent: 25 })), 'bulk');
  assert.equal(pricingMode(parseStorePricing({ sales_active: true })), 'sale');
});

test('options are priced one by one and the card shows the cheapest option', () => {
  const product = {
    id: 'p1',
    price: 100,
    compare_at_price: null,
    metadata: { discount: { type: 'percent', value: 50 } },
    product_variants: [
      { id: 'a', price: 60, metadata: { color_hex: '#000' } },
      { id: 'b', price: 0 },
      { id: 'c', price: 150 },
    ],
  };
  const priced = priceProduct(product, OFF, { stripMetadata: true });
  assert.deepEqual(priced.product_variants.map((v) => [v.price, v.compare_at_price]), [[30, 60], [50, 100], [75, 150]]);
  assert.equal(priced.price, 50);
  assert.equal(priced.compare_at_price, 60);
  assert.equal(priced.regular_price, 100);
  assert.equal(priced.on_sale, true);
  assert.equal('metadata' in priced, false);
  assert.equal('metadata' in priced.product_variants[0], false);
  // The row from the database is left alone.
  assert.equal(product.product_variants[0].price, 60);
});

test('an option uses its own sale price, then the product sale price', () => {
  const product = {
    price: 100,
    metadata: { sale_price: 80 },
    product_variants: [
      { id: 'a', price: 100, metadata: { sale_price: 70 } },
      { id: 'b', price: 120, metadata: {} },
      { id: 'c', price: 60 },
    ],
  };
  assert.equal(resolveLinePrice(product, product.product_variants[0], SALE), 70);
  assert.equal(resolveLinePrice(product, product.product_variants[1], SALE), 80);
  // The product sale price is not lower than this option, so it keeps its price.
  assert.equal(resolveLinePrice(product, product.product_variants[2], SALE), 60);
  assert.equal(resolveLinePrice(product, null, SALE), 80);
  assert.equal(resolveLinePrice(product, null, OFF), 100);
});

test('a product with nothing running comes back unchanged', () => {
  const priced = priceProduct({ price: 45, compare_at_price: 60, metadata: {}, product_variants: [] }, OFF);
  assert.equal(priced.price, 45);
  assert.equal(priced.compare_at_price, 60);
  assert.equal(priced.on_sale, false);
});
