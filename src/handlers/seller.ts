import type { PlaywrightCrawlingContext } from '@crawlee/playwright';

import { decideSeller, detectBlocked, readSellerFacts } from '../check.js';
import { statusItem } from '../output.js';
import { effectiveStatus } from '../utils/cloudflare.js';
import { extractSellerId } from '../utils/parse.js';
import { reportedUrl } from '../utils/request.js';

/**
 * Check one DHGate seller/store page.
 *
 * The store header is the whole test: it is server-rendered on every store tab and carried by no
 * error page, so its presence is what tells a live store from a closed one. See `check.ts`.
 */
export async function handleSeller(ctx: PlaywrightCrawlingContext): Promise<void> {
    const { request, page, log, pushData } = ctx;
    const url = request.loadedUrl ?? request.url;
    // What the row reports: the caller's original URL, not our normalized rewrite of it.
    const outUrl = reportedUrl(request);

    // See handlers/product.ts — the recorded status belongs to the challenge, not to this document.
    const status = effectiveStatus(request, ctx.response?.status());

    // DHGate answers a browser with 502 where its CDN answers curl with a clean 404, so a 5xx says
    // nothing about the store. Throw rather than push: Crawlee retries on a new session.
    const blocked = await detectBlocked(page, status);
    if (blocked) throw new Error(`${blocked} for ${url} — retrying with a new session`);

    const facts = await readSellerFacts(page);
    const verdict = decideSeller(facts, { status, url });

    if (verdict.active === null) {
        throw new Error(`could not tell whether ${url} is live (${verdict.reason}) — retrying with a new session`);
    }

    log.info(
        `[seller] ${outUrl} → active=${verdict.active} | reason=${verdict.reason} ` +
            `(HTTP ${status ?? 'unknown'}) ${verdict.title ? `| ${verdict.title}` : ''}`,
    );

    await pushData(
        statusItem(outUrl, 'seller', {
            id: extractSellerId(url),
            active: verdict.active,
            reason: verdict.reason,
            title: verdict.title,
            httpStatus: status ?? null,
        }),
    );
}
