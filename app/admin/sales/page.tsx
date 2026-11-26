'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import { storageImageUrl } from '@/lib/storage-image';

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  category: string;
  image: string | null;
  variantsCount: number;
  /** Regular price (for a product with options, its cheapest option). */
  regular: number;
  /** Sale price, whether the sale is switched on or off. Null when not on sale. */
  sale: number | null;
  percentOff: number;
  hasSale: boolean;
  live: boolean;
};

type VariantRow = { id: string; label: string; regular: number; sale: number | null };
type SaleFilter = 'all' | 'on' | 'live' | 'paused' | 'off';

const PAGE_SIZE = 24;
const fmt = (v: number) => `GH₵${Number(v || 0).toFixed(2)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isPaused = (p: ProductRow) => p.hasSale && !p.live;

function Switch({
  on,
  onClick,
  disabled,
  pending,
  label,
  size = 'sm',
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  label: string;
  size?: 'sm' | 'lg';
}) {
  const big = size === 'lg';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-busy={pending}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex flex-shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 ${
        big ? 'h-9 w-16' : 'h-6 w-11'
      } ${on ? 'bg-green-600' : 'bg-gray-300'} ${pending ? 'opacity-60' : disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`inline-block transform rounded-full bg-white shadow transition-transform duration-200 ${
          big ? 'h-7 w-7' : 'h-5 w-5'
        } ${on ? (big ? 'translate-x-8' : 'translate-x-[22px]') : big ? 'translate-x-1' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

export default function AdminSalesPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [salesActive, setSalesActive] = useState(true);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [saleFilter, setSaleFilter] = useState<SaleFilter>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [bulkPercent, setBulkPercent] = useState('');
  const [bulkFixed, setBulkFixed] = useState('');
  const [rowPrice, setRowPrice] = useState<Record<string, string>>({});

  // "Variant prices" editor: one product's options, opened under its row.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [variantData, setVariantData] = useState<Record<string, VariantRow[]>>({});
  const [variantLoading, setVariantLoading] = useState(false);
  const [variantInputs, setVariantInputs] = useState<Record<string, string>>({});
  const [variantFillAll, setVariantFillAll] = useState('');

  const [busy, setBusy] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  // A row's switch while its request is running: shows the new position at once.
  const [switching, setSwitching] = useState<{ id: string; to: boolean } | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{ salesActive: boolean; products: ProductRow[] }>('/api/admin/sales');
      setProducts(data.products);
      setSalesActive(data.salesActive);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))).sort(), [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (term && !p.name.toLowerCase().includes(term)) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (saleFilter === 'on' && !p.hasSale) return false;
      if (saleFilter === 'live' && !p.live) return false;
      if (saleFilter === 'paused' && !isPaused(p)) return false;
      if (saleFilter === 'off' && p.hasSale) return false;
      return true;
    });
  }, [products, search, categoryFilter, saleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, saleFilter]);

  const onSaleCount = useMemo(() => products.filter((p) => p.hasSale).length, [products]);
  const liveCount = useMemo(() => products.filter((p) => p.live).length, [products]);
  const pausedCount = onSaleCount - liveCount;
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  const toggleSelectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((p) => (allFilteredSelected ? next.delete(p.id) : next.add(p.id)));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const callApi = (payload: Record<string, unknown>) =>
    adminFetch<any>('/api/admin/sales', { method: 'POST', body: JSON.stringify(payload) });

  const fail = (err: unknown, fallback: string) =>
    setToast({ text: err instanceof Error ? err.message : fallback, ok: false });

  /** Put the server's updated rows into the table. */
  const mergeRows = (rows: ProductRow[] | undefined) => {
    if (!rows?.length) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    setProducts((prev) => prev.map((p) => byId.get(p.id) || p));
  };

  /** Variant prices may have changed on the server: reload them the next time a row is opened. */
  const forgetVariants = (id?: string) => {
    setVariantData((prev) => {
      if (!id) return {};
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (!id || expandedId === id) setExpandedId(null);
  };

  /** Extra toast text when a change left sales switched off. */
  const pausedNote = (json: any) => {
    if (!json?.paused) return '';
    return salesActive
      ? ' Sales that were switched off stay off.'
      : ' All sales are off, so new sale prices start switched off. Use the Live switch to turn one on.';
  };

  const toggleSalesActive = async () => {
    const next = !salesActive;
    const question = next
      ? 'Turn ON all sales? Every switched-off sale goes live, including products you switched off one by one.'
      : 'Turn OFF all sales? Every product goes back to its normal price, including products you switched on one by one. Each sale price is kept and returns when you switch it back on.';
    if (!confirm(question)) return;
    setTogglingActive(true);
    try {
      await callApi({ action: 'set_active', active: next });
      setSalesActive(next);
      forgetVariants();
      await load();
      setToast({
        text: next ? 'All sales are ON. Every sale price is live.' : 'All sales are OFF. Every product is at its normal price.',
        ok: true,
      });
    } catch (err) {
      fail(err, 'Failed to switch sales');
    } finally {
      setTogglingActive(false);
    }
  };

  /** Switch one product's sale on or off. */
  const toggleProductSale = async (p: ProductRow) => {
    if (switching) return;
    const next = !p.live;
    setSwitching({ id: p.id, to: next });
    try {
      const json = await callApi({ action: 'set_product_active', active: next, productIds: [p.id] });
      mergeRows(json?.products);
      forgetVariants(p.id);
      setToast({ text: next ? `${p.name}: sale is on.` : `${p.name}: sale is off. It shows the normal price.`, ok: true });
    } catch (err) {
      fail(err, 'Could not switch the sale');
    } finally {
      setSwitching(null);
    }
  };

  const needSelection = () => {
    if (selected.size > 0) return false;
    setToast({ text: 'Select at least one product first', ok: false });
    return true;
  };

  /** Switch the selected products' sales on or off. */
  const switchSelected = async (active: boolean) => {
    if (needSelection()) return;
    setBusy(true);
    try {
      const json = await callApi({ action: 'set_product_active', active, productIds: Array.from(selected) });
      mergeRows(json?.products);
      const changed = json?.changed ?? 0;
      setToast({ text: `Switched ${active ? 'on' : 'off'} ${plural(changed, 'sale')}.`, ok: true });
      setSelected(new Set());
      forgetVariants();
    } catch (err) {
      fail(err, 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const runBulk = async (kind: 'percentage' | 'fixed' | 'remove') => {
    if (needSelection()) return;
    const ids = Array.from(selected);
    let payload: Record<string, unknown> = { action: 'remove', productIds: ids };
    if (kind === 'percentage') {
      const value = Number(bulkPercent);
      if (!Number.isFinite(value) || value < 1 || value > 99) {
        setToast({ text: 'Enter a discount between 1 and 99%', ok: false });
        return;
      }
      payload = { action: 'apply', mode: 'percentage', value, productIds: ids };
    } else if (kind === 'fixed') {
      const value = Number(bulkFixed);
      if (!Number.isFinite(value) || value <= 0) {
        setToast({ text: 'Enter a valid sale price', ok: false });
        return;
      }
      payload = { action: 'apply', mode: 'fixed', value, productIds: ids };
    } else if (!confirm(`Remove ${plural(ids.length, 'product')} from sale? They go back to their regular price.`)) {
      return;
    }
    setBusy(true);
    try {
      const json = await callApi(payload);
      mergeRows(json?.products);
      const changed = json?.changed ?? 0;
      const skipped = json?.skipped ?? 0;
      if (kind === 'remove') {
        setToast({ text: `Removed ${plural(changed, 'product')} from sale.`, ok: true });
      } else if (kind === 'percentage') {
        setToast({ text: `Applied ${bulkPercent}% off to ${plural(changed, 'product')}.` + pausedNote(json), ok: true });
      } else {
        setToast({
          text:
            (skipped
              ? `Set sale price on ${plural(changed, 'product')}. ${skipped} skipped (products with variants, or the price is not below the regular price).`
              : `Set sale price on ${plural(changed, 'product')}.`) + pausedNote(json),
          ok: changed > 0,
        });
      }
      setSelected(new Set());
      setBulkPercent('');
      setBulkFixed('');
      forgetVariants();
    } catch (err) {
      fail(err, 'Failed to update sales');
    } finally {
      setBusy(false);
    }
  };

  const applyRowPrice = async (p: ProductRow) => {
    const value = Number(rowPrice[p.id]);
    if (!Number.isFinite(value) || value <= 0) {
      setToast({ text: 'Enter a valid sale price', ok: false });
      return;
    }
    if (value >= p.regular) {
      setToast({ text: `Sale price must be below the regular price (${fmt(p.regular)})`, ok: false });
      return;
    }
    setBusy(true);
    try {
      const json = await callApi({ action: 'apply', mode: 'fixed', value, productIds: [p.id] });
      mergeRows(json?.products);
      setRowPrice((prev) => ({ ...prev, [p.id]: '' }));
      setToast({ text: `${p.name} is on sale at ${fmt(value)}.` + pausedNote(json), ok: true });
    } catch (err) {
      fail(err, 'Failed to set the sale price');
    } finally {
      setBusy(false);
    }
  };

  const removeRow = async (p: ProductRow) => {
    setBusy(true);
    try {
      const json = await callApi({ action: 'remove', productIds: [p.id] });
      mergeRows(json?.products);
      forgetVariants(p.id);
      setToast({ text: `${p.name} is back at its regular price.`, ok: true });
    } catch (err) {
      fail(err, 'Failed to remove the sale');
    } finally {
      setBusy(false);
    }
  };

  /** Open a product's options under its row, loading them the first time. */
  const toggleVariants = async (p: ProductRow) => {
    if (expandedId === p.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(p.id);
    setVariantFillAll('');
    setVariantInputs({});
    if (variantData[p.id]) return;
    setVariantLoading(true);
    try {
      const json = await adminFetch<{ variants: VariantRow[] }>(`/api/admin/sales?variants=${p.id}`);
      setVariantData((prev) => ({ ...prev, [p.id]: json.variants }));
    } catch (err) {
      fail(err, 'Could not load the variants');
      setExpandedId(null);
    } finally {
      setVariantLoading(false);
    }
  };

  /** Apply the typed sale prices for one product's options. */
  const applyVariantPrices = async (p: ProductRow) => {
    const items: { variantId: string; price: number }[] = [];
    for (const v of variantData[p.id] || []) {
      const raw = variantInputs[v.id];
      if (raw == null || raw.trim() === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        setToast({ text: `Enter a valid sale price for "${v.label}"`, ok: false });
        return;
      }
      if (value >= v.regular) {
        setToast({ text: `Sale price for "${v.label}" must be below its regular price (${fmt(v.regular)})`, ok: false });
        return;
      }
      items.push({ variantId: v.id, price: Math.round(value * 100) / 100 });
    }
    if (items.length === 0) {
      setToast({ text: 'Type a sale price for at least one variant', ok: false });
      return;
    }
    setBusy(true);
    try {
      const json = await callApi({ action: 'variant_prices', productId: p.id, items });
      mergeRows(json?.products);
      forgetVariants(p.id);
      setVariantInputs({});
      setToast({ text: `Set sale prices on ${plural(json?.updated ?? items.length, 'variant')} of ${p.name}.` + pausedNote(json), ok: true });
    } catch (err) {
      fail(err, 'Failed to set variant sale prices');
    } finally {
      setBusy(false);
    }
  };

  /** Fill every option's box with the same percentage off its own regular price. */
  const fillAllVariants = (p: ProductRow) => {
    const pct = Number(variantFillAll);
    if (!Number.isFinite(pct) || pct < 1 || pct > 99) {
      setToast({ text: 'Enter a discount between 1 and 99%', ok: false });
      return;
    }
    const next: Record<string, string> = {};
    for (const v of variantData[p.id] || []) next[v.id] = (Math.round(v.regular * (1 - pct / 100) * 100) / 100).toFixed(2);
    setVariantInputs(next);
  };

  const input = 'px-3 py-2 border border-gray-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
  const noneSelected = selected.size === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Sales</h1>
          <p className="text-gray-600 mt-1">
            Set a discount % or a sale price, then switch each sale on or off, or all of them at once.
          </p>
        </div>
        <Link
          href="/sale"
          target="_blank"
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-2 text-sm font-medium self-start whitespace-nowrap"
        >
          <i className="ri-external-link-line" aria-hidden></i>
          View Sale page
        </Link>
      </div>

      {/* Master on/off switch */}
      <div
        className={`rounded-xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          salesActive ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
        }`}
      >
        <div className="flex items-start gap-3">
          <i
            className={`text-2xl mt-0.5 ${salesActive ? 'ri-flashlight-fill text-green-600' : 'ri-pause-circle-line text-amber-600'}`}
            aria-hidden
          ></i>
          <div>
            <p className="font-semibold text-gray-900">
              All sales: {salesActive ? 'ON' : 'OFF'}
              <span className="ml-2 text-sm font-normal text-gray-600">
                {liveCount} live{pausedCount > 0 ? `, ${pausedCount} switched off` : ''}
              </span>
            </p>
            <p className="text-sm text-gray-600 mt-0.5 max-w-xl">
              {salesActive
                ? 'This switch turns every sale on or off at once. To switch one product, use its Live switch in the table.'
                : 'Every sale is off. You can still switch on single products with their Live switch in the table, or turn every sale back on here.'}
            </p>
          </div>
        </div>
        <Switch
          size="lg"
          on={salesActive}
          onClick={toggleSalesActive}
          disabled={togglingActive || busy || loading}
          pending={togglingActive}
          label="Turn all sales on or off"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          ['Total products', products.length, 'text-gray-900'],
          ['Sale live', liveCount, 'text-red-600'],
          ['Sale switched off', pausedCount, 'text-amber-600'],
          ['Not on sale', products.length - onSaleCount, 'text-gray-900'],
        ].map(([label, value, color]) => (
          <div key={label as string} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{loading ? '–' : value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden></i>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products by name…"
            aria-label="Search products by name"
            className={`w-full pl-10 pr-4 py-2.5 ${input}`}
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Category"
          className={`py-2.5 ${input}`}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={saleFilter}
          onChange={(e) => setSaleFilter(e.target.value as SaleFilter)}
          aria-label="Which products to show"
          className={`py-2.5 ${input}`}
        >
          <option value="all">All products</option>
          <option value="on">On sale</option>
          <option value="live">Sale live</option>
          <option value="paused">Sale switched off</option>
          <option value="off">Not on sale</option>
        </select>
      </div>

      {/* Bulk action bar */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 sticky top-2 z-20">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <label className="flex items-center gap-2 lg:w-56 cursor-pointer">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              disabled={filtered.length === 0}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">
              {selected.size > 0 ? `${selected.size} selected` : `Select all ${filtered.length} filtered`}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={bulkPercent}
                onChange={(e) => setBulkPercent(e.target.value)}
                placeholder="%"
                aria-label="Percent off"
                className={`w-20 ${input}`}
              />
              <button
                onClick={() => runBulk('percentage')}
                disabled={busy || noneSelected}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                Apply % off
              </button>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={bulkFixed}
                onChange={(e) => setBulkFixed(e.target.value)}
                placeholder="₵ price"
                aria-label="Sale price in cedis"
                className={`w-28 ${input}`}
              />
              <button
                onClick={() => runBulk('fixed')}
                disabled={busy || noneSelected}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                Set price
              </button>
            </div>
            <button
              onClick={() => switchSelected(true)}
              disabled={busy || noneSelected}
              className="px-4 py-2 bg-white border border-green-300 text-green-800 hover:bg-green-50 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              Switch on
            </button>
            <button
              onClick={() => switchSelected(false)}
              disabled={busy || noneSelected}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              Switch off
            </button>
            <button
              onClick={() => runBulk('remove')}
              disabled={busy || noneSelected}
              className="px-4 py-2 bg-white border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              Remove from sale
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          Fixed price applies only to products without variants and must be below the regular price. For variant products
          use a percentage, or click &quot;Variant prices&quot; on the row to set each variant&apos;s own sale price.
        </p>
      </div>

      <div aria-live="polite">
        {toast && (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              toast.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-loader-4-line text-3xl animate-spin block mb-2" aria-hidden></i>
            Loading products…
          </div>
        ) : loadError ? (
          <div className="p-12 text-center">
            <p className="font-medium text-gray-900">The products could not load.</p>
            <p className="text-sm text-gray-600 mt-1">{loadError}</p>
            <button
              onClick={() => {
                setLoading(true);
                load();
              }}
              className="mt-4 px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50"
            >
              Try again
            </button>
          </div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center text-gray-600">
            There are no products yet.{' '}
            <Link href="/admin/products/new" className="font-semibold text-blue-700 underline">
              Add your first product
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500">No products match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b border-gray-200">
                  <th className="p-3 w-10"></th>
                  <th className="p-3 font-semibold">Product</th>
                  <th className="p-3 font-semibold">Regular</th>
                  <th className="p-3 font-semibold">Sale price</th>
                  <th className="p-3 font-semibold">Off</th>
                  <th className="p-3 font-semibold">Live</th>
                  <th className="p-3 font-semibold">Set price</th>
                  <th className="p-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const pending = switching?.id === p.id;
                  const from = p.variantsCount > 0 ? 'From ' : '';
                  return (
                    <Fragment key={p.id}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50/70">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            onChange={() => toggleOne(p.id)}
                            aria-label={`Select ${p.name}`}
                            className="w-4 h-4 rounded border-gray-300"
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <span className="w-10 h-10 rounded bg-gray-100 flex-shrink-0 overflow-hidden">
                              {p.image && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={storageImageUrl(p.image, { width: 96, height: 96 })}
                                  alt=""
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900 truncate max-w-[260px]">{p.name}</div>
                              <div className="text-xs text-gray-500 flex items-center gap-2">
                                <span>{p.category}</span>
                                {p.variantsCount > 0 && (
                                  <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{p.variantsCount} variants</span>
                                )}
                                {p.status !== 'active' && (
                                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">{p.status}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 whitespace-nowrap text-gray-700 tabular-nums">
                          {from}
                          {fmt(p.regular)}
                        </td>
                        <td className="p-3 whitespace-nowrap tabular-nums">
                          {p.sale != null ? (
                            <span className="font-semibold text-red-600">
                              {from}
                              {fmt(p.sale)}
                              {isPaused(p) && <span className="ml-1 text-xs font-normal text-amber-700">(off)</span>}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {p.percentOff > 0 ? (
                            <span className="inline-block px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs font-bold">-{p.percentOff}%</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {p.hasSale ? (
                            <Switch
                              on={pending ? switching!.to : p.live}
                              pending={pending}
                              onClick={() => toggleProductSale(p)}
                              disabled={busy || togglingActive || !!switching}
                              label={`Sale for ${p.name}`}
                            />
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {p.variantsCount > 0 ? (
                            <button
                              onClick={() => toggleVariants(p)}
                              disabled={busy}
                              aria-expanded={expandedId === p.id}
                              className="px-2.5 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <i className={expandedId === p.id ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} aria-hidden></i>
                              {expandedId === p.id ? 'Hide variants' : 'Variant prices'}
                            </button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="0.01"
                                value={rowPrice[p.id] ?? ''}
                                onChange={(e) => setRowPrice((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') applyRowPrice(p);
                                }}
                                placeholder="₵"
                                aria-label={`Sale price for ${p.name}`}
                                className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                              <button
                                onClick={() => applyRowPrice(p)}
                                disabled={busy || !rowPrice[p.id]}
                                className="px-2.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                              >
                                Set
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {p.hasSale && (
                            <button
                              onClick={() => removeRow(p)}
                              disabled={busy}
                              className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50 whitespace-nowrap"
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>

                      {expandedId === p.id && (
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <td></td>
                          <td colSpan={7} className="p-4">
                            {variantLoading && !variantData[p.id] ? (
                              <p className="text-sm text-gray-500">
                                <i className="ri-loader-4-line animate-spin mr-1" aria-hidden></i>
                                Loading variants…
                              </p>
                            ) : (
                              <div className="space-y-3 max-w-2xl">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm text-gray-700">Fill every variant with</span>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={99}
                                    value={variantFillAll}
                                    onChange={(e) => setVariantFillAll(e.target.value)}
                                    placeholder="%"
                                    aria-label="Percent off for every variant"
                                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                                  />
                                  <span className="text-sm text-gray-700">off</span>
                                  <button
                                    onClick={() => fillAllVariants(p)}
                                    className="px-2.5 py-1.5 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-xs font-semibold"
                                  >
                                    Fill
                                  </button>
                                </div>
                                <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
                                  <thead>
                                    <tr className="text-left bg-gray-50 border-b border-gray-200">
                                      <th className="p-2 font-semibold">Variant</th>
                                      <th className="p-2 font-semibold">Regular</th>
                                      <th className="p-2 font-semibold">Sale now</th>
                                      <th className="p-2 font-semibold">New sale price</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(variantData[p.id] || []).map((v) => (
                                      <tr key={v.id} className="border-b border-gray-100 last:border-b-0">
                                        <td className="p-2 text-gray-900">{v.label}</td>
                                        <td className="p-2 tabular-nums text-gray-700">{fmt(v.regular)}</td>
                                        <td className="p-2 tabular-nums">
                                          {v.sale != null ? (
                                            <span className="font-semibold text-red-600">{fmt(v.sale)}</span>
                                          ) : (
                                            <span className="text-gray-400">—</span>
                                          )}
                                        </td>
                                        <td className="p-2">
                                          <input
                                            type="number"
                                            inputMode="decimal"
                                            min={0}
                                            step="0.01"
                                            value={variantInputs[v.id] ?? ''}
                                            onChange={(e) => setVariantInputs((prev) => ({ ...prev, [v.id]: e.target.value }))}
                                            placeholder="₵"
                                            aria-label={`New sale price for ${v.label}`}
                                            className="w-28 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                          />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => applyVariantPrices(p)}
                                    disabled={busy}
                                    className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                                  >
                                    Apply variant prices
                                  </button>
                                  <span className="text-xs text-gray-600">Variants you leave empty keep the price they have now.</span>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !loadError && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm">
            <span className="text-gray-600">
              Page {currentPage} of {totalPages} · {filtered.length} products
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
