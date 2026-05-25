#!/usr/bin/env node
/**
 * External uptime check for Deliz Beauty Tools.
 *
 * Designed to run on GitHub Actions every 5 minutes (see
 * .github/workflows/uptime-check.yml). Performs a small set of
 * health probes against the live site + self-hosted Supabase, and
 * if any of them fail, sends an SMS alert to the admin team via the
 * existing Moolre SMS integration.
 *
 * Required environment variables (set as GitHub Action secrets):
 *   MOOLRE_API_KEY         - Moolre VAS key (same one the site uses).
 *   ADMIN_SMS_RECIPIENTS   - Comma-separated phone numbers to alert.
 *   SMS_SENDER_ID          - Optional. Defaults to "DelizBeauty".
 *
 * The script intentionally has zero npm dependencies — it only uses
 * Node's built-in fetch, so it runs as a one-liner in CI without
 * any install step.
 */

const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 30_000;

const SMS_API_KEY = process.env.MOOLRE_API_KEY || process.env.MOOLRE_SMS_API_KEY || '';
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || 'DelizBeauty';
const RECIPIENTS = (process.env.ADMIN_SMS_RECIPIENTS || '0278549831')
  .split(/[,\s\n]+/)
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Each check returns { ok: boolean, label, detail }.
 * Keep them small and self-explanatory — the SMS body uses these labels.
 */
const CHECKS = [
  {
    label: 'Storefront',
    url: 'https://delizbeautytools.com/api/storefront/shop?limit=1',
    expect: (body) => typeof body === 'string' && body.includes('"id"'),
  },
  {
    label: 'Supabase REST',
    // Anon-key request through the public REST endpoint. Kong responds even
    // before the upstream is ready, so we verify the JSON shape rather than
    // just the status code.
    url: 'https://supabase.doctorbarns.com/rest/v1/products?select=id&limit=1',
    headers: {
      apikey:
        'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3NzgzMzI0MCwiZXhwIjo0OTMzNTA2ODQwLCJyb2xlIjoiYW5vbiJ9.uSyVWiz-MVdgpUpCwiq4zwDrhM7ViiLVgU5Dvd4aD6U',
    },
    expect: (body) => typeof body === 'string' && body.startsWith('['),
  },
  {
    label: 'Supabase Storage',
    url:
      'https://supabase.doctorbarns.com/storage/v1/object/public/products/cat-1773236413204-jknjw930b9c.jpeg',
    expectStatus: 200,
    expect: (_body, res) => {
      const ct = res.headers.get('content-type') || '';
      return ct.startsWith('image/');
    },
  },
];

function maskPhone(p) {
  if (!p) return '';
  const s = String(p);
  if (s.length < 6) return s;
  return s.slice(0, 4) + '****' + s.slice(-2);
}

function formatPhone(phone) {
  let s = String(phone || '').replace(/\D/g, '');
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0')) s = '233' + s.slice(1);
  return '+' + s;
}

async function probe(check) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(check.url, {
      method: 'GET',
      headers: { Accept: '*/*', ...(check.headers || {}) },
      signal: controller.signal,
      redirect: 'follow',
    });
    const body = await res.text();
    clearTimeout(timer);
    const elapsed = Date.now() - started;
    if (check.expectStatus && res.status !== check.expectStatus) {
      return { ok: false, label: check.label, detail: `HTTP ${res.status} in ${elapsed}ms` };
    }
    if (!res.ok && !check.expectStatus) {
      return { ok: false, label: check.label, detail: `HTTP ${res.status} in ${elapsed}ms` };
    }
    if (check.expect && !check.expect(body, res)) {
      return {
        ok: false,
        label: check.label,
        detail: `Unexpected body (${body.slice(0, 60).replace(/\s+/g, ' ')}...) in ${elapsed}ms`,
      };
    }
    return { ok: true, label: check.label, detail: `OK in ${elapsed}ms` };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      label: check.label,
      detail: err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message || 'error',
    };
  }
}

async function runProbes() {
  return Promise.all(CHECKS.map(probe));
}

async function sendSms(text) {
  if (!SMS_API_KEY) {
    console.error('[alert] Skipping SMS: MOOLRE_API_KEY not configured');
    return;
  }
  for (const raw of RECIPIENTS) {
    const recipient = formatPhone(raw);
    try {
      const res = await fetch('https://api.moolre.com/open/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-VASKEY': SMS_API_KEY,
        },
        body: JSON.stringify({
          type: 1,
          senderid: SMS_SENDER_ID,
          messages: [{ recipient, message: text }],
        }),
      });
      const json = await res.json().catch(() => ({}));
      const status = json.status === 1 ? 'sent' : 'failed';
      console.log(`[alert] SMS to ${maskPhone(recipient)} ${status}`);
    } catch (e) {
      console.error(`[alert] SMS to ${maskPhone(recipient)} threw: ${e.message}`);
    }
  }
}

async function main() {
  const first = await runProbes();
  const failedFirst = first.filter((r) => !r.ok);

  if (failedFirst.length === 0) {
    console.log('OK', first.map((r) => `${r.label}: ${r.detail}`).join(' | '));
    return;
  }

  console.warn(
    '[warn] failures on first pass:',
    failedFirst.map((r) => `${r.label} (${r.detail})`).join(' | ')
  );
  console.log(`[info] Re-checking after ${RETRY_DELAY_MS / 1000}s to filter false positives...`);
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));

  const second = await runProbes();
  const stillFailing = second.filter((r) => !r.ok);

  if (stillFailing.length === 0) {
    console.log('Recovered on retry. No alert sent.');
    console.log(second.map((r) => `${r.label}: ${r.detail}`).join(' | '));
    return;
  }

  const message =
    `Deliz Beauty Tools DOWN. ` +
    stillFailing.map((r) => `${r.label}: ${r.detail}`).join('. ') +
    `. Time: ${new Date().toISOString()}`;
  console.error('[alert]', message);
  await sendSms(message);

  // Exit non-zero so the GitHub Actions run is marked as failed
  process.exit(1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
