import type { CheerioCrawlingContext } from '@crawlee/cheerio';
import { createCheerioRouter } from '@crawlee/cheerio';

type Cheerio$ = CheerioCrawlingContext['$'];

export const LABELS = {
    PRODUCT: 'CHECK_PRODUCT',
    SELLER: 'CHECK_SELLER',
} as const;

export const router = createCheerioRouter();

// HTTP codes that mean "the listing/store is gone for good" — never retry, treat as dead.
const DEAD_STATUS = new Set([404, 410]);
// HTTP codes that signal anti-bot / transient blocking — throw so Crawlee retries with a new session.
const BLOCKED_STATUS = new Set([401, 403, 429]);

/**
 * Detect an anti-bot / temporary-block response (e.g. DHgate's "Access Denied" page or a 5xx).
 * Returns true when the request should be retried rather than recorded as a result.
 */
function isBlocked($: Cheerio$, status: number | undefined): boolean {
    if (status !== undefined && (BLOCKED_STATUS.has(status) || status >= 500)) return true;
    const title = $('title').first().text().trim().toLowerCase();
    return title === 'access denied' || title.includes('access denied');
}

router.addHandler(LABELS.PRODUCT, async ({ $, body, request, response, log, pushData }) => {
    const status = response?.statusCode;

    // Removed / non-existent product → dead, do not retry.
    if (status !== undefined && DEAD_STATUS.has(status)) {
        log.info(`${request.url} → active=false | reason=http_${status} (HTTP ${status})`);
        await pushData({ url: request.url, active: false, reason: `http_${status}`, checkedAt: new Date().toISOString() });
        return;
    }

    if (isBlocked($, status)) {
        throw new Error(`Likely blocked (status=${status}) — retry with new session`);
    }

    // The product data is embedded as escaped JSON inside the HTML (e.g. `istate\":true`),
    // so unescape quotes before matching markers.
    const raw = (typeof body === 'string' ? body : body.toString('utf8')).replace(/\\"/g, '"');

    // DHgate sometimes serves a soft "This item doesn't exist" page with HTTP 200 instead of 410
    // (its error pages use the `pcen.error.*` tracking namespace). Treat those as removed.
    const isErrorPage = raw.includes('pcen.error') || /item\s+doesn.{0,8}t\s+exist/i.test(raw);
    const hasProduct = raw.includes('"istate"');
    // A live page that explicitly marks the item offline still counts as not active.
    const isOffline = raw.includes('"istate":false');
    const active = !isErrorPage && hasProduct && !isOffline;

    let reason: string;
    if (isErrorPage) reason = 'error_page'; // soft "item doesn't exist" served as 200
    else if (!hasProduct) reason = 'no_product_data'; // page rendered but no product payload
    else if (isOffline) reason = 'offline'; // istate=false → delisted/offline
    else reason = 'live';

    log.info(`${request.url} → active=${active} | reason=${reason} (HTTP ${status})`);
    await pushData({ url: request.url, active, reason, checkedAt: new Date().toISOString() });
});

router.addHandler(LABELS.SELLER, async ({ $, request, response, log, pushData }) => {
    const status = response?.statusCode;

    // Non-existent store → dead, do not retry.
    if (status !== undefined && DEAD_STATUS.has(status)) {
        log.info(`${request.url} → active=false | reason=http_${status} (HTTP ${status})`);
        await pushData({ url: request.url, active: false, reason: `http_${status}`, checkedAt: new Date().toISOString() });
        return;
    }

    if (isBlocked($, status)) {
        throw new Error(`Likely blocked (status=${status}) — retry with new session`);
    }

    const active = $('.store-head-warp, .storeinfo, .storelogo').length > 0;
    const reason = active ? 'live' : 'no_store_dom'; // 200 but store header markers missing

    log.info(`${request.url} → active=${active} | reason=${reason} (HTTP ${status})`);
    await pushData({ url: request.url, active, reason, checkedAt: new Date().toISOString() });
});
