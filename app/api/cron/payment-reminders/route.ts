import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sendPaymentLink, sendOrderConfirmation } from '@/lib/notifications';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Safety net: reconcile unpaid Moolre orders against Moolre's transaction-status
 * API. If a payment actually went through but our callback/verify missed it, mark
 * the order paid so it never stays stuck as "pending". Runs before reminders so we
 * never nag a customer who already paid.
 */
async function reconcileMoolrePayments(supabase: SupabaseClient) {
  const apiUser = process.env.MOOLRE_API_USER;
  const apiPubkey = process.env.MOOLRE_API_PUBKEY;
  const accountNumber = process.env.MOOLRE_ACCOUNT_NUMBER;
  if (!apiUser || !apiPubkey || !accountNumber) {
    console.warn('[Reconcile] Missing Moolre credentials — skipping reconciliation');
    return { checked: 0, recovered: 0 };
  }

  // Only look back a few days — Moolre transactions settle quickly and older
  // unpaid orders are abandoned carts.
  const sinceIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, total, email, payment_status, metadata')
    .neq('payment_status', 'paid')
    .neq('payment_status', 'failed')
    .eq('payment_method', 'moolre')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    console.error('[Reconcile] Query error:', error);
    return { checked: 0, recovered: 0 };
  }

  let checked = 0;
  let recovered = 0;

  for (const order of orders || []) {
    const uniqueRef = order.metadata?.moolre_unique_ref || order.order_number;
    checked++;
    try {
      const res = await fetch('https://api.moolre.com/open/transact/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-USER': apiUser,
          'X-API-PUBKEY': apiPubkey,
        },
        body: JSON.stringify({ type: 1, idtype: '1', id: uniqueRef, accountnumber: accountNumber }),
      });
      const result = await res.json().catch(() => ({}));
      const data = result.data || {};
      const txOk = data.txstatus === 1 || data.txstatus === '1';
      const apiOk = result.status === 1 || result.status === '1';
      if (!apiOk || !txOk) continue;

      // Verify amount matches before trusting it.
      if (data.amount != null) {
        const paid = parseFloat(String(data.amount));
        if (Math.abs(paid - Number(order.total)) > 0.01) {
          console.error(`[Reconcile] Amount mismatch for ${order.order_number}: expected ${order.total}, got ${paid}`);
          continue;
        }
      }

      const { data: orderJson, error: rpcError } = await supabase.rpc('mark_order_paid', {
        order_ref: order.order_number,
        moolre_ref: String(data.transactionid || data.thirdpartyref || 'reconciled'),
      });
      if (rpcError) {
        console.error(`[Reconcile] mark_order_paid failed for ${order.order_number}:`, rpcError.message);
        continue;
      }

      recovered++;
      console.log(`[Reconcile] Recovered payment for ${order.order_number} (txn ${data.transactionid})`);

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
          console.error(`[Reconcile] Post-payment steps failed for ${order.order_number}:`, notifyErr?.message);
        }
      }
    } catch (e: any) {
      console.warn(`[Reconcile] Status check failed for ${order.order_number}:`, e?.message);
    }
  }

  return { checked, recovered };
}

// This endpoint is called by a cron job to send payment reminders
// for orders that haven't been paid within 15 minutes
export async function GET(request: Request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Safety net: recover any payments that succeeded on Moolre but were missed
    // by the callback/verify flow, BEFORE sending reminders (so we don't nag
    // customers who already paid).
    const reconcile = await reconcileMoolrePayments(supabase);
    console.log(`[Payment Reminders] Reconciled ${reconcile.recovered}/${reconcile.checked} pending Moolre orders`);

    // Find orders that:
    // 1. Are not paid
    // 2. Were created more than 15 minutes ago
    // 3. Haven't had a reminder sent yet
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { data: pendingOrders, error } = await supabase
      .from('orders')
      .select('id, order_number, email, phone, total, shipping_address, metadata')
      .neq('payment_status', 'paid')
      .eq('payment_reminder_sent', false)
      .lt('created_at', fifteenMinutesAgo)
      .order('created_at', { ascending: true })
      .limit(50); // Process max 50 at a time to avoid timeout

    if (error) {
      console.error('[Payment Reminders] Query error:', error);
      throw error;
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No pending reminders to send',
        processed: 0,
        reconciled: reconcile.recovered
      });
    }

    console.log(`[Payment Reminders] Found ${pendingOrders.length} orders to remind`);

    let sent = 0;
    let failed = 0;

    for (const order of pendingOrders) {
      try {
        // Send payment link notification
        await sendPaymentLink(order);

        // Mark as sent
        await supabase
          .from('orders')
          .update({ 
            payment_reminder_sent: true,
            payment_reminder_sent_at: new Date().toISOString()
          })
          .eq('id', order.id);

        sent++;
        console.log(`[Payment Reminders] Sent reminder for order ${order.order_number}`);
      } catch (err) {
        console.error(`[Payment Reminders] Failed for order ${order.order_number}:`, err);
        failed++;
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Processed ${pendingOrders.length} orders`,
      sent,
      failed,
      reconciled: reconcile.recovered
    });

  } catch (error: any) {
    console.error('[Payment Reminders] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
