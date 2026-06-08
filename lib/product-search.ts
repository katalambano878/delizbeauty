/**
 * Storefront product search — broad recall + relevance scoring.
 * Matches across name, descriptions, tags, SKU, brand, categories, and variants.
 */

export const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'for',
  'with',
  'from',
  'that',
  'this',
  'these',
  'those',
  'to',
  'in',
  'on',
  'at',
  'by',
  'of',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'it',
  'its',
  'as',
  'if',
  'but',
  'so',
  'not',
  'no',
  'yes',
  'all',
  'any',
  'some',
  'my',
  'your',
  'our',
  'their',
  'me',
  'you',
  'we',
  'they',
  'what',
  'which',
  'who',
  'when',
  'where',
  'why',
  'how',
  'buy',
  'get',
  'need',
  'want',
  'looking',
  'look',
  'find',
  'show',
  'please',
  'deliz',
  'delizbeauty',
  'beauty',
  'beautytools',
]);

/** Common beauty / hair / nails synonyms for Deliz inventory */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
  nail: ['nails', 'manicure', 'acrylic', 'gel', 'polish', 'tip', 'tips'],
  nails: ['nail', 'manicure', 'acrylic', 'gel', 'polish'],
  manicure: ['nail', 'nails', 'acrylic', 'gel'],
  acrylic: ['nail', 'nails', 'gel', 'powder'],
  gel: ['nail', 'nails', 'acrylic', 'polish'],
  polish: ['nail', 'nails', 'lacquer'],
  hair: ['wig', 'weave', 'lace', 'human', 'braid', 'braiding', 'extension'],
  wig: ['hair', 'lace', 'frontal', 'closure', 'human', 'synthetic'],
  wigs: ['wig', 'hair', 'lace'],
  weave: ['hair', 'bundle', 'bundles', 'extension'],
  lace: ['wig', 'frontal', 'closure', 'hair'],
  frontal: ['lace', 'wig', 'hair', 'closure'],
  closure: ['lace', 'wig', 'frontal', 'hair'],
  braid: ['braiding', 'hair', 'synthetic'],
  braiding: ['braid', 'hair', 'synthetic'],
  lash: ['lashes', 'eyelash', 'mink', 'strip'],
  lashes: ['lash', 'eyelash', 'mink'],
  eyelash: ['lash', 'lashes'],
  makeup: ['cosmetic', 'foundation', 'lipstick', 'powder', 'concealer'],
  cosmetic: ['makeup', 'beauty'],
  lip: ['lipstick', 'gloss', 'balm', 'liner'],
  brow: ['eyebrow', 'brow', 'microblade'],
  eyebrow: ['brow'],
  skin: ['skincare', 'serum', 'cream', 'lotion'],
  skincare: ['skin', 'serum', 'cream'],
  tool: ['tools', 'kit', 'set', 'equipment'],
  tools: ['tool', 'kit', 'set'],
  comb: ['brush', 'detangler', 'pick'],
  brush: ['comb', 'detangler'],
  dryer: ['blow', 'blowdry', 'dryer'],
  iron: ['straightener', 'flat', 'curling'],
  mannequin: ['head', 'practice', 'training', 'doll'],
  practice: ['mannequin', 'training', 'head'],
  extension: ['hair', 'weave', 'bundle'],
  bundle: ['hair', 'weave', 'extension'],
  human: ['hair', 'wig', 'virgin', 'remy'],
  synthetic: ['hair', 'braid', 'wig'],
  perfume: ['fragrance', 'scent', 'cologne'],
  fragrance: ['perfume', 'scent'],
};

const TEXT_FIELDS = [
  'name',
  'description',
  'short_description',
  'sku',
  'brand',
  'vendor',
  'seo_title',
  'seo_description',
] as const;

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function tokenizeSearchQuery(raw: string): string[] {
  const normalized = normalizeSearchText(raw);
  if (!normalized) return [];

  const tokens = normalized
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !SEARCH_STOP_WORDS.has(token));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
  }

  return unique;
}

function singularize(token: string): string | null {
  if (token.length <= 3) return null;
  if (token.endsWith('ies') && token.length > 4) return token.slice(0, -3) + 'y';
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return null;
}

function pluralize(token: string): string | null {
  if (token.length <= 2) return null;
  if (token.endsWith('y') && token.length > 3 && !/[aeiou]y$/i.test(token)) return token.slice(0, -1) + 'ies';
  if (token.endsWith('s') || token.endsWith('x') || token.endsWith('z') || token.endsWith('ch') || token.endsWith('sh')) {
    return `${token}es`;
  }
  return `${token}s`;
}

export function expandSearchTerms(tokens: string[]): string[] {
  const expanded = new Set<string>();

  for (const token of tokens) {
    expanded.add(token);

    const singular = singularize(token);
    if (singular) expanded.add(singular);

    const plural = pluralize(token);
    if (plural) expanded.add(plural);

    const synonyms = SEARCH_SYNONYMS[token] || [];
    for (const synonym of synonyms) {
      if (synonym.length >= 2) expanded.add(synonym);
    }
  }

  return Array.from(expanded);
}

export function buildProductTextOrFilter(terms: string[]): string {
  const parts: string[] = [];

  for (const term of terms) {
    const escaped = escapeIlikePattern(term);
    for (const field of TEXT_FIELDS) {
      parts.push(`${field}.ilike.%${escaped}%`);
    }
    parts.push(`tags.cs.{${term}}`);
  }

  return parts.join(',');
}

export type SearchableProduct = {
  id: string;
  name?: string | null;
  description?: string | null;
  short_description?: string | null;
  sku?: string | null;
  brand?: string | null;
  vendor?: string | null;
  tags?: string[] | null;
  seo_title?: string | null;
  seo_description?: string | null;
  categories?: { name?: string | null; slug?: string | null } | null;
  product_categories?: { categories?: { name?: string | null; slug?: string | null } | null }[] | null;
  product_variants?: {
    name?: string | null;
    option1?: string | null;
    option2?: string | null;
    sku?: string | null;
  }[] | null;
};

function getCategoryNames(product: SearchableProduct): string[] {
  const names: string[] = [];
  if (product.categories?.name) names.push(String(product.categories.name));
  for (const row of product.product_categories || []) {
    if (row?.categories?.name) names.push(String(row.categories.name));
  }
  return names;
}

function getSearchableHaystack(product: SearchableProduct): string {
  const categoryNames = getCategoryNames(product).join(' ');
  const tagText = (product.tags || []).join(' ');
  const variantText = (product.product_variants || [])
    .map((variant) => [variant.name, variant.option1, variant.option2, variant.sku].filter(Boolean).join(' '))
    .join(' ');

  return normalizeSearchText(
    [
      product.name,
      product.description,
      product.short_description,
      product.sku,
      product.brand,
      product.vendor,
      product.seo_title,
      product.seo_description,
      tagText,
      categoryNames,
      variantText,
    ]
      .filter(Boolean)
      .join(' ')
  );
}

export function scoreProductMatch(
  product: SearchableProduct,
  query: string,
  tokens: string[],
  expandedTerms: string[]
): number {
  const normalizedQuery = normalizeSearchText(query);
  const name = normalizeSearchText(product.name || '');
  const haystack = getSearchableHaystack(product);

  if (!haystack) return 0;

  let score = 0;

  if (normalizedQuery && name === normalizedQuery) score += 120;
  if (normalizedQuery && name.startsWith(normalizedQuery)) score += 80;
  if (normalizedQuery && name.includes(normalizedQuery)) score += 55;
  if (normalizedQuery && haystack.includes(normalizedQuery)) score += 35;

  const allTokens = expandedTerms.length > 0 ? expandedTerms : tokens;
  let matchedTokenCount = 0;

  for (const term of allTokens) {
    let termScore = 0;

    if (name === term) termScore = Math.max(termScore, 40);
    if (name.startsWith(term)) termScore = Math.max(termScore, 28);
    if (name.includes(term)) termScore = Math.max(termScore, 22);

    for (const categoryName of getCategoryNames(product)) {
      const normalizedCategory = normalizeSearchText(categoryName);
      if (normalizedCategory === term) termScore = Math.max(termScore, 26);
      if (normalizedCategory.includes(term)) termScore = Math.max(termScore, 18);
    }

    if ((product.tags || []).some((tag) => normalizeSearchText(tag).includes(term))) {
      termScore = Math.max(termScore, 16);
    }

    if (normalizeSearchText(product.sku || '').includes(term)) termScore = Math.max(termScore, 20);
    if (normalizeSearchText(product.brand || '').includes(term)) termScore = Math.max(termScore, 14);
    if (normalizeSearchText(product.vendor || '').includes(term)) termScore = Math.max(termScore, 12);

    for (const variant of product.product_variants || []) {
      const variantHaystack = normalizeSearchText(
        [variant.name, variant.option1, variant.option2, variant.sku].filter(Boolean).join(' ')
      );
      if (variantHaystack.includes(term)) {
        termScore = Math.max(termScore, 10);
        break;
      }
    }

    if (normalizeSearchText(product.description || '').includes(term)) {
      termScore = Math.max(termScore, 8);
    }
    if (normalizeSearchText(product.short_description || '').includes(term)) {
      termScore = Math.max(termScore, 9);
    }
    if (normalizeSearchText(product.seo_title || '').includes(term)) {
      termScore = Math.max(termScore, 7);
    }
    if (normalizeSearchText(product.seo_description || '').includes(term)) {
      termScore = Math.max(termScore, 6);
    }

    if (haystack.includes(term)) termScore = Math.max(termScore, 4);

    if (termScore > 0) {
      matchedTokenCount += 1;
      score += termScore;
    }
  }

  if (tokens.length > 1 && matchedTokenCount === tokens.length) score += 25;
  if (tokens.length > 1 && matchedTokenCount >= Math.ceil(tokens.length * 0.6)) score += 12;

  return score;
}

export function scoreCategoryMatch(
  category: { name?: string | null; slug?: string | null },
  query: string,
  tokens: string[],
  expandedTerms: string[]
): number {
  const name = normalizeSearchText(category.name || '');
  const slug = normalizeSearchText((category.slug || '').replace(/-/g, ' '));
  const haystack = `${name} ${slug}`.trim();
  const normalizedQuery = normalizeSearchText(query);
  let score = 0;

  if (normalizedQuery && haystack.includes(normalizedQuery)) score += 30;

  for (const term of expandedTerms.length > 0 ? expandedTerms : tokens) {
    if (name === term || slug.replace(/\s+/g, '') === term) score += 20;
    else if (name.includes(term) || slug.includes(term)) score += 12;
    else if (haystack.includes(term)) score += 6;
  }

  return score;
}

export function rankSearchResults<T extends SearchableProduct>(
  products: T[],
  query: string,
  tokens: string[],
  expandedTerms: string[]
): Array<T & { searchScore: number }> {
  return products
    .map((product) => ({
      ...product,
      searchScore: scoreProductMatch(product, query, tokens, expandedTerms),
    }))
    .filter((product) => product.searchScore > 0)
    .sort((a, b) => b.searchScore - a.searchScore);
}
