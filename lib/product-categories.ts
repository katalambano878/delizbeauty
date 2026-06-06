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

export function extractCategoryIdsFromProduct(product: any): string[] {
  const fromJunction = (product?.product_categories || [])
    .map((row: any) => row?.category_id || row?.categories?.id)
    .filter(Boolean);

  if (fromJunction.length > 0) {
    return fromJunction;
  }

  return product?.category_id ? [product.category_id] : [];
}
