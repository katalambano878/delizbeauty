import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendOrderConfirmation } from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { hubtelCheckStatus, isHubtelPaid } from '@/lib/hubtel';

/**
 * Return-page verification for Hubtel hosted checkout.
 *
 * Called from /order-success after the customer returns from the checkout page.
 * Works locally (unlike the callback, which needs a public URL).
 *
 * SECURITY: we ONLY trust Hubtel's RMSC status endpoint for payment proof.
 * Everything here is idempotent — both this route and the callback may fire.
 */
export async function POST(req: Request) {
    try {
        // 1. Rate limit + same-origin enforcement.
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`verify:${clientId}`, RATE_LIMITS.payment);
        if (!rateLimitResult.success) {
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        const origin = req.headers.get('origin') || '';
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
        const host = req.headers.get('host') || '';
        if (origin) {
            let originHost = '';
            try {
                originHost = new URL(origin).host;
            } catch {
                originHost = '';
            }
            const appHost = appUrl ? new URL(appUrl).host : '';
            const sameOrigin = originHost && (originHost === host || (appHost && originHost === appHost));
            if (!sameOrigin) {
                console.warn('[Hubtel Verify] Cross-origin request rejected:', origin);
                return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
            }
        }

        const { orderNumber, email } = await req.json().catch(() => ({}));

        // 2. Validate email + order number format.
        if (!email || typeof email !== 'string' || !/\S+@\S+\.\S+/.test(email)) {
            return NextResponse.json({ success: false, message: 'A valid email is required' }, { status: 400 });
        }
        if (!orderNumber || typeof orderNumber !== 'string' || !/^ORD-\d+-\d+$/.test(orderNumber)) {
            return NextResponse.json({ success: false, message: 'Invalid order number format' }, { status: 400 });
        }

        console.log('[Hubtel Verify] Checking payment for:', orderNumber);

        const { data: order, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, payment_status, status, total, email, metadata')
            .eq('order_number', orderNumber)
            .single();

        // 3. IDOR guard: 404 on missing order OR email mismatch (don't reveal existence).
        if (fetchError || !order) {
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }
        if (String(order.email || '').trim().toLowerCase() !== email.trim().toLowerCase()) {
            console.warn('[Hubtel Verify] Email mismatch for order:', orderNumber);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        // 4. Already paid → idempotent success.
        if (order.payment_status === 'paid') {
            return NextResponse.json({
                success: true,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Order already paid',
            });
        }

        const clientReference = order.metadata?.hubtel_client_reference;
        if (!clientReference) {
            return NextResponse.json({
                success: false,
                status: order.status,
                payment_status: order.payment_status,
                message: 'No Hubtel checkout was initiated for this order',
            }, { status: 400 });
        }

        // 5. Re-query Hubtel status.
        const statusResult = await hubtelCheckStatus(clientReference);
        console.log(
            '[Hubtel Verify] RMSC status for', orderNumber,
            '| found:', statusResult.found,
            '| status:', statusResult.status,
            '| amount:', statusResult.amount,
            '| amountAfterCharges:', statusResult.amountAfterCharges
        );

        const verifiedPaid = statusResult.found && isHubtelPaid(statusResult.status);
        if (!verifiedPaid) {
            return NextResponse.json({
                success: false,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Payment not yet confirmed by payment provider',
            });
        }

        // Settlement amount must match order total within 0.01.
        const settled = statusResult.amountAfterCharges ?? statusResult.amount;
        const expected = Number(order.total);
        if (settled !== null && Math.abs(settled - expected) > 0.01) {
            console.error('[Hubtel Verify] AMOUNT MISMATCH! Expected:', expected, 'Settled:', settled);
            return NextResponse.json({
                success: false,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Payment amount does not match order total',
            }, { status: 400 });
        }

        // Mark paid via RPC (idempotent with the callback).
        const paymentRef = String(statusResult.transactionId || clientReference);
        const { data: orderJson, error: updateError } = await supabaseAdmin.rpc('mark_order_paid', {
            order_ref: orderNumber,
            moolre_ref: paymentRef,
        });

        if (updateError) {
            console.error('[Hubtel Verify] RPC error:', updateError.message);
            return NextResponse.json({ success: false, message: 'Failed to update order' }, { status: 500 });
        }

        console.log('[Hubtel Verify] Order marked paid:', orderNumber);

        if (orderJson?.email) {
            try {
                await supabaseAdmin.rpc('update_customer_stats', {
                    p_customer_email: orderJson.email,
                    p_order_total: orderJson.total,
                });
            } catch (statsError: any) {
                console.error('[Hubtel Verify] Customer stats failed:', statsError.message);
            }
        }

        if (orderJson) {
            try {
                await sendOrderConfirmation(orderJson);
                console.log('[Hubtel Verify] Notifications sent for:', orderNumber);
            } catch (notifyError: any) {
                console.error('[Hubtel Verify] Notification failed:', notifyError.message);
            }
        }

        return NextResponse.json({
            success: true,
            status: 'processing',
            payment_status: 'paid',
            message: 'Payment verified and order updated',
        });
    } catch (error: any) {
        console.error('[Hubtel Verify] Error:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
    }
}
