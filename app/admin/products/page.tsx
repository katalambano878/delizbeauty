'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Inline SVG placeholder. Kept local (no third-party request, no SW interception)
// so a thumbnail without an uploaded image always shows a clean "No image" tile,
// even on flaky mobile networks.
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">' +
      '<rect width="160" height="160" fill="#f3f4f6"/>' +
      '<g fill="none" stroke="#9ca3af" stroke-width="2">' +
        '<rect x="32" y="40" width="96" height="72" rx="6"/>' +
        '<path d="M40 96l24-22 18 16 14-12 24 22"/>' +
        '<circle cx="58" cy="62" r="5"/>' +
      '</g>' +
      '<text x="80" y="134" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="#9ca3af" text-anchor="middle">No image</text>' +
    '</svg>'
  );

export default function ProductsPage() {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'out_of_stock' | 'low_stock' | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<any[]>([]);

  // Statistics
  const [stats, setStats] = useState({
    total: 0,
    lowStock: 0,
    outOfStock: 0,
    active: 0
  });

  const statusColors: any = {
    'active': 'bg-gray-100 text-gray-900',
    'draft': 'bg-gray-100 text-gray-700',
    'archived': 'bg-amber-100 text-amber-700',
  };

  useEffect(() => {
    fetchProducts();
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when sortBy changes
  }, [sortBy]);

  const fetchCategories = async () => {
    const { data } = await supabase.from('categories').select('name');
    if (data) setCategories(data);
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const sortParam = sortBy ? `?sortBy=${encodeURIComponent(sortBy)}` : '';
      const res = await fetch(`/api/admin/products${sortParam}`, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load products');
      }
      const data = await res.json();

      if (data) {
        setProducts(Array.isArray(data) ? data : []);

        const list = Array.isArray(data) ? data : [];
        setStats({
          total: list.length,
          lowStock: list.filter((p: any) => p.quantity < (p.metadata?.low_stock_threshold || 5) && p.quantity > 0).length,
          outOfStock: list.filter((p: any) => p.quantity === 0).length,
          active: list.filter((p: any) => p.status === 'active').length
        });
      }
    } catch (error: any) {
      console.error('Error fetching products:', error);
      setLoadError(error?.message || 'Failed to load products. The catalog is still there — try again in a moment.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedProducts.length === products.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(products.map(p => p.id));
    }
  };

  const handleSelectProduct = (productId: string) => {
    if (selectedProducts.includes(productId)) {
      setSelectedProducts(selectedProducts.filter(id => id !== productId));
    } else {
      setSelectedProducts([...selectedProducts, productId]);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (confirm('Are you sure you want to delete this product?')) {
      const res = await fetch(`/api/admin/products/${productId}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setProducts(products.filter(p => p.id !== productId));
        alert('Product deleted successfully');
      } else {
        alert(data.error || 'Error deleting product');
      }
    }
  };

  const handleBulkDelete = async () => {
    if (confirm(`Are you sure you want to delete ${selectedProducts.length} products?`)) {
      let failed = 0;
      for (const id of selectedProducts) {
        const res = await fetch(`/api/admin/products/${id}`, { method: 'DELETE', credentials: 'include' });
        if (!res.ok) failed++;
      }
      if (failed === 0) {
        setProducts(products.filter(p => !selectedProducts.includes(p.id)));
        setSelectedProducts([]);
        alert('Products deleted successfully');
      } else {
        alert(`Deleted ${selectedProducts.length - failed} product(s). ${failed} could not be deleted (e.g. they have orders).`);
        fetchProducts();
        setSelectedProducts([]);
      }
    }
  };

  const filteredProducts = products.filter(product => {
    const term = searchQuery.toLowerCase();
    const matchesSearch = product.name.toLowerCase().includes(term) ||
      (product.sku && product.sku.toLowerCase().includes(term)) ||
      (product.category && product.category.toLowerCase().includes(term));
    if (!matchesSearch) return false;
    if (stockFilter === 'out_of_stock') return (product.quantity ?? 0) === 0;
    if (stockFilter === 'low_stock') {
      const threshold = product.metadata?.low_stock_threshold ?? 5;
      const qty = product.quantity ?? 0;
      return qty > 0 && qty < threshold;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-600 mt-1">Manage your product catalog and inventory</p>
        </div>
        <div className="flex flex-col md:flex-row items-center gap-3">
          <button
            onClick={() => window.open('/admin/products/print', '_blank')}
            className="w-full md:w-auto px-6 py-3 bg-white border-2 border-gray-900 text-gray-900 hover:bg-gray-50 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center"
          >
            <i className="ri-printer-line mr-2 text-lg"></i>
            Print Inventory
          </button>
          <Link
            href="/admin/products/new"
            className="w-full md:w-auto px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center"
          >
            <i className="ri-add-line mr-2 text-lg"></i>
            Add Product
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setStockFilter(null)}
          className={`text-left rounded-xl border-2 p-4 transition-colors ${stockFilter === null ? 'bg-gray-50 border-gray-900' : 'bg-white border-gray-200 hover:border-gray-300'}`}
        >
          <p className="text-sm text-gray-600 mb-1">Total Products</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </button>
        <button
          type="button"
          onClick={() => setStockFilter(null)}
          className={`text-left rounded-xl border-2 p-4 transition-colors ${stockFilter === null ? 'bg-gray-50 border-gray-900' : 'bg-white border-gray-200 hover:border-gray-300'}`}
        >
          <p className="text-sm text-gray-600 mb-1">Active</p>
          <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
        </button>
        <button
          type="button"
          onClick={() => setStockFilter(prev => prev === 'low_stock' ? null : 'low_stock')}
          className={`text-left rounded-xl border-2 p-4 transition-colors cursor-pointer ${stockFilter === 'low_stock' ? 'bg-amber-50 border-amber-600' : 'bg-white border-gray-200 hover:border-amber-300'}`}
        >
          <p className="text-sm text-gray-600 mb-1">Low Stock</p>
          <p className="text-2xl font-bold text-amber-700">{stats.lowStock}</p>
          {stockFilter === 'low_stock' && <p className="text-xs text-amber-700 mt-1">Showing low stock only</p>}
        </button>
        <button
          type="button"
          onClick={() => setStockFilter(prev => prev === 'out_of_stock' ? null : 'out_of_stock')}
          className={`text-left rounded-xl border-2 p-4 transition-colors cursor-pointer ${stockFilter === 'out_of_stock' ? 'bg-red-50 border-red-600' : 'bg-white border-gray-200 hover:border-red-300'}`}
        >
          <p className="text-sm text-gray-600 mb-1">Out of Stock</p>
          <p className="text-2xl font-bold text-red-700">{stats.outOfStock}</p>
          {stockFilter === 'out_of_stock' && <p className="text-xs text-red-700 mt-1">Showing out of stock only</p>}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg w-5 h-5 flex items-center justify-center"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search products by name, SKU, or category..."
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-medium whitespace-nowrap cursor-pointer"
              >
                <i className="ri-filter-line mr-2"></i>
                Filters
              </button>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-gray-600 font-medium cursor-pointer"
              >
                <option value="newest">Newest First</option>
                <option value="name">Sort by Name</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="stock">Sort by Stock</option>
              </select>
              <div className="flex border-2 border-gray-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  className={`w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <i className="ri-list-check text-xl w-5 h-5 flex items-center justify-center"></i>
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`w-10 h-10 flex items-center justify-center border-l-2 border-gray-300 transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <i className="ri-grid-line text-xl w-5 h-5 flex items-center justify-center"></i>
                </button>
              </div>
            </div>
          </div>

          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg grid md:grid-cols-4 gap-4">
              <select className="px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer">
                <option value="">All Categories</option>
                {categories.map((cat: any) => <option key={cat.name} value={cat.name}>{cat.name}</option>)}
              </select>
              <select className="px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer">
                <option>All Status</option>
                <option>Active</option>
                <option>Draft</option>
                <option>Archived</option>
              </select>
            </div>
          )}
        </div>

        {selectedProducts.length > 0 && (
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <p className="text-gray-800 font-semibold">
              {selectedProducts.length} product{selectedProducts.length > 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-loader-4-line animate-spin text-3xl mb-2 inline-block"></i>
            <p>Loading products...</p>
          </div>
        ) : loadError ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-error-warning-line text-4xl mb-4 text-amber-500 inline-block"></i>
            <p className="text-lg text-gray-900">Could not load products</p>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{loadError}</p>
            <button
              type="button"
              onClick={fetchProducts}
              className="mt-4 px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium"
            >
              Try again
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-inbox-line text-4xl mb-4 text-gray-300 inline-block"></i>
            <p className="text-lg">No products found</p>
            <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="py-4 px-6">
                    <input
                      type="checkbox"
                      checked={selectedProducts.length === products.length && products.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-gray-900 border-gray-300 rounded focus:ring-gray-600 cursor-pointer"
                    />
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Product</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">SKU</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Category</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Price</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Stock</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        checked={selectedProducts.includes(product.id)}
                        onChange={() => handleSelectProduct(product.id)}
                        className="w-4 h-4 text-gray-900 border-gray-300 rounded focus:ring-gray-600 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                          <img
                            src={product.image || PLACEHOLDER_IMAGE}
                            alt={product.name}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const img = e.target as HTMLImageElement;
                              if (img.src !== PLACEHOLDER_IMAGE) img.src = PLACEHOLDER_IMAGE;
                            }}
                          />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{product.name}</p>
                          <div className="flex items-center mt-1">
                            <span className="text-xs text-gray-400">ID: {product.id.substring(0, 8)}...</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-gray-700 text-sm font-mono">{product.sku || '-'}</td>
                    <td className="py-4 px-4 text-gray-700 text-sm">{product.category}</td>
                    <td className="py-4 px-4 font-semibold text-gray-900 whitespace-nowrap">GH₵ {product.price.toFixed(2)}</td>
                    <td className="py-4 px-4 text-gray-700">
                      {product.stock}
                      {product.stock <= (product.metadata?.low_stock_threshold || 5) && product.stock > 0 && (
                        <span className="ml-2 w-2 h-2 rounded-full bg-amber-500 inline-block" title="Low Stock"></span>
                      )}
                      {product.stock === 0 && (
                        <span className="ml-2 w-2 h-2 rounded-full bg-red-500 inline-block" title="Out of Stock"></span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap capitalize ${statusColors[product.status] || 'bg-gray-100 text-gray-600'}`}>
                        {product.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-edit-line text-lg"></i>
                        </Link>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-delete-bin-line text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <div key={product.id} className="border-2 border-gray-200 rounded-xl p-4 hover:shadow-lg transition-shadow">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={selectedProducts.includes(product.id)}
                    onChange={() => handleSelectProduct(product.id)}
                    className="absolute top-2 left-2 w-5 h-5 text-gray-900 border-gray-300 rounded focus:ring-gray-600 cursor-pointer z-10"
                  />
                  <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden mb-3 border border-gray-200">
                    <img
                      src={product.image || PLACEHOLDER_IMAGE}
                      alt={product.name}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        if (img.src !== PLACEHOLDER_IMAGE) img.src = PLACEHOLDER_IMAGE;
                      }}
                    />
                  </div>
                </div>
                <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold mb-2 capitalize ${statusColors[product.status] || 'bg-gray-100 text-gray-600'}`}>
                  {product.status}
                </span>
                <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2">{product.name}</h3>
                <p className="text-sm text-gray-600 mb-2">{product.category}</p>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-lg font-bold text-gray-900">GH₵ {product.price}</p>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-600 mb-3 pb-3 border-b border-gray-200">
                  <span>Stock: {product.stock}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Link
                    href={`/admin/products/${product.id}`}
                    className="flex-1 bg-gray-900 hover:bg-gray-800 text-white py-2 rounded-lg text-sm font-medium text-center transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDeleteProduct(product.id)}
                    className="w-9 h-9 flex items-center justify-center border-2 border-gray-300 text-gray-700 hover:border-red-600 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                  >
                    <i className="ri-delete-bin-line"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="p-6 border-t border-gray-200 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {filteredProducts.length === 0 ? 'No products' : `Showing ${filteredProducts.length} product${filteredProducts.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>
    </div>
  );
}
