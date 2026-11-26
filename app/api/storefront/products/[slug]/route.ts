import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { priceProduct } from '@/lib/pricing';
import { getStorePricing } from '@/lib/store-pricing';

/**
 * GET /api/storefront/products/[slug]
 * Returns a single product by slug with variants and images (service role, so variants always load).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!slug) {
    return NextResponse.json({ error: 'Slug required' }, { status: 400 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
  }

  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);

    let query = supabaseAdmin
      .from('products')
      .select(`
        *,
        categories(name, slug),
        product_categories(category_id, is_primary, categories(name, slug)),
        product_variants(id, name, price, compare_at_price, quantity, option1, option2, image_url, sku, metadata, sort_order),
        product_images(url, position, alt_text, media_type)
      `)
      .eq('status', 'active');

    if (isUUID) {
      query = query.or(`id.eq.${slug},slug.eq.${slug}`);
    } else {
      query = query.eq('slug', slug);
    }

    const { data: productData, error } = await query.single();

    if (error || !productData) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Sort variants by sort_order
    if (productData.product_variants) {
      productData.product_variants.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    // Sale and discount rules decide the price the shopper sees and adds to the cart.
    const priced = priceProduct(productData, await getStorePricing());

    return NextResponse.json(priced, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (err: any) {
    console.error('[Storefront API] Product by slug error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
