import { matchProductVariant, type OrderItemVariant } from '@/lib/order-item-display';

export type StockProduct = {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  quantity?: number | null;
  track_quantity?: boolean | null;
  continue_selling?: boolean | null;
  product_variants?: OrderItemVariant[] | null;
};

export type StockOrderItem = {
  product_id?: string | null;
  product_name?: string | null;
  variant_id?: string | null;
  variant_name?: string | null;
  quantity?: number | null;
  metadata?: { variant_id?: string | null } | null;
};

export function orderItemLabel(item: StockOrderItem): string {
  const name = String(item.product_name || 'Unknown product').trim() || 'Unknown product';
  return item.variant_name ? `${name} (${item.variant_name})` : name;
}

export function isOrderItemInStock(item: StockOrderItem, product: StockProduct | null | undefined): boolean {
  if (!product) return false;
  if (product.status && product.status !== 'active') return false;

  const tracks = product.track_quantity !== false && !product.continue_selling;
  if (!tracks) return true;

  const variant = matchProductVariant(
    product.product_variants,
    item.variant_name,
    item.variant_id || item.metadata?.variant_id
  );
  const onHand = Number(variant?.quantity ?? product.quantity);
  if (!Number.isFinite(onHand)) return true;

  const ordered = Number(item.quantity) || 0;
  return onHand >= ordered;
}
