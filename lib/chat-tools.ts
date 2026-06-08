// ─── Types ──────────────────────────────────────────────────────────────────

export type ChatProduct = {
  id: string;
  name: string;
  slug: string;
  price: number;
  image: string;
  quantity: number;
  maxStock: number;
  moq: number;
  inStock: boolean;
};

export type ChatOrder = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total: number;
  created_at: string;
  tracking_number?: string;
  items: { name: string; quantity: number; price: number }[];
};

export type ChatCoupon = {
  valid: boolean;
  code: string;
  reason?: string;
  type?: string;
  value?: number;
  minimum_purchase?: number;
  maximum_discount?: number;
  expires?: string;
};

export type ChatTicket = {
  id: string;
  ticket_number: number;
  status: string;
  subject: string;
};

export type ChatReturn = {
  id: string;
  status: string;
  order_number: string;
  reason: string;
};

export type ChatCustomerProfile = {
  name: string;
  email: string;
  total_orders: number;
  total_spent: number;
  last_order_at: string | null;
};

// ─── 1. Search Products (existing) ──────────────────────────────────────────

export async function searchProducts(
  supabase: any,
  query: string,
  limit = 4
): Promise<ChatProduct[]> {
  const term = (query || '').trim();
  if (!term) return [];

  const { data, error } = await supabase
    .from('products')
    .select(`id, name, slug, price, quantity, metadata, product_images(url, position)`)
    .eq('status', 'active')
    .or(`name.ilike.%${term}%,description.ilike.%${term}%`)
    .order('name')
    .limit(limit);

  if (error) {
    console.error('[ChatTools] searchProducts error:', error);
    return [];
  }

  return (data || []).map(mapProduct);
}

// ─── 2. Get Product for Cart (existing) ─────────────────────────────────────

export async function getProductForCart(
  supabase: any,
  slugOrId: string
): Promise<ChatProduct | null> {
  if (!slugOrId?.trim()) return null;
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId.trim());

  const q = supabase
    .from('products')
    .select(`id, name, slug, price, quantity, metadata, product_images(url, position)`)
    .eq('status', 'active');

  const { data, error } = isId
    ? await q.eq('id', slugOrId).single()
    : await q.eq('slug', slugOrId).single();

  if (error || !data) return null;
  return mapProduct(data);
}

// ─── 3. Track Order ─────────────────────────────────────────────────────────

export async function trackOrder(
  supabase: any,
  orderNumber: string,
  email: string
): Promise<ChatOrder | null> {
  if (!orderNumber?.trim() || !email?.trim()) return null;

  const { data, error } = await supabase.rpc('get_order_for_tracking', {
    p_order_number: orderNumber.trim(),
    p_email: email.trim(),
  });

  if (error || !data || typeof data !== 'object') return null;

  return {
    id: data.id,
    order_number: data.order_number,
    status: data.status,
    payment_status: data.payment_status,
    total: Number(data.total),
    created_at: data.created_at,
    tracking_number: data.metadata?.tracking_number || undefined,
    items: (data.order_items || []).map((i: any) => ({
      name: i.product_name,
      quantity: i.quantity,
      price: Number(i.unit_price),
    })),
  };
}

// ─── 4. Get Customer Orders ─────────────────────────────────────────────────

export async function getCustomerOrders(
  supabase: any,
  userId: string,
  limit = 5
): Promise<ChatOrder[]> {
  if (!userId) return [];

  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, status, payment_status, total, created_at, metadata,
      order_items(product_name, quantity, unit_price)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((o: any) => ({
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    payment_status: o.payment_status,
    total: Number(o.total),
    created_at: o.created_at,
    tracking_number: o.metadata?.tracking_number || undefined,
    items: (o.order_items || []).map((i: any) => ({
      name: i.product_name,
      quantity: i.quantity,
      price: Number(i.unit_price),
    })),
  }));
}

// ─── 5. Check Coupon ────────────────────────────────────────────────────────

export async function checkCoupon(
  supabase: any,
  code: string,
  cartTotal?: number
): Promise<ChatCoupon> {
  const trimmed = (code || '').trim().toUpperCase();
  if (!trimmed) return { valid: false, code: trimmed, reason: 'No code provided.' };

  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', trimmed)
    .single();

  if (error || !data) {
    return { valid: false, code: trimmed, reason: 'This coupon code does not exist.' };
  }

  const now = new Date();
  if (!data.is_active) return { valid: false, code: trimmed, reason: 'This coupon is no longer active.' };
  if (data.start_date && new Date(data.start_date) > now) return { valid: false, code: trimmed, reason: 'This coupon is not yet valid.' };
  if (data.end_date && new Date(data.end_date) < now) return { valid: false, code: trimmed, reason: 'This coupon has expired.' };
  if (data.usage_limit && data.usage_count >= data.usage_limit) return { valid: false, code: trimmed, reason: 'This coupon has reached its usage limit.' };
  if (cartTotal !== undefined && data.minimum_purchase && cartTotal < Number(data.minimum_purchase)) {
    return { valid: false, code: trimmed, reason: `Minimum purchase of GH₵${Number(data.minimum_purchase).toFixed(2)} required.` };
  }

  return {
    valid: true,
    code: trimmed,
    type: data.type,
    value: Number(data.value),
    minimum_purchase: data.minimum_purchase ? Number(data.minimum_purchase) : undefined,
    maximum_discount: data.maximum_discount ? Number(data.maximum_discount) : undefined,
    expires: data.end_date || undefined,
  };
}

// ─── 6. Create Support Ticket ───────────────────────────────────────────────

export async function createSupportTicket(
  supabase: any,
  params: { userId?: string; email: string; subject: string; description: string; category?: string }
): Promise<ChatTicket | null> {
  const { userId, email, subject, description, category } = params;
  if (!email || !subject || !description) return null;

  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .insert({
      user_id: userId || null,
      email,
      subject,
      description,
      category: category || 'other',
      status: 'open',
      priority: 'medium',
    })
    .select('id, ticket_number, status, subject')
    .single();

  if (error || !ticket) {
    console.error('[ChatTools] createSupportTicket error:', error);
    return null;
  }

  await supabase.from('support_messages').insert({
    ticket_id: ticket.id,
    user_id: userId || null,
    message: description,
    is_internal: false,
  });

  return {
    id: ticket.id,
    ticket_number: ticket.ticket_number,
    status: ticket.status,
    subject: ticket.subject,
  };
}

// ─── 7. Initiate Return ─────────────────────────────────────────────────────

export async function initiateReturn(
  supabase: any,
  params: { userId: string; orderId: string; reason: string; description: string }
): Promise<ChatReturn | null> {
  const { userId, orderId, reason, description } = params;
  if (!userId || !orderId) return null;

  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, status, created_at, user_id')
    .eq('id', orderId)
    .single();

  if (!order) return null;
  if (order.user_id !== userId) return null;
  if (order.status !== 'delivered') return null;

  const deliveredDate = new Date(order.created_at);
  const daysSinceDelivery = (Date.now() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceDelivery > 30) return null;

  const { data: ret, error } = await supabase
    .from('return_requests')
    .insert({
      order_id: orderId,
      user_id: userId,
      reason,
      description,
      status: 'pending',
    })
    .select('id, status')
    .single();

  if (error || !ret) {
    console.error('[ChatTools] initiateReturn error:', error);
    return null;
  }

  return {
    id: ret.id,
    status: ret.status,
    order_number: order.order_number,
    reason,
  };
}

// ─── 8. Get Recommendations ─────────────────────────────────────────────────

export async function getRecommendations(
  supabase: any,
  context?: string
): Promise<ChatProduct[]> {
  let query = supabase
    .from('products')
    .select(`id, name, slug, price, quantity, metadata, product_images(url, position)`)
    .eq('status', 'active')
    .gt('quantity', 0);

  if (context?.trim()) {
    query = query.or(`name.ilike.%${context.trim()}%,description.ilike.%${context.trim()}%`);
  }

  const { data, error } = await query
    .order('rating_avg', { ascending: false })
    .order('review_count', { ascending: false })
    .limit(4);

  if (error || !data) return [];
  return data.map(mapProduct);
}

// ─── 9. Get Store Info (static) ─────────────────────────────────────────────

const STORE_INFO: Record<string, string> = {
  shipping: `We deliver across Ghana. Standard delivery takes 1-3 business days within Accra and 3-7 business days outside Accra. Shipping fees vary by location and are calculated at checkout.`,
  returns: `We accept returns within 30 days of delivery for unused items in original packaging. To start a return, go to your account or ask me to help. Refunds are processed within 5-7 business days after we receive the item.`,
  payment: `We accept Mobile Money (MTN, Vodafone Cash, AirtelTigo Money) via our secure Moolre payment gateway. Cash on delivery is available for orders within Accra.`,
  contact: `You can reach us through:\n- This chat (24/7)\n- Email: contact@delizbeautytools.com\n- Phone: 027 854 9831\n- Visit: Madina, Ritz Junction, Accra\n- Support ticket: I can create one for you right now`,
  about: `Deliz Beauty Tools is Ghana's trusted destination for premium beauty essentials. We specialize in lash products, hair and wig tools, pedicure and manicure supplies, nail accessories, spa equipment, and skincare. Located in Madina, Ritz Junction, Accra. Nationwide delivery.`,
  delivery_times: `Accra: 1-3 business days\nKumasi, Takoradi, Cape Coast: 3-5 business days\nOther regions: 5-7 business days\nExpress delivery available for Accra (same day/next day) at extra cost.`,
  hours: `Our online store is open 24/7. Customer support is available Monday-Saturday, 8 AM - 8 PM GMT.`,
};

export function getStoreInfo(topic: string): string {
  const key = (topic || '').toLowerCase().replace(/[^a-z_]/g, '');
  const match = Object.keys(STORE_INFO).find((k) => key.includes(k));
  if (match) return STORE_INFO[match];
  return Object.values(STORE_INFO).join('\n\n');
}

// ─── 10. Get Customer Profile ───────────────────────────────────────────────

export async function getCustomerProfile(
  supabase: any,
  userId: string
): Promise<ChatCustomerProfile | null> {
  if (!userId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .single();

  const { data: customer } = await supabase
    .from('customers')
    .select('total_orders, total_spent, last_order_at')
    .eq('user_id', userId)
    .single();

  if (!profile) return null;

  return {
    name: profile.full_name || profile.email?.split('@')[0] || 'Customer',
    email: profile.email || '',
    total_orders: Number(customer?.total_orders) || 0,
    total_spent: Number(customer?.total_spent) || 0,
    last_order_at: customer?.last_order_at || null,
  };
}

// ─── 11. Create Order from Chat ─────────────────────────────────────────────

export type ChatOrderResult = {
  success: boolean;
  orderNumber?: string;
  total?: number;
  paymentUrl?: string;
  message: string;
};

interface ChatOrderItem {
  productId: string;
  quantity: number;
}

interface ChatShippingInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  region: string;
}

const DELIVERY_COSTS: Record<string, number> = {
  standard: 20,
  express: 40,
  pickup: 0,
};

const MAX_ITEMS_PER_ORDER = 20;
const MAX_QUANTITY_PER_ITEM = 100;
const MAX_FIELD_LENGTH = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-() ]{7,20}$/;

const orderRateMap = new Map<string, { count: number; resetAt: number }>();
const ORDER_RATE_LIMIT = 3;
const ORDER_RATE_WINDOW_MS = 300_000; // 3 orders per 5 minutes

function checkOrderRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = orderRateMap.get(key);
  if (!entry || now > entry.resetAt) {
    orderRateMap.set(key, { count: 1, resetAt: now + ORDER_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= ORDER_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function sanitize(input: string): string {
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

export async function createChatOrder(
  supabaseAdmin: any,
  params: {
    items: ChatOrderItem[];
    shipping: ChatShippingInfo;
    deliveryMethod: string;
    paymentMethod: string;
    userId?: string | null;
  }
): Promise<ChatOrderResult> {
  const { items, shipping, deliveryMethod, paymentMethod, userId } = params;

  if (!items || items.length === 0) {
    return { success: false, message: 'No items provided. Please add products to your cart first.' };
  }

  if (items.length > MAX_ITEMS_PER_ORDER) {
    return { success: false, message: `Too many items. Maximum ${MAX_ITEMS_PER_ORDER} items per order.` };
  }

  if (!shipping.firstName || !shipping.lastName || !shipping.email || !shipping.phone || !shipping.address || !shipping.city || !shipping.region) {
    return { success: false, message: 'Missing shipping information. Please provide all required fields: first name, last name, email, phone, address, city, and region.' };
  }

  if (!EMAIL_RE.test(shipping.email)) {
    return { success: false, message: 'Please provide a valid email address.' };
  }

  if (!PHONE_RE.test(shipping.phone)) {
    return { success: false, message: 'Please provide a valid phone number.' };
  }

  for (const item of items) {
    if (!UUID_RE.test(item.productId)) {
      return { success: false, message: 'Invalid product reference. Please try again.' };
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_ITEM) {
      return { success: false, message: `Invalid quantity. Must be between 1 and ${MAX_QUANTITY_PER_ITEM}.` };
    }
  }

  if (!['standard', 'express', 'pickup'].includes(deliveryMethod)) {
    return { success: false, message: 'Invalid delivery method.' };
  }
  if (!['moolre', 'cod'].includes(paymentMethod)) {
    return { success: false, message: 'Invalid payment method.' };
  }

  // Rate-limit order creation per email to prevent spam/abuse
  const rateLimitKey = shipping.email.toLowerCase().trim();
  if (!checkOrderRateLimit(rateLimitKey)) {
    return { success: false, message: 'Too many orders placed recently. Please wait a few minutes before trying again.' };
  }

  // Sanitize all string inputs
  const sanitizedShipping: ChatShippingInfo = {
    firstName: sanitize(shipping.firstName),
    lastName: sanitize(shipping.lastName),
    email: shipping.email.toLowerCase().trim().slice(0, MAX_FIELD_LENGTH),
    phone: shipping.phone.replace(/[^0-9+\-() ]/g, '').slice(0, 20),
    address: sanitize(shipping.address),
    city: sanitize(shipping.city),
    region: sanitize(shipping.region),
  };

  const shippingCost = DELIVERY_COSTS[deliveryMethod];

  try {
    // Validate and fetch all products
    const productIds = items.map(i => i.productId);
    const { data: products, error: prodError } = await supabaseAdmin
      .from('products')
      .select('id, name, slug, price, quantity, metadata, product_images(url, position)')
      .in('id', productIds)
      .eq('status', 'active');

    if (prodError || !products || products.length === 0) {
      return { success: false, message: 'Could not find the requested products. They may no longer be available.' };
    }

    const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));

    // Validate stock and price
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        return { success: false, message: `Product not found: ${item.productId}` };
      }
      const price = Number(product.price);
      if (!Number.isFinite(price) || price <= 0) {
        return { success: false, message: `Sorry, "${product.name}" is currently unavailable for purchase (no price set).` };
      }
      if (product.quantity < item.quantity) {
        return { success: false, message: `Sorry, "${product.name}" only has ${product.quantity} units in stock, but you requested ${item.quantity}.` };
      }
    }

    // Calculate totals
    let subtotal = 0;
    for (const item of items) {
      const product = productMap.get(item.productId)!;
      subtotal += Number(product.price) * item.quantity;
    }
    const total = subtotal + shippingCost;

    // Generate order number and tracking number
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const trackingChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const trackingId = Array.from({ length: 6 }, () => trackingChars[Math.floor(Math.random() * trackingChars.length)]).join('');
    const trackingNumber = `SLI-${trackingId}`;

    const shippingData = {
      firstName: sanitizedShipping.firstName,
      lastName: sanitizedShipping.lastName,
      email: sanitizedShipping.email,
      phone: sanitizedShipping.phone,
      address: sanitizedShipping.address,
      city: sanitizedShipping.city,
      region: sanitizedShipping.region,
      country: 'Ghana',
    };

    // Insert order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert([{
        order_number: orderNumber,
        user_id: userId || null,
        email: sanitizedShipping.email,
        phone: sanitizedShipping.phone,
        status: 'pending',
        payment_status: 'pending',
        currency: 'GHS',
        subtotal,
        tax_total: 0,
        shipping_total: shippingCost,
        discount_total: 0,
        total,
        shipping_method: deliveryMethod,
        payment_method: paymentMethod,
        shipping_address: shippingData,
        billing_address: shippingData,
        metadata: {
          guest_checkout: !userId,
          first_name: sanitizedShipping.firstName,
          last_name: sanitizedShipping.lastName,
          tracking_number: trackingNumber,
          source: 'chat',
        },
      }])
      .select()
      .single();

    if (orderError || !order) {
      console.error('[ChatTools] createChatOrder order insert error:', orderError);
      return { success: false, message: 'Failed to create order. Please try again or use the checkout page.' };
    }

    // Insert order items
    const orderItems = items.map(item => {
      const product = productMap.get(item.productId)!;
      return {
        order_id: order.id,
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        unit_price: Number(product.price),
        total_price: Number(product.price) * item.quantity,
        metadata: {
          image: product.product_images?.[0]?.url || '',
          slug: product.slug,
          preorder_shipping: product.metadata?.preorder_shipping || null,
        },
      };
    });

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('[ChatTools] createChatOrder items insert error:', itemsError);
      return { success: false, message: 'Failed to add items to order. Please try again.' };
    }

    // Upsert customer record
    try {
      await supabaseAdmin.rpc('upsert_customer_from_order', {
        p_email: sanitizedShipping.email,
        p_phone: sanitizedShipping.phone,
        p_full_name: `${sanitizedShipping.firstName} ${sanitizedShipping.lastName}`.trim(),
        p_first_name: sanitizedShipping.firstName,
        p_last_name: sanitizedShipping.lastName,
        p_user_id: userId || null,
        p_address: shippingData,
      });
    } catch (e) {
      console.error('[ChatTools] upsert customer error:', e);
    }

    // Handle payment
    if (paymentMethod === 'moolre') {
      try {
        const moolreApiUser = process.env.MOOLRE_API_USER;
        const moolreApiPubkey = process.env.MOOLRE_API_PUBKEY;
        const moolreAccountNumber = process.env.MOOLRE_ACCOUNT_NUMBER;
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');

        if (!moolreApiUser || !moolreApiPubkey || !moolreAccountNumber) {
          return {
            success: true,
            orderNumber,
            total,
            message: `Order ${orderNumber} created (GH₵${total.toFixed(2)}), but payment gateway is not configured. Please complete payment through the website.`,
          };
        }

        const uniqueRef = `${orderNumber}-R${Date.now()}`;
        const payload = {
          type: 1,
          amount: total.toString(),
          email: process.env.MOOLRE_MERCHANT_EMAIL || 'contact@delizbeautytools.com',
          externalref: uniqueRef,
          callback: `${baseUrl}/api/payment/moolre/callback`,
          redirect: `${baseUrl}/order-success?order=${orderNumber}&payment_success=true`,
          reusable: '0',
          currency: 'GHS',
          accountnumber: moolreAccountNumber,
          metadata: {
            customer_email: sanitizedShipping.email,
            original_order_number: orderNumber,
          },
        };

        const response = await fetch('https://api.moolre.com/embed/link', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-USER': moolreApiUser,
            'X-API-PUBKEY': moolreApiPubkey,
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (result.status === 1 && result.data?.authorization_url) {
          return {
            success: true,
            orderNumber,
            total,
            paymentUrl: result.data.authorization_url,
            message: `Order ${orderNumber} created successfully! Total: GH₵${total.toFixed(2)} (including GH₵${shippingCost.toFixed(2)} delivery). Please complete your payment using the link below.`,
          };
        } else {
          return {
            success: true,
            orderNumber,
            total,
            message: `Order ${orderNumber} created (GH₵${total.toFixed(2)}), but we couldn't generate a payment link. Please visit your order page to complete payment.`,
          };
        }
      } catch (payErr: any) {
        console.error('[ChatTools] Moolre payment error:', payErr);
        return {
          success: true,
          orderNumber,
          total,
          message: `Order ${orderNumber} created (GH₵${total.toFixed(2)}), but payment initiation failed. Please visit the website to complete payment.`,
        };
      }
    }

    // COD or other payment methods
    return {
      success: true,
      orderNumber,
      total,
      message: `Order ${orderNumber} placed successfully! Total: GH₵${total.toFixed(2)} (including GH₵${shippingCost.toFixed(2)} delivery). Payment: Cash on Delivery. Your order will be delivered to ${sanitizedShipping.address}, ${sanitizedShipping.city}.`,
    };
  } catch (err: any) {
    console.error('[ChatTools] createChatOrder error:', err);
    return { success: false, message: 'Something went wrong creating your order. Please try using the checkout page instead.' };
  }
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function mapProduct(p: any): ChatProduct {
  const qty = Number(p.quantity) ?? 0;
  const moq = Number(p.metadata?.moq) || 1;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: Number(p.price),
    image: p.product_images?.[0]?.url || '',
    quantity: qty,
    maxStock: qty,
    moq,
    inStock: qty >= moq,
  };
}
