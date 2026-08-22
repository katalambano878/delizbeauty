import { supabaseAdmin } from '@/lib/supabase-admin';

export function normalizeCategoryIds(categoryIds: unknown): string[] {
  if (!Array.isArray(categoryIds)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of categoryIds) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export async function syncProductCategories(
  productId: string,
  categoryIds: string[]
): Promise<{ primaryCategoryId: string | null; error?: string }> {
  const ids = normalizeCategoryIds(categoryIds);
  const primaryCategoryId = ids[0] ?? null;

  const { error: clearError } = await supabaseAdmin
    .from('product_categories')
    .delete()
    .eq('product_id', productId);

  if (clearError) {
    return { primaryCategoryId, error: clearError.message };
  }

  if (ids.length > 0) {
    const rows = ids.map((categoryId, index) => ({
      product_id: productId,
      category_id: categoryId,
      is_primary: index === 0,
    }));

    const { error: insertError } = await supabaseAdmin.from('product_categories').insert(rows);
    if (insertError) {
      return { primaryCategoryId, error: insertError.message };
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from('products')
    .update({ category_id: primaryCategoryId })
    .eq('id', productId);

  if (updateError) {
    return { primaryCategoryId, error: updateError.message };
  }

  return { primaryCategoryId };
}

export function formatProductCategoryNames(product: any): string {
  const fromJunction = (product?.product_categories || [])
    .map((row: any) => row?.categories?.name)
    .filter(Boolean);

  if (fromJunction.length > 0) {
    return fromJunction.join(', ');
  }

  return product?.categories?.name || 'Uncategorized';
}

/** Resolve category slugs or names (case-insensitive) to IDs. */
export async function resolveCategoryIdsFromSlugs(slugs: string[]): Promise<string[]> {
  const wanted = new Set(
    slugs.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
  );
  if (wanted.size === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('id, slug, name')
    .eq('status', 'active');

  if (error) {
    console.error('[Categories] Failed to resolve slugs:', error.message);
    return [];
  }

  return (data || [])
    .filter((category) => {
      const slug = String(category.slug || '').trim().toLowerCase();
      const name = String(category.name || '').trim().toLowerCase();
      return wanted.has(slug) || wanted.has(name);
    })
    .map((category) => category.id);
}

/** Product IDs assigned to any of the given categories (junction + legacy category_id). */
export async function getProductIdsForCategoryIds(categoryIds: string[]): Promise<string[]> {
  if (categoryIds.length === 0) return [];

  const [{ data: junction, error: junctionError }, { data: legacy, error: legacyError }] =
    await Promise.all([
      supabaseAdmin.from('product_categories').select('product_id').in('category_id', categoryIds),
      supabaseAdmin.from('products').select('id').in('category_id', categoryIds).eq('status', 'active'),
    ]);

  if (junctionError) {
    console.error('[Categories] Junction lookup failed:', junctionError.message);
  }
  if (legacyError) {
    console.error('[Categories] Legacy category_id lookup failed:', legacyError.message);
  }

  const ids = new Set<string>();
  for (const row of junction || []) {
    if (row.product_id) ids.add(row.product_id);
  }
  for (const row of legacy || []) {
    if (row.id) ids.add(row.id);
  }
  return Array.from(ids);
}

export function productBelongsToCategoryIds(product: any, categoryIds: string[]): boolean {
  if (!product || categoryIds.length === 0) return false;
  const allowed = new Set(categoryIds);
  if (product.category_id && allowed.has(product.category_id)) return true;
  for (const row of product.product_categories || []) {
    const id = row?.category_id || row?.categories?.id;
    if (id && allowed.has(id)) return true;
  }
  return false;
}

export function extractCategoryIdsFromProduct(product: any): string[] {
  const fromJunction = (product?.product_categories || [])
    .map((row: any) => row?.category_id || row?.categories?.id)
    .filter(Boolean);

  if (fromJunction.length > 0) {
    return fromJunction;
  }

  return product?.category_id ? [product.category_id] : [];
}
