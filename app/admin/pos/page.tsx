'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Product {
    id: string;
    name: string;
    price: number;
    quantity: number;
    category: string;
    image: string;
    sku: string;
    barcode?: string;
}

interface CartItem extends Product {
    cartQuantity: number;
    discount: number;
    variant?: string;
}

interface Customer {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
}

interface HeldOrder {
    id: string;
    cart: CartItem[];
    customer: Customer | null;
    note: string;
    heldAt: number;
}

interface DailySummary {
    totalSales: number;
    orderCount: number;
    cashSales: number;
    cardSales: number;
    momoSales: number;
}

// ─── Sound Effects ──────────────────────────────────────────────────────────

function playSound(type: 'scan' | 'add' | 'error' | 'success' | 'hold') {
    if (typeof window === 'undefined') return;
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.08;

        const configs: Record<string, { freq: number; dur: number; type: OscillatorType }> = {
            scan: { freq: 1200, dur: 0.08, type: 'square' },
            add: { freq: 800, dur: 0.06, type: 'sine' },
            error: { freq: 300, dur: 0.2, type: 'sawtooth' },
            success: { freq: 1000, dur: 0.15, type: 'sine' },
            hold: { freq: 600, dur: 0.1, type: 'triangle' },
        };

        const c = configs[type] || configs.add;
        osc.frequency.value = c.freq;
        osc.type = c.type;
        osc.start();
        osc.stop(ctx.currentTime + c.dur);
    } catch {}
}

// ─── Thermal Receipt Printer ────────────────────────────────────────────────

function printReceipt(order: {
    orderNumber: string;
    items: CartItem[];
    subtotal: number;
    discount: number;
    total: number;
    paymentMethod: string;
    amountTendered?: number;
    change?: number;
    customerName?: string;
    cashier?: string;
    paymentPending?: boolean;
}) {
    const now = new Date();
    const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const paymentLabel: Record<string, string> = { cash: 'Cash', card: 'Card', momo: 'Mobile Money' };

    const itemRows = order.items.map(item => {
        const lineTotal = item.price * item.cartQuantity;
        const discountAmt = item.discount > 0 ? ` (-${item.discount}%)` : '';
        return `
            <tr>
                <td style="text-align:left;padding:2px 0;">${item.name}${discountAmt}</td>
                <td style="text-align:center;padding:2px 4px;">${item.cartQuantity}</td>
                <td style="text-align:right;padding:2px 0;">${lineTotal.toFixed(2)}</td>
            </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html><head><title>Receipt</title>
<style>
    @page { margin: 0; size: 80mm auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; padding: 4mm; color: #000; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .store-name { font-size: 16px; font-weight: bold; letter-spacing: 1px; }
    table { width: 100%; border-collapse: collapse; }
    .total-row td { font-size: 14px; font-weight: bold; padding-top: 4px; }
    .footer { font-size: 10px; color: #555; margin-top: 8px; }
</style></head><body>
    <div class="center">
        <div class="store-name">DELIZ BEAUTY TOOLS</div>
        <div style="font-size:10px;margin-top:2px;">Premium Quality Products</div>
        <div style="font-size:10px;">Tel: 027 854 9831</div>
    </div>
    <div class="divider"></div>
    <div style="display:flex;justify-content:space-between;font-size:10px;">
        <span>${date} ${time}</span>
        <span>#${order.orderNumber.replace('ORD-', '')}</span>
    </div>
    ${order.cashier ? `<div style="font-size:10px;">Cashier: ${order.cashier}</div>` : ''}
    ${order.customerName ? `<div style="font-size:10px;">Customer: ${order.customerName}</div>` : ''}
    <div class="divider"></div>
    <table>
        <thead>
            <tr style="font-size:10px;border-bottom:1px solid #000;">
                <th style="text-align:left;padding:2px 0;">Item</th>
                <th style="text-align:center;padding:2px 4px;">Qty</th>
                <th style="text-align:right;padding:2px 0;">Amount</th>
            </tr>
        </thead>
        <tbody>${itemRows}</tbody>
    </table>
    <div class="divider"></div>
    <table>
        <tr><td>Subtotal</td><td style="text-align:right;">GH₵${order.subtotal.toFixed(2)}</td></tr>
        ${order.discount > 0 ? `<tr><td>Discount</td><td style="text-align:right;">-GH₵${order.discount.toFixed(2)}</td></tr>` : ''}
        <tr class="total-row"><td>TOTAL</td><td style="text-align:right;">GH₵${order.total.toFixed(2)}</td></tr>
    </table>
    <div class="divider"></div>
    <div>Payment: ${paymentLabel[order.paymentMethod] || order.paymentMethod}</div>
    ${order.paymentMethod === 'cash' && order.amountTendered ? `
        <div>Tendered: GH₵${order.amountTendered.toFixed(2)}</div>
        <div class="bold">Change: GH₵${(order.change || 0).toFixed(2)}</div>
    ` : ''}
    ${order.paymentPending ? '<div class="bold" style="margin-top:4px;">*** PAYMENT PENDING ***</div>' : ''}
    <div class="divider"></div>
    <div class="center footer">
        <div>Thank you for shopping with us!</div>
        <div>www.delizbeautytools.com</div>
    </div>
    <div style="margin-top:12px;"></div>
</body></html>`;

    const win = window.open('', '_blank', 'width=320,height=600');
    if (win) {
        win.document.write(html);
        win.document.close();
        setTimeout(() => {
            win.print();
            setTimeout(() => win.close(), 1000);
        }, 300);
    }
}

// ─── Held Orders Storage ────────────────────────────────────────────────────

const HELD_ORDERS_KEY = 'pos-held-orders';
const LAST_RECEIPT_KEY = 'pos-last-receipt';

function loadHeldOrders(): HeldOrder[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(HELD_ORDERS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch { return []; }
}

function saveHeldOrders(orders: HeldOrder[]) {
    try { localStorage.setItem(HELD_ORDERS_KEY, JSON.stringify(orders)); } catch {}
}

// ─── POS Component ──────────────────────────────────────────────────────────

export default function POSPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [activeCategory, setActiveCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

    // Checkout State
    const [showCheckoutModal, setShowCheckoutModal] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerSearch, setCustomerSearch] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [amountTendered, setAmountTendered] = useState<string>('');
    const [processing, setProcessing] = useState(false);
    const [completedOrder, setCompletedOrder] = useState<any>(null);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'doorstep'>('pickup');
    const [guestDetails, setGuestDetails] = useState({
        firstName: '', lastName: '', email: '', phone: '',
        address: '', city: '', region: ''
    });

    // New production features
    const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
    const [showHeldOrders, setShowHeldOrders] = useState(false);
    const [holdNote, setHoldNote] = useState('');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [orderDiscount, setOrderDiscount] = useState(0);
    const [showDiscountInput, setShowDiscountInput] = useState(false);
    const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
    const [showDailySummary, setShowDailySummary] = useState(false);
    const [lastReceipt, setLastReceipt] = useState<any>(null);
    const [cashierName, setCashierName] = useState('');
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [scanFeedback, setScanFeedback] = useState('');

    const searchInputRef = useRef<HTMLInputElement>(null);
    const barcodeBuffer = useRef('');
    const barcodeTimeout = useRef<NodeJS.Timeout | null>(null);

    const ghanaRegions = [
        'Greater Accra', 'Ashanti', 'Western', 'Central', 'Eastern',
        'Northern', 'Volta', 'Upper East', 'Upper West', 'Brong-Ahafo',
        'Ahafo', 'Bono', 'Bono East', 'North East', 'Savannah', 'Oti', 'Western North'
    ];

    // ─── Init ───────────────────────────────────────────────────────────────

    useEffect(() => {
        fetchData();
        setHeldOrders(loadHeldOrders());
        try {
            const lr = localStorage.getItem(LAST_RECEIPT_KEY);
            if (lr) setLastReceipt(JSON.parse(lr));
        } catch {}

        // Load cashier name
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                supabase.from('profiles').select('full_name').eq('id', session.user.id).single()
                    .then(({ data }) => { if (data?.full_name) setCashierName(data.full_name); });
            }
        });

        fetchDailySummary();
    }, []);

    // ─── Keyboard Shortcuts ─────────────────────────────────────────────────

    useEffect(() => {
        function handleShortcut(e: KeyboardEvent) {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

            if (e.key === 'Escape') {
                if (showCheckoutModal) { setShowCheckoutModal(false); e.preventDefault(); }
                else if (showHeldOrders) { setShowHeldOrders(false); e.preventDefault(); }
                else if (showDailySummary) { setShowDailySummary(false); e.preventDefault(); }
                return;
            }

            if (isInput) return;

            switch (e.key) {
                case 'F1':
                    e.preventDefault();
                    if (cart.length > 0) { setPaymentMethod('cash'); setShowCheckoutModal(true); }
                    break;
                case 'F2':
                    e.preventDefault();
                    if (cart.length > 0) { setPaymentMethod('card'); setShowCheckoutModal(true); }
                    break;
                case 'F3':
                    e.preventDefault();
                    if (cart.length > 0) { setPaymentMethod('momo'); setShowCheckoutModal(true); }
                    break;
                case 'F4':
                    e.preventDefault();
                    if (cart.length > 0) holdCurrentOrder();
                    break;
                case 'F5':
                    e.preventDefault();
                    setShowHeldOrders(true);
                    break;
                case 'F8':
                    e.preventDefault();
                    emptyCart();
                    break;
                case 'F9':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'F11':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'F12':
                    e.preventDefault();
                    if (cart.length > 0) { setShowCheckoutModal(true); setCheckoutError(null); }
                    break;
            }
        }

        window.addEventListener('keydown', handleShortcut);
        return () => window.removeEventListener('keydown', handleShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- holdCurrentOrder, toggleFullscreen, emptyCart defined later; effect runs after mount
    }, [cart, showCheckoutModal, showHeldOrders, showDailySummary]);

    // ─── Fullscreen ─────────────────────────────────────────────────────────

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
            setIsFullscreen(true);
        } else {
            document.exitFullscreen().catch(() => {});
            setIsFullscreen(false);
        }
    }, []);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    // ─── Data Fetching ──────────────────────────────────────────────────────

    const fetchData = async () => {
        try {
            setLoading(true);
            const { data: prodData } = await supabase
                .from('products')
                .select(`id, name, price, quantity, sku, metadata, categories(name), product_images(url)`)
                .eq('status', 'active')
                .order('name');

            if (prodData) {
                const formatted: Product[] = prodData.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    price: p.price,
                    quantity: p.quantity,
                    category: p.categories?.name || 'Uncategorized',
                    image: p.product_images?.[0]?.url || '',
                    sku: p.sku || '',
                    barcode: p.metadata?.barcode || p.sku || '',
                }));
                setProducts(formatted);
                const cats = Array.from(new Set(formatted.map(p => p.category))).sort();
                setCategories(['All', ...cats]);
            }

            const { data: custData } = await supabase
                .from('customers')
                .select('id, full_name, email, phone')
                .order('full_name')
                .limit(200);
            if (custData) setCustomers(custData);
        } catch (error) {
            console.error('Error fetching POS data:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchDailySummary = async () => {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const { data } = await supabase
                .from('orders')
                .select('total, payment_method, payment_status')
                .gte('created_at', todayStart.toISOString())
                .eq('metadata->>pos_sale', 'true');

            if (data) {
                const paid = data.filter(o => o.payment_status === 'paid');
                setDailySummary({
                    totalSales: paid.reduce((s, o) => s + Number(o.total), 0),
                    orderCount: paid.length,
                    cashSales: paid.filter(o => o.payment_method === 'cash').reduce((s, o) => s + Number(o.total), 0),
                    cardSales: paid.filter(o => o.payment_method === 'card').reduce((s, o) => s + Number(o.total), 0),
                    momoSales: paid.filter(o => o.payment_method === 'moolre').reduce((s, o) => s + Number(o.total), 0),
                });
            }
        } catch {}
    };

    // ─── Cart Functions ─────────────────────────────────────────────────────

    const addToCart = useCallback((product: Product) => {
        if (product.quantity <= 0) {
            playSound('error');
            return;
        }
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                if (existing.cartQuantity >= product.quantity) {
                    playSound('error');
                    return prev;
                }
                playSound('add');
                return prev.map(item =>
                    item.id === product.id ? { ...item, cartQuantity: item.cartQuantity + 1 } : item
                );
            }
            playSound('add');
            return [...prev, { ...product, cartQuantity: 1, discount: 0 }];
        });
    }, []);

    // ─── Barcode Scanner Detection ──────────────────────────────────────────

    const handleBarcodeScan = useCallback((code: string) => {
        const product = products.find(p =>
            p.barcode === code || p.sku === code || p.sku?.toLowerCase() === code.toLowerCase()
        );
        if (product) {
            addToCart(product);
            playSound('scan');
            setScanFeedback(`✓ ${product.name}`);
            setTimeout(() => setScanFeedback(''), 2000);
        } else {
            playSound('error');
            setScanFeedback(`✗ Not found: ${code}`);
            setTimeout(() => setScanFeedback(''), 3000);
        }
    }, [products, addToCart]);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
            const isSearchInput = target === searchInputRef.current;

            if (e.key === 'Enter' && barcodeBuffer.current.length >= 3) {
                e.preventDefault();
                const scannedCode = barcodeBuffer.current.trim();
                barcodeBuffer.current = '';
                if (barcodeTimeout.current) clearTimeout(barcodeTimeout.current);
                handleBarcodeScan(scannedCode);
                return;
            }

            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                if (isInput && !isSearchInput) return;
                barcodeBuffer.current += e.key;
                if (barcodeTimeout.current) clearTimeout(barcodeTimeout.current);
                barcodeTimeout.current = setTimeout(() => { barcodeBuffer.current = ''; }, 80);
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [products, handleBarcodeScan]);

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.id !== productId));
    };

    const updateQuantity = (productId: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.id === productId) {
                const newQty = item.cartQuantity + delta;
                if (newQty < 1) return item;
                if (newQty > item.quantity) { playSound('error'); return item; }
                return { ...item, cartQuantity: newQty };
            }
            return item;
        }));
    };

    const setItemDiscount = (productId: string, discount: number) => {
        const d = Math.max(0, Math.min(100, discount));
        setCart(prev => prev.map(item =>
            item.id === productId ? { ...item, discount: d } : item
        ));
    };

    const emptyCart = useCallback(() => { setCart([]); setOrderDiscount(0); }, []);

    // ─── Hold & Recall ──────────────────────────────────────────────────────

    const holdCurrentOrder = useCallback(() => {
        if (cart.length === 0) return;
        const held: HeldOrder = {
            id: `hold-${Date.now()}`,
            cart: [...cart],
            customer: selectedCustomer,
            note: holdNote || `${cart.length} items - GH₵${grandTotal.toFixed(2)}`,
            heldAt: Date.now(),
        };
        const updated = [...heldOrders, held];
        setHeldOrders(updated);
        saveHeldOrders(updated);
        emptyCart();
        setSelectedCustomer(null);
        setHoldNote('');
        playSound('hold');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- grandTotal is defined later (computed); callback uses current value at invoke time
    }, [cart, selectedCustomer, holdNote, heldOrders, emptyCart]);

    const recallOrder = (holdId: string) => {
        const order = heldOrders.find(h => h.id === holdId);
        if (!order) return;

        if (cart.length > 0) {
            holdCurrentOrder();
        }
        setCart(order.cart);
        setSelectedCustomer(order.customer);
        const updated = heldOrders.filter(h => h.id !== holdId);
        setHeldOrders(updated);
        saveHeldOrders(updated);
        setShowHeldOrders(false);
        playSound('add');
    };

    const deleteHeldOrder = (holdId: string) => {
        const updated = heldOrders.filter(h => h.id !== holdId);
        setHeldOrders(updated);
        saveHeldOrders(updated);
    };

    // ─── Computed ───────────────────────────────────────────────────────────

    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            const q = searchQuery.toLowerCase();
            const matchesSearch = p.name.toLowerCase().includes(q) ||
                p.sku?.toLowerCase().includes(q) ||
                p.barcode?.toLowerCase().includes(q);
            const matchesCat = activeCategory === 'All' || p.category === activeCategory;
            return matchesSearch && matchesCat;
        });
    }, [products, searchQuery, activeCategory]);

    const filteredCustomers = useMemo(() => {
        if (!customerSearch.trim()) return customers;
        const q = customerSearch.toLowerCase();
        return customers.filter(c =>
            c.full_name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.phone?.includes(q)
        );
    }, [customers, customerSearch]);

    const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);
    const itemDiscounts = cart.reduce((sum, item) => {
        if (item.discount > 0) return sum + (item.price * item.cartQuantity * item.discount / 100);
        return sum;
    }, 0);
    const orderDiscountAmount = (cartSubtotal - itemDiscounts) * orderDiscount / 100;
    const totalDiscount = itemDiscounts + orderDiscountAmount;
    const grandTotal = cartSubtotal - totalDiscount;
    const changeDue = amountTendered ? (parseFloat(amountTendered) - grandTotal) : 0;

    // ─── Order Helpers ──────────────────────────────────────────────────────

    const getOrderEmail = () => {
        if (selectedCustomer) return selectedCustomer.email;
        return guestDetails.email || 'pos-walkin@store.local';
    };

    const getOrderPhone = () => {
        if (selectedCustomer) return selectedCustomer.phone || '';
        return guestDetails.phone || '';
    };

    const getCustomerFullName = () => {
        if (selectedCustomer) return selectedCustomer.full_name || '';
        return `${guestDetails.firstName} ${guestDetails.lastName}`.trim();
    };

    const validateCheckout = (): string | null => {
        if (cart.length === 0) return 'Cart is empty';
        if (paymentMethod === 'momo' && !getOrderPhone()) return 'Phone number is required for Mobile Money payment';
        if (paymentMethod === 'cash') {
            const tendered = parseFloat(amountTendered || '0');
            if (tendered < grandTotal) return 'Insufficient amount tendered';
        }
        // Customer info is optional for POS walk-in sales
        if (deliveryMethod === 'doorstep') {
            if (!guestDetails.address.trim()) return 'Delivery address is required';
            if (!guestDetails.city.trim()) return 'City is required for delivery';
            if (!guestDetails.region) return 'Region is required for delivery';
        }
        return null;
    };

    // ─── Checkout ───────────────────────────────────────────────────────────

    const handleCheckout = async () => {
        const validationError = validateCheckout();
        if (validationError) { setCheckoutError(validationError); return; }

        setProcessing(true);
        setCheckoutError(null);

        try {
            const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const customerName = getCustomerFullName();
            const customerEmail = getOrderEmail();
            const customerPhone = getOrderPhone();
            const isCashOrCard = paymentMethod === 'cash' || paymentMethod === 'card';

            const addressData = selectedCustomer ? {
                firstName: selectedCustomer.full_name?.split(' ')[0] || '',
                lastName: selectedCustomer.full_name?.split(' ').slice(1).join(' ') || '',
                email: selectedCustomer.email,
                phone: selectedCustomer.phone || '',
                address: guestDetails.address, city: guestDetails.city,
                region: guestDetails.region, pos_sale: true
            } : {
                firstName: guestDetails.firstName, lastName: guestDetails.lastName,
                email: guestDetails.email, phone: guestDetails.phone,
                address: guestDetails.address, city: guestDetails.city,
                region: guestDetails.region, pos_sale: true
            };

            const orderItemsPayload = cart.map(item => ({
                product_id: item.id,
                product_name: item.name,
                variant_name: item.variant || null,
                quantity: item.cartQuantity,
                unit_price: item.price,
                total_price: item.price * item.cartQuantity * (1 - (item.discount || 0) / 100),
                metadata: { image: item.image, pos_sale: true, discount_pct: item.discount || 0 }
            }));

            const res = await fetch('/api/admin/pos/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    order_number: orderNumber,
                    email: customerEmail,
                    phone: customerPhone,
                    status: isCashOrCard ? (deliveryMethod === 'doorstep' ? 'processing' : 'delivered') : 'pending',
                    payment_status: isCashOrCard ? 'paid' : 'pending',
                    subtotal: cartSubtotal,
                    discount_total: totalDiscount,
                    total: grandTotal,
                    shipping_method: deliveryMethod,
                    payment_method: paymentMethod === 'momo' ? 'moolre' : paymentMethod,
                    shipping_address: addressData,
                    billing_address: addressData,
                    metadata: {
                        pos_sale: true,
                        first_name: addressData.firstName,
                        last_name: addressData.lastName,
                        phone: customerPhone,
                        cashier: cashierName || undefined,
                    },
                    items: orderItemsPayload,
                    mark_paid: isCashOrCard,
                }),
            });

            const apiData = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(apiData.error || 'Failed to create order');
            const order = apiData.order;
            if (!order) throw new Error('No order returned');

            // Upsert Customer
            const hasRealEmail = customerEmail && customerEmail !== 'pos-walkin@store.local';
            const upsertEmail = hasRealEmail ? customerEmail
                : customerPhone ? `${customerPhone.replace(/[^0-9]/g, '')}@pos.local` : null;

            if (upsertEmail) {
                try {
                    await supabase.rpc('upsert_customer_from_order', {
                        p_email: upsertEmail, p_phone: customerPhone || null,
                        p_full_name: customerName || null,
                        p_first_name: addressData.firstName || null,
                        p_last_name: addressData.lastName || null,
                        p_user_id: null, p_address: addressData
                    });
                    supabase.from('customers').select('id, full_name, email, phone').order('full_name').limit(200)
                        .then(({ data }) => { if (data) setCustomers(data); });
                } catch (custErr) {
                    console.error('Customer upsert error:', custErr);
                }
            }

            const notifyCustomer = (type: 'order_created' | 'payment_link', savedOrder: any) => {
                const realEmail = hasRealEmail && /\S+@\S+\.\S+/.test(customerEmail) ? customerEmail : '';
                if (!customerPhone && !realEmail) return;
                supabase.auth.getSession().then(({ data: { session } }) => {
                    fetch('/api/notifications', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
                        },
                        body: JSON.stringify({
                            type,
                            payload: {
                                ...savedOrder,
                                order_number: orderNumber,
                                email: realEmail,
                                phone: customerPhone,
                                total: grandTotal,
                                shipping_address: addressData,
                            },
                        }),
                    }).catch(() => {});
                }).catch(() => {});
            };

            if (isCashOrCard) {
                const receiptData = {
                    orderNumber, items: cart, subtotal: cartSubtotal,
                    discount: totalDiscount, total: grandTotal,
                    paymentMethod, amountTendered: parseFloat(amountTendered || '0'),
                    change: changeDue > 0 ? changeDue : 0,
                    customerName: customerName || 'Walk-in', cashier: cashierName,
                };

                setCompletedOrder({ id: order.id, orderNumber, total: grandTotal, items: cart, receiptData });
                setLastReceipt(receiptData);
                try { localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(receiptData)); } catch {}
                setCart([]);
                setOrderDiscount(0);
                playSound('success');
                fetchDailySummary();

                notifyCustomer('order_created', order);
            }

            if (paymentMethod === 'momo') {
                const paymentRes = await fetch('/api/payment/moolre', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: orderNumber, amount: grandTotal, customerEmail })
                });
                const paymentResult = await paymentRes.json();
                if (!paymentResult.success) throw new Error(paymentResult.message || 'Failed to initiate Mobile Money payment');

                const receiptData = {
                    orderNumber, items: cart, subtotal: cartSubtotal,
                    discount: totalDiscount, total: grandTotal,
                    paymentMethod, customerName: customerName || 'Walk-in',
                    cashier: cashierName, paymentPending: true,
                };

                setCompletedOrder({
                    id: order.id, orderNumber, total: grandTotal, items: cart,
                    paymentUrl: paymentResult.url, paymentPending: true, receiptData,
                });
                setLastReceipt(receiptData);
                try { localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(receiptData)); } catch {}
                setCart([]);
                setOrderDiscount(0);
                playSound('success');
                fetchDailySummary();
                notifyCustomer('payment_link', order);
            }
        } catch (error: any) {
            console.error('Checkout failed:', error);
            setCheckoutError(error.message || 'Checkout failed. Please try again.');
            playSound('error');
        } finally {
            setProcessing(false);
        }
    };

    const resetCheckout = () => {
        setShowCheckoutModal(false);
        setCompletedOrder(null);
        setAmountTendered('');
        setSelectedCustomer(null);
        setCustomerSearch('');
        setCheckoutError(null);
        setPaymentMethod('cash');
        setDeliveryMethod('pickup');
        setGuestDetails({ firstName: '', lastName: '', email: '', phone: '', address: '', city: '', region: '' });
    };

    // ─── Render ─────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col lg:flex-row h-screen overflow-hidden bg-gray-100 relative">

            {/* Barcode Scan Feedback */}
            {scanFeedback && (
                <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl font-bold text-sm animate-in fade-in slide-in-from-top-2 ${
                    scanFeedback.startsWith('✓') ? 'bg-gray-700 text-white' : 'bg-red-600 text-white'
                }`}>
                    <i className={`mr-2 ${scanFeedback.startsWith('✓') ? 'ri-barcode-line' : 'ri-error-warning-line'}`} />
                    {scanFeedback}
                </div>
            )}

            {/* LEFT: Product Grid */}
            <div className={`flex-1 flex flex-col h-full min-w-0 ${isMobileCartOpen ? 'hidden lg:flex' : 'flex'}`}>
                {/* Header */}
                <div className="bg-white p-3 border-b border-gray-200 shrink-0">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin"
                            className="p-2.5 text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
                            title="Back to Admin"
                        >
                            <i className="ri-arrow-left-line text-lg" />
                        </Link>

                        {/* Search */}
                        <div className="relative flex-1 max-w-md">
                            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search or scan barcode..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 text-sm"
                                autoFocus
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                    <i className="ri-close-line" />
                                </button>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5">
                            {heldOrders.length > 0 && (
                                <button
                                    onClick={() => setShowHeldOrders(true)}
                                    className="relative px-3 py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors text-sm font-medium"
                                    title="Held Orders (F5)"
                                >
                                    <i className="ri-pause-circle-line mr-1" />
                                    Held
                                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-amber-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                                        {heldOrders.length}
                                    </span>
                                </button>
                            )}

                            <button
                                onClick={() => setShowDailySummary(true)}
                                className="px-3 py-2.5 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium hidden sm:flex items-center"
                                title="Today's Sales"
                            >
                                <i className="ri-line-chart-line mr-1" />
                                {dailySummary ? `GH₵${dailySummary.totalSales.toFixed(0)}` : '...'}
                            </button>

                            {lastReceipt && (
                                <button
                                    onClick={() => printReceipt(lastReceipt)}
                                    className="p-2.5 text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                                    title="Reprint Last Receipt"
                                >
                                    <i className="ri-printer-line" />
                                </button>
                            )}

                            <button
                                onClick={toggleFullscreen}
                                className="p-2.5 text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                                title={isFullscreen ? 'Exit Fullscreen (F9)' : 'Fullscreen (F9)'}
                            >
                                <i className={isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} />
                            </button>

                            <button
                                onClick={() => setShowShortcuts(s => !s)}
                                className="p-2.5 text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors hidden sm:block"
                                title="Keyboard Shortcuts"
                            >
                                <i className="ri-keyboard-line" />
                            </button>
                        </div>
                    </div>

                    {/* Category Tabs */}
                    <div className="flex items-center gap-2 mt-3 overflow-x-auto no-scrollbar pb-1">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                                    activeCategory === cat
                                        ? 'bg-gray-900 text-white shadow-md'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>

                    {/* Shortcuts Bar */}
                    {showShortcuts && (
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-500">
                            {[
                                ['F1', 'Cash'], ['F2', 'Card'], ['F3', 'MoMo'], ['F4', 'Hold'],
                                ['F5', 'Recall'], ['F8', 'Clear'], ['F9', 'Fullscreen'], ['F12', 'Checkout'], ['Esc', 'Close']
                            ].map(([key, label]) => (
                                <span key={key} className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded">
                                    <kbd className="font-mono font-bold text-gray-700 bg-white px-1 rounded shadow-sm border">{key}</kbd>
                                    {label}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Product Grid */}
                <div className="flex-1 overflow-y-auto p-4 content-start">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            <i className="ri-loader-4-line animate-spin text-2xl mr-2" /> Loading products...
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <i className="ri-inbox-line text-4xl mb-2" />
                            <p>No products found</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pb-20 lg:pb-4">
                            {filteredProducts.map(product => {
                                const inCart = cart.find(c => c.id === product.id);
                                const outOfStock = product.quantity <= 0;
                                return (
                                    <div
                                        key={product.id}
                                        onClick={() => !outOfStock && addToCart(product)}
                                        className={`bg-white rounded-xl shadow-sm hover:shadow-md transition-all overflow-hidden border group flex flex-col h-full ${
                                            outOfStock ? 'opacity-50 cursor-not-allowed border-gray-200' :
                                            inCart ? 'border-gray-300 ring-1 ring-gray-200 cursor-pointer' : 'border-gray-100 cursor-pointer'
                                        }`}
                                    >
                                        <div className="aspect-square relative bg-gray-50 shrink-0">
                                            {product.image ? (
                                                <img src={product.image} alt={product.name}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                    <i className="ri-image-line text-3xl" />
                                                </div>
                                            )}
                                            <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full backdrop-blur-sm font-medium">
                                                {outOfStock ? 'OUT' : `${product.quantity}`}
                                            </div>
                                            {inCart && (
                                                <div className="absolute top-2 left-2 w-6 h-6 bg-gray-700 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                                    {inCart.cartQuantity}
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-2.5 flex flex-col flex-1">
                                            <h3 className="text-xs font-semibold text-gray-900 line-clamp-2 mb-auto">{product.name}</h3>
                                            <div className="flex items-center justify-between mt-1.5">
                                                <span className="text-gray-900 font-bold text-sm">GH₵{product.price.toFixed(2)}</span>
                                                {!outOfStock && (
                                                    <div className="w-7 h-7 rounded-full bg-gray-50 text-gray-900 flex items-center justify-center group-hover:bg-gray-900 group-hover:text-white transition-colors">
                                                        <i className="ri-add-line text-sm" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Mobile Bottom Cart Bar */}
                {cart.length > 0 && (
                    <div className="lg:hidden p-4 border-t border-gray-200 bg-white fixed bottom-0 left-0 right-0 z-30 shadow-2xl safe-area-bottom">
                        <button
                            onClick={() => setIsMobileCartOpen(true)}
                            className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold flex justify-between px-6 shadow-lg active:scale-95 transition-transform"
                        >
                            <span className="flex items-center text-sm">
                                <span className="bg-white/20 px-2 py-0.5 rounded mr-2">{cart.reduce((a, b) => a + b.cartQuantity, 0)}</span>
                                Items
                            </span>
                            <span>View Cart</span>
                            <span>GH₵{grandTotal.toFixed(2)}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* RIGHT: Cart Panel */}
            <div className={`w-full lg:w-96 bg-white border-l border-gray-200 flex flex-col h-full shadow-lg z-20 absolute inset-0 lg:relative ${isMobileCartOpen ? 'flex' : 'hidden lg:flex'}`}>
                <div className="p-3 border-b border-gray-200 flex items-center justify-between bg-gray-50 shrink-0">
                    <div className="flex items-center">
                        <button onClick={() => setIsMobileCartOpen(false)} className="lg:hidden mr-2 p-2 -ml-2 text-gray-600 hover:bg-gray-200 rounded-full">
                            <i className="ri-arrow-left-line text-xl" />
                        </button>
                        <h2 className="text-base font-bold text-gray-900 flex items-center">
                            <i className="ri-shopping-basket-2-line mr-2" />
                            Current Order
                        </h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="bg-gray-100 text-gray-800 text-xs font-bold px-2 py-1 rounded-full">
                            {cart.reduce((a, b) => a + b.cartQuantity, 0)} Items
                        </span>
                        {cart.length > 0 && (
                            <button
                                onClick={holdCurrentOrder}
                                className="text-xs px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 font-medium"
                                title="Hold Order (F4)"
                            >
                                <i className="ri-pause-circle-line mr-1" />Hold
                            </button>
                        )}
                    </div>
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-3">
                            <i className="ri-shopping-cart-line text-5xl opacity-20" />
                            <p className="text-sm">Scan barcode or tap product</p>
                            <button onClick={() => setIsMobileCartOpen(false)} className="lg:hidden text-gray-700 font-medium hover:underline text-sm">
                                Browse Products
                            </button>
                        </div>
                    ) : (
                        cart.map(item => (
                            <div key={item.id} className="flex gap-2.5 p-2.5 bg-gray-50 rounded-lg group hover:bg-gray-100 transition-colors">
                                <div className="w-14 h-14 bg-white rounded-md overflow-hidden flex-shrink-0 border border-gray-200">
                                    {item.image ? <img src={item.image} className="w-full h-full object-cover" alt="" /> :
                                        <div className="w-full h-full flex items-center justify-center text-gray-300"><i className="ri-image-line" /></div>}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-between">
                                    <div className="flex justify-between items-start">
                                        <p className="text-xs font-semibold text-gray-900 line-clamp-1 pr-1">{item.name}</p>
                                        <button onClick={() => removeFromCart(item.id)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                                            <i className="ri-close-line text-sm" />
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between mt-1">
                                        <div className="flex items-center space-x-1 bg-white rounded border border-gray-200 px-0.5 py-0.5">
                                            <button onClick={() => updateQuantity(item.id, -1)} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded">
                                                <i className="ri-subtract-line text-xs" />
                                            </button>
                                            <span className="text-xs font-bold w-5 text-center">{item.cartQuantity}</span>
                                            <button onClick={() => updateQuantity(item.id, 1)} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded">
                                                <i className="ri-add-line text-xs" />
                                            </button>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-bold text-gray-900">GH₵{(item.price * item.cartQuantity * (1 - item.discount / 100)).toFixed(2)}</p>
                                            {item.discount > 0 && <p className="text-[10px] text-red-500 line-through">GH₵{(item.price * item.cartQuantity).toFixed(2)}</p>}
                                        </div>
                                    </div>
                                    {item.discount > 0 && (
                                        <span className="text-[10px] text-red-600 font-medium">-{item.discount}% discount</span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Cart Footer */}
                <div className="p-3 bg-gray-50 border-t border-gray-200 space-y-3 shrink-0 safe-area-bottom">
                    <div className="space-y-1 text-sm">
                        <div className="flex justify-between text-gray-600">
                            <span>Subtotal</span>
                            <span>GH₵{cartSubtotal.toFixed(2)}</span>
                        </div>
                        {totalDiscount > 0 && (
                            <div className="flex justify-between text-red-600">
                                <span>Discount</span>
                                <span>-GH₵{totalDiscount.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200 mt-1">
                            <span>Total</span>
                            <span>GH₵{grandTotal.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Discount Button */}
                    {cart.length > 0 && (
                        <div className="flex gap-2">
                            {showDiscountInput ? (
                                <div className="flex items-center gap-2 flex-1">
                                    <input
                                        type="number"
                                        value={orderDiscount || ''}
                                        onChange={e => setOrderDiscount(Math.min(100, Math.max(0, Number(e.target.value))))}
                                        placeholder="0"
                                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center"
                                        autoFocus
                                    />
                                    <span className="text-xs text-gray-500">% off order</span>
                                    <button onClick={() => setShowDiscountInput(false)} className="text-xs text-gray-700 font-medium">Done</button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowDiscountInput(true)}
                                    className="text-xs px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium"
                                >
                                    <i className="ri-percent-line mr-1" />
                                    {orderDiscount > 0 ? `${orderDiscount}% Discount` : 'Add Discount'}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={emptyCart}
                            disabled={cart.length === 0}
                            className="px-3 py-3 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <i className="ri-delete-bin-line mr-1" />Clear
                        </button>
                        <button
                            onClick={() => { setShowCheckoutModal(true); setCheckoutError(null); }}
                            disabled={cart.length === 0}
                            className="px-3 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-900 font-bold text-sm shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Charge GH₵{grandTotal.toFixed(2)}
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── Checkout Modal ─────────────────────────────────────────────── */}
            {showCheckoutModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        {completedOrder ? (
                            <div className="p-8 text-center flex flex-col items-center justify-center space-y-5 overflow-y-auto">
                                <div className={`w-20 h-20 rounded-full flex items-center justify-center ${completedOrder.paymentPending ? 'bg-amber-100' : 'bg-gray-100'}`}>
                                    <i className={`text-5xl ${completedOrder.paymentPending ? 'ri-time-line text-amber-600' : 'ri-checkbox-circle-fill text-gray-700'}`} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-900">
                                        {completedOrder.paymentPending ? 'Payment Link Generated!' : 'Payment Successful!'}
                                    </h2>
                                    <p className="text-gray-500 mt-1">Order #{completedOrder.orderNumber}</p>

                                    {!completedOrder.paymentPending && paymentMethod === 'cash' && changeDue > 0 && (
                                        <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
                                            <p className="text-sm text-gray-900">Change Due</p>
                                            <p className="text-3xl font-bold text-gray-800">GH₵{changeDue.toFixed(2)}</p>
                                        </div>
                                    )}

                                    {completedOrder.paymentPending && completedOrder.paymentUrl && (
                                        <div className="mt-4 space-y-3">
                                            <p className="text-sm text-gray-600">Customer can pay using this link:</p>
                                            <a href={completedOrder.paymentUrl} target="_blank" rel="noopener noreferrer"
                                                className="inline-flex items-center px-6 py-3 bg-amber-600 text-white rounded-xl font-semibold hover:bg-amber-700 transition-colors">
                                                <i className="ri-external-link-line mr-2" />Open Payment Page
                                            </a>
                                            <div>
                                                <button onClick={() => { navigator.clipboard.writeText(completedOrder.paymentUrl); }}
                                                    className="text-sm text-gray-900 hover:text-gray-800 font-medium underline">
                                                    <i className="ri-file-copy-line mr-1" />Copy Link
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3 w-full mt-4">
                                    <button
                                        onClick={() => completedOrder.receiptData && printReceipt(completedOrder.receiptData)}
                                        className="py-3 px-4 border border-gray-300 rounded-xl font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center"
                                    >
                                        <i className="ri-printer-line mr-2" />Print Receipt
                                    </button>
                                    <button onClick={resetCheckout}
                                        className="py-3 px-4 bg-gray-700 text-white rounded-xl font-semibold hover:bg-gray-900 transition-colors">
                                        New Order
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                                    <h3 className="text-xl font-bold text-gray-900">Finalize Payment</h3>
                                    <button onClick={() => setShowCheckoutModal(false)} className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500">
                                        <i className="ri-close-line text-xl" />
                                    </button>
                                </div>

                                <div className="p-5 space-y-5 overflow-y-auto">
                                    {checkoutError && (
                                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                                            <i className="ri-error-warning-line text-red-500 mt-0.5" />
                                            <p className="text-sm text-red-700">{checkoutError}</p>
                                        </div>
                                    )}

                                    <div className="text-center py-4 bg-gray-50 rounded-xl border border-gray-100">
                                        <p className="text-xs text-gray-800 uppercase tracking-wider font-semibold">Amount to Pay</p>
                                        <p className="text-4xl font-extrabold text-gray-900 mt-1">GH₵{grandTotal.toFixed(2)}</p>
                                        {totalDiscount > 0 && <p className="text-xs text-red-500 mt-1">Discount: -GH₵{totalDiscount.toFixed(2)}</p>}
                                    </div>

                                    {/* Customer */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Customer</label>
                                        <div className="relative mb-2">
                                            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                                            <input type="text" placeholder="Search customers..."
                                                value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                                                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 outline-none text-sm" />
                                        </div>
                                        <select className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 outline-none text-sm mb-2"
                                            onChange={(e) => setSelectedCustomer(customers.find(c => c.id === e.target.value) || null)}
                                            value={selectedCustomer?.id || ''}>
                                            <option value="">Walk-in Customer / New Guest</option>
                                            {filteredCustomers.map(c => (
                                                <option key={c.id} value={c.id}>{c.full_name || 'No Name'} — {c.phone || c.email}</option>
                                            ))}
                                        </select>

                                        {selectedCustomer && (
                                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 mb-2 flex items-center justify-between">
                                                <div>
                                                    <p className="font-semibold text-gray-900 text-sm">{selectedCustomer.full_name}</p>
                                                    <p className="text-xs text-gray-600">{selectedCustomer.email} {selectedCustomer.phone && `| ${selectedCustomer.phone}`}</p>
                                                </div>
                                                <button onClick={() => setSelectedCustomer(null)} className="text-gray-400 hover:text-red-500"><i className="ri-close-line" /></button>
                                            </div>
                                        )}

                                        {!selectedCustomer && (
                                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mt-2 space-y-2">
                                                <h4 className="text-xs font-bold text-gray-700">New Customer</h4>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input type="text" placeholder="First Name *" value={guestDetails.firstName}
                                                        onChange={e => setGuestDetails({ ...guestDetails, firstName: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-gray-600 outline-none" />
                                                    <input type="text" placeholder="Last Name" value={guestDetails.lastName}
                                                        onChange={e => setGuestDetails({ ...guestDetails, lastName: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-gray-600 outline-none" />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input type="email" placeholder="Email" value={guestDetails.email}
                                                        onChange={e => setGuestDetails({ ...guestDetails, email: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-gray-600 outline-none" />
                                                    <input type="tel"
                                                        placeholder={paymentMethod === 'momo' ? 'Phone (Required) *' : 'Phone'}
                                                        value={guestDetails.phone}
                                                        onChange={e => setGuestDetails({ ...guestDetails, phone: e.target.value })}
                                                        className={`w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-gray-600 outline-none ${
                                                            paymentMethod === 'momo' && !guestDetails.phone ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
                                                        }`} />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Delivery */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Delivery Method</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => setDeliveryMethod('pickup')}
                                                className={`p-2.5 rounded-lg border transition-all flex items-center gap-2 ${
                                                    deliveryMethod === 'pickup' ? 'border-gray-700 bg-gray-50 ring-1 ring-gray-700' : 'border-gray-200 hover:border-gray-300'
                                                }`}>
                                                <i className={`ri-store-2-line text-lg ${deliveryMethod === 'pickup' ? 'text-gray-900' : 'text-gray-400'}`} />
                                                <div className="text-left">
                                                    <p className={`text-sm font-semibold ${deliveryMethod === 'pickup' ? 'text-gray-800' : 'text-gray-700'}`}>Pickup</p>
                                                </div>
                                            </button>
                                            <button onClick={() => setDeliveryMethod('doorstep')}
                                                className={`p-2.5 rounded-lg border transition-all flex items-center gap-2 ${
                                                    deliveryMethod === 'doorstep' ? 'border-gray-700 bg-gray-50 ring-1 ring-gray-700' : 'border-gray-200 hover:border-gray-300'
                                                }`}>
                                                <i className={`ri-truck-line text-lg ${deliveryMethod === 'doorstep' ? 'text-gray-900' : 'text-gray-400'}`} />
                                                <div className="text-left">
                                                    <p className={`text-sm font-semibold ${deliveryMethod === 'doorstep' ? 'text-gray-800' : 'text-gray-700'}`}>Delivery</p>
                                                </div>
                                            </button>
                                        </div>
                                        {deliveryMethod === 'doorstep' && (
                                            <div className="mt-2 bg-blue-50 p-3 rounded-lg border border-blue-200 space-y-2">
                                                <input type="text" placeholder="Street Address *" value={guestDetails.address}
                                                    onChange={e => setGuestDetails({ ...guestDetails, address: e.target.value })}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input type="text" placeholder="City *" value={guestDetails.city}
                                                        onChange={e => setGuestDetails({ ...guestDetails, city: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                                                    <select value={guestDetails.region} onChange={e => setGuestDetails({ ...guestDetails, region: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none">
                                                        <option value="">Region *</option>
                                                        {ghanaRegions.map(r => <option key={r} value={r}>{r}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Payment Method */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { key: 'cash', label: 'Cash', icon: 'ri-money-cny-circle-line', shortcut: 'F1' },
                                                { key: 'card', label: 'Card', icon: 'ri-bank-card-line', shortcut: 'F2' },
                                                { key: 'momo', label: 'MoMo', icon: 'ri-smartphone-line', shortcut: 'F3' }
                                            ].map(method => (
                                                <button key={method.key} onClick={() => setPaymentMethod(method.key)}
                                                    className={`py-3 rounded-lg font-medium border transition-all flex flex-col items-center gap-1 ${
                                                        paymentMethod === method.key
                                                            ? 'border-gray-700 bg-gray-50 text-gray-800 ring-1 ring-gray-700'
                                                            : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                                    }`}>
                                                    <i className={`${method.icon} text-xl`} />
                                                    <span className="text-sm">{method.label}</span>
                                                    <span className="text-[9px] text-gray-400">{method.shortcut}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Cash Amount */}
                                    {paymentMethod === 'cash' && (
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Amount Tendered</label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">GH₵</span>
                                                <input type="number" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)}
                                                    className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-600 outline-none font-bold text-lg"
                                                    placeholder="0.00" autoFocus />
                                            </div>
                                            {changeDue > 0 && <p className="text-right text-gray-700 font-bold mt-2">Change: GH₵{changeDue.toFixed(2)}</p>}
                                            {changeDue < 0 && amountTendered && <p className="text-right text-red-500 font-medium mt-2">Insufficient</p>}
                                            <div className="grid grid-cols-4 gap-2 mt-3">
                                                {[1, 2, 5, 10, 20, 50, 100, 200].map(amount => (
                                                    <button key={amount} onClick={() => setAmountTendered(amount.toString())}
                                                        className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                            parseFloat(amountTendered) === amount
                                                                ? 'bg-gray-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                                        }`}>
                                                        GH₵{amount}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex gap-2 mt-2">
                                                {[grandTotal, Math.ceil(grandTotal / 10) * 10, Math.ceil(grandTotal / 50) * 50].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map(amount => (
                                                    <button key={`exact-${amount}`} onClick={() => setAmountTendered(amount.toString())}
                                                        className="flex-1 px-2 py-2 bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-lg text-xs font-semibold text-gray-900 transition-colors">
                                                        Exact: GH₵{amount.toFixed(2)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {paymentMethod === 'momo' && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                                            <i className="ri-information-line text-amber-600 mt-0.5" />
                                            <div className="text-sm text-amber-800">
                                                <p className="font-semibold">Mobile Money</p>
                                                <p className="mt-1">A payment link will be generated for the customer.</p>
                                            </div>
                                        </div>
                                    )}

                                    {paymentMethod === 'card' && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                                            <i className="ri-bank-card-line text-blue-600 mt-0.5" />
                                            <div className="text-sm text-blue-800">
                                                <p className="font-semibold">Card Payment</p>
                                                <p className="mt-1">Process on your POS terminal, then confirm here.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="p-5 border-t border-gray-100 bg-gray-50 shrink-0">
                                    <button onClick={handleCheckout} disabled={processing}
                                        className="w-full py-4 bg-gray-900 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                                        {processing ? (
                                            <><i className="ri-loader-4-line animate-spin" /><span>Processing...</span></>
                                        ) : paymentMethod === 'momo' ? (
                                            <><i className="ri-smartphone-line" /><span>Generate Payment Link</span></>
                                        ) : (
                                            <><i className="ri-secure-payment-line" /><span>Complete Payment — GH₵{grandTotal.toFixed(2)}</span></>
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ─── Held Orders Modal ─────────────────────────────────────────── */}
            {showHeldOrders && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <i className="ri-pause-circle-line text-amber-600" />
                                Held Orders ({heldOrders.length})
                            </h3>
                            <button onClick={() => setShowHeldOrders(false)} className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500">
                                <i className="ri-close-line text-xl" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                            {heldOrders.length === 0 ? (
                                <div className="text-center py-8 text-gray-400">
                                    <i className="ri-inbox-line text-4xl mb-2 block" />
                                    <p className="text-sm">No held orders</p>
                                </div>
                            ) : (
                                heldOrders.map(held => (
                                    <div key={held.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <p className="font-semibold text-gray-900 text-sm">{held.note}</p>
                                                <p className="text-xs text-gray-500">
                                                    {new Date(held.heldAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                                    {held.customer && ` · ${held.customer.full_name}`}
                                                </p>
                                            </div>
                                            <p className="font-bold text-gray-900 text-sm">
                                                GH₵{held.cart.reduce((s, i) => s + i.price * i.cartQuantity, 0).toFixed(2)}
                                            </p>
                                        </div>
                                        <div className="text-xs text-gray-500 mb-3">
                                            {held.cart.map(i => `${i.name} ×${i.cartQuantity}`).join(', ')}
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => recallOrder(held.id)}
                                                className="flex-1 py-2 bg-gray-700 text-white rounded-lg text-sm font-semibold hover:bg-gray-900 transition-colors">
                                                <i className="ri-refresh-line mr-1" />Recall
                                            </button>
                                            <button onClick={() => deleteHeldOrder(held.id)}
                                                className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors">
                                                <i className="ri-delete-bin-line" />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Daily Summary Modal ───────────────────────────────────────── */}
            {showDailySummary && dailySummary && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <i className="ri-line-chart-line text-gray-700" />
                                Today&apos;s Sales
                            </h3>
                            <button onClick={() => setShowDailySummary(false)} className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500">
                                <i className="ri-close-line text-xl" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="text-center py-4 bg-gray-50 rounded-xl">
                                <p className="text-xs text-gray-700 uppercase tracking-wider font-semibold">Total Sales</p>
                                <p className="text-3xl font-extrabold text-gray-900">GH₵{dailySummary.totalSales.toFixed(2)}</p>
                                <p className="text-sm text-gray-500 mt-1">{dailySummary.orderCount} order{dailySummary.orderCount !== 1 ? 's' : ''}</p>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="text-center p-3 bg-gray-50 rounded-xl">
                                    <i className="ri-money-cny-circle-line text-lg text-gray-500" />
                                    <p className="text-sm font-bold text-gray-900">GH₵{dailySummary.cashSales.toFixed(0)}</p>
                                    <p className="text-[10px] text-gray-500">Cash</p>
                                </div>
                                <div className="text-center p-3 bg-gray-50 rounded-xl">
                                    <i className="ri-bank-card-line text-lg text-gray-500" />
                                    <p className="text-sm font-bold text-gray-900">GH₵{dailySummary.cardSales.toFixed(0)}</p>
                                    <p className="text-[10px] text-gray-500">Card</p>
                                </div>
                                <div className="text-center p-3 bg-gray-50 rounded-xl">
                                    <i className="ri-smartphone-line text-lg text-gray-500" />
                                    <p className="text-sm font-bold text-gray-900">GH₵{dailySummary.momoSales.toFixed(0)}</p>
                                    <p className="text-[10px] text-gray-500">MoMo</p>
                                </div>
                            </div>
                            <button onClick={() => { setShowDailySummary(false); fetchDailySummary(); }}
                                className="w-full py-2.5 text-sm text-gray-900 bg-gray-50 rounded-xl font-medium hover:bg-gray-100 transition-colors">
                                <i className="ri-refresh-line mr-1" />Refresh
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
