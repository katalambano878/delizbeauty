import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { matchProductVariant } from '@/lib/order-item-display';
import { resolveLinePrice, round2 } from '@/lib/pricing';
import { getStorePricing } from '@/lib/store-pricing';

const PRODUCT_SELECT =
  'id, slug, price, compare_at_price, metadata, product_variants(id, name, option1, option2, image_url, sku, price, compare_at_price, metadata)';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      orderNumber,
      trackingNumber,
      userId,
      email,
      phone,
      subtotal,
      tax,
      shippingCost,
      total,
      deliveryMethod,
      paymentMethod,
      shippingData,
      cart,
    } = body;

    if (!orderNumber || !cart?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const isValidUUID = (str: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const isPositivePrice = (value: unknown) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0;
    };

    // 0. Price every line on the server, BEFORE creating the order. The browser's
    // prices are never trusted: each unit price comes from the database with the
    // sale and discount rules that are active right now, so a stale or tampered
    // cart cannot buy at the wrong price and unpriced items cannot be bought.
    const cartUuids = cart.map((i: any) => i.id).filter(isValidUUID);
    const cartSlugs = cart.map((i: any) => i.slug || i.id).filter((s: any) => s && !isValidUUID(s));

    const [{ data: byId }, { data: bySlug }, pricing] = await Promise.all([
      cartUuids.length > 0
        ? supabaseAdmin.from('products').select(PRODUCT_SELECT).in('id', cartUuids)
        : Promise.resolve({ data: [] as any[] }),
      cartSlugs.length > 0
        ? supabaseAdmin.from('products').select(PRODUCT_SELECT).in('slug', cartSlugs)
        : Promise.resolve({ data: [] as any[] }),
      getStorePricing({ fresh: true }),
    ]);

    const productByKey = new Map<string, any>();
    for (const p of [...(byId || []), ...(bySlug || [])]) {
      if (p?.id) productByKey.set(p.id, p);
      if (p?.slug) productByKey.set(p.slug, p);
    }

    const lines: {
      item: any;
      product: any;
      variant: ReturnType<typeof matchProductVariant>;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }[] = [];

    for (const item of cart) {
      let product = productByKey.get(item.id) || productByKey.get(item.slug);

      if (!product || !isValidUUID(product.id)) {
        const { data: lookedUp } = await supabaseAdmin
          .from('products')
          .select(PRODUCT_SELECT)
          .or(`slug.eq.${item.slug || item.id},id.eq.${item.id}`)
          .single();

        if (!lookedUp) {
          return NextResponse.json(
            { error: `Product not found: ${item.name}. Please remove it from your cart and try again.` },
            { status: 400 }
          );
        }
        product = lookedUp;
        productByKey.set(lookedUp.id, lookedUp);
        if (lookedUp.slug) productByKey.set(lookedUp.slug, lookedUp);
      }

      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json(
          { error: `"${item.name}" has no quantity. Please update your cart and try again.` },
          { status: 400 }
        );
      }

      const variant = matchProductVariant(
        product.product_variants || [],
        item.variant,
        item.variantId
      );

      const unitPrice = resolveLinePrice(product, variant, pricing);
      if (!isPositivePrice(unitPrice)) {
        return NextResponse.json(
          { error: `"${item.name}" is currently unavailable for purchase (no price set). Please remove it from your cart.` },
          { status: 400 }
        );
      }

      lines.push({ item, product, variant, quantity, unitPrice, lineTotal: round2(unitPrice * quantity) });
    }

    const serverSubtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const serverTotal = round2(serverSubtotal + (Number(shippingCost) || 0) + (Number(tax) || 0));
    const priceChanged = Math.abs(serverSubtotal - (Number(subtotal) || 0)) > 0.01;

    // 1. Create Order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert([{
        order_number: orderNumber,
        user_id: userId || null,
        email,
        phone,
        status: 'pending',
        payment_status: 'pending',
        currency: 'GHS',
        subtotal: serverSubtotal,
        tax_total: tax,
        shipping_total: shippingCost,
        discount_total: 0,
        total: serverTotal,
        shipping_method: deliveryMethod,
        payment_method: paymentMethod,
        shipping_address: shippingData,
        billing_address: shippingData,
        metadata: {
          guest_checkout: !userId,
          first_name: shippingData.firstName,
          last_name: shippingData.lastName,
          tracking_number: trackingNumber,
          ...(priceChanged ? { cart_total_shown: Number(total) || 0 } : {}),
        },
      }])
      .select()
      .single();

    if (orderError) {
      console.error('Order insert error:', orderError);
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    // 2. Build order items from the server-priced lines
    const orderItems = lines.map(({ item, product, variant, quantity, unitPrice, lineTotal }) => ({
      order_id: order.id,
      product_id: product.id,
      variant_id: variant?.id || item.variantId || null,
      product_name: item.name,
      variant_name: item.variant || variant?.name || null,
      sku: item.sku || variant?.sku || null,
      quantity,
      unit_price: unitPrice,
      total_price: lineTotal,
      metadata: {
        image: variant?.image_url || item.image || null,
        slug: item.slug,
        variant_id: variant?.id || item.variantId || null,
        preorder_shipping: product?.metadata?.preorder_shipping || null,
      },
    }));

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItems);
    if (itemsError) {
      console.error('Order items insert error:', itemsError);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // 3. Upsert customer record
    const fullName = `${shippingData.firstName} ${shippingData.lastName}`.trim();
    try {
      await supabaseAdmin.rpc('upsert_customer_from_order', {
        p_email: shippingData.email,
        p_phone: shippingData.phone,
        p_full_name: fullName,
        p_first_name: shippingData.firstName,
        p_last_name: shippingData.lastName,
        p_user_id: userId || null,
        p_address: shippingData,
      });
    } catch (e: any) {
      console.warn('upsert_customer_from_order warning:', e.message);
    }

    return NextResponse.json({ order, priceChanged });
  } catch (e: any) {
    console.error('Checkout API error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}
