/**
 * Sale prices, shared by the storefront, checkout, payment, POS and the admin Sales screen.
 *
 * The `price` column always holds the regular price. A sale is a note on the product:
 *
 *   products.metadata.sale = { type, value?, live }
 *     type 'percent'   value% off the product and every option
 *     type 'fixed'     the product sells at `value` (products without options only)
 *     type 'variants'  each option sells at its own product_variants.metadata.sale_price
 *
 * `live` is that product's on/off switch. Off means the sale is kept but shoppers pay the
 * regular price. Because nothing is overwritten, switching a sale off or removing it
 * brings the regular price back exactly.
 *
 * When a product has no live sale, `compare_at_price` still works as a hand-typed "was" price.
 * No imports here, so the same file runs in the browser, on the server and in node tests.
 */

export type SaleType = 'percent' | 'fixed' | 'variants';

export type Sale = {
  type: SaleType;
  /** Percent off, or the fixed sale price. Unused for 'variants'. */
  value: number;
  live: boolean;
  set_at?: string;
  set_by?: string;
};

export type ResolvedPrice = {
  /** What the customer pays. */
  price: number;
  /** The crossed-out "was" price, or null when there is none. */
  compareAt: number | null;
  /** True when a live sale lowered the price. */
  onSale: boolean;
};

/** A sale takes between 1% and 99% off. */
export const MAX_PERCENT_OFF = 99;

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function positive(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readSale(metadata: unknown): Sale | null {
  const raw = (metadata as { sale?: unknown } | null | undefined)?.sale;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const type: SaleType | null =
    s.type === 'percent' || s.type === 'fixed' || s.type === 'variants' ? s.type : null;
  if (!type) return null;
  const value = positive(s.value) ?? 0;
  if (type === 'percent' && (value < 1 || value > MAX_PERCENT_OFF)) return null;
  if (type === 'fixed' && value <= 0) return null;
  return {
    type,
    value,
    live: s.live === true,
    set_at: typeof s.set_at === 'string' ? s.set_at : undefined,
    set_by: typeof s.set_by === 'string' ? s.set_by : undefined,
  };
}

export function readVariantSalePrice(metadata: unknown): number | null {
  return positive((metadata as { sale_price?: unknown } | null | undefined)?.sale_price);
}

/**
 * The sale price a sale gives one price, whether or not the sale is switched on.
 * Null when the sale does not apply, or would not be lower than the regular price.
 */
export function salePriceFor(args: {
  regular: number;
  sale: Sale | null | undefined;
  /** True when pricing an option of a product, false for a product without options. */
  isVariant: boolean;
  variantSalePrice?: number | null;
}): number | null {
  const regular = Number(args.regular) || 0;
  const sale = args.sale;
  if (!sale || regular <= 0) return null;

  let next: number | null = null;
  if (sale.type === 'percent') next = round2(regular * (1 - sale.value / 100));
  else if (sale.type === 'fixed') next = args.isVariant ? null : round2(sale.value);
  else next = args.isVariant ? positive(args.variantSalePrice) : null;

  return next != null && next > 0 && next < regular ? round2(next) : null;
}

export function resolvePrice(args: {
  regular: number;
  compareAt?: number | null;
  sale?: Sale | null;
  isVariant?: boolean;
  variantSalePrice?: number | null;
}): ResolvedPrice {
  const regular = Number(args.regular) || 0;
  if (args.sale?.live) {
    const price = salePriceFor({
      regular,
      sale: args.sale,
      isVariant: args.isVariant === true,
      variantSalePrice: args.variantSalePrice,
    });
    if (price != null) return { price, compareAt: regular, onSale: true };
  }
  const compare = positive(args.compareAt);
  return { price: regular, compareAt: compare != null && compare > regular ? compare : null, onSale: false };
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

/** An option with no price of its own sells at the product price, as the storefront shows it. */
export function variantRegularPrice(product: ProductRow, variant: VariantRow): number {
  return Number(variant.price) || Number(product.price) || 0;
}

function hasVariants(product: ProductRow): boolean {
  return Array.isArray(product.product_variants) && product.product_variants.length > 0;
}

function resolveProductOnly(product: ProductRow): ResolvedPrice {
  return resolvePrice({
    regular: Number(product.price) || 0,
    compareAt: positive(product.compare_at_price),
    sale: readSale(product.metadata),
    isVariant: false,
  });
}

function resolveVariant(product: ProductRow, variant: VariantRow): ResolvedPrice {
  return resolvePrice({
    regular: variantRegularPrice(product, variant),
    compareAt: positive(variant.compare_at_price) ?? positive(product.compare_at_price),
    sale: readSale(product.metadata),
    isVariant: true,
    variantSalePrice: readVariantSalePrice(variant.metadata),
  });
}

/** The unit price to charge for a cart line, from the database rows, never from the browser. */
export function resolveLinePrice(product: ProductRow, variant: VariantRow | null | undefined): number {
  return (variant ? resolveVariant(product, variant) : resolveProductOnly(product)).price;
}

/**
 * Returns a copy of a product row with `price` and `compare_at_price` replaced by what
 * the shopper should see, on the product and on every option. `regular_price` keeps the
 * stored price. For a product with options, the product-level `compare_at_price` is the
 * "was" price of its cheapest option, which is what a product card shows next to "From".
 */
export function priceProduct<T extends ProductRow>(
  product: T,
  options: { stripMetadata?: boolean } = {}
): T & { regular_price: number; on_sale: boolean } {
  const own = resolveProductOnly(product);
  let cardCompare = own.compareAt;
  let onSale = own.onSale;
  let pricedVariants: VariantRow[] | null = null;

  if (hasVariants(product)) {
    let cheapest: ResolvedPrice | null = null;
    onSale = false;
    pricedVariants = product.product_variants!.map((variant) => {
      const r = resolveVariant(product, variant);
      if (r.onSale) onSale = true;
      if (r.price > 0 && (!cheapest || r.price < cheapest.price)) cheapest = r;
      const next: VariantRow = {
        ...variant,
        price: r.price,
        compare_at_price: r.compareAt,
        regular_price: variantRegularPrice(product, variant),
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
  options: { stripMetadata?: boolean } = {}
) {
  return (products || []).map((product) => priceProduct(product, options));
}

export type SaleSummary = {
  /** Regular price to show: the product's, or its cheapest option's. */
  regular: number;
  /** Sale price to show next to it, whether the sale is on or off. Null when not on sale. */
  sale: number | null;
  percentOff: number;
  hasSale: boolean;
  live: boolean;
  type: SaleType | null;
};

/** One line for the admin Sales table: what the sale is, and whether it is switched on. */
export function summarizeSale(product: ProductRow): SaleSummary {
  const sale = readSale(product.metadata);
  const lines = hasVariants(product)
    ? product.product_variants!.map((v) => {
        const regular = variantRegularPrice(product, v);
        return {
          regular,
          sale: salePriceFor({ regular, sale, isVariant: true, variantSalePrice: readVariantSalePrice(v.metadata) }),
        };
      })
    : [
        {
          regular: Number(product.price) || 0,
          sale: salePriceFor({ regular: Number(product.price) || 0, sale, isVariant: false }),
        },
      ];

  const discounted = lines.filter((l) => l.sale != null);
  // Show the cheapest discounted line; with no discount, the cheapest regular price.
  const shown = (discounted.length ? discounted : lines.filter((l) => l.regular > 0)).sort(
    (a, b) => (a.sale ?? a.regular) - (b.sale ?? b.regular)
  )[0] || { regular: Number(product.price) || 0, sale: null };

  const hasSale = sale != null && discounted.length > 0;
  return {
    regular: shown.regular,
    sale: hasSale ? shown.sale : null,
    percentOff:
      hasSale && shown.sale != null && shown.regular > 0 ? Math.round((1 - shown.sale / shown.regular) * 100) : 0,
    hasSale,
    live: hasSale && sale!.live,
    type: hasSale ? sale!.type : null,
  };
}
