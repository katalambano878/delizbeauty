import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

function getAccessToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/\bsb-access-token=([^;]+)/);
  if (match) return decodeURIComponent(match[1].trim());
  const authCookie = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('sb-') && (c.includes('-auth-token') || c.includes('auth')));
  if (!authCookie) return null;
  const value = authCookie.split('=').slice(1).join('=').trim();
  const decoded = decodeURIComponent(value);
  try {
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed) && parsed[0]) return parsed[0];
    if (parsed?.access_token) return parsed.access_token;
    if (typeof parsed === 'string') return parsed;
  } catch {
    return decoded;
  }
  return null;
}

async function requireAdmin(request: Request): Promise<NextResponse | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
  }
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  const role = profile?.role != null ? String(profile.role) : '';
  if (role !== 'admin' && role !== 'staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

/**
 * POST /api/admin/pos/orders
 * Create a POS order (and items) using service role so RLS does not block walk-in (user_id: null).
 */
export async function POST(request: Request) {
  const err = await requireAdmin(request);
  if (err) return err;

  try {
    const body = await request.json();
    const {
      order_number,
      email,
      phone,
      status,
      payment_status,
      subtotal,
      discount_total,
      total,
      shipping_method,
      payment_method,
      shipping_address,
      billing_address,
      metadata,
      items,
      mark_paid,
    } = body;

    if (!order_number || total == null || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing order_number, total, or items' }, { status: 400 });
    }

    const paidNow = Boolean(mark_paid) && (payment_status === 'paid' || payment_method === 'cash' || payment_method === 'card');
    const orderStatus = paidNow
      ? (shipping_method === 'doorstep' || shipping_method === 'delivery' ? 'processing' : 'delivered')
      : (status === 'pending' || status === 'awaiting_payment' ? status : 'pending');

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_number,
        user_id: null,
        email: email || null,
        phone: phone || null,
        status: orderStatus,
        payment_status: payment_status || 'pending',
        currency: 'GHS',
        subtotal: Number(subtotal) || 0,
        tax_total: 0,
        shipping_total: 0,
        discount_total: Number(discount_total) || 0,
        total: Number(total) || 0,
        shipping_method: shipping_method || 'pickup',
        payment_method: payment_method || 'cash',
        shipping_address: shipping_address || {},
        billing_address: billing_address || {},
        metadata: {
          ...(metadata || {}),
          receipt_token: randomBytes(16).toString('hex'),
        },
      })
      .select()
      .single();

    if (orderError) {
      console.error('POS order insert error:', orderError);
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    const orderItems = items.map((item: any) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.product_name,
      variant_name: item.variant_name || null,
      quantity: item.quantity,
      unit_price: Number(item.unit_price) || 0,
      total_price: Number(item.total_price) || 0,
      metadata: item.metadata || {},
    }));

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItems);
    if (itemsError) {
      console.error('POS order_items insert error:', itemsError);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    if (paidNow) {
      try {
        await supabaseAdmin.rpc('mark_order_paid', {
          order_ref: order_number,
          moolre_ref: `POS-${(payment_method || 'cash').toUpperCase()}-${Date.now()}`,
        });
      } catch (e) {
        console.error('mark_order_paid error:', e);
      }
    }

    return NextResponse.json({ order });
  } catch (e: any) {
    console.error('POS orders API error:', e);
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
