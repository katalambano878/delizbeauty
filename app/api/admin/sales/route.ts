import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  MAX_PERCENT_OFF,
  markdownLabel,
  markdownPrice,
  pricingMode,
  readMarkdown,
  readSalePrice,
  storePricingFor,
  type Markdown,
  type PricingMode,
} from '@/lib/pricing';
import { getStorePricing, saveStorePricing } from '@/lib/store-pricing';

export const dynamic = 'force-dynamic';

/**
 * Sale & discounts.
 *
 *   GET     everything the admin screen shows
 *   PUT     start or stop a whole-store sale            (administrators only)
 *   POST    put a discount on chosen products
 *   DELETE  end the discount on chosen products, or on all of them
 *
 * A product discount is a note in products.metadata.discount. The stored price is
 * never changed, so ending a discount brings the old price back exactly and a
 * second discount replaces the first instead of stacking on it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

type Actor = { name: string; isAdmin: boolean };

async function requireSales(
  request: NextRequest
): Promise<{ actor: Actor; denied?: undefined } | { actor?: undefined; denied: NextResponse }> {
  const auth = await verifyAuth(request, { requireAdmin: true });
  if (!auth.authenticated) {
    return { denied: NextResponse.json({ error: auth.error || 'Please sign in again.' }, { status: 401 }) };
  }
  const name = auth.user?.email || 'Staff';
  if (auth.role === 'admin') return { actor: { name, isAdmin: true } };

  // Staff follow the same rule as the sidebar: allowed when their role has this screen switched on.
  const { data: role } = await supabaseAdmin
    .from('roles')
    .select('permissions, enabled')
    .eq('id', auth.role)
    .maybeSingle();
  const permissions = (role?.permissions || {}) as Record<string, boolean>;
  const restricted = Object.keys(permissions).length > 0;
  if (role?.enabled === false || (restricted && permissions.sales !== true)) {
    return {
      denied: NextResponse.json(
        { error: 'Your role does not include Sale & discounts. Ask an administrator to switch it on under Roles.' },
        { status: 403 }
      ),
    };
  }
  return { actor: { name, isAdmin: false } };
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && UUID.test(v)))).slice(0, 2000);
}

/** Run a job for every item, a few at a time, so a big selection does not flood the database. */
async function inBatches<T>(items: T[], size: number, job: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(job));
  }
}

async function allProducts(select: string, ids?: string[]) {
  const rows: any[] = [];
  if (ids) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabaseAdmin.from('products').select(select).in('id', ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
    }
    return rows;
  }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(select)
      .neq('status', 'archived')
      .order('name')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function GET(request: NextRequest) {
  const { actor, denied } = await requireSales(request);
  if (denied) return denied;

  try {
    const [products, categoriesResult, pricing] = await Promise.all([
      allProducts(
        'id, name, sku, status, price, category_id, metadata, categories(name), product_images(url, position), product_variants(price, metadata)'
      ),
      supabaseAdmin.from('categories').select('id, name').eq('status', 'active').order('name'),
      getStorePricing({ fresh: true }),
    ]);

    const rows = products.map((p: any) => {
      const variants: any[] = Array.isArray(p.product_variants) ? p.product_variants : [];
      const price = Number(p.price) || 0;
      const optionPrices = variants.map((v) => Number(v.price) || price).filter((n) => n > 0);
      const images = Array.isArray(p.product_images)
        ? [...p.product_images].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
        : [];
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        status: p.status,
        price,
        // For a product with options, the range of its option prices.
        low: optionPrices.length ? Math.min(...optionPrices) : price,
        high: optionPrices.length ? Math.max(...optionPrices) : price,
        options: variants.length,
        category_id: p.category_id,
        category: p.categories?.name || null,
        image: images[0]?.url || null,
        markdown: readMarkdown(p.metadata),
        has_sale_price:
          readSalePrice(p.metadata) != null || variants.some((v) => readSalePrice(v.metadata) != null),
      };
    });

    return NextResponse.json({
      mode: pricingMode(pricing),
      percent: pricing.discount_percent,
      isAdmin: actor.isAdmin,
      maxPercent: MAX_PERCENT_OFF,
      products: rows,
      categories: categoriesResult.data || [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load products.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const { actor, denied } = await requireSales(request);
  if (denied) return denied;
  if (!actor.isAdmin) {
    return NextResponse.json(
      { error: 'Only an administrator can start or stop a whole-store sale.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const mode: PricingMode = body?.mode === 'sale' || body?.mode === 'bulk' ? body.mode : 'off';
  const percent = Math.round(Number(body?.percent) * 100) / 100;

  if (mode === 'bulk' && !(percent >= 1 && percent <= MAX_PERCENT_OFF)) {
    return NextResponse.json(
      { error: `Enter a percentage between 1 and ${MAX_PERCENT_OFF}.` },
      { status: 400 }
    );
  }

  const { error } = await saveStorePricing(storePricingFor(mode, mode === 'bulk' ? percent : 0));
  if (error) return NextResponse.json({ error }, { status: 500 });

  const message =
    mode === 'bulk'
      ? `${percent}% off everything is on. Shoppers see it within about a minute.`
      : mode === 'sale'
        ? 'Sale prices are showing. Shoppers see them within about a minute.'
        : 'The whole-store sale is off. Regular prices are back.';
  return NextResponse.json({ mode, percent: mode === 'bulk' ? percent : 0, message });
}

export async function POST(request: NextRequest) {
  const { actor, denied } = await requireSales(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const type: Markdown['type'] = body?.type === 'fixed' ? 'fixed' : 'percent';
  const value = Math.round(Number(body?.value) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: 'Enter how much to take off.' }, { status: 400 });
  }
  if (type === 'percent' && value > MAX_PERCENT_OFF) {
    return NextResponse.json({ error: `Keep the percentage at ${MAX_PERCENT_OFF} or below.` }, { status: 400 });
  }

  const productIds = cleanIds(body?.productIds);
  if (productIds.length === 0) {
    return NextResponse.json({ error: 'Choose at least one product.' }, { status: 400 });
  }

  try {
    const products = await allProducts('id, name, price, metadata, product_variants(price)', productIds);
    const markdown: Markdown = { type, value, applied_at: new Date().toISOString(), applied_by: actor.name };
    const applied: string[] = [];
    const skipped: string[] = [];
    let failed = 0;

    const eligible = products.filter((p: any) => {
      const price = Number(p.price) || 0;
      const prices = [price, ...(p.product_variants || []).map((v: any) => Number(v.price) || price)];
      // Skip a product when the discount would leave nothing to charge on every price it has.
      const works = prices.some((n) => n > 0 && markdownPrice(n, markdown) != null);
      if (!works) skipped.push(p.name);
      return works;
    });

    await inBatches(eligible, 8, async (p: any) => {
      const { error } = await supabaseAdmin
        .from('products')
        .update({ metadata: { ...(p.metadata || {}), discount: markdown }, updated_at: new Date().toISOString() })
        .eq('id', p.id);
      if (error) failed += 1;
      else applied.push(p.name);
    });

    if (applied.length === 0 && failed > 0) {
      return NextResponse.json({ error: 'The discount could not be saved. Try again.' }, { status: 500 });
    }

    const parts = [`${markdownLabel(markdown)} is on ${applied.length} product${applied.length === 1 ? '' : 's'}.`];
    if (skipped.length) {
      parts.push(
        `Left out ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''}: the discount is more than the price.`
      );
    }
    if (failed) parts.push(`${failed} could not be saved. Select them and try again.`);
    return NextResponse.json({ message: parts.join(' '), applied: applied.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The discount could not be saved.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { denied } = await requireSales(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const everything = body?.all === true;
  const productIds = everything ? undefined : cleanIds(body?.productIds);
  if (productIds && productIds.length === 0) {
    return NextResponse.json({ error: 'Choose which discounts to end.' }, { status: 400 });
  }

  try {
    const products = (await allProducts('id, metadata', productIds)).filter(
      (p: any) => p.metadata && typeof p.metadata === 'object' && 'discount' in p.metadata
    );
    let ended = 0;
    let failed = 0;

    await inBatches(products, 8, async (p: any) => {
      const { discount: _removed, ...rest } = p.metadata;
      const { error } = await supabaseAdmin
        .from('products')
        .update({ metadata: rest, updated_at: new Date().toISOString() })
        .eq('id', p.id);
      if (error) failed += 1;
      else ended += 1;
    });

    if (ended === 0 && failed > 0) {
      return NextResponse.json({ error: 'The discounts could not be ended. Try again.' }, { status: 500 });
    }
    return NextResponse.json({
      message:
        `Regular prices are back on ${ended} product${ended === 1 ? '' : 's'}.` +
        (failed ? ` ${failed} could not be changed. Try those again.` : ''),
      ended,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The discounts could not be ended.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
