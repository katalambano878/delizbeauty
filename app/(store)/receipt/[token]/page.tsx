import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const metadata: Metadata = {
  title: 'Receipt',
  robots: { index: false, follow: false },
};

type ReceiptItem = {
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
};

type ReceiptOrder = {
  order_number: string;
  status: string;
  payment_status: string;
  total: number;
  subtotal: number;
  discount_total: number;
  created_at: string;
  payment_method: string | null;
  order_items: ReceiptItem[] | null;
};

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  const { data } = await supabaseAdmin
    .from('orders')
    .select('order_number, status, payment_status, total, subtotal, discount_total, created_at, payment_method, order_items(product_name, variant_name, quantity, unit_price, total_price)')
    .eq('metadata->>receipt_token', token)
    .maybeSingle();

  const order = data as ReceiptOrder | null;
  if (!order) notFound();

  const items = order.order_items || [];
  const placed = new Date(order.created_at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <main className="min-h-screen bg-[#f6f4f1] px-4 py-10">
      <article className="mx-auto max-w-lg rounded-3xl bg-white px-6 py-8 shadow-[0_20px_50px_-28px_rgba(0,0,0,0.45)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Deliz Beauty Tools</p>
        <h1 className="mt-2 font-serif text-3xl text-gray-950">Receipt</h1>
        <p className="mt-1 text-sm text-gray-500">{order.order_number}</p>
        <p className="text-sm text-gray-500">{placed}</p>

        <div className="mt-6 flex items-center justify-between border-y border-gray-100 py-4">
          <span className="text-sm text-gray-600">{order.payment_status === 'paid' ? 'Paid' : 'Payment pending'}</span>
          <span className="text-2xl font-semibold tabular-nums text-gray-950">GH₵{Number(order.total).toFixed(2)}</span>
        </div>

        <ul className="mt-6 space-y-4">
          {items.map((item, index) => (
            <li key={`${item.product_name}-${index}`} className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-gray-950">{item.product_name}</p>
                {item.variant_name && <p className="text-sm text-gray-500">{item.variant_name}</p>}
                <p className="text-sm text-gray-500">Qty {item.quantity}</p>
              </div>
              <p className="tabular-nums text-gray-950">GH₵{Number(item.total_price || item.unit_price * item.quantity).toFixed(2)}</p>
            </li>
          ))}
        </ul>

        <dl className="mt-6 space-y-2 border-t border-gray-100 pt-4 text-sm">
          <div className="flex justify-between text-gray-600">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">GH₵{Number(order.subtotal).toFixed(2)}</dd>
          </div>
          {Number(order.discount_total) > 0 && (
            <div className="flex justify-between text-gray-600">
              <dt>Discount</dt>
              <dd className="tabular-nums">−GH₵{Number(order.discount_total).toFixed(2)}</dd>
            </div>
          )}
          <div className="flex justify-between font-semibold text-gray-950">
            <dt>Total</dt>
            <dd className="tabular-nums">GH₵{Number(order.total).toFixed(2)}</dd>
          </div>
        </dl>
      </article>
    </main>
  );
}
