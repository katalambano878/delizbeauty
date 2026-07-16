import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOrderConfirmation } from '@/lib/notifications';
import {
    hubtelCheckStatus,
    isHubtelPaid,
    hubtelAmountMatches,
    isHubtelConfigured,
} from '@/lib/hubtel';

/**
 * Payment reconciler — safety net behind Hubtel (and later Moolre) callbacks.
 *
 * Every 5 minutes: for unpaid Hubtel orders in the lookback window, query RMSC
 * status. If Hubtel says paid and the amount matches, run mark_order_paid +
 * notifications. Idempotent with the callback/verify routes.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Manual catch-up: ?lookback_hours=168&max=100
 */

const DEFAULT_LOOKBACK_HOURS = 72;
const DEFAULT_MAX = 60;

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isHubtelConfigured()) {
        return NextResponse.json({ error: 'Hubtel not configured' }, { status: 503 });
    }

    const url = new URL(request.url);
    const lookbackHours = Math.min(
        Math.max(parseInt(url.searchParams.get('lookback_hours') || '', 10) || DEFAULT_LOOKBACK_HOURS, 1),
        24 * 30
    );
    const maxPerRun = Math.min(
        Math.max(parseInt(url.searchParams.get('max') || '', 10) || DEFAULT_MAX, 1),
        200
    );

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
    const { data: candidates, error } = await supabase
        .from('orders')
        .select('id, order_number, total, email, payment_status, status, metadata, payment_method, payment_provider, created_at')
        .gte('created_at', since)
        .in('payment_status', ['pending', 'failed'])
        .order('created_at', { ascending: true })
        .limit(maxPerRun);

    if (error) {
        console.error('[Reconciler] Query failed:', error.message);
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
    }

    const counters = {
        examined: 0,
        confirmed: 0,
        still_pending: 0,
        amount_mismatch: 0,
        skipped: 0,
        errors: 0,
    };
    const confirmedOrders: string[] = [];

    for (const order of candidates || []) {
        const meta: any = order.metadata || {};
        const gateway = String(
            meta.payment_gateway || meta.payment_method || order.payment_method || order.payment_provider || ''
        ).toLowerCase();

        if (gateway !== 'hubtel') {
            counters.skipped += 1;
            continue;
        }

        const clientRef = meta.hubtel_client_reference as string | undefined;
        if (!clientRef) {
            counters.skipped += 1;
            continue;
        }

        counters.examined += 1;

        try {
            const status = await hubtelCheckStatus(clientRef);
            if (!status.found || !isHubtelPaid(status.status)) {
                counters.still_pending += 1;
                continue;
            }

            if (!hubtelAmountMatches(Number(order.total), status)) {
                console.error(
                    `[Reconciler] Amount mismatch ${order.order_number}: expected ${order.total}, paid ${status.amount}, afterFees ${status.amountAfterCharges}`
                );
                counters.amount_mismatch += 1;
                continue;
            }

            const { data: orderJson, error: rpcError } = await supabase.rpc('mark_order_paid', {
                order_ref: order.order_number,
                moolre_ref: String(status.transactionId || 'reconciler-hubtel'),
            });

            if (rpcError) {
                console.error(`[Reconciler] mark_order_paid failed for ${order.order_number}:`, rpcError.message);
                counters.errors += 1;
                continue;
            }

            counters.confirmed += 1;
            confirmedOrders.push(order.order_number);
            console.log(`[Reconciler] Confirmed Hubtel payment for ${order.order_number}`);

            if (orderJson) {
                try {
                    if (orderJson.email) {
                        await supabase.rpc('update_customer_stats', {
                            p_customer_email: orderJson.email,
                            p_order_total: orderJson.total,
                        });
                    }
                    await sendOrderConfirmation(orderJson);
                } catch (notifyErr: any) {
                    console.error(`[Reconciler] Post-payment steps failed for ${order.order_number}:`, notifyErr?.message);
                }
            }
        } catch (e: any) {
            console.warn(`[Reconciler] Status check failed for ${order.order_number}:`, e?.message);
            counters.errors += 1;
        }
    }

    return NextResponse.json({
        success: true,
        lookback_hours: lookbackHours,
        counters,
        confirmed_orders: confirmedOrders,
    });
}
