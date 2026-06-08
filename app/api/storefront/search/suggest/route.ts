import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  buildProductTextOrFilter,
  expandSearchTerms,
  rankSearchResults,
  scoreCategoryMatch,
  tokenizeSearchQuery,
} from '@/lib/product-search';

const PRODUCT_SELECT = `
  id,
  name,
  slug,
  price,
  compare_at_price,
  categories(name, slug),
  product_categories(categories(name, slug)),
  product_images(url, position)
`;

/**
 * GET /api/storefront/search/suggest?q=nail&limit=8
 * Fast typeahead suggestions for header / mobile search.
 */
export async function GET(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || searchParams.get('search') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '8', 10), 12);

  if (!query.trim()) {
    return NextResponse.json({ products: [], categories: [] });
  }

  try {
    const tokens = tokenizeSearchQuery(query);
    const fallbackToken = query.trim().length >= 2 ? query.trim().toLowerCase() : '';
    const effectiveTokens = tokens.length > 0 ? tokens : fallbackToken ? [fallbackToken] : [];

    if (effectiveTokens.length === 0) {
      return NextResponse.json({ products: [], categories: [] });
    }

    const expandedTerms = expandSearchTerms(effectiveTokens);
    const orFilter = buildProductTextOrFilter(expandedTerms);

    const [textResult, categoriesResult] = await Promise.all([
      supabaseAdmin
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('status', 'active')
        .or(orFilter)
        .limit(120),
      supabaseAdmin
        .from('categories')
        .select('id, name, slug')
        .eq('status', 'active'),
    ]);

    if (textResult.error) {
      return NextResponse.json({ error: textResult.error.message }, { status: 500 });
    }

    const scoredCategories = (categoriesResult.data || [])
      .map((category) => ({
        category,
        score: scoreCategoryMatch(category, query, effectiveTokens, expandedTerms),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);

    let categoryProducts: any[] = [];
    if (scoredCategories.length > 0) {
      const categoryIds = scoredCategories.slice(0, 3).map((row) => row.category.id);
      const { data } = await supabaseAdmin
        .from('products')
        .select(PRODUCT_SELECT.replace(
          'product_categories(category_id, categories(name, slug))',
          'product_categories!inner(category_id, categories!inner(name, slug))'
        ))
        .eq('status', 'active')
        .in('product_categories.category_id', categoryIds)
        .limit(60);
      categoryProducts = data || [];
    }

    const merged = new Map<string, any>();
    for (const product of [...(textResult.data || []), ...categoryProducts]) {
      merged.set(product.id, product);
    }

    const rankedProducts = rankSearchResults(
      Array.from(merged.values()),
      query,
      effectiveTokens,
      expandedTerms
    )
      .slice(0, limit)
      .map((product) => {
        const images = Array.isArray(product.product_images)
          ? [...product.product_images].sort(
              (a: any, b: any) => (Number(a.position) ?? 0) - (Number(b.position) ?? 0)
            )
          : [];
        const categoryNames = new Set<string>();
        if (product.categories?.name) categoryNames.add(product.categories.name);
        for (const row of product.product_categories || []) {
          if (row?.categories?.name) categoryNames.add(row.categories.name);
        }

        return {
          id: product.id,
          slug: product.slug,
          name: product.name,
          price: product.price,
          compare_at_price: product.compare_at_price,
          image:
            images.find((img: any) => Number(img.position) === 0)?.url ||
            images[0]?.url ||
            null,
          categories: Array.from(categoryNames),
          searchScore: product.searchScore,
        };
      });

    const categories = scoredCategories
      .slice(0, 5)
      .map(({ category }) => ({ id: category.id, name: category.name, slug: category.slug }));

    return NextResponse.json(
      { products: rankedProducts, categories },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
        },
      }
    );
  } catch (e: any) {
    console.error('[Storefront Search Suggest API] Error:', e);
    return NextResponse.json({ error: e?.message || 'Failed to fetch suggestions' }, { status: 500 });
  }
}
