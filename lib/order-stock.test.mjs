import { test } from 'node:test';
import assert from 'node:assert/strict';

function isOrderItemInStock(item, product) {
  if (!product) return false;
  if (product.status && product.status !== 'active') return false;
  const tracks = product.track_quantity !== false && !product.continue_selling;
  if (!tracks) return true;
  const variant = (product.product_variants || []).find((v) =>
    v.id === (item.variant_id || item.metadata?.variant_id)
    || (item.variant_name && (v.name === item.variant_name || `${v.option2} / ${v.name}` === item.variant_name))
  );
  const onHand = Number(variant?.quantity ?? product.quantity);
  if (!Number.isFinite(onHand)) return true;
  return onHand >= (Number(item.quantity) || 0);
}

test('missing product is out of stock', () => {
  assert.equal(isOrderItemInStock({ quantity: 1, product_name: 'Glue' }, null), false);
});

test('uses quantity, not a stock column', () => {
  assert.equal(
    isOrderItemInStock({ quantity: 2, product_name: 'Glue' }, { status: 'active', quantity: 48 }),
    true
  );
});

test('too few units is out of stock', () => {
  assert.equal(
    isOrderItemInStock({ quantity: 5, product_name: 'Tape' }, { status: 'active', quantity: 2 }),
    false
  );
});

test('undefined quantity does not false-fail', () => {
  assert.equal(
    isOrderItemInStock({ quantity: 1, product_name: 'Fan' }, { status: 'active' }),
    true
  );
});

test('variant quantity is used when present', () => {
  assert.equal(
    isOrderItemInStock(
      { quantity: 1, variant_name: 'Yellow / 150ml', metadata: { variant_id: 'v1' } },
      { status: 'active', quantity: 0, product_variants: [{ id: 'v1', name: '150ml', option2: 'Yellow', quantity: 50 }] }
    ),
    true
  );
});
