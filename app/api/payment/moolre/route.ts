import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: Request) {
    try {
        // Rate limiting
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`payment:${clientId}`, RATE_LIMITS.payment);

        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, message: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': rateLimitResult.resetIn.toString()
                    }
                }
            );
        }

        const body = await req.json();
        const { orderId, customerEmail } = body;

        if (!orderId || typeof orderId !== 'string') {
            return NextResponse.json({ success: false, message: 'Missing or invalid orderId' }, { status: 400 });
        }

        // Ensure environment variables are set
        if (!process.env.MOOLRE_API_USER || !process.env.MOOLRE_API_PUBKEY || !process.env.MOOLRE_ACCOUNT_NUMBER) {
            console.error('Missing Moolre credentials');
            return NextResponse.json({ success: false, message: 'Payment gateway configuration error' }, { status: 500 });
        }

        // SECURITY: Fetch the order from the database and use its total.
        // NEVER trust the amount from the client.
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
        const query = supabaseAdmin
            .from('orders')
            .select('id, order_number, total, email, payment_status');

        const { data: order, error: orderError } = isUUID
            ? await query.eq('id', orderId).single()
            : await query.eq('order_number', orderId).single();

        if (orderError || !order) {
            console.error('[Payment] Order not found:', orderId);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        // Don't allow payment for already-paid orders
        if (order.payment_status === 'paid') {
            return NextResponse.json({ success: false, message: 'Order is already paid' }, { status: 400 });
        }

        // Use the database amount, NOT the client-provided amount
        const amount = Number(order.total);
        if (!amount || amount <= 0) {
            return NextResponse.json({ success: false, message: 'Invalid order amount' }, { status: 400 });
        }

        const orderRef = order.order_number || orderId;

        const requestUrl = new URL(req.url);
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin).replace(/\/+$/, '');

        // Moolre's backend occasionally fails transiently while provisioning the
        // Web POS terminal for a transaction (e.g. "SQLSTATE[23000] ... Column
        // 'terminal_id' cannot be null", or 5xx). Retry a few times with a fresh
        // externalref before giving up, so a single hiccup doesn't block a sale.
        const isTransientMoolreError = (status: number, message: string) => {
            const m = (message || '').toLowerCase();
            return (
                status >= 500 ||
                m.includes('terminal_id') ||
                m.includes('terminal id') ||
                m.includes('sqlstate') ||
                m.includes('integrity constraint') ||
                m.includes('try again') ||
                m.includes('timeout') ||
                m.includes('temporarily')
            );
        };

        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const MAX_ATTEMPTS = 3;

        let successUrl: string | null = null;
        let successReference: string | undefined;
        let successRef: string | null = null;
        let lastMessage = 'Failed to generate payment link';

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            // Fresh unique reference per attempt to avoid Moolre "Transaction already exists" on retry
            const uniqueRef = `${orderRef}-R${Date.now()}${attempt > 1 ? `-${attempt}` : ''}`;

            const payload = {
                type: 1,
                amount: amount.toString(),
                email: process.env.MOOLRE_MERCHANT_EMAIL || 'admin@standardecom.com',
                externalref: uniqueRef,
                callback: `${baseUrl}/api/payment/moolre/callback`,
                redirect: `${baseUrl}/order-success?order=${orderRef}&payment_success=true`,
                reusable: "0",
                currency: "GHS",
                accountnumber: process.env.MOOLRE_ACCOUNT_NUMBER,
                metadata: {
                    customer_email: customerEmail || order.email,
                    original_order_number: orderRef
                }
            };

            let result: any = {};
            let httpStatus = 0;
            try {
                const response = await fetch('https://api.moolre.com/embed/link', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-USER': process.env.MOOLRE_API_USER,
                        'X-API-PUBKEY': process.env.MOOLRE_API_PUBKEY
                    },
                    body: JSON.stringify(payload)
                });
                httpStatus = response.status;
                result = await response.json().catch(() => ({}));
            } catch (fetchErr: any) {
                httpStatus = 503;
                result = { message: fetchErr?.message || 'Network error' };
            }

            console.log(
                `[Payment] Attempt ${attempt}/${MAX_ATTEMPTS} for order ${orderRef} | HTTP ${httpStatus} | status ${result.status} | hasURL ${!!result.data?.authorization_url}`
            );

            if (result.status === 1 && result.data?.authorization_url) {
                successUrl = result.data.authorization_url;
                successReference = result.data.reference;
                successRef = uniqueRef;
                break;
            }

            lastMessage = result.message || lastMessage;

            // Stop early on non-transient (logical) errors — retrying won't help.
            if (!isTransientMoolreError(httpStatus, lastMessage)) {
                console.warn(`[Payment] Non-transient Moolre error for ${orderRef}:`, lastMessage);
                break;
            }

            console.warn(`[Payment] Transient Moolre error for ${orderRef} (attempt ${attempt}):`, lastMessage);
            if (attempt < MAX_ATTEMPTS) await sleep(400 * attempt);
        }

        if (successUrl && successRef) {
            // Persist the successful externalref so verify/callback can match it later.
            try {
                const { data: currentOrder } = await supabaseAdmin
                    .from('orders')
                    .select('metadata')
                    .eq('order_number', orderRef)
                    .single();
                await supabaseAdmin
                    .from('orders')
                    .update({ metadata: { ...(currentOrder?.metadata || {}), moolre_unique_ref: successRef, moolre_init_at: new Date().toISOString() } })
                    .eq('order_number', orderRef);
            } catch (metaErr) {
                console.warn('[Payment] Could not save uniqueRef to order:', metaErr);
            }

            return NextResponse.json({ success: true, url: successUrl, reference: successReference });
        }

        // All attempts failed — log the real reason but never leak the raw
        // gateway/SQL error to the customer.
        console.error(`[Payment] Failed to initialize payment for ${orderRef} after ${MAX_ATTEMPTS} attempts. Last message:`, lastMessage);
        return NextResponse.json(
            {
                success: false,
                message: "We couldn't start your payment right now. Please try again in a moment — if it keeps happening, contact us on WhatsApp and we'll help you complete your order."
            },
            { status: 502 }
        );

    } catch (error: any) {
        console.error('Payment API Error:', error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
