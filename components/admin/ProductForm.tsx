'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { supabase } from '@/lib/supabase'; // used for categories fetch only
import { useRouter } from 'next/navigation';

interface ProductFormProps {
    initialData?: any;
    isEditMode?: boolean;
}

export default function ProductForm({ initialData, isEditMode = false }: ProductFormProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState<any[]>([]);

    const [productName, setProductName] = useState(initialData?.name || '');
    const [categoryId, setCategoryId] = useState(initialData?.category_id || '');
    const [price, setPrice] = useState(initialData?.price ?? '');
    const [comparePrice, setComparePrice] = useState(initialData?.compare_at_price ?? '');
    const [onSale, setOnSale] = useState(!!(initialData?.compare_at_price && parseFloat(initialData.compare_at_price) > parseFloat(initialData?.price || 0)));
    const [wholesalePrice, setWholesalePrice] = useState(initialData?.metadata?.wholesale_price ?? '');
    const [wholesaleMinQty, setWholesaleMinQty] = useState(initialData?.metadata?.wholesale_min_qty ?? '');
    const [sku, setSku] = useState(initialData?.sku || '');
    const [stock, setStock] = useState(initialData?.quantity || '');
    const [moq, setMoq] = useState(initialData?.moq || '1');
    const [lowStockThreshold, setLowStockThreshold] = useState(initialData?.metadata?.low_stock_threshold || '5');
    const [description, setDescription] = useState(initialData?.description || '');
    const [status, setStatus] = useState(initialData?.status || 'Active');
    const [featured, setFeatured] = useState(initialData?.featured || false);
    const [preorderShipping, setPreorderShipping] = useState(initialData?.metadata?.preorder_shipping || '');
    const [activeTab, setActiveTab] = useState('general');
    const [aiGenerating, setAiGenerating] = useState(false);

    // Auto-generate SKU function
    const generateSku = () => {
        const prefix = 'DBT';
        const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `${prefix}-${timestamp}-${random}`;
    };

    // --- Variant System ---
    // Preset color palette
    const colorPresets = [
        { name: 'Black', hex: '#000000' },
        { name: 'White', hex: '#FFFFFF' },
        { name: 'Red', hex: '#EF4444' },
        { name: 'Blue', hex: '#3B82F6' },
        { name: 'Navy', hex: '#1E3A5F' },
        { name: 'Green', hex: '#22C55E' },
        { name: 'Yellow', hex: '#EAB308' },
        { name: 'Pink', hex: '#EC4899' },
        { name: 'Purple', hex: '#A855F7' },
        { name: 'Orange', hex: '#F97316' },
        { name: 'Gray', hex: '#6B7280' },
        { name: 'Brown', hex: '#92400E' },
        { name: 'Beige', hex: '#D2B48C' },
        { name: 'Maroon', hex: '#800000' },
        { name: 'Teal', hex: '#14B8A6' },
        { name: 'Cream', hex: '#FFFDD0' },
        { name: 'Gold', hex: '#D4AF37' },
        { name: 'Silver', hex: '#C0C0C0' },
    ];
    // Common beauty / cosmetics sizes & options (you can still add any custom ones)
    const sizePresets = ['10ml', '20ml', '30ml', '50ml', '100ml', '150ml', '200ml'];

    // Parse existing variants to extract unique colors, sizes, and variant image
    const existingVariants = (initialData?.product_variants || []).map((v: any) => ({
        ...v,
        stock: v.stock ?? v.quantity ?? 0,
        color: v.color ?? v.option2 ?? '',
        size: v.name || '',
        image_url: v.image_url || ''
    }));

    const [selectedColors, setSelectedColors] = useState<{ name: string; hex: string }[]>(() => {
        const colors = new Map<string, string>();
        existingVariants.forEach((v: any) => {
            if (v.color) {
                const preset = colorPresets.find(c => c.name.toLowerCase() === v.color.toLowerCase());
                colors.set(v.color, preset?.hex || '#888888');
            }
        });
        return Array.from(colors.entries()).map(([name, hex]) => ({ name, hex }));
    });

    const [selectedSizes, setSelectedSizes] = useState<string[]>(() => {
        const sizes = new Set<string>();
        existingVariants.forEach((v: any) => {
            if (v.size) sizes.add(v.size);
        });
        return Array.from(sizes);
    });

    const [customColorName, setCustomColorName] = useState('');
    const [customColorHex, setCustomColorHex] = useState('#888888');
    const [customSize, setCustomSize] = useState('');

    // Build variants from colors × sizes (or just sizes, or just colors)
    const buildVariantKey = (color: string, size: string) => `${color}|||${size}`;

    // Store variant data (price, stock, sku, optional image_url) keyed by "color|||size"
    const [variantData, setVariantData] = useState<Record<string, { price: string; stock: string; sku: string; image_url?: string }>>(() => {
        const data: Record<string, { price: string; stock: string; sku: string; image_url?: string }> = {};
        existingVariants.forEach((v: any) => {
            const key = buildVariantKey(v.color || '', v.size || '');
            data[key] = {
                price: v.price?.toString() || '',
                stock: v.stock?.toString() || '0',
                sku: v.sku || '',
                image_url: v.image_url || undefined
            };
        });
        return data;
    });

    // Computed: all variant combinations
    const variantCombinations = (() => {
        const combos: { color: string; colorHex: string; size: string; key: string }[] = [];
        const colors = selectedColors.length > 0 ? selectedColors : [{ name: '', hex: '' }];
        const sizes = selectedSizes.length > 0 ? selectedSizes : [''];

        for (const color of colors) {
            for (const size of sizes) {
                if (!color.name && !size) continue; // skip if both empty
                const key = buildVariantKey(color.name, size);
                combos.push({ color: color.name, colorHex: color.hex, size, key });
            }
        }
        return combos;
    })();

    // Build the flat variants array for saving (used by handleSubmit)
    const variants = variantCombinations.map((combo, idx) => {
        const d = variantData[combo.key] || { price: price, stock: '0', sku: '' };
        return {
            name: combo.size,
            color: combo.color,
            sku: d.sku,
            price: d.price || price,
            stock: d.stock || '0',
            image_url: d.image_url || undefined,
            sort_order: idx,
        };
    });

    const updateVariantField = (key: string, field: string, value: string) => {
        setVariantData(prev => ({
            ...prev,
            [key]: { ...prev[key] || { price: price, stock: '0', sku: '' }, [field]: value }
        }));
    };

    const setVariantImage = (key: string, imageUrl: string) => {
        setVariantData(prev => ({
            ...prev,
            [key]: { ...prev[key] || { price: price, stock: '0', sku: '' }, image_url: imageUrl || undefined }
        }));
    };

    // Bulk set price/stock for all variants
    const bulkSetField = (field: 'price' | 'stock', value: string) => {
        setVariantData(prev => {
            const updated = { ...prev };
            variantCombinations.forEach(combo => {
                updated[combo.key] = { ...updated[combo.key] || { price: price, stock: '0', sku: '' }, [field]: value };
            });
            return updated;
        });
    };

    const toggleColor = (color: { name: string; hex: string }) => {
        setSelectedColors(prev => {
            const exists = prev.find(c => c.name === color.name);
            if (exists) return prev.filter(c => c.name !== color.name);
            return [...prev, color];
        });
    };

    const toggleSize = (size: string) => {
        setSelectedSizes(prev => {
            if (prev.includes(size)) return prev.filter(s => s !== size);
            return [...prev, size];
        });
    };

    const addCustomColor = () => {
        if (!customColorName.trim()) return;
        const exists = selectedColors.find(c => c.name.toLowerCase() === customColorName.trim().toLowerCase());
        if (!exists) {
            setSelectedColors(prev => [...prev, { name: customColorName.trim(), hex: customColorHex }]);
        }
        setCustomColorName('');
        setCustomColorHex('#888888');
    };

    const addCustomSize = () => {
        if (!customSize.trim()) return;
        if (!selectedSizes.includes(customSize.trim())) {
            setSelectedSizes(prev => [...prev, customSize.trim()]);
        }
        setCustomSize('');
    };

    const editSize = (oldSize: string, newSize: string) => {
        const trimmed = newSize.trim();
        if (!trimmed || trimmed === oldSize) return;
        if (selectedSizes.includes(trimmed)) return; // avoid duplicate
        setSelectedSizes(prev => prev.map(s => s === oldSize ? trimmed : s));
        setVariantData(prev => {
            const next: Record<string, { price: string; stock: string; sku: string; image_url?: string }> = {};
            Object.entries(prev).forEach(([key, val]) => {
                const [color, size] = key.split('|||');
                next[size === oldSize ? buildVariantKey(color, trimmed) : key] = val;
            });
            return next;
        });
    };

    const editColor = (oldName: string, newName: string, newHex?: string) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === oldName) return;
        if (selectedColors.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) return;
        const hex = newHex || selectedColors.find(c => c.name === oldName)?.hex || '#888888';
        setSelectedColors(prev => prev.map(c => c.name === oldName ? { name: trimmed, hex } : c));
        setVariantData(prev => {
            const next: Record<string, { price: string; stock: string; sku: string; image_url?: string }> = {};
            Object.entries(prev).forEach(([key, val]) => {
                const [color, size] = key.split('|||');
                next[color === oldName ? buildVariantKey(trimmed, size) : key] = val;
            });
            return next;
        });
    };

    // Images
    const [images, setImages] = useState<any[]>(initialData?.product_images || []);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ name: string; done: boolean }[]>([]);

    // SEO
    const [seoTitle, setSeoTitle] = useState(initialData?.seo_title || '');
    const [metaDescription, setMetaDescription] = useState(initialData?.seo_description || '');
    const [urlSlug, setUrlSlug] = useState(initialData?.slug || '');
    const [keywords, setKeywords] = useState(initialData?.tags?.join(', ') || '');
    // Track manual edits so auto-generation doesn't overwrite user changes
    const [seoTitleEdited, setSeoTitleEdited] = useState(!!initialData?.seo_title);
    const [metaDescEdited, setMetaDescEdited] = useState(!!initialData?.seo_description);
    const [keywordsEdited, setKeywordsEdited] = useState(!!(initialData?.tags?.length));

    const generateSeoFields = (name: string, desc: string) => {
        const title = name ? `${name} | Deliz Beauty Tools` : '';
        const metaDesc = desc
            ? (desc.length > 160 ? desc.substring(0, 157).trimEnd() + '...' : desc)
            : name ? `Shop ${name} at Deliz Beauty Tools. Premium beauty products in Ghana.` : '';
        const kw = name
            ? [...new Set([
                name.toLowerCase(),
                ...name.toLowerCase().split(/\s+/).filter(w => w.length > 2),
                'deliz beauty', 'beauty tools ghana', 'beauty supplies'
              ])].join(', ')
            : '';
        return { title, metaDesc, kw };
    };

    const tabs = [
        { id: 'general', label: 'General', icon: 'ri-information-line' },
        { id: 'pricing', label: 'Pricing & Inventory', icon: 'ri-price-tag-3-line' },
        { id: 'variants', label: 'Variants', icon: 'ri-layout-grid-line' },
        { id: 'images', label: 'Images', icon: 'ri-image-line' },
        { id: 'seo', label: 'SEO', icon: 'ri-search-line' }
    ];

    const [categoriesLoaded, setCategoriesLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        async function fetchCategories() {
            const { data } = await supabase
                .from('categories')
                .select('id, name')
                .eq('status', 'active')
                .order('name', { ascending: true });
            if (cancelled) return;
            setCategories(data || []);
            setCategoriesLoaded(true);
        }
        fetchCategories();
        return () => { cancelled = true; };
    }, []);

    // Auto-generate slug from name if not manually edited
    useEffect(() => {
        if (!isEditMode && productName && !urlSlug) {
            setUrlSlug(productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''));
        }
    }, [productName, isEditMode, urlSlug]);

    // Auto-generate SEO fields from name + description (only if not manually edited)
    useEffect(() => {
        if (isEditMode) return; // don't auto-overwrite on edit
        const { title, metaDesc, kw } = generateSeoFields(productName, description);
        if (!seoTitleEdited) setSeoTitle(title);
        if (!metaDescEdited) setMetaDescription(metaDesc);
        if (!keywordsEdited) setKeywords(kw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [productName, description]);

    // Auto-generate SKU for new products
    useEffect(() => {
        if (!isEditMode && !sku) {
            setSku(generateSku());
        }
    }, [isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep On Sale toggle in sync with Compare at Price (interchangeable)
    useEffect(() => {
        const hasSale = !!(comparePrice && price && parseFloat(comparePrice) > parseFloat(price));
        setOnSale(hasSale);
    }, [comparePrice, price]);

    const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        try {
            if (!e.target.files || e.target.files.length === 0) return;

            const files = Array.from(e.target.files);
            const existingCount = images.length;
            const maxItems = 10;

            if (existingCount + files.length > maxItems) {
                alert(`You can upload up to ${maxItems} media items per product. You have ${existingCount} already. Please remove some or select fewer files.`);
                return;
            }

            setUploading(true);
            setUploadProgress(files.map(f => ({ name: f.name, done: false })));

            const newImages: any[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
                const isVideo = ['mp4', 'mov', 'webm'].includes(fileExt);

                const maxSize = isVideo ? 100 * 1024 * 1024 : 5 * 1024 * 1024;
                if (file.size > maxSize) {
                    alert(`"${file.name}" is too large. Max: ${isVideo ? '100MB for videos' : '5MB for images'}`);
                    setUploadProgress(prev => prev.map((p, idx) => idx === i ? { ...p, done: true } : p));
                    continue;
                }

                const formData = new FormData();
                formData.append('file', file);
                formData.append('bucket', 'products');

                const res = await fetch('/api/admin/upload', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include',
                });

                const data = await res.json().catch(() => ({}));
                setUploadProgress(prev => prev.map((p, idx) => idx === i ? { ...p, done: true } : p));

                if (!res.ok) {
                    alert(data.error || `Upload failed for "${file.name}"`);
                    continue;
                }

                const url = data.url;
                if (!url) {
                    alert(`No URL returned for "${file.name}"`);
                    continue;
                }

                newImages.push({
                    url,
                    position: existingCount + newImages.length,
                    media_type: isVideo ? 'video' : 'image',
                });
            }

            if (newImages.length > 0) {
                setImages(prev => [...prev, ...newImages]);
            }
        } catch (error: any) {
            alert('Error uploading: ' + (error?.message || 'Upload failed'));
        } finally {
            setUploading(false);
            setUploadProgress([]);
            if (e.target) e.target.value = '';
        }
    };

    const handleRemoveImage = (indexToRemove: number) => {
        setImages(images.filter((_, idx) => idx !== indexToRemove));
    };

    const handleImageReorder = (result: DropResult) => {
        if (!result.destination) return;
        const items = Array.from(images);
        const [reordered] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reordered);
        setImages(items);
    };

    const handleAiDescription = async () => {
        const firstImage = images.find((img: any) => img.media_type !== 'video');
        if (!firstImage?.url) {
            alert('Please upload at least one product image first so AI can analyze it.');
            return;
        }
        setAiGenerating(true);
        try {
            const selectedCat = categories.find((c: any) => c.id === categoryId);
            const res = await fetch('/api/admin/products/generate-description', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    imageUrl: firstImage.url,
                    productName: productName || undefined,
                    categoryName: selectedCat?.name || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to generate');
            setDescription(data.description);
        } catch (err: any) {
            alert(err.message || 'AI generation failed. Please try again.');
        } finally {
            setAiGenerating(false);
        }
    };

    // Variant helpers removed — variants are now auto-generated from selectedColors × selectedSizes

    const handleSubmit = async () => {
        try {
            if (!productName.trim()) {
                alert('Please enter a product name.');
                return;
            }
            if (!categoriesLoaded) {
                alert('Categories are still loading. Please wait a moment and try again.');
                return;
            }
            if (!categoryId) {
                alert('Please select a category before saving.');
                return;
            }

            setLoading(true);

            const hasVariants = variants.length > 0;
            const variantStockTotal = hasVariants
                ? variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0)
                : parseInt(stock) || 0;

            // Build variants payload with colorHex and image_url for the API
            const variantsPayload = variants.map(v => ({
                ...v,
                colorHex: selectedColors.find(c => c.name === v.color)?.hex || null,
                image_url: v.image_url || null,
            }));

            const productData = {
                name: productName,
                slug: urlSlug || productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''),
                description,
                category_id: categoryId || null,
                price: parseFloat(price) || 0,
                compare_at_price: comparePrice ? parseFloat(comparePrice) : null,
                sku: sku || generateSku(),
                quantity: hasVariants ? variantStockTotal : (parseInt(stock) || 0),
                moq: parseInt(moq) || 1,
                status: status.toLowerCase(),
                featured,
                seo_title: seoTitle,
                seo_description: metaDescription,
                tags: (keywords as string).split(',').map((k: string) => k.trim()).filter(Boolean),
                metadata: {
                    low_stock_threshold: parseInt(lowStockThreshold) || 5,
                    preorder_shipping: preorderShipping.trim() || null,
                    wholesale_price: wholesalePrice ? parseFloat(wholesalePrice) : null,
                    wholesale_min_qty: wholesaleMinQty ? parseInt(wholesaleMinQty) : null
                },
                variants: variantsPayload,
            };

            let productId = initialData?.id;

            if (isEditMode && productId) {
                // Update via API (service role — bypasses RLS)
                const res = await fetch(`/api/admin/products/${productId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(productData),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to update product');
            } else {
                // Create via API (service role — bypasses RLS, handles unique slug)
                const res = await fetch('/api/admin/products', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(productData),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to create product');
                productId = data.id;
            }

            // Save images via API
            if (productId) {
                const res = await fetch(`/api/admin/products/${productId}/images`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        images: images.map((img: any, idx: number) => ({
                            url: img.url,
                            position: idx,
                            alt_text: productName,
                            media_type: img.media_type || 'image',
                        })),
                        productName,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to save product images');
            }

            alert(isEditMode
                ? 'Product updated successfully!'
                : 'Product created successfully!');
            router.push('/admin/products');

        } catch (err: any) {
            console.error('Error saving product:', err);
            alert(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Link
                        href="/admin/products"
                        className="w-10 h-10 flex items-center justify-center border-2 border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
                    >
                        <i className="ri-arrow-left-line text-xl text-gray-700"></i>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">
                            {isEditMode ? 'Edit Product' : 'Add New Product'}
                        </h1>
                        <p className="text-gray-600 mt-1">
                            {isEditMode ? 'Update product information and settings' : 'Create a new product for your catalog'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    {isEditMode && initialData?.slug && (
                        <Link
                            href={`/product/${initialData.slug}`}
                            target="_blank"
                            className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-semibold whitespace-nowrap cursor-pointer flex items-center"
                        >
                            <i className="ri-eye-line mr-2"></i>
                            Preview
                        </Link>
                    )}
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className={`px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                        {loading ? (
                            <>
                                <i className="ri-loader-4-line animate-spin mr-2"></i>
                                Saving...
                            </>
                        ) : (
                            <>
                                <i className="ri-save-line mr-2"></i>
                                {isEditMode ? 'Save Changes' : 'Create Product'}
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="border-b border-gray-200 overflow-x-auto">
                    <div className="flex">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center space-x-2 px-6 py-4 font-semibold whitespace-nowrap transition-colors border-b-2 cursor-pointer ${activeTab === tab.id
                                    ? 'border-gray-900 text-gray-900 bg-gray-50'
                                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                    }`}
                            >
                                <i className={`${tab.icon} text-xl`}></i>
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="p-8">
                    {activeTab === 'general' && (
                        <div className="space-y-6 max-w-3xl">
                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">
                                    Product Name *
                                </label>
                                <input
                                    type="text"
                                    value={productName}
                                    onChange={(e) => setProductName(e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                    placeholder="Enter product name"
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-sm font-semibold text-gray-900">
                                        Description
                                    </label>
                                    <button
                                        type="button"
                                        onClick={handleAiDescription}
                                        disabled={aiGenerating}
                                        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-lg border-2 transition-colors ${
                                            aiGenerating
                                                ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                                                : 'border-gray-300 text-gray-700 hover:border-gray-900 hover:bg-gray-50 cursor-pointer'
                                        }`}
                                    >
                                        <i className={`${aiGenerating ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-line'}`}></i>
                                        {aiGenerating ? 'Generating...' : 'AI Write'}
                                    </button>
                                </div>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={6}
                                    maxLength={500}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600 resize-none"
                                    placeholder="Describe your product..."
                                />
                                <p className="text-sm text-gray-500 mt-2">{description.length}/500 characters</p>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                                        Category *
                                    </label>
                                    <select
                                        value={categoryId}
                                        onChange={(e) => setCategoryId(e.target.value)}
                                        required
                                        className={`w-full px-4 py-3 pr-8 border-2 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600 cursor-pointer ${
                                            !categoriesLoaded || !categoryId ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
                                        }`}
                                    >
                                        {!categoriesLoaded && <option value="">Loading categories...</option>}
                                        {categoriesLoaded && <option value="">— Select a category —</option>}
                                        {categories.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                                        Status
                                    </label>
                                    <select
                                        value={status}
                                        onChange={(e) => setStatus(e.target.value)}
                                        className="w-full px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600 cursor-pointer"
                                    >
                                        <option>Active</option>
                                        <option>Draft</option>
                                        <option>Archived</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center space-x-3">
                                <input
                                    type="checkbox"
                                    checked={featured}
                                    onChange={(e) => setFeatured(e.target.checked)}
                                    className="w-5 h-5 text-gray-900 border-gray-300 rounded focus:ring-gray-600 cursor-pointer"
                                />
                                <label className="text-gray-900 font-medium">
                                    Feature this product on homepage
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">
                                    Pre-order / Estimated Shipping
                                </label>
                                <input
                                    type="text"
                                    value={preorderShipping}
                                    onChange={(e) => setPreorderShipping(e.target.value)}
                                    placeholder="e.g., Ships in 14 days, Available March 15"
                                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-600 focus:border-transparent transition-all"
                                />
                                <p className="text-xs text-gray-500 mt-1">Leave empty if product ships immediately. Otherwise, enter estimated shipping time.</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'pricing' && (
                        <div className="space-y-6 max-w-3xl">
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                                        Price (GH₵) *
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                                        <input
                                            type="number"
                                            value={price}
                                            onChange={(e) => setPrice(e.target.value)}
                                            className="w-full pl-16 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                            step="0.01"
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                                        Compare at Price (GH₵)
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                                        <input
                                            type="number"
                                            value={comparePrice}
                                            onChange={(e) => setComparePrice(e.target.value)}
                                            className="w-full pl-16 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                            step="0.01"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <p className="text-sm text-gray-500 mt-2">Show original price for comparison (e.g. crossed out when on sale).</p>
                                </div>
                            </div>

                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                <p className="text-blue-900 font-semibold mb-1">Discount Calculation</p>
                                {price && comparePrice && parseFloat(comparePrice) > parseFloat(price) ? (
                                    <p className="text-blue-800">
                                        Savings: GH₵ {(parseFloat(comparePrice) - parseFloat(price)).toFixed(2)}
                                        <span className="ml-2">
                                            ({(((parseFloat(comparePrice) - parseFloat(price)) / parseFloat(comparePrice)) * 100).toFixed(0)}% off)
                                        </span>
                                    </p>
                                ) : (
                                    <p className="text-blue-800 text-sm">Enter a compare price higher than the selling price to see discount.</p>
                                )}
                            </div>

                            {/* On Sale toggle - works interchangeably with Compare at Price above */}
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border-2 border-gray-200">
                                <div>
                                    <p className="font-semibold text-gray-900">On Sale</p>
                                    <p className="text-sm text-gray-600 mt-0.5">Turn on to mark as sale (or just set Compare at Price above).</p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={onSale}
                                    onClick={() => {
                                        if (onSale) {
                                            setComparePrice('');
                                        } else {
                                            const p = parseFloat(price);
                                            if (p > 0) setComparePrice(String((p * 1.1).toFixed(2)));
                                        }
                                    }}
                                    className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer ${onSale ? 'bg-gray-900' : 'bg-gray-300'}`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all ${onSale ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>

                            {/* Wholesale */}
                            <div className="pt-6 border-t border-gray-200">
                                <h3 className="text-lg font-bold text-gray-900 mb-2">Wholesale (optional)</h3>
                                <p className="text-sm text-gray-600 mb-4">Set a bulk price for customers who order larger quantities.</p>
                                <div className="grid md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">Wholesale Price (GH₵)</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                                            <input
                                                type="number"
                                                value={wholesalePrice}
                                                onChange={(e) => setWholesalePrice(e.target.value)}
                                                className="w-full pl-16 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                                step="0.01"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">Minimum Quantity for Wholesale</label>
                                        <input
                                            type="number"
                                            value={wholesaleMinQty}
                                            onChange={(e) => setWholesaleMinQty(e.target.value)}
                                            min="2"
                                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                            placeholder="e.g. 10"
                                        />
                                        <p className="text-sm text-gray-500 mt-2">Min. order qty to qualify for wholesale price.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-6 border-t border-gray-200">
                                <h3 className="text-lg font-bold text-gray-900 mb-4">Inventory</h3>

                                <div className="grid md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">
                                            SKU (Auto-generated)
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={sku}
                                                onChange={(e) => setSku(e.target.value)}
                                                className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600 font-mono bg-gray-50"
                                                placeholder="Auto-generated"
                                                readOnly
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setSku(generateSku())}
                                                className="px-4 py-3 border-2 border-gray-300 rounded-lg hover:border-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
                                                title="Generate new SKU"
                                            >
                                                <i className="ri-refresh-line text-lg"></i>
                                            </button>
                                        </div>
                                        <p className="text-sm text-gray-500 mt-1">SKU is auto-generated. Click refresh to generate a new one.</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">
                                            Stock Quantity *
                                        </label>
                                        {variants.length > 0 ? (
                                            <div>
                                                <input
                                                    type="number"
                                                    value={variants.reduce((sum: number, v: any) => sum + (parseInt(v.stock) || 0), 0)}
                                                    readOnly
                                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                                                />
                                                <p className="text-sm text-amber-600 mt-1 flex items-center">
                                                    <i className="ri-information-line mr-1"></i>
                                                    Stock is managed per variant. Edit stock in the Variants tab.
                                                </p>
                                            </div>
                                        ) : (
                                            <input
                                                type="number"
                                                value={stock}
                                                onChange={(e) => setStock(e.target.value)}
                                                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                                placeholder="0"
                                            />
                                        )}
                                    </div>
                                </div>

                                <div className="grid md:grid-cols-2 gap-6 mt-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">
                                            Minimum Order Quantity (MOQ)
                                        </label>
                                        <input
                                            type="number"
                                            value={moq}
                                            onChange={(e) => setMoq(e.target.value)}
                                            min="1"
                                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                            placeholder="1"
                                        />
                                        <p className="text-sm text-gray-500 mt-1">Minimum quantity customers must order</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">
                                            Low Stock Threshold
                                        </label>
                                        <input
                                            type="number"
                                            value={lowStockThreshold}
                                            onChange={(e) => setLowStockThreshold(e.target.value)}
                                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                        />
                                        <p className="text-sm text-gray-500 mt-1">Get notified when stock falls below this number</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'variants' && (
                        <div className="space-y-8">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">Product Variants</h3>
                                <p className="text-gray-600 mt-1">Select colors and sizes below — variants are generated automatically</p>
                            </div>

                            {/* STEP 1: Colors */}
                            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                                <h4 className="text-sm font-bold text-gray-900 mb-1 flex items-center">
                                    <i className="ri-palette-line mr-2 text-lg text-gray-900"></i>
                                    Step 1: Select Colors
                                    {selectedColors.length > 0 && (
                                        <span className="ml-2 bg-gray-100 text-gray-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                                            {selectedColors.length} selected
                                        </span>
                                    )}
                                </h4>
                                <p className="text-xs text-gray-500 mb-4">Click colors to add/remove. Skip if product has no color options.</p>

                                <div className="flex flex-wrap gap-2 mb-4">
                                    {colorPresets.map(color => {
                                        const isSelected = selectedColors.some(c => c.name === color.name);
                                        return (
                                            <button
                                                key={color.name}
                                                onClick={() => toggleColor(color)}
                                                className={`flex items-center space-x-2 px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium ${
                                                    isSelected
                                                        ? 'border-gray-700 bg-gray-50 ring-1 ring-gray-700'
                                                        : 'border-gray-200 hover:border-gray-300 bg-white'
                                                }`}
                                                title={color.name}
                                            >
                                                <span
                                                    className="w-5 h-5 rounded-full border border-gray-300 flex-shrink-0"
                                                    style={{ backgroundColor: color.hex }}
                                                ></span>
                                                <span className={isSelected ? 'text-gray-800' : 'text-gray-700'}>{color.name}</span>
                                                {isSelected && <i className="ri-check-line text-gray-900"></i>}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Custom color */}
                                <div className="flex items-center gap-2 pt-3 border-t border-gray-200">
                                    <input
                                        type="color"
                                        value={customColorHex}
                                        onChange={(e) => setCustomColorHex(e.target.value)}
                                        className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer p-0.5"
                                        title="Pick a custom color"
                                    />
                                    <input
                                        type="text"
                                        value={customColorName}
                                        onChange={(e) => setCustomColorName(e.target.value)}
                                        placeholder="Custom color name"
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        onKeyDown={(e) => e.key === 'Enter' && addCustomColor()}
                                    />
                                    <button
                                        onClick={addCustomColor}
                                        disabled={!customColorName.trim()}
                                        className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Add Color
                                    </button>
                                </div>

                                {/* Selected colors summary */}
                                {selectedColors.length > 0 && (
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {selectedColors.map(color => (
                                            <span key={color.name} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm shadow-sm">
                                                <span className="w-3.5 h-3.5 rounded-full border border-gray-300" style={{ backgroundColor: color.hex }}></span>
                                                {color.name}
                                                <button type="button" onClick={() => { const v = prompt('Edit color name:', color.name); if (v != null && v.trim()) editColor(color.name, v.trim()); }} className="text-gray-400 hover:text-gray-700 ml-0.5" title="Edit name">
                                                    <i className="ri-pencil-line text-sm"></i>
                                                </button>
                                                <button type="button" onClick={() => toggleColor(color)} className="text-gray-400 hover:text-red-500 ml-0.5">
                                                    <i className="ri-close-line text-sm"></i>
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* STEP 2: Sizes */}
                            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                                <h4 className="text-sm font-bold text-gray-900 mb-1 flex items-center">
                                    <i className="ri-ruler-line mr-2 text-lg text-blue-600"></i>
                                    Step 2: Select Sizes / Options
                                    {selectedSizes.length > 0 && (
                                        <span className="ml-2 bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                                            {selectedSizes.length} selected
                                        </span>
                                    )}
                                </h4>
                                <p className="text-xs text-gray-500 mb-4">
                                    Click options to add/remove. Use custom for things like volumes (10ml, 50ml),
                                    lash lengths (12mm, 16mm), wig lengths (14&quot;, 20&quot;), bundle counts, etc.
                                </p>

                                <div className="flex flex-wrap gap-2 mb-4">
                                    {sizePresets.map(size => {
                                        const isSelected = selectedSizes.includes(size);
                                        return (
                                            <button
                                                key={size}
                                                onClick={() => toggleSize(size)}
                                                className={`px-5 py-2.5 rounded-lg border-2 font-semibold text-sm transition-all ${
                                                    isSelected
                                                        ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600'
                                                        : 'border-gray-200 hover:border-gray-300 bg-white text-gray-700'
                                                }`}
                                            >
                                                {size}
                                                {isSelected && <i className="ri-check-line ml-1.5 text-blue-600"></i>}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Custom size */}
                                <div className="flex items-center gap-2 pt-3 border-t border-gray-200">
                                    <input
                                        type="text"
                                        value={customSize}
                                        onChange={(e) => setCustomSize(e.target.value)}
                                        placeholder="Custom option (e.g. 10ml serum, 16mm lash, 20&quot; wig, One Size)"
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        onKeyDown={(e) => e.key === 'Enter' && addCustomSize()}
                                    />
                                    <button
                                        onClick={addCustomSize}
                                        disabled={!customSize.trim()}
                                        className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Add Size
                                    </button>
                                </div>

                                {/* Selected sizes — draggable to reorder */}
                                {selectedSizes.length > 0 && (
                                    <DragDropContext onDragEnd={(result: DropResult) => {
                                        if (!result.destination) return;
                                        const reordered = Array.from(selectedSizes);
                                        const [moved] = reordered.splice(result.source.index, 1);
                                        reordered.splice(result.destination.index, 0, moved);
                                        setSelectedSizes(reordered);
                                    }}>
                                        <Droppable droppableId="sizes-list" direction="horizontal">
                                            {(provided) => (
                                                <div className="mt-4 flex flex-wrap gap-2" ref={provided.innerRef} {...provided.droppableProps}>
                                                    {selectedSizes.map((size, idx) => (
                                                        <Draggable key={size} draggableId={`size-${size}`} index={idx}>
                                                            {(dragProvided, snapshot) => (
                                                                <span
                                                                    ref={dragProvided.innerRef}
                                                                    {...dragProvided.draggableProps}
                                                                    {...dragProvided.dragHandleProps}
                                                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border rounded-full text-sm shadow-sm font-medium cursor-grab active:cursor-grabbing select-none transition-shadow ${snapshot.isDragging ? 'border-gray-400 shadow-md ring-2 ring-gray-200' : 'border-gray-200'}`}
                                                                >
                                                                    <i className="ri-draggable text-gray-300 text-xs mr-0.5"></i>
                                                                    {size}
                                                                    <button type="button" onClick={() => { const v = prompt('Edit option name:', size); if (v != null && v.trim()) editSize(size, v.trim()); }} className="text-gray-400 hover:text-gray-700 ml-0.5" title="Edit name">
                                                                        <i className="ri-pencil-line text-sm"></i>
                                                                    </button>
                                                                    <button type="button" onClick={() => toggleSize(size)} className="text-gray-400 hover:text-red-500 ml-0.5">
                                                                        <i className="ri-close-line text-sm"></i>
                                                                    </button>
                                                                </span>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </DragDropContext>
                                )}
                            </div>

                            {/* STEP 3: Variant Grid */}
                            {variantCombinations.length > 0 && (
                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-900 flex items-center">
                                                <i className="ri-grid-line mr-2 text-lg text-purple-600"></i>
                                                Step 3: Set Price & Stock ({variantCombinations.length} variant{variantCombinations.length > 1 ? 's' : ''})
                                            </h4>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => {
                                                    const val = prompt('Set price for ALL variants:', price?.toString() || '0');
                                                    if (val !== null) bulkSetField('price', val);
                                                }}
                                                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
                                            >
                                                Bulk Set Price
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const val = prompt('Set stock for ALL variants:', '0');
                                                    if (val !== null) bulkSetField('stock', val);
                                                }}
                                                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
                                            >
                                                Bulk Set Stock
                                            </button>
                                        </div>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead className="bg-gray-50 border-b border-gray-200">
                                                <tr>
                                                    {selectedColors.length > 0 && (
                                                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Color</th>
                                                    )}
                                                    {selectedSizes.length > 0 && (
                                                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Size</th>
                                                    )}
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Variant image</th>
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Price (GH₵)</th>
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Stock</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {variantCombinations.map((combo) => {
                                                    const d = variantData[combo.key] || { price: price, stock: '0', sku: '' };
                                                    return (
                                                        <tr key={combo.key} className="border-b border-gray-100 hover:bg-gray-50">
                                                            {selectedColors.length > 0 && (
                                                                <td className="py-3 px-4">
                                                                    <div className="flex items-center gap-2">
                                                                        <span
                                                                            className="w-5 h-5 rounded-full border border-gray-300 flex-shrink-0"
                                                                            style={{ backgroundColor: combo.colorHex }}
                                                                        ></span>
                                                                        <span className="text-sm font-medium text-gray-900">{combo.color}</span>
                                                                    </div>
                                                                </td>
                                                            )}
                                                            {selectedSizes.length > 0 && (
                                                                <td className="py-3 px-4">
                                                                    <span className="text-sm font-semibold text-gray-900 bg-gray-100 px-2.5 py-1 rounded">
                                                                        {combo.size}
                                                                    </span>
                                                                </td>
                                                            )}
                                                            <td className="py-3 px-4">
                                                                <div className="flex items-center gap-2">
                                                                    {d.image_url ? (
                                                                        <>
                                                                            <img src={d.image_url} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                                                                            <button type="button" onClick={() => setVariantImage(combo.key, '')} className="text-xs text-red-600 hover:underline font-medium">Remove</button>
                                                                        </>
                                                                    ) : (
                                                                        <span className="text-gray-400 text-xs">No image</span>
                                                                    )}
                                                                    <div className="flex flex-col gap-1">
                                                                        <label className="cursor-pointer text-xs font-medium text-gray-700 hover:text-gray-900 flex items-center gap-1">
                                                                            <i className="ri-upload-line"></i> Upload
                                                                            <input
                                                                                type="file"
                                                                                accept=".jpg,.jpeg,.png,.webp"
                                                                                className="hidden"
                                                                                onChange={async (e) => {
                                                                                    const file = e.target.files?.[0];
                                                                                    if (!file) return;
                                                                                    const fd = new FormData();
                                                                                    fd.append('file', file);
                                                                                    fd.append('bucket', 'products');
                                                                                    const res = await fetch('/api/admin/upload', { method: 'POST', body: fd, credentials: 'include' });
                                                                                    const data = await res.json().catch(() => ({}));
                                                                                    if (data?.url) setVariantImage(combo.key, data.url);
                                                                                    e.target.value = '';
                                                                                }}
                                                                            />
                                                                        </label>
                                                                        {images.filter((img: any) => img.media_type !== 'video').length > 0 && (
                                                                            <select
                                                                                className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-700"
                                                                                value=""
                                                                                onChange={(e) => { const u = e.target.value; if (u) setVariantImage(combo.key, u); e.target.value = ''; }}
                                                                            >
                                                                                <option value="">Pick from product</option>
                                                                                {images.filter((img: any) => img.media_type !== 'video').map((img: any, idx: number) => (
                                                                                    <option key={idx} value={img.url}>Image {idx + 1}</option>
                                                                                ))}
                                                                            </select>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-4">
                                                                <input
                                                                    type="number"
                                                                    value={d.price}
                                                                    onChange={(e) => updateVariantField(combo.key, 'price', e.target.value)}
                                                                    className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-gray-600 focus:border-gray-600"
                                                                    step="0.01"
                                                                    placeholder={price?.toString() || '0'}
                                                                />
                                                            </td>
                                                            <td className="py-3 px-4">
                                                                <input
                                                                    type="number"
                                                                    value={d.stock}
                                                                    onChange={(e) => updateVariantField(combo.key, 'stock', e.target.value)}
                                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-gray-600 focus:border-gray-600"
                                                                    placeholder="0"
                                                                />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="p-3 bg-gray-50 border-t border-gray-100">
                                        <p className="text-xs text-gray-800 flex items-center">
                                            <i className="ri-information-line mr-1.5"></i>
                                            Total stock across all variants: <strong className="ml-1">{variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0)}</strong>
                                        </p>
                                    </div>
                                </div>
                            )}

                            {variantCombinations.length === 0 && (
                                <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                    <i className="ri-palette-line text-4xl text-gray-300 mb-2 block"></i>
                                    <p className="font-medium">No variants configured</p>
                                    <p className="text-sm mt-1">Select colors and/or sizes above to create variant combinations.</p>
                                    <p className="text-xs mt-2 text-gray-400">You can add just colors, just sizes, or both for a full grid.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'images' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">Product Media</h3>
                                <p className="text-gray-600">Add up to 10 images or videos. First item will be the primary display. Drag images to reorder. <strong className="text-gray-700">Click &quot;Save Changes&quot; after adding images to make them visible to customers.</strong></p>
                            </div>

                            <DragDropContext onDragEnd={handleImageReorder}>
                                <Droppable droppableId="product-images" direction="horizontal">
                                    {(provided) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                            className="grid grid-cols-2 md:grid-cols-4 gap-4"
                                        >
                                            {images.map((img: any, index: number) => {
                                                const isVideo = img.media_type === 'video' || /\.(mp4|mov|webm)$/i.test(img.url);
                                                return (
                                                    <Draggable key={img.url} draggableId={img.url} index={index}>
                                                        {(provided) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                className="relative group cursor-grab active:cursor-grabbing"
                                                            >
                                                                <div className="aspect-square bg-gray-100 rounded-xl overflow-hidden border-2 border-gray-200">
                                                                    {isVideo ? (
                                                                        <video src={img.url} className="w-full h-full object-cover" muted preload="metadata" />
                                                                    ) : (
                                                                        <img src={img.url} alt={`Product ${index + 1}`} className="w-full h-full object-cover" />
                                                                    )}
                                                                </div>
                                                                <span className="absolute top-2 left-2 bg-gray-900/80 text-white px-2 py-1 rounded text-xs font-semibold flex items-center gap-1.5">
                                                                    <i className="ri-drag-drop-line"></i>
                                                                    {index === 0 ? 'Primary' : index + 1}
                                                                </span>
                                                                {isVideo && (
                                                                    <span className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-xs font-semibold flex items-center gap-1">
                                                                        <i className="ri-video-line"></i> Video
                                                                    </span>
                                                                )}
                                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 rounded-xl">
                                                                    <a href={img.url} target="_blank" rel="noreferrer" className="w-9 h-9 flex items-center justify-center bg-white text-gray-900 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                                                        <i className={isVideo ? 'ri-play-line' : 'ri-eye-line'}></i>
                                                                    </a>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); handleRemoveImage(index); }}
                                                                        className="w-9 h-9 flex items-center justify-center bg-white text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                                                                    >
                                                                        <i className="ri-delete-bin-line"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                );
                                            })}
                                            {provided.placeholder}

                                            {/* Add more slot — always visible if under limit */}
                                            {!uploading && images.length < 10 && (
                                    <label className="aspect-square border-2 border-dashed border-gray-300 rounded-xl hover:border-gray-900 hover:bg-gray-50 transition-colors flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-gray-900 cursor-pointer">
                                        <i className="ri-add-line text-3xl"></i>
                                        <span className="text-xs font-semibold text-center px-2 leading-tight">Add photos<br/>or video</span>
                                        {/* Using file extensions (not image/*) forces iOS to open Files app which supports multi-select on all iOS versions */}
                                        <input
                                            type="file"
                                            accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm"
                                            multiple
                                            className="hidden"
                                            onChange={handleMediaUpload}
                                        />
                                    </label>
                                )}
                                        </div>
                                    )}
                                </Droppable>
                            </DragDropContext>

                            {/* Action buttons row */}
                            <div className="flex flex-wrap gap-3 items-center">
                                {/* Take Photo — camera only, no multiple needed */}
                                <label className={`flex items-center gap-2 px-4 py-2.5 border-2 border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:border-gray-900 hover:bg-gray-50 transition-colors cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <i className="ri-camera-line text-lg"></i>
                                    Take Photo
                                    <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        className="hidden"
                                        onChange={handleMediaUpload}
                                        disabled={uploading}
                                    />
                                </label>

                                {/* Choose from gallery — file extensions trigger Files app on iOS for reliable multi-select */}
                                <label className={`flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <i className="ri-image-add-line text-lg"></i>
                                    Choose from Gallery
                                    <input
                                        type="file"
                                        accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm"
                                        multiple
                                        className="hidden"
                                        onChange={handleMediaUpload}
                                        disabled={uploading}
                                    />
                                </label>

                                <span className="text-sm text-gray-400 ml-auto">{images.length}/10</span>
                            </div>

                            {/* Per-file upload progress */}
                            {uploading && uploadProgress.length > 0 && (
                                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                                    <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                        <i className="ri-loader-4-line animate-spin"></i>
                                        Uploading {uploadProgress.filter(p => p.done).length} of {uploadProgress.length} files...
                                    </p>
                                    {uploadProgress.map((p, i) => (
                                        <div key={i} className="flex items-center gap-2 text-sm">
                                            {p.done
                                                ? <i className="ri-check-circle-fill text-green-600"></i>
                                                : <i className="ri-loader-4-line animate-spin text-gray-400"></i>
                                            }
                                            <span className={`truncate max-w-xs ${p.done ? 'text-gray-500' : 'text-gray-800 font-medium'}`}>{p.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-1">
                                <p className="text-sm font-semibold text-blue-900 flex items-center gap-1">
                                    <i className="ri-smartphone-line"></i> On iPhone / Android
                                </p>
                                <p className="text-sm text-blue-800">
                                    Tap <strong>Choose from Gallery</strong> → your Files app opens → tap <strong>Select</strong> (top-right) → tap all the photos you want → tap <strong>Open</strong>. All selected photos upload at once.
                                </p>
                                <p className="text-xs text-blue-700 mt-1">Images: JPG, PNG, WebP, HEIC (max 5MB each) · Videos: MP4, MOV, WebM (max 100MB each)</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'seo' && (
                        <div className="space-y-6 max-w-3xl">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">Search Engine Optimization</h3>
                                    <p className="text-gray-600 text-sm">Auto-generated from your product name and description. You can edit any field manually.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const { title, metaDesc, kw } = generateSeoFields(productName, description);
                                        setSeoTitle(title);
                                        setMetaDescription(metaDesc);
                                        setKeywords(kw);
                                        if (productName) setUrlSlug(productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''));
                                        setSeoTitleEdited(false);
                                        setMetaDescEdited(false);
                                        setKeywordsEdited(false);
                                    }}
                                    className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-2 border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:border-gray-900 hover:bg-gray-50 transition-colors"
                                >
                                    <i className="ri-refresh-line"></i>
                                    Regenerate
                                </button>
                            </div>

                            {/* Google preview */}
                            {(seoTitle || metaDescription) && (
                                <div className="p-4 bg-white border-2 border-gray-100 rounded-xl">
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Google Preview</p>
                                    <p className="text-blue-700 text-base font-medium leading-snug truncate">{seoTitle || productName}</p>
                                    <p className="text-green-700 text-xs mt-0.5">delizbeautytools.com/product/{urlSlug}</p>
                                    <p className="text-gray-600 text-sm mt-1 line-clamp-2">{metaDescription}</p>
                                </div>
                            )}

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-semibold text-gray-900">Page Title</label>
                                    <span className={`text-xs font-medium ${seoTitle.length > 60 ? 'text-red-500' : seoTitle.length > 50 ? 'text-amber-500' : 'text-gray-400'}`}>
                                        {seoTitle.length}/60
                                    </span>
                                </div>
                                <input
                                    type="text"
                                    value={seoTitle}
                                    onChange={(e) => { setSeoTitle(e.target.value); setSeoTitleEdited(true); }}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                    placeholder="e.g. Lash Bed | Deliz Beauty Tools"
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-semibold text-gray-900">Meta Description</label>
                                    <span className={`text-xs font-medium ${metaDescription.length > 160 ? 'text-red-500' : metaDescription.length > 140 ? 'text-amber-500' : 'text-gray-400'}`}>
                                        {metaDescription.length}/160
                                    </span>
                                </div>
                                <textarea
                                    rows={3}
                                    value={metaDescription}
                                    onChange={(e) => { setMetaDescription(e.target.value); setMetaDescEdited(true); }}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600 resize-none"
                                    placeholder="e.g. Shop premium lash beds at Deliz Beauty Tools. Fast delivery across Ghana."
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">
                                    URL Slug
                                </label>
                                <div className="flex items-center">
                                    <span className="text-gray-600 bg-gray-100 px-4 py-3 border-2 border-r-0 border-gray-300 rounded-l-lg whitespace-nowrap text-sm">
                                        /product/
                                    </span>
                                    <input
                                        type="text"
                                        value={urlSlug}
                                        onChange={(e) => setUrlSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)+/g, ''))}
                                        className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-r-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                        placeholder="product-slug"
                                    />
                                </div>
                                <p className="text-xs text-gray-400 mt-1">Only lowercase letters, numbers and hyphens. Auto-sanitised as you type.</p>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">
                                    Keywords
                                </label>
                                <input
                                    type="text"
                                    value={keywords}
                                    onChange={(e) => { setKeywords(e.target.value); setKeywordsEdited(true); }}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                    placeholder="e.g. lash bed, beauty tools, ghana"
                                />
                                <p className="text-xs text-gray-400 mt-1">Separate with commas. Auto-generated from product name.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
