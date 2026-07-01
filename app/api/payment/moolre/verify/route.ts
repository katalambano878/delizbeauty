import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendOrderConfirmation } from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Payment verification endpoint.
 * Called from the order-success page after the user completes payment on Moolre.
 * 
 * SECURITY: We ONLY trust Moolre's API response for payment verification.
 * The `fromRedirect` flag is NO LONGER trusted as proof of payment,
 * because anyone could forge that request.
 */
export async function POST(req: Request) {
    try {
        // Rate limiting
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`verify:${clientId}`, RATE_LIMITS.payment);

        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, message: 'Too many requests' },
                { status: 429 }
            );
        }

        const { orderNumber } = await req.json();

        if (!orderNumber || typeof orderNumber !== 'string') {
            return NextResponse.json({ success: false, message: 'Missing or invalid orderNumber' }, { status: 400 });
        }

        // Sanitize: only allow expected order number format
        if (!/^ORD-\d+-\d+$/.test(orderNumber)) {
            return NextResponse.json({ success: false, message: 'Invalid order number format' }, { status: 400 });
        }

        console.log('[Verify] Checking payment for:', orderNumber);

        // 1. Check current order status
        const { data: order, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, payment_status, status, total, email, phone, shipping_address, metadata')
            .eq('order_number', orderNumber)
            .single();

        if (fetchError || !order) {
            console.error('[Verify] Order not found:', orderNumber);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        // Already paid - no action needed
        if (order.payment_status === 'paid') {
            console.log('[Verify] Order already paid:', orderNumber);
            return NextResponse.json({
                success: true,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Order already paid'
            });
        }

        // 2. Verify payment method is moolre
        if (order.metadata?.payment_method && order.metadata.payment_method !== 'moolre') {
            return NextResponse.json({
                success: false,
                message: 'This order does not use Moolre payment'
            }, { status: 400 });
        }

        // 3. ONLY verify with Moolre's API — no more trusting client-side flags
        let moolreApiVerified = false;

        if (!process.env.MOOLRE_API_USER || !process.env.MOOLRE_API_PUBKEY || !process.env.MOOLRE_ACCOUNT_NUMBER) {
            console.error('[Verify] Missing Moolre API credentials');
            return NextResponse.json({
                success: false,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Payment verification unavailable'
            }, { status: 503 });
        }

        // Build list of refs to try — unique ref first, plain order number as fallback
        const refsToTry: string[] = [];
        if (order.metadata?.moolre_unique_ref) refsToTry.push(order.metadata.moolre_unique_ref);
        refsToTry.push(orderNumber); // always try plain order number too

        for (const ref of refsToTry) {
            if (moolreApiVerified) break;
            try {
                console.log('[Verify] Querying Moolre with ref:', ref);

                // Official transaction-status endpoint. idtype 1 = our externalref.
                const checkResponse = await fetch('https://api.moolre.com/open/transact/status', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-USER': process.env.MOOLRE_API_USER,
                        'X-API-PUBKEY': process.env.MOOLRE_API_PUBKEY
                    },
                    body: JSON.stringify({
                        type: 1,
                        idtype: '1',
                        id: ref,
                        accountnumber: process.env.MOOLRE_ACCOUNT_NUMBER
                    })
                });

                const checkResult = await checkResponse.json();
                console.log('[Verify] Moolre response for ref', ref, ':', JSON.stringify(checkResult));

                const data = checkResult.data || {};

                // Status API returns data.txstatus (1 = success). Also accept the
                // callback-style field name (txtstatus) defensively.
                const apiOk = checkResult.status === 1 || checkResult.status === '1';
                const txOk =
                    data.txstatus === 1 || data.txstatus === '1' ||
                    data.txtstatus === 1 || data.txtstatus === '1';
                const statusStr = String(data.status || data.txtstatus_description || '').toLowerCase();
                const messageStr = String(checkResult.message || '').toLowerCase();
                const statusOk = txOk ||
                    statusStr.includes('success') || statusStr.includes('complet') || statusStr === 'paid' ||
                    messageStr.includes('successful') || messageStr.includes('success');

                const candidate = apiOk && statusOk && !messageStr.includes('fail') && !messageStr.includes('not found');

                if (candidate) {
                    // Verify amount if provided
                    if (data.amount) {
                        const paidAmount = parseFloat(data.amount);
                        const expectedAmount = Number(order.total);
                        if (Math.abs(paidAmount - expectedAmount) > 0.01) {
                            console.error('[Verify] AMOUNT MISMATCH! Expected:', expectedAmount, 'Got:', paidAmount);
                            continue;
                        }
                    }
                    moolreApiVerified = true;
                    console.log('[Verify] Payment confirmed via ref:', ref);
                }
            } catch (moolreError: any) {
                console.warn('[Verify] Moolre check failed for ref', ref, ':', moolreError.message);
            }
        }

        // 4. Only proceed if Moolre API confirmed payment
        if (!moolreApiVerified) {
            console.log('[Verify] Cannot verify payment for:', orderNumber);
            return NextResponse.json({
                success: false,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Payment not yet confirmed by payment provider'
            });
        }

        console.log('[Verify] Marking order paid via moolre-api for:', orderNumber);

        // 5. Mark as paid
        const { data: orderJson, error: updateError } = await supabaseAdmin
            .rpc('mark_order_paid', {
                order_ref: orderNumber,
                moolre_ref: 'moolre-api-verify'
            });

        if (updateError) {
            console.error('[Verify] RPC Error:', updateError.message);
            return NextResponse.json({ success: false, message: 'Failed to update order' }, { status: 500 });
        }

        console.log('[Verify] Order marked as paid:', orderNumber);

        // 6. Update customer stats
        if (orderJson?.email) {
            try {
                await supabaseAdmin.rpc('update_customer_stats', {
                    p_customer_email: orderJson.email,
                    p_order_total: orderJson.total
                });
            } catch (statsError: any) {
                console.error('[Verify] Customer stats failed:', statsError.message);
            }
        }

        // 7. Send notifications (SMS + Email)
        if (orderJson) {
            try {
                await sendOrderConfirmation(orderJson);
                console.log('[Verify] Notifications sent for:', orderNumber);
            } catch (notifyError: any) {
                console.error('[Verify] Notification failed:', notifyError.message);
            }
        }

        return NextResponse.json({
            success: true,
            status: 'processing',
            payment_status: 'paid',
            message: 'Payment verified and order updated'
        });

    } catch (error: any) {
        console.error('[Verify] Error:', error.message);
        return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
    }
}
