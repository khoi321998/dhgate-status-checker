import type { Page } from 'playwright';

import { CHALLENGE_TITLE } from './utils/cloudflare.js';

/**
 * Is the listing/store still there?
 *
 * Reading the page is split from judging it on purpose. {@link readProductFacts} /
 * {@link readSellerFacts} do the DOM work and nothing else; {@link decideProduct} /
 * {@link decideSeller} are pure functions over what they found, so every verdict this Actor can
 * reach is reproducible in a unit test without a browser or a network.
 *
 * Three outcomes, and telling them apart is the whole point:
 *
 * - **gone** (`active: false`) — DHGate answered 404/410, rendered an error page, or served a page
 *   with none of the markers a live listing/store has.
 * - **live** (`active: true`) — the product heading / store header is there.
 * - **unknown** (`active: null`) — the page loaded but carries no evidence either way. The handler
 *   throws on this so Crawlee retries; recording it as "gone" would turn a bad render into a
 *   takedown report.
 *
 * A refusal (anti-bot, 5xx) never reaches these functions at all — see {@link detectBlocked}.
 */

/** The page kinds we can be pointed at, and the URL shape each one must keep. */
const URL_SHAPE = {
    /** `/product/<slug>/<id>.html` */
    product: /\/product\/.*\/\d+\.html/,
    /** `/store/<tab>/<id>.html` — the tab segment varies, `/store/` does not. */
    seller: /\/store\//,
} as const;

/**
 * Statuses that mean the page is gone for good. Verified against live DHGate: an unknown product
 * id returns `410 Gone`, an unknown store id `404` (both 200 when alive).
 */
const GONE_STATUSES = new Set([404, 410]);

/** Statuses that mean "not now" rather than "not ever" — worth another attempt on a new session. */
const BLOCKED_STATUSES = new Set([401, 403, 429]);

/**
 * Detect a refusal: anti-bot (401/403/429, DHGate's "Access Denied" page, or a Cloudflare
 * challenge that never cleared) and 5xx, which DHGate serves to a browser for URLs its CDN answers
 * with a clean 404 — so a 5xx here is not evidence of anything about the item.
 *
 * Pass the status through `effectiveStatus` first. Cloudflare's interstitial *is* a 403, and the
 * real page it hands us afterwards arrives on a navigation Crawlee never records — so the raw
 * `ctx.response` status would condemn a perfectly good product page.
 *
 * Returns the reason, for the caller to throw with; `null` when the response looks usable.
 */
export async function detectBlocked(page: Page, status?: number): Promise<string | null> {
    if (status != null && (BLOCKED_STATUSES.has(status) || status >= 500)) {
        return `DHGate answered HTTP ${status}`;
    }
    const title = await page.title().catch(() => '');
    if (/access denied/i.test(title)) return 'DHGate served its "Access Denied" page';
    // The post-navigation hook already waited this out; still being here means it never cleared.
    if (CHALLENGE_TITLE.test(title)) return 'Cloudflare is still holding us on its challenge page';
    return null;
}

/** A verdict on one URL: is it live, and what said so. */
export interface Verdict {
    active: boolean | null;
    reason: string;
    /** The product heading or store name behind the verdict, when one was read. */
    title: string | null;
}

/** What a product page told us about itself. */
export interface ProductFacts {
    /** `<title>` — a removed listing renders Next.js's `404: This page could not be found.` */
    documentTitle: string;
    /** `<html id="__next_error__">` — the Next.js not-found tree. */
    nextError: boolean;
    /** DHGate's soft error page, served with HTTP 200 and recognizable by its `pcen.error` namespace. */
    softError: boolean;
    /** `"istate":false` in the embedded payload — the listing exists but is delisted/offline. */
    offline: boolean;
    /** `"istate"` at all — this really is a product document, whatever else is missing. */
    hasProductData: boolean;
    /** The product heading, i.e. what a shopper sees as the item's name. */
    heading: string | null;
}

/** What a store page told us about itself. */
export interface SellerFacts {
    documentTitle: string;
    /** The server-rendered store header block, present on every store tab and on no error page. */
    hasStoreHeader: boolean;
    /** `.sto-name` — the store's display name. */
    storeName: string | null;
}

/**
 * How long to wait for the product heading to render.
 *
 * The PDP is a React app: the heading is not in the initial HTML, so a live product that is merely
 * slow looks exactly like a dead one for the first second or two. Long enough to let a slow
 * container hydrate, short enough that a genuinely dead page does not cost a minute — and it only
 * ever runs on a page with no error marker on it, so dead listings skip this wait entirely.
 */
const TITLE_TIMEOUT_MILLIS = millisFromEnv('DHGATE_TITLE_TIMEOUT_MS', 20_000);

/** How long to wait for the store header. The store app is server-rendered, so this is a formality. */
const STORE_HEADER_TIMEOUT_MILLIS = millisFromEnv('DHGATE_STORE_HEADER_TIMEOUT_MS', 10_000);

function millisFromEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read everything a verdict on a product page needs, in one pass.
 *
 * The cheap DOM markers are read first and the heading is only waited for when none of them fired:
 * on a removed listing the heading will never appear, and waiting {@link TITLE_TIMEOUT_MILLIS} for
 * it on every dead URL is the difference between a check that scales and one that does not.
 */
export async function readProductFacts(page: Page): Promise<ProductFacts> {
    const markers = await page
        .evaluate(() => {
            const html = document.documentElement.innerHTML;
            return {
                documentTitle: document.title,
                nextError: document.documentElement.id === '__next_error__',
                softError: html.includes('pcen.error') || /item\s+doesn.{0,8}t\s+exist/i.test(html),
                // The payload is embedded as escaped JSON (`\"istate\":true`), so both spellings
                // have to match — which is why this is a regex rather than an `includes`.
                offline: /istate\\?":\s*false/.test(html),
                hasProductData: /istate\\?":/.test(html),
            };
        })
        .catch(() => null);

    const facts: ProductFacts = {
        documentTitle: markers?.documentTitle ?? '',
        nextError: markers?.nextError ?? false,
        softError: markers?.softError ?? false,
        offline: markers?.offline ?? false,
        hasProductData: markers?.hasProductData ?? false,
        heading: null,
    };

    // Already answered by the markers — nothing a heading could add is worth the wait.
    if (facts.nextError || facts.softError) return facts;

    facts.heading = await readProductHeading(page);
    return facts;
}

/**
 * The product heading, read the same way the data scraper reads it.
 *
 * The wrapper classes are hashed and change between builds, so this targets the stable
 * `data-section` / `itemprop="name"` heading instead. Promotional badges ("Buyers' Picks", …) are
 * nested elements inside the `<h1>` while the real title is a direct text node, so only the direct
 * text nodes are read.
 */
async function readProductHeading(page: Page): Promise<string | null> {
    const locator = page.locator('[data-section="SectionProductTitle"] h1, h1[itemprop="name"]').first();
    await locator.waitFor({ state: 'visible', timeout: TITLE_TIMEOUT_MILLIS }).catch(() => {});
    if ((await locator.count().catch(() => 0)) === 0) return null;

    const title = await locator
        .evaluate((h1) =>
            Array.from(h1.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent ?? '')
                .join('')
                .trim(),
        )
        .catch(() => '');

    if (title) return title;
    return (await locator.textContent().catch(() => null))?.trim() || null;
}

/**
 * Read everything a verdict on a store page needs.
 *
 * The store app is the legacy stack and its error page has changed shape more than once, so the
 * store is judged *present* rather than absent: the header block is server-rendered on every store
 * tab (home, top-selling, about-us) and no error page carries it.
 */
export async function readSellerFacts(page: Page): Promise<SellerFacts> {
    await page
        .locator('.store-head-warp, .storeinfo, .storelogo')
        .first()
        .waitFor({ state: 'attached', timeout: STORE_HEADER_TIMEOUT_MILLIS })
        .catch(() => {});

    const facts = await page
        .evaluate(() => ({
            documentTitle: document.title,
            hasStoreHeader: document.querySelector('.store-head-warp, .storeinfo, .storelogo') != null,
            storeName:
                document.querySelector('.sto-name')?.textContent?.replace(/\s+/g, ' ').trim() ||
                document.querySelector('.sto-name')?.getAttribute('title')?.trim() ||
                null,
        }))
        .catch(() => null);

    return {
        documentTitle: facts?.documentTitle ?? '',
        hasStoreHeader: facts?.hasStoreHeader ?? false,
        storeName: facts?.storeName ?? null,
    };
}

/**
 * Judge a product page. Pure — everything it looks at is in its arguments.
 *
 * `status` is the *effective* status (see utils/cloudflare.ts): `undefined` means a challenge hid
 * the real one, and the DOM decides alone.
 */
export function decideProduct(facts: ProductFacts, { status, url }: { status?: number; url: string }): Verdict {
    const title = facts.heading;

    if (status != null && GONE_STATUSES.has(status)) {
        return { active: false, reason: `http_${status}`, title };
    }
    if (!URL_SHAPE.product.test(url)) {
        return { active: false, reason: 'not_a_product_url', title };
    }
    // Next.js rendered its not-found tree — the listing is gone.
    if (facts.nextError || /^404\b/.test(facts.documentTitle.trim())) {
        return { active: false, reason: 'error_page_404', title };
    }
    // DHGate's own soft "this item doesn't exist" page, served with HTTP 200.
    if (facts.softError) {
        return { active: false, reason: 'error_page', title };
    }
    // The listing still exists but is delisted: `istate` says the item is off.
    if (facts.offline) {
        return { active: false, reason: 'offline', title };
    }
    if (title) {
        return { active: true, reason: 'live', title };
    }
    // A product document that never rendered its heading — slow hydration, not a takedown. Live,
    // but the reason says the evidence was thinner than usual.
    if (facts.hasProductData) {
        return { active: true, reason: 'live_no_title', title };
    }
    // No error page, no product payload, no heading: this page says nothing. Do not guess.
    return { active: null, reason: 'no_product_markers', title };
}

/** Judge a store page. Pure, same contract as {@link decideProduct}. */
export function decideSeller(facts: SellerFacts, { status, url }: { status?: number; url: string }): Verdict {
    const title = facts.storeName;

    if (status != null && GONE_STATUSES.has(status)) {
        return { active: false, reason: `http_${status}`, title };
    }
    if (!URL_SHAPE.seller.test(url)) {
        return { active: false, reason: 'not_a_seller_url', title };
    }
    if (facts.hasStoreHeader) {
        return { active: true, reason: 'live', title };
    }
    // No store header on a `/store/` URL: the store is closed, or DHGate replaced the page with
    // whatever its error template renders this month. Either way it is not a live store.
    return { active: false, reason: 'no_store_header', title };
}
