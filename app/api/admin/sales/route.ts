import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  MAX_PERCENT_OFF,
  readSale,
  readVariantSalePrice,
  round2,
  salePriceFor,
  summarizeSale,
  variantRegularPrice,
  type Sale,
} from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/**
 * Admin Sales.
 *
 *   GET                       the Sales table: every product, its sale and its switch
 *   GET ?variants=<productId> one product's options, for the "Variant prices" editor
 *   POST { action: 'apply', mode: 'percentage', value: 1-99, productIds }
 *   POST { action: 'apply', mode: 'fixed', value: price, productIds }   products without options
 *   POST { action: 'variant_prices', productId, items: [{ variantId, price }] }
 *   POST { action: 'remove', productIds }
 *   POST { action: 'set_product_active', active, productIds }           one product's Live switch
 *   POST { action: 'set_active', active }                               the all-sales switch
 *
 * A sale is a note in products.metadata.sale; the price column is never changed, so
 * switching a sale off or removing it brings the regular price back exactly.
 * Changing a sale keeps its switch where it was. A new sale starts on when the
 * all-sales switch is on, and off when it is off.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 2000;
const PAGE = 1000;
const SALES_ACTIVE_KEY = 'sales_active';
const PRODUCT_SELECT =
  'id, name, slug, status, price, compare_at_price, metadata, categories(name), product_images(url, position), product_variants(id, name, option1, option2, price, metadata, sort_order)';

class ActionError extends Error {}

async function requireSales(request: NextRequest): Promise<{ name: string } | NextResponse> {
  const auth = await verifyAuth(request, { requireAdmin: true });
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Please sign in again.' }, { status: 401 });
  }
  const name = auth.user?.email || 'Staff';
  if (auth.role === 'admin') return { name };

  // Staff follow the same rule as the sidebar: allowed when their role has this screen switched on.
  const { data: role } = await supabaseAdmin
    .from('roles')
    .select('permissions, enabled')
    .eq('id', auth.role)
    .maybeSingle();
  const permissions = (role?.permissions || {}) as Record<string, boolean>;
  const restricted = Object.keys(permissions).length > 0;
  if (role?.enabled === false || (restricted && permissions.sales !== true)) {
    return NextResponse.json(
      { error: 'Your role does not include Sales. Ask an administrator to switch it on under Roles.' },
      { status: 403 }
    );
  }
  return { name };
}

async function getSalesActive(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('site_settings')
    .select('value')
    .eq('key', SALES_ACTIVE_KEY)
    .maybeSingle();
  // No row yet means sales have never been switched off.
  if (!data) return true;
  return data.value === true || data.value === 'true';
}

async function loadProducts(ids?: string[]): Promise<any[]> {
  const rows: any[] = [];
  if (ids) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabaseAdmin.from('products').select(PRODUCT_SELECT).in('id', ids.slice(i, i + 200));
      if (error) throw new ActionError(error.message);
      rows.push(...(data || []));
    }
    return rows;
  }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(PRODUCT_SELECT)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new ActionError(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** One row of the Sales table. */
function toRow(p: any) {
  const images = Array.isArray(p.product_images)
    ? [...p.product_images].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
    : [];
  const summary = summarizeSale(p);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    category: p.categories?.name || 'Uncategorized',
    image: images[0]?.url || null,
    variantsCount: Array.isArray(p.product_variants) ? p.product_variants.length : 0,
    regular: summary.regular,
    sale: summary.sale,
    percentOff: summary.percentOff,
    hasSale: summary.hasSale,
    live: summary.live,
  };
}

/** Run a job for every item, a few at a time, so a big selection does not flood the database. */
async function inBatches<T>(items: T[], job: (item: T) => Promise<void>, size = 8) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(job));
  }
}

async function saveMetadata(table: 'products' | 'product_variants', id: string, metadata: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from(table)
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new ActionError(error.message);
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && UUID.test(v))));
}

function variantLabel(v: any): string {
  return [v.option2, v.option1 || v.name].filter(Boolean).join(' / ') || v.name || 'Option';
}

export async function GET(request: NextRequest) {
  const who = await requireSales(request);
  if (who instanceof NextResponse) return who;

  try {
    const variantsFor = request.nextUrl.searchParams.get('variants') || '';
    if (variantsFor) {
      if (!UUID.test(variantsFor)) return NextResponse.json({ error: 'Unknown product' }, { status: 400 });
      const [product] = await loadProducts([variantsFor]);
      if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      const sale = readSale(product.metadata);
      const variants = [...(product.product_variants || [])]
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((v: any) => {
          const regular = variantRegularPrice(product, v);
          return {
            id: v.id,
            label: variantLabel(v),
            regular,
            sale: salePriceFor({ regular, sale, isVariant: true, variantSalePrice: readVariantSalePrice(v.metadata) }),
          };
        });
      return NextResponse.json({ variants });
    }

    const [products, salesActive] = await Promise.all([loadProducts(), getSalesActive()]);
    return NextResponse.json({ salesActive, products: products.map(toRow) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load products.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const who = await requireSales(request);
  if (who instanceof NextResponse) return who;

  const body = await request.json().catch(() => null);
  const action = String(body?.action || '');
  const stamp = { set_at: new Date().toISOString(), set_by: who.name };

  try {
    // The all-sales switch: every sale on, or every sale off, in one go.
    if (action === 'set_active') {
      const active = body?.active === true;
      const withSale = (await loadProducts()).filter((p) => readSale(p.metadata));
      const toChange = withSale.filter((p) => readSale(p.metadata)!.live !== active);
      await inBatches(toChange, (p) =>
        saveMetadata('products', p.id, { ...p.metadata, sale: { ...p.metadata.sale, live: active } })
      );
      const { error } = await supabaseAdmin
        .from('site_settings')
        .upsert({ key: SALES_ACTIVE_KEY, value: active, category: 'pricing' }, { onConflict: 'key' });
      if (error) throw new ActionError(error.message);
      return NextResponse.json({ success: true, action, active, changed: toChange.length });
    }

    // Each option of one product at its own sale price.
    if (action === 'variant_prices') {
      const productId = String(body?.productId || '');
      const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : [];
      if (!UUID.test(productId) || rawItems.length === 0) {
        return NextResponse.json({ error: 'No variant prices provided' }, { status: 400 });
      }
      const [product] = await loadProducts([productId]);
      if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

      const wanted = new Map<string, number>();
      for (const item of rawItems as any[]) {
        const price = round2(Number(item?.price));
        if (UUID.test(String(item?.variantId)) && Number.isFinite(price) && price > 0) wanted.set(item.variantId, price);
      }
      const existing = readSale(product.metadata);
      const keepOthers = existing?.type === 'variants';
      let updated = 0;
      let skipped = 0;
      const changes: { id: string; metadata: Record<string, unknown> }[] = [];
      for (const v of product.product_variants || []) {
        const meta = { ...(v.metadata || {}) };
        const price = wanted.get(v.id);
        if (price != null) {
          if (price < variantRegularPrice(product, v)) {
            meta.sale_price = price;
            updated += 1;
            changes.push({ id: v.id, metadata: meta });
          } else {
            skipped += 1;
          }
        } else if (!keepOthers && 'sale_price' in meta) {
          // Left over from an earlier sale of another kind: it must not come back to life.
          delete meta.sale_price;
          changes.push({ id: v.id, metadata: meta });
        }
      }
      if (updated === 0) {
        return NextResponse.json(
          { error: "A sale price must be lower than the variant's regular price." },
          { status: 400 }
        );
      }
      await inBatches(changes, (c) => saveMetadata('product_variants', c.id, c.metadata));
      const live = existing ? existing.live : await getSalesActive();
      const sale: Sale = { type: 'variants', value: 0, live, ...stamp };
      await saveMetadata('products', product.id, { ...(product.metadata || {}), sale });
      const products = (await loadProducts([productId])).map(toRow);
      return NextResponse.json({ success: true, action, updated, skipped, paused: live ? 0 : 1, products });
    }

    const rawIds: unknown = body?.productIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: 'No products selected' }, { status: 400 });
    }
    if (rawIds.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Too many products in one request (max ${MAX_IDS}). Apply in smaller batches.` },
        { status: 400 }
      );
    }
    const productIds = cleanIds(rawIds);
    if (productIds.length === 0) return NextResponse.json({ error: 'No valid product IDs' }, { status: 400 });

    const products = await loadProducts(productIds);
    const done = async (extra: Record<string, unknown>) =>
      NextResponse.json({ success: true, action, ...extra, products: (await loadProducts(productIds)).map(toRow) });

    // One product's Live switch (or the selected products').
    if (action === 'set_product_active') {
      const active = body?.active === true;
      const toChange = products.filter((p) => {
        const sale = readSale(p.metadata);
        return sale && sale.live !== active;
      });
      await inBatches(toChange, (p) =>
        saveMetadata('products', p.id, { ...p.metadata, sale: { ...p.metadata.sale, live: active } })
      );
      return done({ active, changed: toChange.length });
    }

    if (action === 'remove') {
      const toChange = products.filter((p) => p.metadata && typeof p.metadata === 'object' && 'sale' in p.metadata);
      await inBatches(toChange, (p) => {
        const { sale: _removed, ...rest } = p.metadata;
        return saveMetadata('products', p.id, rest);
      });
      return done({ changed: toChange.length });
    }

    if (action !== 'apply') return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    const mode = String(body?.mode || '');
    const value = Number(body?.value);
    if (mode !== 'percentage' && mode !== 'fixed') return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    if (!Number.isFinite(value)) return NextResponse.json({ error: 'Invalid value' }, { status: 400 });
    if (mode === 'percentage' && (value < 1 || value > MAX_PERCENT_OFF)) {
      return NextResponse.json({ error: `Discount percent must be between 1 and ${MAX_PERCENT_OFF}` }, { status: 400 });
    }
    if (mode === 'fixed' && value <= 0) {
      return NextResponse.json({ error: 'Sale price must be greater than 0' }, { status: 400 });
    }

    const salesActive = await getSalesActive();
    let paused = 0;
    const toChange: { p: any; sale: Sale }[] = [];
    for (const p of products) {
      const existing = readSale(p.metadata);
      const live = existing ? existing.live : salesActive;
      const hasOptions = (p.product_variants || []).length > 0;
      const sale: Sale =
        mode === 'percentage'
          ? { type: 'percent', value: round2(value), live, ...stamp }
          : { type: 'fixed', value: round2(value), live, ...stamp };
      // A fixed price fits one price only, and must be below the regular price.
      if (mode === 'fixed' && (hasOptions || !(sale.value < (Number(p.price) || 0)))) continue;
      if (mode === 'percentage' && !(Number(p.price) > 0) && !hasOptions) continue;
      if (!live) paused += 1;
      toChange.push({ p, sale });
    }
    await inBatches(toChange, ({ p, sale }) => saveMetadata('products', p.id, { ...(p.metadata || {}), sale }));
    return done({ mode, changed: toChange.length, skipped: productIds.length - toChange.length, paused });
  } catch (err) {
    console.error(`[admin/sales] ${action} error:`, err);
    const message = err instanceof Error ? err.message : 'Failed to update sales';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
