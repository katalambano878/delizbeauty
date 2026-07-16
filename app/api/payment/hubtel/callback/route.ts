import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendOrderConfirmation } from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import {
    stripHubtelReferenceSuffix,
    hubtelCheckStatusWithRetry,
    isHubtelPaid,
    isHubtelFailure,
    hubtelAmountMatches,
} from '@/lib/hubtel';

/**
 * Hubtel checkout callback (webhook).
 *
 * SECURITY: Hubtel does NOT sign callbacks. We NEVER mark an order paid from
 * the callback body alone — we re-query the RMSC status endpoint and require
 * Hubtel's own API to confirm payment AND the amount to match.
 *
 * IMPORTANT: return HTTP 503 when payment is not yet confirmed so Hubtel
 * retries (returning 200 stops retries even if we haven't marked paid).
 */
export async function POST(req: Request) {
    console.log('[Hubtel Callback] POST received at', new Date().toISOString());

    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`callback:${clientId}`, RATE_LIMITS.callback);
        if (!rateLimitResult.success) {
            console.warn('[Hubtel Callback] Rate limited:', clientId);
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        // Tolerate JSON, form-encoded, or raw bodies.
        let body: any = {};
        const contentType = req.headers.get('content-type') || '';
        try {
            if (contentType.includes('application/json')) {
                body = await req.json();
            } else if (contentType.includes('form')) {
                const formData = await req.formData();
                body = Object.fromEntries(formData.entries());
            } else {
                const rawText = await req.text();
                try {
                    body = JSON.parse(rawText);
                } catch {
                    body = Object.fromEntries(new URLSearchParams(rawText).entries());
                }
            }
        } catch {
            console.error('[Hubtel Callback] Body parsing failed');
            return NextResponse.json({ success: false, message: 'Invalid Request Body' }, { status: 400 });
        }

        const data = body?.Data || body?.data || {};
        const clientReference =
            data.ClientReference || data.clientReference || body.ClientReference || body.clientReference;
        const responseCode = body.ResponseCode || body.responseCode || data.ResponseCode;
        const callbackStatus = data.Status || data.status || body.Status || body.status;

        console.log(
            '[Hubtel Callback] ref:', clientReference,
            '| ResponseCode:', responseCode,
            '| callback status:', callbackStatus
        );

        if (!clientReference) {
            console.error('[Hubtel Callback] Missing ClientReference. Body:', JSON.stringify(body).substring(0, 500));
            return NextResponse.json({ success: false, message: 'Missing client reference' }, { status: 400 });
        }

        const orderNumber = stripHubtelReferenceSuffix(clientReference);

        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, payment_status, total, email, metadata')
            .eq('order_number', orderNumber)
            .single();

        if (fetchError || !existingOrder) {
            console.error('[Hubtel Callback] Order not found:', orderNumber);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        if (existingOrder.payment_status === 'paid') {
            console.log('[Hubtel Callback] Order already paid, skipping:', orderNumber);
            return NextResponse.json({ success: true, message: 'Order already processed' });
        }

        // Re-verify with Hubtel (retry — RMSC can lag the webhook).
        const statusResult = await hubtelCheckStatusWithRetry(clientReference, {
            attempts: 3,
            delayMs: 2000,
        });
        console.log(
            '[Hubtel Callback] RMSC status for', orderNumber,
            '| found:', statusResult.found,
            '| status:', statusResult.status,
            '| amount:', statusResult.amount,
            '| amountAfterCharges:', statusResult.amountAfterCharges
        );

        const verifiedPaid = statusResult.found && isHubtelPaid(statusResult.status);

        if (!verifiedPaid) {
            const terminalFailure =
                isHubtelFailure(statusResult.status, statusResult.responseCode) ||
                isHubtelFailure(callbackStatus, responseCode);

            console.log(
                '[Hubtel Callback] Not confirmed paid for', orderNumber,
                '| terminalFailure:', terminalFailure
            );

            if (terminalFailure) {
                const { data: failOrder } = await supabaseAdmin
                    .from('orders')
                    .select('metadata')
                    .eq('order_number', orderNumber)
                    .single();
                await supabaseAdmin
                    .from('orders')
                    .update({
                        payment_status: 'failed',
                        metadata: {
                            ...(failOrder?.metadata || {}),
                            hubtel_checkout_id: data.CheckoutId || data.checkoutId || failOrder?.metadata?.hubtel_checkout_id || null,
                            failure_reason: `Hubtel status: ${statusResult.status || callbackStatus || 'failed'}`,
                            failed_at: new Date().toISOString(),
                        },
                    })
                    .eq('order_number', orderNumber);
                return NextResponse.json({ success: false, message: 'Payment failed' });
            }

            // Not yet confirmed — ask Hubtel to retry (503), not 200.
            return NextResponse.json(
                { success: false, message: 'Payment not confirmed by gateway yet' },
                { status: 503 }
            );
        }

        // Match customer-paid amount OR settlement (merchant-fee accounts diverge).
        if (!hubtelAmountMatches(Number(existingOrder.total), statusResult)) {
            console.error(
                '[Hubtel Callback] AMOUNT MISMATCH — REJECTING! Expected:', existingOrder.total,
                'Paid:', statusResult.amount,
                'AfterFees:', statusResult.amountAfterCharges,
                'Order:', orderNumber
            );
            return NextResponse.json(
                { success: false, message: 'Payment amount does not match order total' },
                { status: 400 }
            );
        }

        const paymentRef = String(statusResult.transactionId || data.CheckoutId || clientReference);
        const { data: orderJson, error: updateError } = await supabaseAdmin.rpc('mark_order_paid', {
            order_ref: orderNumber,
            moolre_ref: paymentRef,
        });

        if (updateError) {
            console.error('[Hubtel Callback] RPC error:', updateError.message);
            return NextResponse.json({ success: false, message: 'Database update failed' }, { status: 500 });
        }
        if (!orderJson) {
            console.error('[Hubtel Callback] Order not found after RPC:', orderNumber);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        console.log('[Hubtel Callback] Order marked paid:', orderNumber);

        try {
            if (orderJson.email) {
                await supabaseAdmin.rpc('update_customer_stats', {
                    p_customer_email: orderJson.email,
                    p_order_total: orderJson.total,
                });
            }
        } catch (statsError: any) {
            console.error('[Hubtel Callback] Customer stats failed:', statsError.message);
        }

        try {
            await sendOrderConfirmation(orderJson);
            console.log('[Hubtel Callback] Notifications sent for:', orderNumber);
        } catch (notifyError: any) {
            console.error('[Hubtel Callback] Notification failed:', notifyError.message);
        }

        return NextResponse.json({ success: true, message: 'Payment verified and order updated' });
    } catch (error: any) {
        console.error('[Hubtel Callback] Critical error:', error?.message || error);
        // 503 so Hubtel retries on unexpected failures
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 503 });
    }
}

export async function GET() {
    return NextResponse.json({
        message: 'Hubtel callback endpoint ready',
        timestamp: new Date().toISOString(),
    });
}
