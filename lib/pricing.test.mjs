import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Node 20 cannot import TypeScript, so the real file is compiled in memory first.
const source = readFileSync(new URL('./pricing.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { priceProduct, readSale, resolveLinePrice, resolvePrice, summarizeSale } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

const percent = (value, live = true) => ({ sale: { type: 'percent', value, live } });
const fixed = (value, live = true) => ({ sale: { type: 'fixed', value, live } });

test('no sale: regular price, and compare-at only when it is higher', () => {
  assert.deepEqual(resolvePrice({ regular: 100, compareAt: 120 }), { price: 100, compareAt: 120, onSale: false });
  assert.deepEqual(resolvePrice({ regular: 100, compareAt: 80 }), { price: 100, compareAt: null, onSale: false });
});

test('a live percentage sale lowers the price and shows the regular price crossed out', () => {
  assert.equal(resolveLinePrice({ price: 200, metadata: percent(25) }, null), 150);
  const priced = priceProduct({ price: 200, compare_at_price: 260, metadata: percent(25) });
  assert.equal(priced.price, 150);
  assert.equal(priced.compare_at_price, 200);
  assert.equal(priced.regular_price, 200);
  assert.equal(priced.on_sale, true);
});

test('a switched-off sale charges the regular price but is remembered', () => {
  const product = { price: 200, metadata: percent(25, false) };
  assert.equal(resolveLinePrice(product, null), 200);
  assert.equal(priceProduct(product).on_sale, false);
  assert.deepEqual(summarizeSale(product), { regular: 200, sale: 150, percentOff: 25, hasSale: true, live: false, type: 'percent' });
});

test('a fixed sale price must be below the regular price', () => {
  assert.equal(resolveLinePrice({ price: 60, metadata: fixed(45) }, null), 45);
  assert.equal(resolveLinePrice({ price: 60, metadata: fixed(60) }, null), 60);
  assert.equal(summarizeSale({ price: 60, metadata: fixed(75) }).hasSale, false);
});

test('prices round to pesewas', () => {
  assert.equal(resolveLinePrice({ price: 19.99, metadata: percent(15) }, null), 16.99);
});

test('malformed sale notes are ignored', () => {
  assert.equal(readSale(null), null);
  assert.equal(readSale({ sale: { type: 'percent', value: 100, live: true } }), null);
  assert.equal(readSale({ sale: { type: 'bogus', value: 10, live: true } }), null);
  assert.equal(readSale({ sale: { type: 'percent', value: 10, live: 'yes' } }).live, false);
  assert.equal(resolveLinePrice({ price: 50, metadata: { sale: 'half price' } }, null), 50);
});

test('a percentage sale prices every option from its own regular price', () => {
  const product = {
    price: 100,
    metadata: percent(50),
    product_variants: [{ id: 'a', price: 60, metadata: { color_hex: '#000' } }, { id: 'b', price: 0 }, { id: 'c', price: 150 }],
  };
  const priced = priceProduct(product, { stripMetadata: true });
  assert.deepEqual(priced.product_variants.map((v) => [v.price, v.compare_at_price]), [[30, 60], [50, 100], [75, 150]]);
  // The card shows "From" the cheapest option, with that option's regular price crossed out.
  assert.equal(priced.compare_at_price, 60);
  assert.equal('metadata' in priced, false);
  assert.equal('metadata' in priced.product_variants[0], false);
  // The row from the database is left alone.
  assert.equal(product.product_variants[0].price, 60);
});

test('variant prices: each option sells at its own sale price, the rest stay regular', () => {
  const product = {
    price: 100,
    metadata: { sale: { type: 'variants', value: 0, live: true } },
    product_variants: [
      { id: 'a', price: 100, metadata: { sale_price: 70 } },
      { id: 'b', price: 120, metadata: {} },
      { id: 'c', price: 60, metadata: { sale_price: 80 } },
    ],
  };
  assert.equal(resolveLinePrice(product, product.product_variants[0]), 70);
  assert.equal(resolveLinePrice(product, product.product_variants[1]), 120);
  // A sale price that is not lower than the option's price is ignored.
  assert.equal(resolveLinePrice(product, product.product_variants[2]), 60);
  assert.deepEqual(summarizeSale(product), { regular: 100, sale: 70, percentOff: 30, hasSale: true, live: true, type: 'variants' });
});

test('a variant sale price left behind does nothing under another kind of sale', () => {
  const product = { price: 100, metadata: percent(10), product_variants: [{ id: 'a', price: 100, metadata: { sale_price: 20 } }] };
  assert.equal(resolveLinePrice(product, product.product_variants[0]), 90);
  const none = { price: 100, metadata: {}, product_variants: [{ id: 'a', price: 100, metadata: { sale_price: 20 } }] };
  assert.equal(resolveLinePrice(none, none.product_variants[0]), 100);
});

test('a fixed price does not apply to a product with options', () => {
  const product = { price: 100, metadata: fixed(50), product_variants: [{ id: 'a', price: 100 }] };
  assert.equal(resolveLinePrice(product, product.product_variants[0]), 100);
  assert.equal(summarizeSale(product).hasSale, false);
});

test('a product with nothing running comes back unchanged', () => {
  const priced = priceProduct({ price: 45, compare_at_price: 60, metadata: {}, product_variants: [] });
  assert.equal(priced.price, 45);
  assert.equal(priced.compare_at_price, 60);
  assert.equal(priced.on_sale, false);
});
