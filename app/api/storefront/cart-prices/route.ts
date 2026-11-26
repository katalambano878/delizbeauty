import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { matchProductVariant } from '@/lib/order-item-display';
import { resolveLinePrice } from '@/lib/pricing';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/storefront/cart-prices
 * Body: { items: [{ id, variant?, variantId? }] }
 * Returns today's unit price for each cart line, in the same order, so a cart saved
 * before a sale started or ended shows what checkout will actually charge.
 * A line whose product is gone or has no price comes back with price: null.
 */
export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const items: any[] = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
    const ids = Array.from(
      new Set(items.map((item) => item?.id).filter((id) => typeof id === 'string' && UUID.test(id)))
    );

    if (ids.length === 0) {
      return NextResponse.json({ prices: items.map(() => ({ price: null })) });
    }

    const { data: products, error } = await supabaseAdmin
        .from('products')
        .select(
          'id, price, compare_at_price, metadata, status, product_variants(id, name, option1, option2, price, compare_at_price, metadata)'
        )
        .in('id', ids);

    if (error) {
      console.error('[Cart prices] products error:', error);
      return NextResponse.json({ error: 'Could not check prices' }, { status: 500 });
    }

    const productById = new Map<string, any>((products || []).map((p: any) => [p.id, p]));

    const prices = items.map((item) => {
      const product = productById.get(item?.id);
      if (!product || product.status !== 'active') return { price: null };
      const variant = matchProductVariant(product.product_variants || [], item.variant, item.variantId);
      const price = resolveLinePrice(product, variant);
      return { price: price > 0 ? price : null };
    });

    return NextResponse.json({ prices }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e: any) {
    console.error('[Cart prices] error:', e);
    return NextResponse.json({ error: 'Could not check prices' }, { status: 500 });
  }
}
