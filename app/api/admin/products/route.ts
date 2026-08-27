import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  formatProductCategoryNames,
  normalizeCategoryIds,
  syncProductCategories,
} from '@/lib/product-categories';

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

// Inline SVG placeholder served as a data URI. This avoids depending on a
// third-party image host (which can be slow/blocked on mobile networks and
// also gets intercepted by the PWA service worker) for products that have
// not had an image uploaded yet.
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">' +
      '<rect width="160" height="160" fill="#f3f4f6"/>' +
      '<g fill="none" stroke="#9ca3af" stroke-width="2">' +
        '<rect x="32" y="40" width="96" height="72" rx="6"/>' +
        '<path d="M40 96l24-22 18 16 14-12 24 22"/>' +
        '<circle cx="58" cy="62" r="5"/>' +
      '</g>' +
      '<text x="80" y="134" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="#9ca3af" text-anchor="middle">No image</text>' +
    '</svg>'
  );

/**
 * GET /api/admin/products
 * Returns products with product_images (and categories, variant count) using service role.
 * Use this in the admin products list so images always load regardless of RLS.
 */
export async function GET(request: Request) {
  const err = await requireAdmin(request);
  if (err) return err;

  try {
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get('sortBy') || 'newest';

    let query = supabaseAdmin
      .from('products')
      .select(`
        id, name, slug, sku, price, quantity, status, created_at, metadata, rating_avg, category_id,
        categories(name),
        product_categories(category_id, is_primary, categories(name)),
        product_variants(count)
      `);

    if (sortBy === 'newest') query = query.order('created_at', { ascending: false });
    if (sortBy === 'price_asc') query = query.order('price', { ascending: true });
    if (sortBy === 'price_desc') query = query.order('price', { ascending: false });
    if (sortBy === 'name') query = query.order('name', { ascending: true });
    if (sortBy === 'stock') query = query.order('quantity', { ascending: true });

    const { data, error } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const thumbByProduct = new Map<string, string>();
    const { data: images } = await supabaseAdmin
      .from('product_images')
      .select('product_id, url, position')
      .order('position', { ascending: true });
    for (const img of images || []) {
      if (!img?.product_id || !img?.url || thumbByProduct.has(img.product_id)) continue;
      thumbByProduct.set(img.product_id, img.url);
    }

    const products = (data || []).map((p: any) => {
      const firstImageUrl = thumbByProduct.get(p.id) || PLACEHOLDER_IMAGE;
      return {
        ...p,
        category: formatProductCategoryNames(p),
        image: firstImageUrl,
        product_images: firstImageUrl === PLACEHOLDER_IMAGE ? [] : [{ url: firstImageUrl, position: 0 }],
        variantsCount: p.product_variants?.[0]?.count || 0,
        stock: p.quantity,
        sales: 0,
        rating: p.rating_avg || 0,
      };
    });

    return NextResponse.json(products);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch products' }, { status: 500 });
  }
}

/**
 * POST /api/admin/products
 * Creates a new product + variants using the service role (bypasses RLS).
 * Handles duplicate slug by appending a numeric suffix.
 */
export async function POST(request: Request) {
  const err = await requireAdmin(request);
  if (err) return err;

  try {
    const body = await request.json();
    const { variants = [], category_ids: rawCategoryIds, ...productData } = body;
    const categoryIds = normalizeCategoryIds(rawCategoryIds ?? productData.category_id);
    if (categoryIds.length === 0) {
      return NextResponse.json({ error: 'At least one category is required' }, { status: 400 });
    }
    productData.category_id = categoryIds[0];

    // Ensure slug is unique
    let slug: string = productData.slug || productData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    let slugCandidate = slug;
    let attempt = 1;
    while (true) {
      const { data: existing } = await supabaseAdmin
        .from('products')
        .select('id')
        .eq('slug', slugCandidate)
        .maybeSingle();
      if (!existing) break;
      attempt++;
      slugCandidate = `${slug}-${attempt}`;
    }
    productData.slug = slugCandidate;

    const { data: newProduct, error: insertError } = await supabaseAdmin
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (insertError || !newProduct) {
      return NextResponse.json({ error: insertError?.message || 'Failed to create product' }, { status: 500 });
    }

    const { error: categoryError } = await syncProductCategories(newProduct.id, categoryIds);
    if (categoryError) {
      return NextResponse.json({ error: categoryError }, { status: 500 });
    }

    // Insert variants if any
    if (variants.length > 0) {
      const variantInserts = variants.map((v: any, idx: number) => ({
        product_id: newProduct.id,
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

    return NextResponse.json({ id: newProduct.id, slug: newProduct.slug });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create product' }, { status: 500 });
  }
}
