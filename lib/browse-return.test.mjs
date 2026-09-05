import { test } from 'node:test';
import assert from 'node:assert/strict';

function browseKey(pathname, search = '') {
  const query = search.startsWith('?') ? search : search ? `?${search}` : '';
  return `${pathname}${query}`;
}

test('browseKey keeps shop filters in the return path', () => {
  assert.equal(browseKey('/shop', '?category=Wig Tools'), '/shop?category=Wig Tools');
  assert.equal(browseKey('/shop', ''), '/shop');
});
