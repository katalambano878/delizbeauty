'use client';

import { useState, useEffect } from 'react';
import DeliveryNav from '../DeliveryNav';

const GHANA_REGIONS = [
    'Greater Accra', 'Ashanti', 'Western', 'Central', 'Eastern', 'Volta',
    'Northern', 'Upper East', 'Upper West', 'Brong Ahafo', 'Oti',
    'Bono East', 'Ahafo', 'Savannah', 'North East', 'Western North',
];

interface Zone {
    id: string; name: string; description: string | null; regions: string[];
    base_fee: number; express_fee: number; estimated_days: string;
    is_active: boolean; created_at: string;
}

export default function ZonesPage() {
    const [zones, setZones] = useState<Zone[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingZone, setEditingZone] = useState<Zone | null>(null);
    const [form, setForm] = useState({
        name: '', description: '', regions: [] as string[],
        base_fee: '', express_fee: '', estimated_days: 'Same day delivery',
    });
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState('');

    useEffect(() => { fetchZones(); }, []);

    async function fetchZones() {
        try {
            const res = await fetch('/api/delivery/zones');
            const data = await res.json();
            setZones(data.zones || []);
        } catch (err) {
            console.error('Failed to fetch zones:', err);
        } finally {
            setLoading(false);
        }
    }

    function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000); }

    function openAddModal() {
        setEditingZone(null);
        setForm({ name: '', description: '', regions: [], base_fee: '', express_fee: '', estimated_days: 'Same day delivery' });
        setShowModal(true);
    }

    function openEditModal(zone: Zone) {
        setEditingZone(zone);
        setForm({
            name: zone.name, description: zone.description || '',
            regions: zone.regions || [], base_fee: String(zone.base_fee),
            estimated_days: 'Same day delivery',
        });
        setShowModal(true);
    }

    function toggleRegion(region: string) {
        setForm(f => ({
            ...f,
            regions: f.regions.includes(region) ? f.regions.filter(r => r !== region) : [...f.regions, region],
        }));
    }

    async function handleSave() {
        if (!form.name.trim()) { showToast('Error: Zone name is required'); return; }
        setSaving(true);
        try {
            const payload = {
                ...form,
                base_fee: parseFloat(form.base_fee) || 0,
                express_fee: parseFloat(form.express_fee) || 0,
            };

            if (editingZone) {
                const res = await fetch('/api/delivery/zones', {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: editingZone.id, ...payload }),
                });
                if (!res.ok) throw new Error((await res.json()).error);
                showToast('Zone updated');
            } else {
                const res = await fetch('/api/delivery/zones', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) throw new Error((await res.json()).error);
                showToast('Zone created');
            }
            setShowModal(false);
            fetchZones();
        } catch (err: any) {
            showToast(`Error: ${err.message}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(zone: Zone) {
        try {
            const res = await fetch('/api/delivery/zones', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: zone.id, is_active: !zone.is_active }),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            showToast(`Zone ${zone.is_active ? 'deactivated' : 'activated'}`);
            fetchZones();
        } catch (err: any) {
            showToast(`Error: ${err.message}`);
        }
    }

    async function handleDelete(zone: Zone) {
        if (!confirm(`Delete zone "${zone.name}"? This cannot be undone.`)) return;
        try {
            const res = await fetch(`/api/delivery/zones?id=${zone.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json()).error);
            showToast('Zone deleted');
            fetchZones();
        } catch (err: any) {
            showToast(`Error: ${err.message}`);
        }
    }

    return (
        <div className="space-y-6">
            {toast && (
                <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${
                    toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-gray-700 text-white'
                }`}>{toast}</div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Delivery Hub</h1>
                    <p className="text-gray-500 mt-1">Define delivery areas and pricing</p>
                </div>
                <button onClick={openAddModal}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors font-medium text-sm">
                    <i className="ri-add-line" /> Add Zone
                </button>
            </div>

            <DeliveryNav />

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <i className="ri-loader-4-line animate-spin text-3xl text-gray-700 mr-3" />
                    <span className="text-gray-500">Loading zones...</span>
                </div>
            ) : zones.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
                    <i className="ri-map-pin-range-line text-5xl text-gray-300 mb-4 block" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No delivery zones yet</h3>
                    <p className="text-gray-500 mb-4">Create delivery zones to define areas, fees, and estimated delivery times.</p>
                    <button onClick={openAddModal}
                        className="px-5 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-800 font-medium text-sm">
                        Create First Zone
                    </button>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {zones.map(zone => (
                        <div key={zone.id} className={`bg-white rounded-2xl border p-5 transition-shadow hover:shadow-md ${
                            zone.is_active ? 'border-gray-200' : 'border-gray-200 opacity-60'
                        }`}>
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <h3 className="font-bold text-gray-900 text-lg">{zone.name}</h3>
                                    {zone.description && <p className="text-sm text-gray-500 mt-0.5">{zone.description}</p>}
                                </div>
                                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                    zone.is_active ? 'bg-gray-100 text-gray-800' : 'bg-gray-100 text-gray-500'
                                }`}>{zone.is_active ? 'Active' : 'Inactive'}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="bg-gray-50 rounded-xl p-3">
                                    <p className="text-[10px] font-medium text-gray-500 uppercase">Standard Fee</p>
                                    <p className="text-lg font-bold text-gray-900">GH₵ {zone.base_fee?.toFixed(2)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3">
                                    <p className="text-[10px] font-medium text-gray-700 uppercase">Express Fee</p>
                                    <p className="text-lg font-bold text-gray-900">GH₵ {zone.express_fee?.toFixed(2)}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mb-3 text-sm text-gray-600">
                                <i className="ri-time-line text-gray-400" />
                                <span>Same day delivery</span>
                            </div>

                            {zone.regions && zone.regions.length > 0 && (
                                <div className="mb-4">
                                    <p className="text-xs font-semibold text-gray-500 mb-2">Regions</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {zone.regions.map(r => (
                                            <span key={r} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-md text-xs">{r}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-2 pt-3 border-t border-gray-100">
                                <button onClick={() => openEditModal(zone)}
                                    className="flex-1 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors">
                                    <i className="ri-edit-line mr-1" /> Edit
                                </button>
                                <button onClick={() => handleToggle(zone)}
                                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                                        zone.is_active ? 'text-amber-600 hover:bg-amber-50' : 'text-gray-700 hover:bg-gray-50'
                                    }`}>
                                    {zone.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                                <button onClick={() => handleDelete(zone)}
                                    className="py-2 px-3 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                    <i className="ri-delete-bin-line" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-gray-900">{editingZone ? 'Edit Zone' : 'Create Zone'}</h2>
                            <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg"><i className="ri-close-line text-xl" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-1.5">Zone Name *</label>
                                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                    placeholder="Greater Accra Metro" />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-1.5">Description</label>
                                <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-gray-600 focus:border-gray-600"
                                    placeholder="Covers central Accra and suburbs" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-1.5">Standard Fee (GH₵)</label>
                                    <input type="number" step="0.01" value={form.base_fee}
                                        onChange={e => setForm(f => ({ ...f, base_fee: e.target.value }))}
                                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-gray-600"
                                        placeholder="20.00" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-1.5">Express Fee (GH₵)</label>
                                    <input type="number" step="0.01" value={form.express_fee}
                                        onChange={e => setForm(f => ({ ...f, express_fee: e.target.value }))}
                                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-gray-600"
                                        placeholder="40.00" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-1.5">Estimated Delivery Time</label>
                                <select value={form.estimated_days} onChange={e => setForm(f => ({ ...f, estimated_days: e.target.value }))}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-gray-600">
                                    <option value="Same day delivery">Same day delivery</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">Covered Regions ({form.regions.length} selected)</label>
                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-3 border-2 border-gray-200 rounded-xl">
                                    {GHANA_REGIONS.map(region => (
                                        <label key={region}
                                            className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors text-sm ${
                                                form.regions.includes(region) ? 'bg-gray-50 text-gray-900' : 'hover:bg-gray-50 text-gray-700'
                                            }`}>
                                            <input type="checkbox" checked={form.regions.includes(region)}
                                                onChange={() => toggleRegion(region)}
                                                className="rounded border-gray-300 text-gray-700 focus:ring-gray-600" />
                                            {region}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-medium">Cancel</button>
                                <button onClick={handleSave} disabled={saving}
                                    className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 font-semibold disabled:opacity-50 transition-colors">
                                    {saving ? 'Saving...' : editingZone ? 'Update Zone' : 'Create Zone'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
