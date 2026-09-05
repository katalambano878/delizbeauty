import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isOrderItemInStock, orderItemLabel } from '@/lib/order-stock';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('*, order_items(id, product_id, variant_id, product_name, variant_name, quantity, unit_price, metadata)')
      .or(isUUID ? `id.eq.${orderId}` : `order_number.eq.${orderId}`)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const items = Array.isArray(order.order_items) ? order.order_items : [];
    const productIds = Array.from(
      new Set(items.map((item: any) => item.product_id).filter(Boolean))
    );

    const { data: products } = productIds.length > 0
      ? await supabaseAdmin
          .from('products')
          .select('id, name, status, quantity, track_quantity, continue_selling, product_variants(id, name, option1, option2, quantity)')
          .in('id', productIds as string[])
      : { data: [] as any[] };

    const productById = new Map((products || []).map((product: any) => [product.id, product]));
    const outOfStockItems = items
      .filter((item: any) => item.product_id && !isOrderItemInStock(item, productById.get(item.product_id)))
      .map((item: any) => orderItemLabel(item));

    return NextResponse.json({
      order,
      stockValid: outOfStockItems.length === 0,
      outOfStockItems,
    });
  } catch (err: any) {
    console.error('[Pay API] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
