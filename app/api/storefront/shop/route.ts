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
  *,
  categories(id, name, slug, parent_id),
  product_categories(category_id, categories(id, name, slug, parent_id)),
  product_images(url, position),
  product_variants(id, name, price, quantity, option1, option2, image_url, sort_order, sku)
`;

const PRODUCT_SELECT_CATEGORY_INNER = `
  *,
  categories(id, name, slug, parent_id),
  product_categories!inner(category_id, categories!inner(id, name, slug, parent_id)),
  product_images(url, position),
  product_variants(id, name, price, quantity, option1, option2, image_url, sort_order, sku)
`;

function applyPriceAndRating<T extends { price?: number; rating_avg?: number }>(
  products: T[],
  priceMin: number,
  priceMax: number,
  rating: number
): T[] {
  return products.filter((product) => {
    const price = Number(product.price ?? 0);
    if (priceMax < 5000 && (price < priceMin || price > priceMax)) return false;
    if (rating > 0 && Number(product.rating_avg ?? 0) < rating) return false;
    return true;
  });
}

function sortProducts(products: any[], sortBy: string, useRelevance: boolean) {
  if (useRelevance) {
    return products.sort((a, b) => {
      const scoreDiff = (b.searchScore ?? 0) - (a.searchScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  switch (sortBy) {
    case 'price-low':
      return products.sort((a, b) => Number(a.price) - Number(b.price));
    case 'price-high':
      return products.sort((a, b) => Number(b.price) - Number(a.price));
    case 'rating':
      return products.sort((a, b) => Number(b.rating_avg ?? 0) - Number(a.rating_avg ?? 0));
    case 'new':
      return products.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    case 'popular':
    default:
      return products.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }
}

async function fetchProductsByCategoryIds(categoryIds: string[]) {
  if (categoryIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('products')
    .select(PRODUCT_SELECT_CATEGORY_INNER)
    .eq('status', 'active')
    .in('product_categories.category_id', categoryIds)
    .limit(500);

  if (error) {
    console.error('[Storefront Shop API] Category product search error:', error);
    return [];
  }

  return data || [];
}

async function runSmartSearch(params: {
  search: string;
  categoryFilterSlugs: string[];
  priceMin: number;
  priceMax: number;
  rating: number;
  sortBy: string;
  page: number;
  limit: number;
}) {
  const { search, categoryFilterSlugs, priceMin, priceMax, rating, sortBy, page, limit } = params;
  const tokens = tokenizeSearchQuery(search);
  const fallbackToken = search.trim().length >= 2 ? search.trim().toLowerCase() : '';
  const effectiveTokens = tokens.length > 0 ? tokens : fallbackToken ? [fallbackToken] : [];

  if (effectiveTokens.length === 0) {
    return { data: [], count: 0 };
  }

  const expandedTerms = expandSearchTerms(effectiveTokens);
  const orFilter = buildProductTextOrFilter(expandedTerms);

  const [textResult, categoriesResult] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('status', 'active')
      .or(orFilter)
      .limit(500),
    supabaseAdmin
      .from('categories')
      .select('id, name, slug, parent_id')
      .eq('status', 'active'),
  ]);

  if (textResult.error) {
    throw new Error(textResult.error.message);
  }

  const categoriesData = categoriesResult.data || [];
  const scoredCategories = categoriesData
    .map((category) => ({
      category,
      score: scoreCategoryMatch(category, search, effectiveTokens, expandedTerms),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const matchedCategoryIds = new Set<string>(scoredCategories.map((row) => row.category.id));
  for (const category of categoriesData) {
    if (category.parent_id && matchedCategoryIds.has(category.parent_id)) {
      matchedCategoryIds.add(category.id);
    }
  }

  let categoryMatchedProducts: any[] = [];
  if (matchedCategoryIds.size > 0) {
    categoryMatchedProducts = await fetchProductsByCategoryIds(Array.from(matchedCategoryIds));
  }

  const merged = new Map<string, any>();
  for (const product of [...(textResult.data || []), ...categoryMatchedProducts]) {
    merged.set(product.id, product);
  }

  let ranked = rankSearchResults(Array.from(merged.values()), search, effectiveTokens, expandedTerms);

  if (categoryFilterSlugs.length > 0) {
    ranked = ranked.filter((product) => {
      const slugs = new Set<string>();
      if (product.categories?.slug) slugs.add(product.categories.slug);
      for (const row of product.product_categories || []) {
        if (row?.categories?.slug) slugs.add(row.categories.slug);
      }
      return categoryFilterSlugs.some((slug) => slugs.has(slug));
    });
  }

  ranked = applyPriceAndRating(ranked, priceMin, priceMax, rating);
  ranked = sortProducts(ranked, sortBy, true);

  const total = ranked.length;
  const from = (page - 1) * limit;
  const paginated = ranked.slice(from, from + limit);

  return {
    data: paginated,
    count: total,
    searchMode: 'smart' as const,
    matchedCategories: scoredCategories.slice(0, 5).map((row) => row.category.name),
  };
}

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
  const directCategorySlugs =
    categorySlugs !== 'all'
      ? categorySlugs.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  try {
    if (search.trim()) {
      const smartResult = await runSmartSearch({
        search,
        categoryFilterSlugs: directCategorySlugs,
        priceMin,
        priceMax,
        rating,
        sortBy,
        page,
        limit,
      });

      return NextResponse.json(smartResult, {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      });
    }

    const hasCategoryFilter = directCategorySlugs.length > 0;
    const categoryJoin = hasCategoryFilter
      ? 'product_categories!inner(category_id, categories!inner(id, name, slug, parent_id))'
      : 'product_categories(category_id, categories(id, name, slug, parent_id))';

    let query = supabaseAdmin
      .from('products')
      .select(PRODUCT_SELECT, { count: 'exact' })
      .eq('status', 'active');

    if (hasCategoryFilter) {
      query = query.in('product_categories.categories.slug', directCategorySlugs);
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

    const { data, error, count } = await query;

    if (error) {
      console.error('[Storefront Shop API] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
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
