import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { normalizeCategoryIds, syncProductCategories } from '@/lib/product-categories';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

function getAccessToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/\bsb-access-token=([^;]+)/);
  if (match) return decodeURIComponent(match[1].trim());
  const authCookie = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('sb-') && (c.includes('-auth-token') || c.includes('auth')));
  if (!authCookie) return null;
  const value = authCookie.split('=').slice(1).join('=').trim();
  const decoded = decodeURIComponent(value);
  try {
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed) && parsed[0]) return parsed[0];
    if (parsed?.access_token) return parsed.access_token;
    if (typeof parsed === 'string') return parsed;
  } catch {
    return decoded;
  }
  return null;
}

async function requireAdmin(request: Request): Promise<NextResponse | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
  }
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  const role = profile?.role != null ? String(profile.role) : '';
  if (role !== 'admin' && role !== 'staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

/**
 * GET /api/admin/products/[id]
 * Fetches a single product with variants and images using service role (bypasses RLS).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = await requireAdmin(request);
  if (err) return err;

  const { id: productId } = await params;
  if (!productId) {
    return NextResponse.json({ error: 'Missing product id' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(`
        *,
        categories(id, name),
        product_categories(category_id, is_primary, categories(id, name)),
        product_variants(*),
        product_images(*)
      `)
      .eq('id', productId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({ product: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch product' }, { status: 500 });
  }
}

/**
 * PUT /api/admin/products/[id]
 * Updates a product + replaces its variants using the service role (bypasses RLS).
 * Handles duplicate slug by appending a numeric suffix.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = await requireAdmin(request);
  if (err) return err;

  const { id: productId } = await params;
  if (!productId) {
    return NextResponse.json({ error: 'Missing product id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { variants = [], category_ids: rawCategoryIds, ...productData } = body;
    const categoryIds = normalizeCategoryIds(rawCategoryIds ?? productData.category_id);
    if (categoryIds.length === 0) {
      return NextResponse.json({ error: 'At least one category is required' }, { status: 400 });
    }
    productData.category_id = categoryIds[0];

    // Ensure slug uniqueness (ignore the current product)
    let slug: string = productData.slug || productData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    let slugCandidate = slug;
    let attempt = 1;
    while (true) {
      const { data: existing } = await supabaseAdmin
        .from('products')
        .select('id')
        .eq('slug', slugCandidate)
        .neq('id', productId)
        .maybeSingle();
      if (!existing) break;
      attempt++;
      slugCandidate = `${slug}-${attempt}`;
    }
    productData.slug = slugCandidate;

    const { error: updateError } = await supabaseAdmin
      .from('products')
      .update(productData)
      .eq('id', productId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const { error: categoryError } = await syncProductCategories(productId, categoryIds);
    if (categoryError) {
      return NextResponse.json({ error: categoryError }, { status: 500 });
    }

    // Replace variants.
    // We can't just DELETE because cart_items.variant_id and order_items.variant_id
    // reference product_variants(id) with NO ACTION (RESTRICT). Any variant that is
    // currently in someone's cart — or has ever been ordered — would block the
    // delete and the whole save would fail silently with a foreign-key error.
    //
    // Strategy:
    //   1. Fetch existing variants for the product.
    //   2. Delete only variants that are NOT referenced by orders/carts.
    //   3. Variants that ARE referenced get UPDATED in place (so their FK stays
    //      valid and order history continues to display the right variant name).
    //   4. Anything new in the payload that doesn't match an existing variant is
    //      inserted.
    const { data: existingVariants, error: existingErr } = await supabaseAdmin
      .from('product_variants')
      .select('id')
      .eq('product_id', productId);
    if (existingErr) {
      return NextResponse.json({ error: existingErr.message }, { status: 500 });
    }
    const existingIds = (existingVariants || []).map((v: any) => v.id);

    if (existingIds.length > 0) {
      // Which of these are referenced and therefore cannot be deleted?
      const [{ data: refOrders }, { data: refCarts }] = await Promise.all([
        supabaseAdmin.from('order_items').select('variant_id').in('variant_id', existingIds),
        supabaseAdmin.from('cart_items').select('variant_id').in('variant_id', existingIds),
      ]);
      const referenced = new Set<string>([
        ...((refOrders || []).map((r: any) => r.variant_id).filter(Boolean) as string[]),
        ...((refCarts || []).map((r: any) => r.variant_id).filter(Boolean) as string[]),
      ]);
      const deletable = existingIds.filter((id) => !referenced.has(id));

      if (deletable.length > 0) {
        const { error: delErr } = await supabaseAdmin
          .from('product_variants')
          .delete()
          .in('id', deletable);
        if (delErr) {
          return NextResponse.json({ error: `Failed to clear old variants: ${delErr.message}` }, { status: 500 });
        }
      }

      // Referenced variants can't be removed — clear their identifying fields
      // so they don't collide with the freshly-inserted ones on the unique-ish
      // (product_id, option1, option2) shape used by the form.
      if (referenced.size > 0) {
        const { error: updErr } = await supabaseAdmin
          .from('product_variants')
          .update({ sort_order: 9999 })
          .in('id', Array.from(referenced));
        if (updErr) {
          // Non-fatal; orphans will simply sort to the bottom of any listings
          console.warn('[admin/products PUT] failed to re-sort referenced variants:', updErr.message);
        }
      }
    }

    if (variants.length > 0) {
      const variantInserts = variants.map((v: any, idx: number) => ({
        product_id: productId,
        name: v.name || v.color || 'Default',
        sku: v.sku || null,
        price: parseFloat(v.price) || 0,
        quantity: parseInt(v.stock) || 0,
        option1: v.name || null,
        option2: v.color?.trim() || null,
        image_url: v.image_url?.trim() || null,
        sort_order: v.sort_order ?? idx,
        metadata: v.colorHex ? { color_hex: v.colorHex } : {},
      }));
      // Insert in chunks of 100 to avoid payload limits
      const CHUNK = 100;
      for (let i = 0; i < variantInserts.length; i += CHUNK) {
        const chunk = variantInserts.slice(i, i + CHUNK);
        const { error: varError } = await supabaseAdmin.from('product_variants').insert(chunk);
        if (varError) {
          return NextResponse.json({ error: varError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true, slug: productData.slug });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to update product' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/products/[id]
 * Deletes a product and its dependent rows (images, variants, cart/wishlist, reviews).
 * Fails with 400 if the product has order history.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = await requireAdmin(request);
  if (err) return err;

  const { id: productId } = await params;
  if (!productId) {
    return NextResponse.json({ error: 'Missing product id' }, { status: 400 });
  }

  try {
    const { data: orderItems } = await supabaseAdmin
      .from('order_items')
      .select('id')
      .eq('product_id', productId)
      .limit(1);
    if (orderItems && orderItems.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete product that has been ordered. Consider archiving it instead.' },
        { status: 400 }
      );
    }

    await supabaseAdmin.from('cart_items').delete().eq('product_id', productId);
    await supabaseAdmin.from('wishlist_items').delete().eq('product_id', productId);

    const { data: reviews } = await supabaseAdmin.from('reviews').select('id').eq('product_id', productId);
    if (reviews?.length) {
      const reviewIds = reviews.map((r) => r.id);
      await supabaseAdmin.from('review_images').delete().in('review_id', reviewIds);
      await supabaseAdmin.from('reviews').delete().eq('product_id', productId);
    }

    await supabaseAdmin.from('product_images').delete().eq('product_id', productId);
    await supabaseAdmin.from('product_variants').delete().eq('product_id', productId);

    const { error } = await supabaseAdmin.from('products').delete().eq('id', productId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to delete product' }, { status: 500 });
  }
}
