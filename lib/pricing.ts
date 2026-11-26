/**
 * Sale and discount rules, shared by the storefront, checkout, payment, POS and admin.
 *
 * The `price` column always holds the regular price. A lower price comes from one of
 * three rules, and only one ever applies to a product (they never stack):
 *
 *   1. Percentage off everything   site_settings.store_pricing { sales_active, strict_discount, discount_percent }
 *   2. Discount on a chosen product products.metadata.discount { type, value }
 *   3. Sale price while the sale is on   products.metadata.sale_price / product_variants.metadata.sale_price
 *
 * When none applies, `compare_at_price` still works as the hand-typed "was" price.
 * No imports here, so the same file runs in the browser, on the server and in node tests.
 */

export type StorePricing = {
  sales_active: boolean;
  discount_percent: number;
  strict_discount: boolean;
};

export type PricingMode = 'off' | 'sale' | 'bulk';

export type Markdown = {
  type: 'percent' | 'fixed';
  value: number;
  applied_at?: string;
  applied_by?: string;
};

export type PriceRule = 'bulk' | 'markdown' | 'sale' | null;

export type ResolvedPrice = {
  /** What the customer pays. */
  price: number;
  /** The crossed-out "was" price, or null when there is none. */
  compareAt: number | null;
  rule: PriceRule;
};

export const STORE_PRICING_OFF: StorePricing = {
  sales_active: false,
  discount_percent: 0,
  strict_discount: false,
};

/** Highest percentage the admin may take off. Anything close to 100% is a typo, not a sale. */
export const MAX_PERCENT_OFF = 90;

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function positive(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Read site_settings.store_pricing, treating anything malformed as "no sale". */
export function parseStorePricing(value: unknown): StorePricing {
  if (!value || typeof value !== 'object') return { ...STORE_PRICING_OFF };
  const raw = value as Record<string, unknown>;
  const percent = Number(raw.discount_percent);
  return {
    sales_active: raw.sales_active === true,
    discount_percent:
      Number.isFinite(percent) && percent > 0 && percent <= MAX_PERCENT_OFF ? percent : 0,
    strict_discount: raw.strict_discount === true,
  };
}

export function pricingMode(pricing: StorePricing | null | undefined): PricingMode {
  if (!pricing?.sales_active) return 'off';
  if (pricing.strict_discount) return pricing.discount_percent > 0 ? 'bulk' : 'off';
  return 'sale';
}

/** The three shapes the admin ever saves. */
export function storePricingFor(mode: PricingMode, percent = 0): StorePricing {
  if (mode === 'bulk') return { sales_active: true, discount_percent: percent, strict_discount: true };
  if (mode === 'sale') return { sales_active: true, discount_percent: 0, strict_discount: false };
  return { ...STORE_PRICING_OFF };
}

export function readMarkdown(metadata: unknown): Markdown | null {
  const raw = (metadata as { discount?: unknown } | null | undefined)?.discount;
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const value = positive(d.value);
  if (value == null) return null;
  const type = d.type === 'fixed' ? 'fixed' : 'percent';
  if (type === 'percent' && value > MAX_PERCENT_OFF) return null;
  return {
    type,
    value,
    applied_at: typeof d.applied_at === 'string' ? d.applied_at : undefined,
    applied_by: typeof d.applied_by === 'string' ? d.applied_by : undefined,
  };
}

export function readSalePrice(metadata: unknown): number | null {
  return positive((metadata as { sale_price?: unknown } | null | undefined)?.sale_price);
}

/** Price after a discount, or null when the discount would leave nothing to charge. */
export function markdownPrice(regular: number, markdown: Pick<Markdown, 'type' | 'value'>): number | null {
  const next =
    markdown.type === 'percent'
      ? round2(regular * (1 - markdown.value / 100))
      : round2(regular - markdown.value);
  return next > 0 && next < regular ? next : null;
}

export function resolvePrice(args: {
  regular: number;
  compareAt?: number | null;
  salePrice?: number | null;
  markdown?: Markdown | null;
  pricing?: StorePricing | null;
}): ResolvedPrice {
  const regular = Number(args.regular) || 0;
  const mode = pricingMode(args.pricing);

  if (regular > 0) {
    if (mode === 'bulk') {
      const price = markdownPrice(regular, { type: 'percent', value: args.pricing!.discount_percent });
      if (price != null) return { price, compareAt: regular, rule: 'bulk' };
    }
    if (args.markdown) {
      const price = markdownPrice(regular, args.markdown);
      if (price != null) return { price, compareAt: regular, rule: 'markdown' };
    }
    if (mode === 'sale') {
      const sale = positive(args.salePrice);
      if (sale != null && sale < regular) return { price: round2(sale), compareAt: regular, rule: 'sale' };
    }
  }

  const compare = positive(args.compareAt);
  return { price: regular, compareAt: compare != null && compare > regular ? compare : null, rule: null };
}

type VariantRow = {
  price?: number | string | null;
  compare_at_price?: number | string | null;
  metadata?: unknown;
  [key: string]: unknown;
};

type ProductRow = {
  price?: number | string | null;
  compare_at_price?: number | string | null;
  metadata?: unknown;
  product_variants?: VariantRow[] | null;
  [key: string]: unknown;
};

function resolveProductOnly(product: ProductRow, pricing: StorePricing | null | undefined): ResolvedPrice {
  return resolvePrice({
    regular: Number(product.price) || 0,
    compareAt: positive(product.compare_at_price),
    salePrice: readSalePrice(product.metadata),
    markdown: readMarkdown(product.metadata),
    pricing,
  });
}

function resolveVariant(
  product: ProductRow,
  variant: VariantRow,
  pricing: StorePricing | null | undefined
): ResolvedPrice {
  // An option with no price of its own sells at the product price, as the storefront shows it.
  const regular = Number(variant.price) || Number(product.price) || 0;
  return resolvePrice({
    regular,
    compareAt: positive(variant.compare_at_price) ?? positive(product.compare_at_price),
    salePrice: readSalePrice(variant.metadata) ?? readSalePrice(product.metadata),
    markdown: readMarkdown(product.metadata),
    pricing,
  });
}

/** The unit price to charge for a cart line, from the database rows, never from the browser. */
export function resolveLinePrice(
  product: ProductRow,
  variant: VariantRow | null | undefined,
  pricing: StorePricing | null | undefined
): number {
  return (variant ? resolveVariant(product, variant, pricing) : resolveProductOnly(product, pricing)).price;
}

/**
 * Returns a copy of a product row with `price` and `compare_at_price` replaced by what
 * the shopper should see, on the product and on every option. `regular_price` keeps the
 * stored price. For a product with options, the product-level `compare_at_price` is the
 * "was" price of its cheapest option, which is what a product card shows next to "From".
 */
export function priceProduct<T extends ProductRow>(
  product: T,
  pricing: StorePricing | null | undefined,
  options: { stripMetadata?: boolean } = {}
): T & { regular_price: number; on_sale: boolean } {
  const own = resolveProductOnly(product, pricing);
  const variants = Array.isArray(product.product_variants) ? product.product_variants : null;

  let cardCompare = own.compareAt;
  let onSale = own.rule != null;
  let pricedVariants: VariantRow[] | null = null;

  if (variants && variants.length > 0) {
    let cheapest: ResolvedPrice | null = null;
    onSale = false;
    pricedVariants = variants.map((variant) => {
      const r = resolveVariant(product, variant, pricing);
      if (r.rule != null) onSale = true;
      if (r.price > 0 && (!cheapest || r.price < cheapest.price)) cheapest = r;
      const next: VariantRow = {
        ...variant,
        price: r.price,
        compare_at_price: r.compareAt,
        regular_price: Number(variant.price) || Number(product.price) || 0,
      };
      if (options.stripMetadata) delete next.metadata;
      return next;
    });
    cardCompare = cheapest ? (cheapest as ResolvedPrice).compareAt : null;
  }

  const next: Record<string, unknown> = {
    ...product,
    price: own.price,
    compare_at_price: cardCompare,
    regular_price: Number(product.price) || 0,
    on_sale: onSale,
  };
  if (pricedVariants) next.product_variants = pricedVariants;
  if (options.stripMetadata) delete next.metadata;
  return next as T & { regular_price: number; on_sale: boolean };
}

export function priceProducts<T extends ProductRow>(
  products: T[] | null | undefined,
  pricing: StorePricing | null | undefined,
  options: { stripMetadata?: boolean } = {}
) {
  return (products || []).map((product) => priceProduct(product, pricing, options));
}

/** "20% off" or "GH₵10 off", for tags and messages. */
export function markdownLabel(markdown: Pick<Markdown, 'type' | 'value'>): string {
  if (markdown.type === 'percent') return `${markdown.value}% off`;
  const amount = Number.isInteger(markdown.value) ? String(markdown.value) : markdown.value.toFixed(2);
  return `GH₵${amount} off`;
}
