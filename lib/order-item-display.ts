export type OrderItemVariant = {
  id?: string | null;
  name?: string | null;
  option1?: string | null;
  option2?: string | null;
  image_url?: string | null;
  sku?: string | null;
  price?: number | null;
  quantity?: number | null;
};

export type OrderItemImage = {
  url?: string | null;
  position?: number | null;
};

export type OrderItemForDisplay = {
  variant_id?: string | null;
  variant_name?: string | null;
  sku?: string | null;
  metadata?: { image?: string | null } | null;
  product_variants?: OrderItemVariant | OrderItemVariant[] | null;
  products?: {
    product_images?: OrderItemImage[] | null;
    product_variants?: OrderItemVariant[] | null;
  } | null;
};

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function nonEmpty(value: unknown): string {
  return String(value ?? '').trim();
}

export function variantLabels(variant: OrderItemVariant): string[] {
  const name = nonEmpty(variant.name);
  const option1 = nonEmpty(variant.option1);
  const option2 = nonEmpty(variant.option2);
  return [
    name,
    option1,
    option2,
    option2 && name ? `${option2} / ${name}` : '',
    name && option2 ? `${name} / ${option2}` : '',
    option1 && name && option1 !== name ? `${option1} / ${name}` : '',
    name && option1 && option1 !== name ? `${name} / ${option1}` : '',
    option2 && option1 ? `${option2} / ${option1}` : '',
    option1 && option2 ? `${option1} / ${option2}` : '',
  ].filter(Boolean);
}

function asVariantList(
  embedded: OrderItemVariant | OrderItemVariant[] | null | undefined
): OrderItemVariant[] {
  if (Array.isArray(embedded)) return embedded;
  return embedded ? [embedded] : [];
}

export function collectItemVariants(item: OrderItemForDisplay): OrderItemVariant[] {
  return [
    ...asVariantList(item.product_variants),
    ...(item.products?.product_variants || []),
  ];
}

export function matchProductVariant(
  variants: OrderItemVariant[] | null | undefined,
  variantName?: string | null,
  variantId?: string | null
): OrderItemVariant | null {
  const list = Array.isArray(variants) ? variants : [];
  if (variantId) {
    const byId = list.find((variant) => variant.id === variantId);
    if (byId) return byId;
  }

  const wanted = norm(variantName);
  if (!wanted) return null;

  return (
    list.find((variant) =>
      variantLabels(variant).some((label) => norm(label) === wanted)
    ) || null
  );
}

export function resolveOrderItemImage(item: OrderItemForDisplay): string | null {
  const variant = matchProductVariant(
    collectItemVariants(item),
    item.variant_name,
    item.variant_id
  );
  const variantImage = nonEmpty(variant?.image_url);
  if (variantImage) return variantImage;

  const storedImage = nonEmpty(item.metadata?.image);
  if (storedImage) return storedImage;

  const productImages = [...(item.products?.product_images || [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );
  return productImages.find((image) => nonEmpty(image.url))?.url || null;
}

export function resolveOrderItemSku(item: OrderItemForDisplay): string {
  const storedSku = nonEmpty(item.sku);
  if (storedSku) return storedSku;

  const variant = matchProductVariant(
    collectItemVariants(item),
    item.variant_name,
    item.variant_id
  );
  return nonEmpty(variant?.sku);
}
