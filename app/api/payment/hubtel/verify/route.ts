import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendOrderConfirmation } from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import {
    hubtelCheckStatusWithRetry,
    isHubtelPaid,
    hubtelAmountMatches,
    getHubtelPublicBaseUrl,
} from '@/lib/hubtel';

/**
 * Return-page verification for Hubtel hosted checkout.
 *
 * Called from /order-success after the customer returns from checkout.
 * Idempotent with the callback — both re-verify via RMSC.
 */
export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`verify:${clientId}`, RATE_LIMITS.payment);
        if (!rateLimitResult.success) {
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        // Soft same-origin: only reject when Origin is present AND clearly foreign.
        const origin = req.headers.get('origin') || '';
        const appUrl = getHubtelPublicBaseUrl();
        const host = req.headers.get('host') || '';
        if (origin) {
            let originHost = '';
            try {
                originHost = new URL(origin).host;
            } catch {
                originHost = '';
            }
            let appHost = '';
            try {
                appHost = appUrl ? new URL(appUrl).host : '';
            } catch {
                appHost = '';
            }
            const allowed = new Set(
                [host, appHost, 'delizbeautytools.com', 'www.delizbeautytools.com'].filter(Boolean)
            );
            if (originHost && !allowed.has(originHost)) {
                console.warn('[Hubtel Verify] Cross-origin request rejected:', origin);
                return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
            }
        }

        const body = await req.json().catch(() => ({}));
        const { orderNumber, email, externalRef } = body || {};

        if (!orderNumber || typeof orderNumber !== 'string' || !/^ORD-\d+-\d+$/.test(orderNumber)) {
            return NextResponse.json({ success: false, message: 'Invalid order number format' }, { status: 400 });
        }

        console.log('[Hubtel Verify] Checking payment for:', orderNumber);

        const { data: order, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, payment_status, status, total, email, metadata')
            .eq('order_number', orderNumber)
            .single();

        if (fetchError || !order) {
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        // IDOR guard only when an email was supplied AND the order has one.
        // Guest checkouts sometimes have empty email — don't block those.
        if (
            email &&
            typeof email === 'string' &&
            order.email &&
            String(order.email).trim().toLowerCase() !== email.trim().toLowerCase()
        ) {
            console.warn('[Hubtel Verify] Email mismatch for order:', orderNumber);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        if (order.payment_status === 'paid') {
            return NextResponse.json({
                success: true,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Order already paid',
            });
        }

        const clientReference =
            (typeof externalRef === 'string' && externalRef) ||
            order.metadata?.hubtel_client_reference;

        if (!clientReference) {
            return NextResponse.json({
                success: false,
                status: order.status,
                payment_status: order.payment_status,
                message: 'No Hubtel checkout was initiated for this order',
            }, { status: 400 });
        }

        const statusResult = await hubtelCheckStatusWithRetry(clientReference, {
            attempts: 3,
            delayMs: 1500,
        });
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

        if (!hubtelAmountMatches(Number(order.total), statusResult)) {
            console.error(
                '[Hubtel Verify] AMOUNT MISMATCH! Expected:', order.total,
                'Paid:', statusResult.amount,
                'AfterFees:', statusResult.amountAfterCharges
            );
            return NextResponse.json({
                success: false,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Payment amount does not match order total',
            }, { status: 400 });
        }

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
