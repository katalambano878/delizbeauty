import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { matchProductVariant } from '@/lib/order-item-display';

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

    // 0. Server-side price validation (authoritative — runs BEFORE creating
    // the order so unpriced / zero-price items can never be purchased, even if
    // the client was tampered with).
    const cartUuids = cart.map((i: any) => i.id).filter(isValidUUID);
    const cartSlugs = cart.map((i: any) => i.slug || i.id).filter((s: any) => s && !isValidUUID(s));

    const [{ data: byId }, { data: bySlug }] = await Promise.all([
      cartUuids.length > 0
        ? supabaseAdmin
            .from('products')
            .select('id, slug, price, metadata, product_variants(id, name, option1, option2, image_url, sku, price)')
            .in('id', cartUuids)
        : Promise.resolve({ data: [] as any[] }),
      cartSlugs.length > 0
        ? supabaseAdmin
            .from('products')
            .select('id, slug, price, metadata, product_variants(id, name, option1, option2, image_url, sku, price)')
            .in('slug', cartSlugs)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const productByKey = new Map<string, any>();
    for (const p of [...(byId || []), ...(bySlug || [])]) {
      if (p?.id) productByKey.set(p.id, p);
      if (p?.slug) productByKey.set(p.slug, p);
    }

    for (const item of cart) {
      // Client-supplied price must be a real positive number.
      if (!isPositivePrice(item.price)) {
        return NextResponse.json(
          { error: `"${item.name}" is currently unavailable for purchase (no price set). Please remove it from your cart.` },
          { status: 400 }
        );
      }

      // The product must have a real price somewhere in the DB (base or a
      // variant). This catches unpriced products even if the client lied.
      const product = productByKey.get(item.id) || productByKey.get(item.slug);
      if (product) {
        const candidatePrices = [
          Number(product.price),
          ...(product.product_variants || []).map((v: any) => Number(v.price)),
        ].filter((n) => Number.isFinite(n));
        const maxPrice = candidatePrices.length > 0 ? Math.max(...candidatePrices) : 0;
        if (!isPositivePrice(maxPrice)) {
          return NextResponse.json(
            { error: `"${item.name}" is currently unavailable for purchase (no price set). Please remove it from your cart.` },
            { status: 400 }
          );
        }
      }
    }

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
        subtotal,
        tax_total: tax,
        shipping_total: shippingCost,
        discount_total: 0,
        total,
        shipping_method: deliveryMethod,
        payment_method: paymentMethod,
        shipping_address: shippingData,
        billing_address: shippingData,
        metadata: {
          guest_checkout: !userId,
          first_name: shippingData.firstName,
          last_name: shippingData.lastName,
          tracking_number: trackingNumber,
        },
      }])
      .select()
      .single();

    if (orderError) {
      console.error('Order insert error:', orderError);
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    // 2. Resolve slugs to UUIDs and build order items
    const orderItems = [];
    for (const item of cart) {
      let product = productByKey.get(item.id) || productByKey.get(item.slug);
      let productId = product?.id || item.id;

      if (!product || !isValidUUID(productId)) {
        const { data: lookedUp } = await supabaseAdmin
          .from('products')
          .select('id, slug, price, metadata, product_variants(id, name, option1, option2, image_url, sku, price)')
          .or(`slug.eq.${item.slug || item.id},id.eq.${item.id}`)
          .single();

        if (lookedUp) {
          product = lookedUp;
          productId = lookedUp.id;
          productByKey.set(lookedUp.id, lookedUp);
          if (lookedUp.slug) productByKey.set(lookedUp.slug, lookedUp);
        } else {
          return NextResponse.json(
            { error: `Product not found: ${item.name}. Please remove it from your cart and try again.` },
            { status: 400 }
          );
        }
      }

      const variant = matchProductVariant(
        product?.product_variants || [],
        item.variant,
        item.variantId
      );
      const lineImage = variant?.image_url || item.image || null;

      orderItems.push({
        order_id: order.id,
        product_id: productId,
        variant_id: variant?.id || item.variantId || null,
        product_name: item.name,
        variant_name: item.variant || variant?.name || null,
        sku: item.sku || variant?.sku || null,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.price * item.quantity,
        metadata: {
          image: lineImage,
          slug: item.slug,
          variant_id: variant?.id || item.variantId || null,
          preorder_shipping: product?.metadata?.preorder_shipping || null,
        },
      });
    }

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

    return NextResponse.json({ order });
  } catch (e: any) {
    console.error('Checkout API error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}
