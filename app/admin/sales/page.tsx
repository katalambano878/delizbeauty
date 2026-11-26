'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { adminFetch, cedis } from '@/lib/admin-fetch';
import { markdownLabel, markdownPrice, type Markdown, type PricingMode } from '@/lib/pricing';
import { storageImageUrl } from '@/lib/storage-image';

type Row = {
  id: string;
  name: string;
  sku: string | null;
  status: string;
  price: number;
  low: number;
  high: number;
  options: number;
  category_id: string | null;
  category: string | null;
  image: string | null;
  markdown: Markdown | null;
  has_sale_price: boolean;
};

type SalesData = {
  mode: PricingMode;
  percent: number;
  isAdmin: boolean;
  maxPercent: number;
  products: Row[];
  categories: { id: string; name: string }[];
};

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const PERCENT_PRESETS = [10, 15, 20, 25, 30, 50];
const AMOUNT_PRESETS = [5, 10, 20, 50];
const ROWS_PER_PAGE = 60;
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2';

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-GH')} ${n === 1 ? one : many}`;
}

/* ─── Whole store ─────────────────────────────────────────────────────────── */

function WholeStore({
  data,
  onSaved,
  onNotice,
  showProducts,
}: {
  data: SalesData;
  onSaved: (mode: PricingMode, percent: number) => void;
  onNotice: (notice: Notice) => void;
  showProducts: () => void;
}) {
  const [choice, setChoice] = useState<PricingMode>(data.mode);
  const [percent, setPercent] = useState(data.percent > 0 ? String(data.percent) : '20');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setChoice(data.mode);
    if (data.percent > 0) setPercent(String(data.percent));
  }, [data.mode, data.percent]);

  const withSalePrice = data.products.filter((p) => p.has_sale_price).length;
  const discounted = data.products.filter((p) => p.markdown).length;
  const percentNumber = Number(percent);
  const percentValid = percentNumber >= 1 && percentNumber <= data.maxPercent;
  const changed = choice !== data.mode || (choice === 'bulk' && percentNumber !== data.percent);
  const canSave = data.isAdmin && changed && !saving && (choice !== 'bulk' || percentValid);

  const action =
    choice === 'off'
      ? 'Stop the sale'
      : choice === 'sale'
        ? 'Show sale prices'
        : data.mode === 'bulk'
          ? `Change to ${percentValid ? percentNumber : '…'}% off`
          : `Start ${percentValid ? percentNumber : '…'}% off everything`;

  async function save() {
    setSaving(true);
    onNotice(null);
    try {
      const result = await adminFetch<{ mode: PricingMode; percent: number; message: string }>('/api/admin/sales', {
        method: 'PUT',
        body: JSON.stringify({ mode: choice, percent: percentNumber }),
      });
      onSaved(result.mode, result.percent);
      onNotice({ kind: 'ok', text: result.message });
    } catch (err) {
      onNotice({ kind: 'error', text: err instanceof Error ? err.message : 'The sale could not be saved.' });
    } finally {
      setSaving(false);
    }
  }

  const options: { key: PricingMode; title: string; body: React.ReactNode }[] = [
    {
      key: 'off',
      title: 'No sale',
      body: 'Every product shows its regular price. Discounts on chosen products still apply.',
    },
    {
      key: 'sale',
      title: 'Sale prices',
      body: (
        <>
          Products with a sale price show it; the rest stay at their regular price.{' '}
          {withSalePrice > 0 ? (
            <span className="text-gray-900">{plural(withSalePrice, 'product has', 'products have')} a sale price.</span>
          ) : (
            <span className="text-amber-800">
              No product has a sale price yet. Add one under{' '}
              <Link href="/admin/products" className="font-semibold underline underline-offset-2">
                Products
              </Link>
              , in Pricing &amp; Inventory.
            </span>
          )}
        </>
      ),
    },
    {
      key: 'bulk',
      title: 'Percentage off everything',
      body: 'One percentage off the regular price of every product. Sale prices and discounts on chosen products are set aside while it runs.',
    },
  ];

  return (
    <section className="max-w-2xl space-y-5" aria-label="Whole-store sale">
      {!data.isAdmin && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Only an administrator can start or stop a whole-store sale. You can still discount chosen products.
        </p>
      )}

      <fieldset disabled={!data.isAdmin || saving} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <legend className="sr-only">Choose what runs across the whole store</legend>
        <div className="divide-y divide-gray-100">
          {options.map((option) => {
            const selected = choice === option.key;
            const running = data.mode === option.key;
            return (
              <div key={option.key} className={selected ? 'bg-slate-50' : ''}>
                <label className={`flex gap-3 p-4 sm:p-5 ${data.isAdmin ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                  <input
                    type="radio"
                    name="store-sale"
                    value={option.key}
                    checked={selected}
                    onChange={() => setChoice(option.key)}
                    className="mt-1 h-4 w-4 shrink-0 border-gray-300 accent-slate-700"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-gray-900">{option.title}</span>
                      {running && (
                        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-medium text-white">
                          {option.key === 'bulk' ? `Running at ${data.percent}%` : option.key === 'off' ? 'Now' : 'Running'}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-gray-600">{option.body}</span>
                  </span>
                </label>

                {option.key === 'bulk' && selected && (
                  <div className="space-y-3 px-4 pb-5 pl-11 sm:px-5 sm:pl-12">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Common percentages">
                      {PERCENT_PRESETS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-pressed={percentNumber === n}
                          onClick={() => setPercent(String(n))}
                          className={`min-h-[40px] rounded-lg border px-3.5 text-sm font-semibold tabular-nums transition-colors ${FOCUS} ${
                            percentNumber === n
                              ? 'border-slate-700 bg-slate-700 text-white'
                              : 'border-gray-300 bg-white text-gray-800 hover:border-slate-500'
                          }`}
                        >
                          {n}%
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-3 text-sm text-gray-700">
                      <span className="shrink-0">Or type one</span>
                      <span className="relative w-28">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={data.maxPercent}
                          step={1}
                          value={percent}
                          onChange={(e) => setPercent(e.target.value)}
                          aria-invalid={!percentValid}
                          className="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-base font-semibold tabular-nums focus:border-slate-700 focus:ring-1 focus:ring-slate-700 sm:text-sm"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                      </span>
                    </label>
                    {percentValid ? (
                      <p className="text-sm text-gray-600">
                        A {cedis(100)} product becomes{' '}
                        <strong className="whitespace-nowrap tabular-nums text-gray-900">
                          {cedis(markdownPrice(100, { type: 'percent', value: percentNumber }) ?? 100)}
                        </strong>
                        .
                      </p>
                    ) : (
                      <p className="text-sm text-red-700">Enter a percentage between 1 and {data.maxPercent}.</p>
                    )}
                    {discounted > 0 && (
                      <p className="text-sm text-gray-600">
                        {plural(discounted, 'product has', 'products have')} a discount of{' '}
                        {discounted === 1 ? 'its' : 'their'} own under{' '}
                        <button type="button" onClick={showProducts} className={`rounded font-semibold underline underline-offset-2 ${FOCUS}`}>
                          Chosen products
                        </button>
                        . Those pause while this runs, then come back.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      {data.isAdmin && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className={`min-h-[44px] rounded-lg bg-slate-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
          >
            {saving ? 'Saving…' : changed ? action : 'No changes to save'}
          </button>
          {changed && !saving && (
            <button
              type="button"
              onClick={() => {
                setChoice(data.mode);
                if (data.percent > 0) setPercent(String(data.percent));
              }}
              className={`min-h-[44px] rounded-lg px-3 text-sm font-medium text-gray-600 hover:text-gray-900 ${FOCUS}`}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      <p className="text-sm text-gray-500">
        The website, the POS and checkout all charge by what is set here. Shoppers already on the site see a change within
        about a minute.
      </p>
    </section>
  );
}

/* ─── Chosen products ─────────────────────────────────────────────────────── */

function PriceCell({ row, preview, paused }: { row: Row; preview: Pick<Markdown, 'type' | 'value'> | null; paused: boolean }) {
  const from = row.options > 0 && row.low !== row.high ? 'From ' : '';
  const current = row.markdown && !paused ? markdownPrice(row.low, row.markdown) : null;
  const next = preview ? markdownPrice(row.low, preview) : null;
  const nextOnSome = preview && next == null && markdownPrice(row.high, preview) != null;

  return (
    <span className="block tabular-nums">
      {current != null ? (
        <span className="block">
          <span className="whitespace-nowrap font-semibold text-gray-900">{from}{cedis(current)}</span>{' '}
          <span className="whitespace-nowrap text-xs text-gray-500 line-through">{cedis(row.low)}</span>
        </span>
      ) : (
        <span className="block font-semibold text-gray-900">{from}{cedis(row.low)}</span>
      )}
      {preview && (
        <span className={`block text-xs font-semibold ${next != null ? 'text-slate-700' : 'text-red-700'}`}>
          {next != null ? `Becomes ${cedis(next)}` : nextOnSome ? 'Only on the dearer options' : 'More than the price'}
        </span>
      )}
    </span>
  );
}

function ChosenProducts({
  data,
  reload,
  onNotice,
}: {
  data: SalesData;
  reload: () => Promise<void>;
  onNotice: (notice: Notice) => void;
}) {
  const [type, setType] = useState<Markdown['type']>('percent');
  const [value, setValue] = useState('10');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState('');
  const [show, setShow] = useState<'all' | 'discounted'>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(ROWS_PER_PAGE);
  const [busy, setBusy] = useState(false);
  const [confirmEndAll, setConfirmEndAll] = useState(false);

  const amount = Number(value) || 0;
  const amountValid = amount > 0 && (type === 'fixed' || amount <= data.maxPercent);
  const preview = amountValid ? { type, value: amount } : null;
  const paused = data.mode === 'bulk';
  const discounted = useMemo(() => data.products.filter((p) => p.markdown), [data.products]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.products.filter(
      (p) =>
        (!category || p.category_id === category) &&
        (show === 'all' || p.markdown) &&
        (!q || `${p.name} ${p.sku || ''}`.toLowerCase().includes(q))
    );
  }, [data.products, category, show, search]);

  useEffect(() => setLimit(ROWS_PER_PAGE), [category, show, search]);

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  const filtered = Boolean(category || search.trim() || show !== 'all');

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of visible) {
        if (allVisibleSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  async function run(method: 'POST' | 'DELETE', body: Record<string, unknown>) {
    setBusy(true);
    onNotice(null);
    try {
      const result = await adminFetch<{ message: string }>('/api/admin/sales', { method, body: JSON.stringify(body) });
      setSelected(new Set());
      setConfirmEndAll(false);
      await reload();
      onNotice({ kind: 'ok', text: result.message });
    } catch (err) {
      onNotice({ kind: 'error', text: err instanceof Error ? err.message : 'That did not save. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  const applyLabel = busy
    ? 'Saving…'
    : selected.size === 0
      ? 'Tick products first'
      : !amountValid
        ? 'Enter an amount'
        : `Take ${markdownLabel({ type, value: amount })} ${plural(selected.size, 'product')}`;
  const canApply = !busy && selected.size > 0 && amountValid;
  const apply = () => run('POST', { productIds: [...selected], type, value: amount });

  return (
    <section className="space-y-5" aria-label="Discount chosen products">
      {paused && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <i className="ri-pause-circle-line text-lg leading-none" aria-hidden />
          <span>
            {data.percent}% off everything is running, so these discounts are set aside for now. They come back when that
            sale stops.
          </span>
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start">
        <aside className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 xl:sticky xl:top-24">
          <h2 className="font-semibold text-gray-900">How much to take off</h2>

          <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1" role="group" aria-label="Kind of discount">
            {(
              [
                ['percent', 'Percent'],
                ['fixed', 'Cedis'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={type === key}
                onClick={() => {
                  setType(key);
                  setValue(key === 'percent' ? '10' : '5');
                }}
                className={`min-h-[40px] rounded-md text-sm font-semibold transition-colors ${FOCUS} ${
                  type === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="sr-only">{type === 'percent' ? 'Percentage off' : 'Cedis off'}</span>
            <span className="relative block">
              {type === 'fixed' && (
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">GH₵</span>
              )}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={type === 'percent' ? 1 : 0.5}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={!amountValid}
                className={`w-full rounded-lg border border-gray-300 py-2.5 text-lg font-semibold tabular-nums focus:border-slate-700 focus:ring-1 focus:ring-slate-700 ${
                  type === 'fixed' ? 'pl-14 pr-3' : 'pl-3 pr-9'
                }`}
              />
              {type === 'percent' && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
              )}
            </span>
          </label>
          {type === 'percent' && amount > data.maxPercent && (
            <p className="text-sm text-red-700">Keep the percentage at {data.maxPercent} or below.</p>
          )}

          <div className="flex flex-wrap gap-2" role="group" aria-label="Common amounts">
            {(type === 'percent' ? PERCENT_PRESETS : AMOUNT_PRESETS).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={amount === n}
                onClick={() => setValue(String(n))}
                className={`min-h-[36px] rounded-lg border px-3 text-sm font-semibold tabular-nums transition-colors ${FOCUS} ${
                  amount === n ? 'border-slate-700 bg-slate-700 text-white' : 'border-gray-300 bg-white text-gray-800 hover:border-slate-500'
                }`}
              >
                {type === 'percent' ? `${n}%` : `GH₵${n}`}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!canApply}
            onClick={apply}
            className={`hidden min-h-[44px] w-full rounded-lg bg-slate-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 xl:block ${FOCUS}`}
          >
            {applyLabel}
          </button>
          <p className="text-sm text-gray-500">
            A new discount replaces the old one on a product. They never add up, and ending one brings the regular price
            back exactly.
          </p>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-600">
              Discounted now: <strong className="whitespace-nowrap tabular-nums text-gray-900">{discounted.length}</strong>
            </p>
            {discounted.length > 0 &&
              (confirmEndAll ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-gray-900">End the discount on all {plural(discounted.length, 'product')}?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run('DELETE', { all: true })}
                      className={`min-h-[40px] flex-1 rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 ${FOCUS}`}
                    >
                      {busy ? 'Ending…' : 'Yes, end all'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmEndAll(false)}
                      className={`min-h-[40px] flex-1 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 ${FOCUS}`}
                    >
                      Keep them
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmEndAll(true)}
                  className={`mt-3 min-h-[40px] w-full rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`}
                >
                  End all discounts
                </button>
              ))}
          </div>
        </aside>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="space-y-3 border-b border-gray-100 p-4">
            <label className="flex min-h-[40px] shrink-0 items-center gap-2.5 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleVisible}
                disabled={visible.length === 0}
                className="h-4 w-4 rounded border-gray-300 accent-slate-700"
              />
              {allVisibleSelected ? 'Untick all' : `Tick all ${visible.length.toLocaleString('en-GH')}`}
              {selected.size > 0 && <span className="font-normal text-gray-500">· {selected.size} ticked</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              <select
                value={show}
                onChange={(e) => setShow(e.target.value as 'all' | 'discounted')}
                aria-label="Which products to list"
                className="min-h-[40px] min-w-[10rem] flex-1 rounded-lg border border-gray-300 px-3 text-base text-gray-800 focus:border-slate-700 focus:ring-1 focus:ring-slate-700 sm:text-sm"
              >
                <option value="all">All products</option>
                <option value="discounted">Discounted only</option>
              </select>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Category"
                className="min-h-[40px] min-w-[10rem] flex-1 rounded-lg border border-gray-300 px-3 text-base text-gray-800 focus:border-slate-700 focus:ring-1 focus:ring-slate-700 sm:text-sm"
              >
                <option value="">All categories</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or SKU"
                aria-label="Search products"
                className="min-h-[40px] min-w-[12rem] flex-[2] rounded-lg border border-gray-300 px-3 text-base text-gray-900 placeholder:text-gray-500 focus:border-slate-700 focus:ring-1 focus:ring-slate-700 sm:text-sm"
              />
            </div>
          </div>

          {data.products.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-medium text-gray-900">There are no products to discount yet.</p>
              <Link href="/admin/products/new" className={`mt-2 inline-block rounded text-sm font-semibold text-slate-700 underline underline-offset-2 ${FOCUS}`}>
                Add your first product
              </Link>
            </div>
          ) : visible.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-medium text-gray-900">
                {show === 'discounted' && !category && !search.trim() ? 'No product is discounted right now.' : 'No products match.'}
              </p>
              {filtered && (
                <button
                  type="button"
                  onClick={() => {
                    setCategory('');
                    setSearch('');
                    setShow('all');
                  }}
                  className={`mt-2 rounded text-sm font-semibold text-slate-700 underline underline-offset-2 ${FOCUS}`}
                >
                  Show all products
                </button>
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-gray-100">
                {visible.slice(0, limit).map((p) => {
                  const ticked = selected.has(p.id);
                  const details = [p.category, p.options ? plural(p.options, 'option') : null, p.status !== 'active' ? 'Draft' : null]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <li key={p.id} className={`flex items-center gap-3 px-4 py-3 ${ticked ? 'bg-slate-50' : ''}`}>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={ticked}
                          onChange={() => toggle(p.id)}
                          className="h-4 w-4 shrink-0 rounded border-gray-300 accent-slate-700"
                        />
                        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                          {p.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={storageImageUrl(p.image, { width: 96, height: 96 })}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-gray-900 line-clamp-2">{p.name}</span>
                          {details && <span className="block truncate text-xs text-gray-500">{details}</span>}
                          <span className="mt-1 block text-sm">
                            <PriceCell row={p} preview={ticked ? preview : null} paused={paused} />
                          </span>
                        </span>
                      </label>
                      <div className="flex w-[5.5rem] shrink-0 flex-col items-end gap-1">
                        {p.markdown ? (
                          <>
                            <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-semibold text-white">
                              {markdownLabel(p.markdown)}
                            </span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => run('DELETE', { productIds: [p.id] })}
                              aria-label={`End the discount on ${p.name}`}
                              className={`min-h-[32px] rounded px-1 text-xs font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-900 disabled:opacity-50 ${FOCUS}`}
                            >
                              End
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-gray-500">Full price</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {visible.length > limit && (
                <div className="border-t border-gray-100 p-4 text-center">
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + ROWS_PER_PAGE * 2)}
                    className={`min-h-[40px] rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 ${FOCUS}`}
                  >
                    Show more ({(visible.length - limit).toLocaleString('en-GH')} left)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* On a phone the amount box scrolls away, so the action stays at the bottom of the screen. */}
      {selected.size > 0 && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-gray-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:-mx-6 lg:px-6 xl:hidden">
          <button
            type="button"
            disabled={!canApply}
            onClick={apply}
            className={`min-h-[48px] w-full rounded-lg bg-slate-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
          >
            {applyLabel}
          </button>
        </div>
      )}
    </section>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

function LoadingRows() {
  return (
    <div className="max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse gap-3 border-b border-gray-100 p-5 last:border-b-0">
          <div className="mt-1 h-4 w-4 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-3 w-full max-w-md rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SaleAndDiscounts() {
  const router = useRouter();
  const pathname = usePathname();
  const tab = useSearchParams().get('tab') === 'products' ? 'products' : 'store';
  const showTab = useCallback(
    (key: 'store' | 'products') => router.replace(key === 'store' ? pathname : `${pathname}?tab=${key}`, { scroll: false }),
    [router, pathname]
  );

  const [data, setData] = useState<SalesData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    try {
      setData(await adminFetch<SalesData>('/api/admin/sales'));
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this page.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const discountedCount = data ? data.products.filter((p) => p.markdown).length : 0;
  const running = !data
    ? ''
    : data.mode === 'bulk'
      ? `${data.percent}% off everything is running.`
      : data.mode === 'sale'
        ? 'Sale prices are showing.'
        : discountedCount > 0
          ? `No whole-store sale. ${plural(discountedCount, 'product is', 'products are')} discounted.`
          : 'Nothing is running. Every product is at its regular price.';

  const tabs = [
    { key: 'store' as const, label: 'Whole store', hint: 'Sale prices, or one percentage off everything' },
    { key: 'products' as const, label: 'Chosen products', hint: 'Discount only the products you tick' },
  ];

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Sale &amp; Discounts</h1>
        <p className="mt-1 text-gray-600">
          Shoppers see the old price crossed out next to the new one. Ending a sale brings every price back exactly.
        </p>
        {running && (
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-gray-900">
            <span
              className={`h-2 w-2 rounded-full ${data!.mode !== 'off' || discountedCount > 0 ? 'bg-green-600' : 'bg-gray-400'}`}
              aria-hidden
            />
            {running}
          </p>
        )}
      </div>

      <div className="grid max-w-2xl grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Where the discount applies">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`sales-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="sales-panel"
            onClick={() => showTab(t.key)}
            className={`rounded-lg px-3 py-2.5 text-left transition-colors ${FOCUS} ${
              tab === t.key ? 'bg-white shadow-sm' : 'hover:bg-gray-50'
            }`}
          >
            <span className={`block text-sm font-semibold ${tab === t.key ? 'text-gray-900' : 'text-gray-700'}`}>
              {t.label}
              {t.key === 'products' && discountedCount > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-700 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                  {discountedCount}
                </span>
              )}
            </span>
            <span className="mt-0.5 hidden text-xs text-gray-600 sm:block">{t.hint}</span>
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {notice && (
          <div
            className={`flex items-start gap-2 rounded-lg border p-4 text-sm ${
              notice.kind === 'ok' ? 'border-green-100 bg-green-50 text-green-800' : 'border-red-100 bg-red-50 text-red-800'
            }`}
          >
            <i className={`${notice.kind === 'ok' ? 'ri-checkbox-circle-fill text-green-600' : 'ri-error-warning-fill text-red-600'} text-lg leading-none`} aria-hidden />
            <span className="flex-1">{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className={`rounded ${FOCUS}`}>
              <i className="ri-close-line text-lg leading-none" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <div id="sales-panel" role="tabpanel" aria-labelledby={`sales-tab-${tab}`}>
        {loadError && !data ? (
          <div className="max-w-2xl rounded-2xl border border-red-100 bg-red-50 p-5 text-sm text-red-800">
            <p className="font-semibold">This page could not load.</p>
            <p className="mt-1">{loadError}</p>
            <button
              type="button"
              onClick={load}
              className={`mt-3 min-h-[40px] rounded-lg bg-white px-4 text-sm font-semibold text-red-800 ring-1 ring-red-200 hover:bg-red-100 ${FOCUS}`}
            >
              Try again
            </button>
          </div>
        ) : !data ? (
          <LoadingRows />
        ) : tab === 'store' ? (
          <WholeStore
            data={data}
            onNotice={setNotice}
            showProducts={() => showTab('products')}
            onSaved={(mode, percent) => setData((prev) => (prev ? { ...prev, mode, percent } : prev))}
          />
        ) : (
          <ChosenProducts data={data} reload={load} onNotice={setNotice} />
        )}
      </div>
    </div>
  );
}

export default function AdminSalesPage() {
  return (
    <Suspense>
      <SaleAndDiscounts />
    </Suspense>
  );
}
