import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  productBelongsToCategoryIds,
  resolveCategoryIdsFromSlugs,
} from '@/lib/product-categories';
import { priceProducts } from '@/lib/pricing';
import { getStorePricing } from '@/lib/store-pricing';

// Simple in-memory cache. It holds the rows as stored (regular prices); the sale and
// discount rules are applied on every response, so a sale shows up without waiting.
let cache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Short edge cache so starting or stopping a sale reaches shoppers within about a minute.
const CACHE_HEADER = 'public, s-maxage=60, stale-while-revalidate=300';

async function withPrices(rows: any[]) {
    return priceProducts(rows, await getStorePricing(), { stripMetadata: true });
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const featured = searchParams.get('featured') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');
    const category = searchParams.get('category');
    const ids = (searchParams.get('ids') || '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => UUID.test(id))
        .slice(0, 24);

    const cacheKey = `${featured}-${limit}-${category || 'all'}`;

    if (featured && cache && cache.data?.[cacheKey] && Date.now() - cache.timestamp < CACHE_TTL) {
        return NextResponse.json(await withPrices(cache.data[cacheKey]), {
            headers: { 'Cache-Control': CACHE_HEADER, 'X-Cache': 'HIT' }
        });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
    }

    try {
        const categoryFilterIds = category
            ? await resolveCategoryIdsFromSlugs([category])
            : [];

        let query = supabaseAdmin
            .from('products')
            .select(`
                id, name, slug, price, compare_at_price, quantity, moq, rating_avg, metadata,
                categories(id, name, slug),
                product_categories(category_id, categories(id, name, slug)),
                product_images(url, position),
                product_variants(id, name, price, compare_at_price, quantity, metadata)
            `)
            .order('created_at', { ascending: false })
            .eq('status', 'active');

        if (featured) {
            query = query.eq('featured', true);
        }

        if (category) {
            if (categoryFilterIds.length === 0) {
                return NextResponse.json([]);
            }
            query = supabaseAdmin
                .from('products')
                .select(`
                    id, name, slug, price, compare_at_price, quantity, moq, rating_avg, metadata,
                    categories(id, name, slug),
                    product_categories!inner(category_id, categories!inner(id, name, slug)),
                    product_images(url, position),
                    product_variants(id, name, price, compare_at_price, quantity, metadata)
                `)
                .order('created_at', { ascending: false })
                .eq('status', 'active')
                .in('product_categories.category_id', categoryFilterIds);
            if (featured) {
                query = query.eq('featured', true);
            }
        }

        if (ids.length > 0) {
            query = query.in('id', ids);
        }

        query = query.limit(limit);

        const { data, error } = await query;

        if (error) {
            console.error('[Storefront API] Products error:', error);
            return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
        }

        const safeData = categoryFilterIds.length > 0
            ? (data || []).filter((product) => productBelongsToCategoryIds(product, categoryFilterIds))
            : (data || []);

        if (ids.length === 0) {
            if (!cache) cache = { data: {}, timestamp: Date.now() };
            cache.data[cacheKey] = safeData;
            cache.timestamp = Date.now();
        }

        return NextResponse.json(await withPrices(safeData), {
            headers: { 'Cache-Control': CACHE_HEADER, 'X-Cache': 'MISS' }
        });
    } catch (err: any) {
        console.error('[Storefront API] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
