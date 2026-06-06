import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const SEARCH_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'these',
  'those',
  'tool',
  'tools',
  'product',
  'products',
  'item',
  'items',
]);

/**
 * GET /api/storefront/shop
 * Returns products for the shop with product_images (service role so images always load).
 * Query params: search, categorySlugs (comma-separated or 'all'), priceMin, priceMax, rating, sortBy, page, limit
 */
export async function GET(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const categorySlugs = searchParams.get('categorySlugs') || 'all';
  const priceMin = parseInt(searchParams.get('priceMin') || '0', 10);
  const priceMax = parseInt(searchParams.get('priceMax') || '5000', 10);
  const rating = parseInt(searchParams.get('rating') || '0', 10);
  const sortBy = searchParams.get('sortBy') || 'popular';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') || '9', 10), 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const directCategorySlugs = categorySlugs !== 'all'
    ? categorySlugs.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  try {
    const runProductQuery = async (params: { nameSearch?: string; categoryFilterSlugs?: string[] }) => {
      const hasCategoryFilter = Boolean(params.categoryFilterSlugs && params.categoryFilterSlugs.length > 0);
      const categoryJoin = hasCategoryFilter
        ? 'product_categories!inner(category_id, categories!inner(id, name, slug, parent_id))'
        : 'product_categories(category_id, categories(id, name, slug, parent_id))';

      let query = supabaseAdmin
        .from('products')
        .select(
          `
          *,
          categories(id, name, slug, parent_id),
          ${categoryJoin},
          product_images(url, position),
          product_variants(id, name, price, quantity, option1, option2, image_url, sort_order)
        `,
          { count: 'exact' }
        )
        .eq('status', 'active');

      if (params.nameSearch?.trim()) {
        query = query.ilike('name', `%${params.nameSearch.trim()}%`);
      }

      if (hasCategoryFilter) {
        query = query.in('product_categories.categories.slug', params.categoryFilterSlugs!);
      }

      if (priceMax < 5000) {
        query = query.gte('price', priceMin).lte('price', priceMax);
      }

      if (rating > 0) {
        query = query.gte('rating_avg', rating);
      }

      switch (sortBy) {
        case 'price-low':
          query = query.order('price', { ascending: true });
          break;
        case 'price-high':
          query = query.order('price', { ascending: false });
          break;
        case 'rating':
          query = query.order('rating_avg', { ascending: false });
          break;
        case 'new':
          query = query.order('created_at', { ascending: false });
          break;
        case 'popular':
        default:
          query = query.order('created_at', { ascending: false });
          break;
      }

      query = query.range(from, to);
      return query;
    };

    const { data, error, count } = await runProductQuery({
      nameSearch: search,
      categoryFilterSlugs: directCategorySlugs,
    });

    if (error) {
      console.error('[Storefront Shop API] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const hasNoDirectResults = (count ?? 0) === 0;
    const canUseCategoryFallback = Boolean(search.trim()) && directCategorySlugs.length === 0 && hasNoDirectResults;

    if (canUseCategoryFallback) {
      const normalizedSearch = search.trim().toLowerCase();
      const searchTerms = Array.from(
        new Set(
          normalizedSearch
            .split(/[^a-z0-9]+/)
            .map((term) => term.trim())
            .filter((term) => term.length >= 3 && !SEARCH_STOP_WORDS.has(term))
        )
      );

      if (searchTerms.length > 0) {
        const { data: categoriesData, error: categoryError } = await supabaseAdmin
          .from('categories')
          .select('id, name, slug, parent_id')
          .eq('status', 'active');

        if (categoryError) {
          console.error('[Storefront Shop API] Category fallback error:', categoryError);
        } else if (categoriesData && categoriesData.length > 0) {
          const scoredMatches = categoriesData
            .map((category: any) => {
              const categoryName = String(category.name || '').toLowerCase();
              const categorySlug = String(category.slug || '').toLowerCase();
              const haystack = `${categoryName} ${categorySlug}`;

              let score = 0;
              if (categoryName.includes(normalizedSearch) || categorySlug.includes(normalizedSearch)) score += 6;
              for (const term of searchTerms) {
                if (categoryName === term || categorySlug === term) score += 4;
                else if (haystack.includes(term)) score += 2;
              }

              return { category, score };
            })
            .filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score);

          if (scoredMatches.length > 0) {
            const matchedIds = new Set(scoredMatches.map((row) => row.category.id));
            for (const category of categoriesData) {
              if (category.parent_id && matchedIds.has(category.parent_id)) {
                matchedIds.add(category.id);
              }
            }

            const fallbackSlugs = categoriesData
              .filter((category) => matchedIds.has(category.id))
              .map((category) => category.slug)
              .filter(Boolean);

            if (fallbackSlugs.length > 0) {
              const { data: fallbackData, error: fallbackError, count: fallbackCount } = await runProductQuery({
                categoryFilterSlugs: fallbackSlugs,
              });

              if (!fallbackError && (fallbackCount ?? 0) > 0) {
                return NextResponse.json(
                  { data: fallbackData || [], count: fallbackCount ?? 0, searchFallback: 'category' },
                  {
                    headers: {
                      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
                    },
                  }
                );
              }
            }
          }
        }
      }
    }

    return NextResponse.json(
      { data: data || [], count: count ?? 0 },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      }
    );
  } catch (e: any) {
    console.error('[Storefront Shop API] Error:', e);
    return NextResponse.json({ error: e?.message || 'Failed to fetch products' }, { status: 500 });
  }
}
