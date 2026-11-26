'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export type CartItem = {
    id: string;
    name: string;
    price: number;
    image: string;
    quantity: number;
    variant?: string;
    variantId?: string;
    sku?: string;
    slug: string;
    maxStock: number;
    moq?: number; // Minimum Order Quantity
};

type CartContextType = {
    cart: CartItem[];
    addToCart: (item: CartItem) => boolean;
    removeFromCart: (itemId: string, variant?: string) => void;
    updateQuantity: (itemId: string, quantity: number, variant?: string) => void;
    clearCart: () => void;
    cartCount: number;
    subtotal: number;
    isCartOpen: boolean;
    setIsCartOpen: (isOpen: boolean) => void;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

/** A purchasable item must have a real, positive price. */
export function isPurchasablePrice(price: unknown): boolean {
    const value = Number(price);
    return Number.isFinite(value) && value > 0;
}

export function CartProvider({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<CartItem[] | null>(null);
    const [isCartOpen, setIsCartOpen] = useState(false);

    // Direct cart toggle
    const handleSetCartOpen = (isOpen: boolean) => {
        setIsCartOpen(isOpen);
    };

    // Load cart from localStorage on mount, with migration for legacy items
    useEffect(() => {
        const savedCart = localStorage.getItem('cart');
        if (savedCart) {
            try {
                const parsed: CartItem[] = JSON.parse(savedCart);
                // Migrate legacy cart items: if `id` is not a UUID, it's likely a slug
                const isValidUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
                const migratedCart = parsed.filter(item => {
                    if (!item.id || !item.name) return false; // Remove corrupted items
                    if (!isPurchasablePrice(item.price)) return false; // Drop unpriced / zero-price items
                    if (!isValidUUID(item.id)) {
                        // Legacy item with slug as id - ensure slug is set, then clear
                        // These items will be resolved at checkout via the slug fallback
                        // But best to remove them so users re-add with correct UUIDs
                        console.warn(`Removing legacy cart item with non-UUID id: ${item.id}`);
                        return false;
                    }
                    // Ensure slug field exists
                    if (!item.slug) {
                        item.slug = item.id;
                    }
                    return true;
                });
                setCart(migratedCart);
            } catch (e) {
                console.error('Failed to parse cart:', e);
                localStorage.removeItem('cart');
                setCart([]);
            }
        } else {
            setCart([]);
        }
    }, []);

    // Save only after the first localStorage read so a remount cannot wipe the cart.
    useEffect(() => {
        if (cart === null) return;
        localStorage.setItem('cart', JSON.stringify(cart));
        window.dispatchEvent(new Event('cartUpdated'));
    }, [cart]);

    // Keep saved cart prices in step with the shop. A cart is a snapshot, so without
    // this a sale that started or ended after the item was added would show the old
    // price here and a different one at payment. Checked when the cart first loads,
    // and again every time the shopper opens the cart or checkout page.
    const pathname = usePathname();
    const cartLoaded = cart !== null;
    const cartRef = useRef<CartItem[]>([]);
    cartRef.current = cart || [];
    const lastPriceCheck = useRef(0);

    useEffect(() => {
        if (!cartLoaded) return;
        const sent = cartRef.current;
        if (sent.length === 0) return;
        const paying = pathname === '/cart' || pathname === '/checkout';
        if (!paying && lastPriceCheck.current > 0) return;
        lastPriceCheck.current = Date.now();

        let cancelled = false;
        fetch('/api/storefront/cart-prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: sent.map((item) => ({ id: item.id, variant: item.variant || null, variantId: item.variantId || null })),
            }),
        })
            .then((res) => (res.ok ? res.json() : null))
            .then((result) => {
                if (cancelled || !Array.isArray(result?.prices)) return;
                const current = new Map<string, number>();
                sent.forEach((item, index) => {
                    const price = Number(result.prices[index]?.price);
                    if (isPurchasablePrice(price)) current.set(`${item.id}|${item.variant || ''}`, price);
                });
                setCart((prev) => {
                    if (!prev) return prev;
                    let changed = false;
                    const next = prev.map((item) => {
                        const price = current.get(`${item.id}|${item.variant || ''}`);
                        if (price == null || Math.abs(price - item.price) < 0.005) return item;
                        changed = true;
                        return { ...item, price };
                    });
                    return changed ? next : prev;
                });
            })
            .catch(() => {
                // Offline or the check failed: keep the saved prices. Checkout prices every line again.
            });

        return () => {
            cancelled = true;
        };
    }, [cartLoaded, pathname]);

    const addToCart = (newItem: CartItem): boolean => {
        // Block items with no price or a price of 0 — they cannot be purchased.
        if (!isPurchasablePrice(newItem.price)) {
            console.warn(`Blocked add-to-cart for unpriced item: ${newItem.name} (${newItem.id})`);
            if (typeof window !== 'undefined') {
                alert('This item is currently unavailable for purchase (no price set).');
            }
            return false;
        }

        setCart((prevCart) => {
            const list = prevCart || [];
            const existingItemIndex = list.findIndex(
                (item) => item.id === newItem.id && item.variant === newItem.variant
            );

            if (existingItemIndex > -1) {
                const newCart = [...list];
                const existingItem = newCart[existingItemIndex];
                const newQuantity = Math.min(
                    existingItem.quantity + newItem.quantity,
                    existingItem.maxStock
                );
                newCart[existingItemIndex] = { ...existingItem, quantity: newQuantity };
                return newCart;
            }
            return [...list, newItem];
        });

        setIsCartOpen(true); // Open cart when item is added
        return true;
    };

    const removeFromCart = (itemId: string, variant?: string) => {
        setCart((prevCart) =>
            (prevCart || []).filter((item) => !(item.id === itemId && item.variant === variant))
        );
    };

    const updateQuantity = (itemId: string, quantity: number, variant?: string) => {
        setCart((prevCart) => {
            const list = prevCart || [];
            const item = list.find(i => i.id === itemId && i.variant === variant);
            if (!item) return list;

            const minQty = item.moq || 1;
            if (quantity < minQty) {
                return list.filter(i => !(i.id === itemId && i.variant === variant));
            }

            const clampedQty = Math.min(Math.max(quantity, minQty), item.maxStock);

            return list.map((i) =>
                i.id === itemId && i.variant === variant
                    ? { ...i, quantity: clampedQty }
                    : i
            );
        });
    };

    const clearCart = () => {
        setCart([]);
    };

    const readyCart = cart || [];
    const cartCount = readyCart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = readyCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    return (
        <CartContext.Provider value={{
            cart: readyCart,
            addToCart,
            removeFromCart,
            updateQuantity,
            clearCart,
            cartCount,
            subtotal,
            isCartOpen,
            setIsCartOpen: handleSetCartOpen
        }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const context = useContext(CartContext);
    if (context === undefined) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
}
