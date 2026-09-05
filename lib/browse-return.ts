const SCROLL_KEY = 'deliz-browse-scroll';
const SHOP_KEY = 'deliz-shop-return';
const BACK_FLAG = 'deliz-browse-back';
const SHOP_RESTORE_FLAG = 'deliz-shop-restore';

export type ShopReturnSnapshot = {
  href: string;
  fetchKey: string;
  pages: number;
  scrollY: number;
  lastSlug?: string | null;
};

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

export function browseKey(pathname: string, search = ''): string {
  const query = search.startsWith('?') ? search : search ? `?${search}` : '';
  return `${pathname}${query}`;
}

export function saveBrowseScroll(key: string, scrollY: number): void {
  if (!canUseStorage() || !key) return;
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    const map = raw ? JSON.parse(raw) as Record<string, number> : {};
    map[key] = Math.max(0, Math.round(scrollY));
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota / private-mode failures
  }
}

export function readBrowseScroll(key: string): number | null {
  if (!canUseStorage() || !key) return null;
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (!raw) return null;
    const value = (JSON.parse(raw) as Record<string, number>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function markBrowseBack(): void {
  if (!canUseStorage()) return;
  sessionStorage.setItem(BACK_FLAG, '1');
}

export function consumeBrowseBack(): boolean {
  if (!canUseStorage()) return false;
  const pending = sessionStorage.getItem(BACK_FLAG) === '1';
  if (pending) sessionStorage.removeItem(BACK_FLAG);
  return pending;
}

export function saveShopReturn(snapshot: ShopReturnSnapshot): void {
  if (!canUseStorage()) return;
  try {
    sessionStorage.setItem(SHOP_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota / private-mode failures
  }
}

export function readShopReturn(): ShopReturnSnapshot | null {
  if (!canUseStorage()) return null;
  try {
    const raw = sessionStorage.getItem(SHOP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShopReturnSnapshot;
    if (!parsed?.href || !parsed.fetchKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getContinueShoppingHref(): string {
  const snapshot = readShopReturn();
  if (snapshot?.href?.startsWith('/shop')) return snapshot.href;
  return '/shop';
}

export function rememberLastProductSlug(slug: string): void {
  const snapshot = readShopReturn();
  if (!snapshot) return;
  saveShopReturn({ ...snapshot, lastSlug: slug, scrollY: typeof window !== 'undefined' ? window.scrollY : snapshot.scrollY });
}

export function markShopRestore(): void {
  if (!canUseStorage()) return;
  sessionStorage.setItem(SHOP_RESTORE_FLAG, '1');
}

export function consumeShopRestore(): boolean {
  if (!canUseStorage()) return false;
  const pending = sessionStorage.getItem(SHOP_RESTORE_FLAG) === '1';
  if (pending) sessionStorage.removeItem(SHOP_RESTORE_FLAG);
  return pending;
}
