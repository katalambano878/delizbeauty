-- Many-to-many product ↔ category assignments.
-- products.category_id remains the primary category for backward compatibility.

CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE (product_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_product
  ON public.product_categories USING btree (product_id);

CREATE INDEX IF NOT EXISTS idx_product_categories_category
  ON public.product_categories USING btree (category_id);

-- Backfill from existing single-category assignments
INSERT INTO public.product_categories (product_id, category_id, is_primary)
SELECT id, category_id, true
FROM public.products
WHERE category_id IS NOT NULL
ON CONFLICT (product_id, category_id) DO NOTHING;

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read product categories"
  ON public.product_categories
  FOR SELECT
  USING (true);

CREATE POLICY "Service role manages product categories"
  ON public.product_categories
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
