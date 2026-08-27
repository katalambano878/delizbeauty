import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  productBelongsToCategoryIds,
  resolveCategoryIdsFromSlugs,
} from '@/lib/product-categories';

// Simple in-memory cache
let cache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const featured = searchParams.get('featured') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');
    const category = searchParams.get('category');

    const cacheKey = `${featured}-${limit}-${category || 'all'}`;

    if (featured && cache && cache.data?.[cacheKey] && Date.now() - cache.timestamp < CACHE_TTL) {
        return NextResponse.json(cache.data[cacheKey], {
            headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800', 'X-Cache': 'HIT' }
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
                id, name, slug, price, compare_at_price, quantity,
                categories(id, name, slug),
                product_categories(category_id, categories(id, name, slug)),
                product_images(url, position),
                product_variants(id, name, price, quantity)
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
                    id, name, slug, price, compare_at_price, quantity,
                    categories(id, name, slug),
                    product_categories!inner(category_id, categories!inner(id, name, slug)),
                    product_images(url, position),
                    product_variants(id, name, price, quantity)
                `)
                .order('created_at', { ascending: false })
                .eq('status', 'active')
                .in('product_categories.category_id', categoryFilterIds);
            if (featured) {
                query = query.eq('featured', true);
            }
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

        if (!cache) cache = { data: {}, timestamp: Date.now() };
        cache.data[cacheKey] = safeData;
        cache.timestamp = Date.now();

        return NextResponse.json(safeData, {
            headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800', 'X-Cache': 'MISS' }
        });
    } catch (err: any) {
        console.error('[Storefront API] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
