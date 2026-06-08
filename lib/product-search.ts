/**
 * Storefront product search — broad recall + relevance scoring + typo tolerance.
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
  shampoo: ['conditioner', 'wash', 'cleanser'],
  conditioner: ['shampoo', 'treatment'],
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

/** Keep the PostgREST `or()` filter well under URL limits. */
const MAX_OR_TERMS = 24;

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

/** All lexical variants of a single token (itself + singular/plural). */
export function tokenVariants(token: string): string[] {
  const variants = new Set<string>([token]);
  const singular = singularize(token);
  if (singular) variants.add(singular);
  const plural = pluralize(token);
  if (plural) variants.add(plural);
  return Array.from(variants);
}

/** Map each original token to its full expansion set (variants + synonyms). */
export function expandTokenMap(tokens: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const token of tokens) {
    const expanded = new Set<string>(tokenVariants(token));
    for (const synonym of SEARCH_SYNONYMS[token] || []) {
      if (synonym.length >= 2) expanded.add(synonym);
    }
    map.set(token, Array.from(expanded));
  }
  return map;
}

export function expandSearchTerms(tokens: string[]): string[] {
  const expanded = new Set<string>();
  for (const variants of expandTokenMap(tokens).values()) {
    for (const term of variants) expanded.add(term);
  }
  return Array.from(expanded);
}

export function buildProductTextOrFilter(terms: string[]): string {
  const parts: string[] = [];
  // Longest terms first so the most specific matches survive the cap.
  const bounded = [...terms].sort((a, b) => b.length - a.length).slice(0, MAX_OR_TERMS);

  for (const term of bounded) {
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

type NormalizedProduct = {
  name: string;
  categories: string[];
  tags: string[];
  sku: string;
  brand: string;
  vendor: string;
  description: string;
  shortDescription: string;
  seoTitle: string;
  seoDescription: string;
  variants: string;
  haystack: string;
  haystackWords: string[];
};

// Memoize the normalized projection so a single request never re-normalizes
// the same product across exact + fuzzy passes.
const normalizedCache = new WeakMap<object, NormalizedProduct>();

function getNormalizedProduct(product: SearchableProduct): NormalizedProduct {
  const cached = normalizedCache.get(product as object);
  if (cached) return cached;

  const categories: string[] = [];
  if (product.categories?.name) categories.push(normalizeSearchText(String(product.categories.name)));
  for (const row of product.product_categories || []) {
    if (row?.categories?.name) categories.push(normalizeSearchText(String(row.categories.name)));
  }

  const tags = (product.tags || []).map((tag) => normalizeSearchText(String(tag))).filter(Boolean);
  const variants = normalizeSearchText(
    (product.product_variants || [])
      .map((variant) => [variant.name, variant.option1, variant.option2, variant.sku].filter(Boolean).join(' '))
      .join(' ')
  );

  const name = normalizeSearchText(product.name || '');
  const description = normalizeSearchText(product.description || '');
  const shortDescription = normalizeSearchText(product.short_description || '');
  const sku = normalizeSearchText(product.sku || '');
  const brand = normalizeSearchText(product.brand || '');
  const vendor = normalizeSearchText(product.vendor || '');
  const seoTitle = normalizeSearchText(product.seo_title || '');
  const seoDescription = normalizeSearchText(product.seo_description || '');

  const haystack = [
    name,
    description,
    shortDescription,
    sku,
    brand,
    vendor,
    seoTitle,
    seoDescription,
    tags.join(' '),
    categories.join(' '),
    variants,
  ]
    .filter(Boolean)
    .join(' ');

  const haystackWords = Array.from(
    new Set(haystack.split(' ').filter((word) => word.length >= 2))
  );

  const normalized: NormalizedProduct = {
    name,
    categories,
    tags,
    sku,
    brand,
    vendor,
    description,
    shortDescription,
    seoTitle,
    seoDescription,
    variants,
    haystack,
    haystackWords,
  };

  normalizedCache.set(product as object, normalized);
  return normalized;
}

function getCategoryNames(product: SearchableProduct): string[] {
  return getNormalizedProduct(product).categories;
}

/**
 * Bounded Damerau (optimal string alignment) distance — counts an adjacent
 * transposition as a single edit and bails out as soon as it exceeds `max`.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (Math.abs(aLen - bLen) > max) return max + 1;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  let prevPrev = new Array<number>(bLen + 1).fill(0);
  let prev = new Array<number>(bLen + 1);
  let curr = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j++) prev[j] = j;

  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const aChar = a.charCodeAt(i - 1);
    const aPrev = i > 1 ? a.charCodeAt(i - 2) : -1;
    for (let j = 1; j <= bLen; j++) {
      const bChar = b.charCodeAt(j - 1);
      const cost = aChar === bChar ? 0 : 1;
      let value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && aChar === b.charCodeAt(j - 2) && aPrev === bChar) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    const tmp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[bLen];
}

/** True when two equal-length words share the exact same character multiset. */
function isAnagram(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return a.split('').sort().join('') === b.split('').sort().join('');
}

/** Distance tolerance scales with word length so short words stay strict. */
function fuzzyThreshold(token: string): number {
  if (token.length <= 2) return 0;
  if (token.length <= 5) return 1;
  return 2;
}

export function scoreProductMatch(
  product: SearchableProduct,
  query: string,
  tokens: string[],
  expandedTerms: string[]
): number {
  const np = getNormalizedProduct(product);
  if (!np.haystack) return 0;

  const normalizedQuery = normalizeSearchText(query);
  const name = np.name;
  let score = 0;

  if (normalizedQuery && name === normalizedQuery) score += 120;
  else if (normalizedQuery && name.startsWith(normalizedQuery)) score += 80;
  else if (normalizedQuery && name.includes(normalizedQuery)) score += 55;
  if (normalizedQuery && np.haystack.includes(normalizedQuery)) score += 35;

  const allTerms = expandedTerms.length > 0 ? expandedTerms : tokens;

  for (const term of allTerms) {
    let termScore = 0;

    if (name === term) termScore = 40;
    else if (name.startsWith(term)) termScore = 28;
    else if (name.includes(term)) termScore = 22;

    for (const category of np.categories) {
      if (category === term) termScore = Math.max(termScore, 26);
      else if (category.includes(term)) termScore = Math.max(termScore, 18);
    }

    if (np.tags.some((tag) => tag.includes(term))) termScore = Math.max(termScore, 16);
    if (np.sku.includes(term)) termScore = Math.max(termScore, 20);
    if (np.brand.includes(term)) termScore = Math.max(termScore, 14);
    if (np.vendor.includes(term)) termScore = Math.max(termScore, 12);
    if (np.variants.includes(term)) termScore = Math.max(termScore, 10);
    if (np.shortDescription.includes(term)) termScore = Math.max(termScore, 9);
    if (np.description.includes(term)) termScore = Math.max(termScore, 8);
    if (np.seoTitle.includes(term)) termScore = Math.max(termScore, 7);
    if (np.seoDescription.includes(term)) termScore = Math.max(termScore, 6);
    if (termScore === 0 && np.haystack.includes(term)) termScore = 4;

    score += termScore;
  }

  // Multi-word coverage bonus based on the user's ORIGINAL words (not synonyms),
  // so "lace frontal wig" rewards products hitting all three concepts.
  if (tokens.length > 1) {
    let matchedOriginal = 0;
    for (const token of tokens) {
      const variants = tokenVariants(token);
      if (variants.some((variant) => np.haystack.includes(variant))) matchedOriginal += 1;
    }
    if (matchedOriginal === tokens.length) score += 25;
    else if (matchedOriginal >= Math.ceil(tokens.length * 0.6)) score += 12;
  }

  return score;
}

/** Typo-tolerant score; only used as a fallback when exact recall is thin. */
export function scoreProductFuzzy(product: SearchableProduct, tokens: string[]): number {
  const np = getNormalizedProduct(product);
  if (!np.haystack || np.haystackWords.length === 0) return 0;

  const nameWords = np.name.split(' ').filter(Boolean);
  let score = 0;
  let matchedTokens = 0;

  for (const token of tokens) {
    if (token.length < 3) continue;

    // Short words (3 chars) only accept transposition typos (e.g. "wgi" -> "wig")
    // to avoid the false positives that single-substitution would cause.
    if (token.length === 3) {
      const anagramHit = np.haystackWords.some((word) => isAnagram(token, word));
      if (anagramHit) {
        matchedTokens += 1;
        const inName = nameWords.some((word) => isAnagram(token, word));
        score += 8 + (inName ? 4 : 0);
      }
      continue;
    }

    const max = fuzzyThreshold(token);
    if (max === 0) continue;

    let best = max + 1;
    for (const word of np.haystackWords) {
      if (Math.abs(word.length - token.length) > max) continue;
      const distance = boundedLevenshtein(token, word, max);
      if (distance < best) best = distance;
      if (best === 1) break;
    }

    if (best <= max) {
      matchedTokens += 1;
      const proximity = best === 1 ? 12 : 7;
      const inName = nameWords.some(
        (word) => Math.abs(word.length - token.length) <= max && boundedLevenshtein(token, word, max) <= max
      );
      score += proximity + (inName ? 6 : 0);
    }
  }

  if (matchedTokens === 0) return 0;
  if (tokens.length > 1 && matchedTokens === tokens.length) score += 10;
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

/** Rank a candidate set purely by typo-tolerant similarity. */
export function fuzzyRankResults<T extends SearchableProduct>(
  products: T[],
  tokens: string[]
): Array<T & { searchScore: number }> {
  return products
    .map((product) => ({
      ...product,
      searchScore: scoreProductFuzzy(product, tokens),
    }))
    .filter((product) => product.searchScore > 0)
    .sort((a, b) => b.searchScore - a.searchScore);
}
