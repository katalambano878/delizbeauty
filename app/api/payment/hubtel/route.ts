import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import {
    isHubtelConfigured,
    makeHubtelClientReference,
    hubtelInitiateCheckout,
    normalizeGhPhone,
    getHubtelPublicBaseUrl,
} from '@/lib/hubtel';

const isUUID = (str: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Initiate a Hubtel hosted-checkout session for an existing order.
 *
 * SECURITY: never trusts client amounts — every line is re-priced from the
 * authoritative products/product_variants prices, and out-of-stock lines are
 * auto-removed before charging.
 */
export async function POST(req: Request) {
    try {
        // 1. Rate limit by client IP
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`payment:${clientId}`, RATE_LIMITS.payment);
        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, message: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': rateLimitResult.resetIn.toString(),
                    },
                }
            );
        }

        const body = await req.json().catch(() => ({}));
        const { orderId, customerEmail, redirectUrl } = body || {};

        if (!orderId || typeof orderId !== 'string') {
            return NextResponse.json({ success: false, message: 'Missing or invalid orderId' }, { status: 400 });
        }

        // 2. Ensure Hubtel credentials are configured
        if (!isHubtelConfigured()) {
            console.error('[Hubtel] Missing HUBTEL_API_ID / HUBTEL_API_KEY / HUBTEL_MERCHANT_ACCOUNT_NUMBER');
            return NextResponse.json({ success: false, message: 'Payment gateway configuration error' }, { status: 500 });
        }

        // 3. Look up the order (parameterized — never string-interpolated filters)
        const ORDER_SELECT =
            'id, order_number, subtotal, tax_total, shipping_total, discount_total, total, email, phone, payment_status, shipping_address, metadata, order_items(id, product_id, product_name, variant_name, quantity, unit_price, total_price, metadata)';

        const { data: order, error: orderError } = isUUID(orderId)
            ? await supabaseAdmin.from('orders').select(ORDER_SELECT).eq('id', orderId).single()
            : await supabaseAdmin.from('orders').select(ORDER_SELECT).eq('order_number', orderId).single();

        if (orderError || !order) {
            console.error('[Hubtel] Order not found:', orderId);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        const orderNumber = order.order_number;

        if (order.payment_status === 'paid') {
            return NextResponse.json({ success: false, message: 'Order is already paid' }, { status: 400 });
        }

        // 4 + 5. Re-price every line from the DB and detect out-of-stock items.
        const items = Array.isArray(order.order_items) ? order.order_items : [];
        const productIds = Array.from(
            new Set(items.map((i: any) => i.product_id).filter((id: any) => id && isUUID(id)))
        );

        const { data: products } = productIds.length > 0
            ? await supabaseAdmin
                .from('products')
                .select('id, name, price, status, quantity, track_quantity, continue_selling, product_variants(id, name, price, quantity)')
                .in('id', productIds as string[])
            : { data: [] as any[] };

        const productById = new Map<string, any>((products || []).map((p: any) => [p.id, p]));

        const keptItems: any[] = [];
        const removedItems: string[] = [];
        const repricedUpdates: { id: string; unit_price: number; total_price: number }[] = [];
        let recomputedSubtotal = 0;

        for (const item of items) {
            const product = item.product_id ? productById.get(item.product_id) : null;
            const label = `${item.product_name}${item.variant_name ? ` (${item.variant_name})` : ''}`;

            // Product missing or inactive → cannot be sold.
            if (!product || (product.status && product.status !== 'active')) {
                removedItems.push(label);
                continue;
            }

            // Resolve authoritative unit price (variant price beats base price).
            let variant: any = null;
            if (item.variant_name && Array.isArray(product.product_variants)) {
                variant = product.product_variants.find((v: any) => v.name === item.variant_name) || null;
            }
            const authoritativePrice = Number(variant ? variant.price : product.price);
            if (!Number.isFinite(authoritativePrice) || authoritativePrice <= 0) {
                // Unpriced product — cannot be sold.
                removedItems.push(label);
                continue;
            }

            // Stock check (only when the product tracks quantity and can't oversell).
            const stockEntity = variant || product;
            const tracks = product.track_quantity !== false && !product.continue_selling;
            if (tracks && typeof stockEntity.quantity === 'number' && stockEntity.quantity < item.quantity) {
                removedItems.push(label);
                continue;
            }

            const qty = Number(item.quantity) || 0;
            const lineTotal = round2(authoritativePrice * qty);
            recomputedSubtotal = round2(recomputedSubtotal + lineTotal);

            if (
                Math.abs(Number(item.unit_price) - authoritativePrice) > 0.01 ||
                Math.abs(Number(item.total_price) - lineTotal) > 0.01
            ) {
                repricedUpdates.push({ id: item.id, unit_price: authoritativePrice, total_price: lineTotal });
            }

            keptItems.push(item);
        }

        // All items unavailable → nothing to charge.
        if (keptItems.length === 0) {
            console.warn('[Hubtel] All items out of stock for order', orderNumber);
            return NextResponse.json(
                {
                    success: false,
                    all_out_of_stock: true,
                    removedItems,
                    message: 'All items in this order are no longer available.',
                },
                { status: 409 }
            );
        }

        // Recompute the authoritative total from server-side prices.
        const shipping = Number(order.shipping_total) || 0;
        const tax = Number(order.tax_total) || 0;
        const discount = Number(order.discount_total) || 0;
        const recomputedTotal = round2(recomputedSubtotal + shipping + tax - discount);

        const storedTotal = Number(order.total) || 0;
        const totalChanged = Math.abs(recomputedTotal - storedTotal) > 0.01;

        // Persist any repricing / removals BEFORE charging.
        const nextMetadata: Record<string, any> = { ...(order.metadata || {}) };

        if (removedItems.length > 0) {
            const removedIds = items
                .filter((i: any) => !keptItems.includes(i))
                .map((i: any) => i.id)
                .filter(Boolean);
            if (removedIds.length > 0) {
                await supabaseAdmin.from('order_items').delete().in('id', removedIds);
            }
            nextMetadata.auto_removed_items = removedItems;
            nextMetadata.auto_removed_at = new Date().toISOString();
        }

        for (const upd of repricedUpdates) {
            await supabaseAdmin
                .from('order_items')
                .update({ unit_price: upd.unit_price, total_price: upd.total_price })
                .eq('id', upd.id);
        }

        if (totalChanged) {
            nextMetadata.server_repriced_at = new Date().toISOString();
            nextMetadata.client_total_attempted = storedTotal;
        }

        const chargeAmount = round2(recomputedTotal);
        if (!chargeAmount || chargeAmount <= 0) {
            return NextResponse.json({ success: false, message: 'Invalid order amount' }, { status: 400 });
        }

        // 6. Build client reference + public URLs (Hubtel requires public HTTPS).
        // CRITICAL: use www host — apex delizbeautytools.com 307-redirects to www
        // and Hubtel's callback POST will not follow that redirect.
        const baseUrl = getHubtelPublicBaseUrl();
        if (!baseUrl || !baseUrl.startsWith('https://')) {
            console.error('[Hubtel] NEXT_PUBLIC_APP_URL must be a public https URL for callbacks. Got:', baseUrl || '(empty)');
            return NextResponse.json(
                { success: false, message: 'Payment gateway configuration error' },
                { status: 500 }
            );
        }

        const clientReference = makeHubtelClientReference(orderNumber);
        const callbackUrl = `${baseUrl}/api/payment/hubtel/callback`;
        const returnUrl =
            typeof redirectUrl === 'string' && redirectUrl.startsWith('https://')
                ? redirectUrl
                : `${baseUrl}/order-success?order=${encodeURIComponent(orderNumber)}&payment_success=true`;
        const cancellationUrl = `${baseUrl}/pay/${encodeURIComponent(orderNumber)}?cancelled=true`;

        // 7. Payee details (best-effort).
        const shippingAddr = order.shipping_address || {};
        const payeeName =
            [shippingAddr.firstName, shippingAddr.lastName].filter(Boolean).join(' ').trim() ||
            shippingAddr.full_name ||
            order.metadata?.first_name ||
            undefined;
        const payeeMobile = normalizeGhPhone(order.phone || shippingAddr.phone) || undefined;
        const payeeEmail = customerEmail || order.email || undefined;

        console.log(
            `[Hubtel] Initiating checkout | order ${orderNumber} | ref ${clientReference} | amount GHS ${chargeAmount}` +
            (removedItems.length ? ` | removed ${removedItems.length} item(s)` : '') +
            (totalChanged ? ` | repriced ${storedTotal} -> ${chargeAmount}` : '')
        );

        // 8. Call Hubtel initiate.
        const result = await hubtelInitiateCheckout({
            totalAmount: chargeAmount,
            description: `Payment for order ${orderNumber}`,
            callbackUrl,
            returnUrl,
            cancellationUrl,
            clientReference,
            payeeName,
            payeeMobileNumber: payeeMobile,
            payeeEmail,
        });

        const checkoutUrl = result.checkoutUrl || result.checkoutDirectUrl;
        if (!result.ok || !checkoutUrl) {
            console.error(
                `[Hubtel] Initiate failed for ${orderNumber} | HTTP ${result.status} | message: ${result.message || 'no checkout url'}`
            );
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "We couldn't start your payment right now. Please try again in a moment — if it keeps happening, contact us on WhatsApp and we'll help you complete your order.",
                },
                { status: 502 }
            );
        }

        // 9. Persist gateway metadata + recomputed totals.
        nextMetadata.payment_gateway = 'hubtel';
        nextMetadata.payment_method = 'hubtel';
        nextMetadata.hubtel_client_reference = clientReference;
        nextMetadata.hubtel_checkout_id = result.checkoutId || null;
        nextMetadata.hubtel_initiated_at = new Date().toISOString();

        const orderUpdate: Record<string, any> = {
            metadata: nextMetadata,
            payment_method: 'hubtel',
            payment_provider: 'hubtel',
        };
        if (totalChanged || removedItems.length > 0) {
            orderUpdate.subtotal = recomputedSubtotal;
            orderUpdate.total = recomputedTotal;
        }

        await supabaseAdmin.from('orders').update(orderUpdate).eq('id', order.id);

        // 10. Return checkout URL.
        return NextResponse.json({
            success: true,
            url: checkoutUrl,
            checkoutId: result.checkoutId || null,
            externalRef: clientReference,
            amount: chargeAmount,
            removedItems,
        });
    } catch (error: any) {
        console.error('[Hubtel] Initiate error:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
