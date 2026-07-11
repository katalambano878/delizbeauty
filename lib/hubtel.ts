/**
 * Hubtel Online Checkout client (hosted checkout).
 *
 * No SDK — plain `fetch` with HTTP Basic auth (base64(API_ID:API_KEY)).
 *
 * Flow:
 *   1. initiate a checkout session server-side (payproxyapi.hubtel.com)
 *   2. redirect the customer to the returned checkout URL
 *   3. confirm the outcome via callback AND server-side status re-verification
 *      against the public RMSC status endpoint (rmsc.hubtel.com).
 *
 * SECURITY NOTES
 * - Hubtel's `ResponseCode === "0000"` on initiate/callback means "request
 *   received", NOT "payment succeeded". The real outcome lives in
 *   Data.Status / Data.TransactionStatus — always re-verify via status check.
 * - Hubtel callbacks are NOT signed. Never mark an order paid from a callback
 *   body alone; re-query the status endpoint and match the settlement amount.
 */

const INITIATE_URL = 'https://payproxyapi.hubtel.com/items/initiate';
const RMSC_STATUS_BASE = 'https://rmsc.hubtel.com/v1/merchantaccount/merchants';

interface HubtelConfig {
    apiId?: string;
    apiKey?: string;
    merchantAccountNumber?: string;
}

function getConfig(): HubtelConfig {
    return {
        apiId: process.env.HUBTEL_API_ID,
        apiKey: process.env.HUBTEL_API_KEY,
        merchantAccountNumber: process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER,
    };
}

/** True only when all three required Hubtel env vars are present. */
export function isHubtelConfigured(): boolean {
    const { apiId, apiKey, merchantAccountNumber } = getConfig();
    return Boolean(apiId && apiKey && merchantAccountNumber);
}

function authHeader(): string {
    const { apiId, apiKey } = getConfig();
    const token = Buffer.from(`${apiId}:${apiKey}`).toString('base64');
    return `Basic ${token}`;
}

/**
 * Hubtel hard-limits `clientReference` to 32 characters. We append a fresh
 * base36 timestamp suffix so retries never collide, then truncate to 32.
 * Example: `ORD-1781531981361-404-r<base36ts>`.
 */
export function makeHubtelClientReference(orderRef: string): string {
    const suffix = `-r${Date.now().toString(36)}`;
    const maxBaseLen = Math.max(0, 32 - suffix.length);
    const base = String(orderRef || 'ORDER').slice(0, maxBaseLen);
    return `${base}${suffix}`.slice(0, 32);
}

/**
 * Strip the trailing `-r<base36>` suffix added by makeHubtelClientReference so
 * the callback can recover the original order number.
 */
export function stripHubtelReferenceSuffix(ref: string): string {
    return String(ref || '').replace(/-r[0-9a-z]+$/i, '');
}

/**
 * True only for terminal success states. CRITICAL: this must NOT be fed
 * Hubtel's ResponseCode ("0000" != paid). Pass the transaction Status string.
 */
export function isHubtelPaid(status?: string | null): boolean {
    const s = String(status || '').trim().toLowerCase();
    return s === 'paid' || s === 'success' || s === 'successful' || s === 'completed';
}

/** True for terminal failure states or known failure response codes. */
export function isHubtelFailure(status?: string | null, responseCode?: string | null): boolean {
    const s = String(status || '').trim().toLowerCase();
    if (
        s === 'failed' ||
        s === 'failure' ||
        s === 'declined' ||
        s === 'cancelled' ||
        s === 'canceled' ||
        s === 'expired' ||
        s === 'reversed'
    ) {
        return true;
    }
    const code = String(responseCode || '').trim();
    return code === '2001' || code === '4000' || code === '4070';
}

/** Normalize a Ghana phone number to the `233XXXXXXXXX` format. */
export function normalizeGhPhone(input?: string | null): string {
    const digits = String(input || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('233')) return digits;
    if (digits.startsWith('0')) return `233${digits.slice(1)}`;
    // Bare 9-digit local number (missing the leading 0)
    if (digits.length === 9) return `233${digits}`;
    return digits;
}

export interface HubtelInitiateParams {
    totalAmount: number;
    description: string;
    callbackUrl: string;
    returnUrl: string;
    cancellationUrl: string;
    clientReference: string;
    payeeName?: string;
    payeeMobileNumber?: string;
    payeeEmail?: string;
}

export interface HubtelInitiateResult {
    ok: boolean;
    status: number;
    checkoutUrl?: string;
    checkoutDirectUrl?: string;
    checkoutId?: string;
    message?: string;
    raw?: any;
}

/** Start a hosted-checkout session. */
export async function hubtelInitiateCheckout(
    params: HubtelInitiateParams
): Promise<HubtelInitiateResult> {
    const { merchantAccountNumber } = getConfig();

    const payload: Record<string, any> = {
        totalAmount: params.totalAmount,
        description: params.description,
        callbackUrl: params.callbackUrl,
        returnUrl: params.returnUrl,
        cancellationUrl: params.cancellationUrl,
        merchantAccountNumber,
        clientReference: params.clientReference,
    };
    if (params.payeeName) payload.payeeName = params.payeeName;
    if (params.payeeMobileNumber) payload.payeeMobileNumber = params.payeeMobileNumber;
    if (params.payeeEmail) payload.payeeEmail = params.payeeEmail;

    try {
        const res = await fetch(INITIATE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader(),
            },
            body: JSON.stringify(payload),
        });

        const raw = await res.json().catch(() => ({}));
        const data = raw?.data || raw?.Data || {};
        const checkoutUrl = data.checkoutUrl || data.CheckoutUrl;
        const checkoutDirectUrl = data.checkoutDirectUrl || data.CheckoutDirectUrl;

        return {
            ok: res.ok && Boolean(checkoutUrl || checkoutDirectUrl),
            status: res.status,
            checkoutUrl,
            checkoutDirectUrl,
            checkoutId: data.checkoutId || data.CheckoutId,
            message: raw?.message || raw?.Message,
            raw,
        };
    } catch (err: any) {
        return {
            ok: false,
            status: 503,
            message: err?.message || 'Network error contacting Hubtel',
        };
    }
}

export interface HubtelStatusResult {
    found: boolean;
    /** Normalized transaction status string (e.g. "Paid", "Unpaid", "Failed"). */
    status: string;
    /** TransactionAmount — what the customer actually paid. */
    amount: number | null;
    /** Fee — Hubtel's charges. */
    charges: number | null;
    /** AmountAfterFees — what the merchant settles with. */
    amountAfterCharges: number | null;
    responseCode: string | null;
    clientReference: string | null;
    transactionId: string | null;
    raw?: any;
}

/**
 * Query the public RMSC transaction-status endpoint. No IP whitelisting
 * required. The endpoint returns PascalCase fields (and `Data` may be an
 * array) — we normalize into a consistent camelCase shape here.
 */
export async function hubtelCheckStatus(clientReference: string): Promise<HubtelStatusResult> {
    const { merchantAccountNumber } = getConfig();
    const url =
        `${RMSC_STATUS_BASE}/${encodeURIComponent(merchantAccountNumber || '')}` +
        `/transactions/status?clientReference=${encodeURIComponent(clientReference)}`;

    const empty: HubtelStatusResult = {
        found: false,
        status: '',
        amount: null,
        charges: null,
        amountAfterCharges: null,
        responseCode: null,
        clientReference: null,
        transactionId: null,
    };

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader(),
            },
        });

        const raw = await res.json().catch(() => ({}));

        let d: any = raw?.Data ?? raw?.data ?? null;
        if (Array.isArray(d)) d = d.length > 0 ? d[0] : null;

        const topResponseCode = raw?.ResponseCode ?? raw?.responseCode ?? null;

        if (!d || typeof d !== 'object') {
            return { ...empty, responseCode: topResponseCode, raw };
        }

        const num = (v: any): number | null => {
            if (v === null || v === undefined || v === '') return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };

        const status = String(
            d.TransactionStatus ??
            d.InvoiceStatus ??
            d.Status ??
            d.status ??
            ''
        ).trim();

        return {
            found: true,
            status,
            amount: num(d.TransactionAmount ?? d.Amount ?? d.amount),
            charges: num(d.Fee ?? d.Charges ?? d.charges),
            amountAfterCharges: num(
                d.AmountAfterFees ?? d.AmountAfterCharges ?? d.amountAfterCharges
            ),
            responseCode: d.ResponseCode ?? topResponseCode ?? null,
            clientReference: d.ClientReference ?? d.clientReference ?? null,
            transactionId: d.TransactionId ?? d.transactionId ?? null,
            raw,
        };
    } catch (err: any) {
        return { ...empty, raw: { error: err?.message || 'Network error' } };
    }
}
