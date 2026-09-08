import { describe, expect, it } from 'vitest';

import type { ProductFacts, SellerFacts } from '../src/check.js';
import { decideProduct, decideSeller } from '../src/check.js';
import { extractDhgateShipCountry, normalizeDhgateHost } from '../src/utils/parse.js';

/**
 * The verdict logic is tested on its own, without a browser.
 *
 * The old tests drove a live CheerioCrawler at DHgate, which is exactly what stopped working when
 * Cloudflare went up: they now measure the anti-bot stack, not the decision. Reading the page and
 * judging it are separate (see src/check.ts), so every outcome this Actor can reach is reachable
 * here from a plain object — including the ones a live test can never reproduce on demand, like a
 * delisted item or a store whose header vanished.
 */

const PRODUCT_URL = 'https://www.dhgate.com/product/men-s-polos-luxury-brand/1064214730.html';
const SELLER_URL = 'https://www.dhgate.com/store/top-selling/21880856.html';

function productFacts(overrides: Partial<ProductFacts> = {}): ProductFacts {
    return {
        documentTitle: 'Men\'s Polos | DHgate',
        nextError: false,
        softError: false,
        offline: false,
        hasProductData: true,
        heading: 'Luxury Brand Short Sleeve Polo',
        ...overrides,
    };
}

function sellerFacts(overrides: Partial<SellerFacts> = {}): SellerFacts {
    return {
        documentTitle: 'LuggageStride Store | DHgate',
        hasStoreHeader: true,
        storeName: 'LuggageStride',
        ...overrides,
    };
}

describe('decideProduct', () => {
    it('marks a product with a heading as live', () => {
        const verdict = decideProduct(productFacts(), { status: 200, url: PRODUCT_URL });
        expect(verdict).toEqual({ active: true, reason: 'live', title: 'Luxury Brand Short Sleeve Polo' });
    });

    it('trusts the DOM when Cloudflare hid the real status', () => {
        // `effectiveStatus` returns undefined after a passed challenge — the recorded 403 belongs
        // to the interstitial, not to the product page now on screen.
        expect(decideProduct(productFacts(), { url: PRODUCT_URL }).active).toBe(true);
    });

    it('marks a removed product as inactive (HTTP 410)', () => {
        const verdict = decideProduct(productFacts({ heading: null, hasProductData: false }), {
            status: 410,
            url: PRODUCT_URL,
        });
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toBe('http_410');
    });

    it('marks the Next.js 404 tree as inactive even on HTTP 200', () => {
        const verdict = decideProduct(
            productFacts({ nextError: true, heading: null, hasProductData: false, documentTitle: '404: This page could not be found.' }),
            { status: 200, url: PRODUCT_URL },
        );
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toBe('error_page_404');
    });

    it("marks DHgate's soft \"item doesn't exist\" page as inactive", () => {
        const verdict = decideProduct(productFacts({ softError: true, heading: null }), {
            status: 200,
            url: PRODUCT_URL,
        });
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toBe('error_page');
    });

    it('marks a delisted item as inactive even though the page renders', () => {
        const verdict = decideProduct(productFacts({ offline: true }), { status: 200, url: PRODUCT_URL });
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toBe('offline');
    });

    it('keeps a product live when only the heading failed to render', () => {
        const verdict = decideProduct(productFacts({ heading: null }), { status: 200, url: PRODUCT_URL });
        expect(verdict.active).toBe(true);
        expect(verdict.reason).toBe('live_no_title');
    });

    it('refuses to guess when the page carries no markers at all', () => {
        const verdict = decideProduct(productFacts({ heading: null, hasProductData: false }), {
            status: 200,
            url: PRODUCT_URL,
        });
        expect(verdict.active).toBeNull();
        expect(verdict.reason).toBe('no_product_markers');
    });

    it('rejects a URL that is not a product page', () => {
        const verdict = decideProduct(productFacts(), { status: 200, url: SELLER_URL });
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toBe('not_a_product_url');
    });
});

describe('decideSeller', () => {
    it('marks a store with its header as live', () => {
        const verdict = decideSeller(sellerFacts(), { status: 200, url: SELLER_URL });
        expect(verdict).toEqual({ active: true, reason: 'live', title: 'LuggageStride' });
    });

    it('marks a non-existent store as inactive (HTTP 404)', () => {
        const verdict = decideSeller(sellerFacts({ hasStoreHeader: false, storeName: null }), {
            status: 404,
            url: SELLER_URL,
        });
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toBe('http_404');
    });

    it('marks a store page without a header as inactive', () => {
        const verdict = decideSeller(sellerFacts({ hasStoreHeader: false, storeName: null }), {
            status: 200,
            url: SELLER_URL,
        });
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toBe('no_store_header');
    });

    it('rejects a URL that is not a store page', () => {
        const verdict = decideSeller(sellerFacts(), { status: 200, url: PRODUCT_URL });
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toBe('not_a_seller_url');
    });
});

describe('regional URLs', () => {
    it('checks a regional URL on www while keeping its ship-to country', () => {
        const url = 'https://es.dhgate.com/product/men-s-polos/1064214730.html';
        expect(normalizeDhgateHost(url)).toBe('https://www.dhgate.com/product/men-s-polos/1064214730.html');
        expect(extractDhgateShipCountry(url)).toBe('ES');
    });

    it('leaves www URLs alone and ships to US by default', () => {
        expect(normalizeDhgateHost(PRODUCT_URL)).toBe(PRODUCT_URL);
        expect(extractDhgateShipCountry(PRODUCT_URL)).toBe('US');
    });
});
