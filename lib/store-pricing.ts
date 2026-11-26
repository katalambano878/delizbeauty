import { supabaseAdmin } from './supabase-admin';
import { parseStorePricing, STORE_PRICING_OFF, type StorePricing } from './pricing';

/**
 * Server-side reader for the whole-store sale setting (site_settings.store_pricing).
 * Browsing routes may reuse a value for a few seconds; anything that decides what a
 * customer is charged passes `fresh: true`.
 */

const TTL_MS = 20 * 1000;
let cached: { value: StorePricing; at: number } | null = null;

export async function getStorePricing(options: { fresh?: boolean } = {}): Promise<StorePricing> {
  if (!options.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const { data, error } = await supabaseAdmin
    .from('site_settings')
    .select('value')
    .eq('key', 'store_pricing')
    .maybeSingle();

  if (error) {
    console.warn('[StorePricing] could not read the sale setting:', error.message);
    // Charging full price is the safe answer when the setting cannot be read.
    return cached?.value ?? { ...STORE_PRICING_OFF };
  }

  const value = parseStorePricing(data?.value);
  cached = { value, at: Date.now() };
  return value;
}

export async function saveStorePricing(next: StorePricing): Promise<{ error: string | null }> {
  const { error } = await supabaseAdmin
    .from('site_settings')
    .upsert({ key: 'store_pricing', value: next, category: 'pricing' }, { onConflict: 'key' });
  if (error) return { error: error.message };
  cached = { value: next, at: Date.now() };
  return { error: null };
}
