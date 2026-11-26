import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { priceProducts } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/**
 * GET /api/storefront/sale
 * Every active product whose sale is switched on, priced for the shopper.
 */
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .select(
      `id, name, slug, price, compare_at_price, quantity, moq, rating_avg, metadata,
       product_images(url, position),
       product_variants(id, name, price, compare_at_price, quantity, option2, metadata)`
    )
    .eq('status', 'active')
    .not('metadata->sale', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[Storefront Sale API] Error:', error);
    return NextResponse.json({ error: 'Could not load the sale' }, { status: 500 });
  }

  // A sale that is switched off, or no longer lower than the price, is not on the page.
  const products = priceProducts(data || [], { stripMetadata: true }).filter((p) => p.on_sale);

  return NextResponse.json(
    { products },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
  );
}
