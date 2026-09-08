import type { PlaywrightCrawlingContext } from '@crawlee/playwright';

import { decideProduct, detectBlocked, readProductFacts } from '../check.js';
import { statusItem } from '../output.js';
import { effectiveStatus } from '../utils/cloudflare.js';
import { extractProductId } from '../utils/parse.js';
import { reportedUrl } from '../utils/request.js';

/**
 * Check one DHGate product listing.
 *
 * Nothing is scraped beyond what the verdict needs: the product heading, the error markers, and the
 * `istate` flag. See `check.ts` for how those turn into `active`.
 */
export async function handleProduct(ctx: PlaywrightCrawlingContext): Promise<void> {
    const { request, page, log, pushData } = ctx;
    const url = request.loadedUrl ?? request.url;
    // What the row reports: the caller's original URL, not our normalized rewrite of it.
    const outUrl = reportedUrl(request);

    // The status that describes the DOM we are about to read — which is not `ctx.response`'s when
    // a Cloudflare challenge stood in front of it and then handed us the real page. See
    // utils/cloudflare.ts.
    const status = effectiveStatus(request, ctx.response?.status());

    // Refusals first: an anti-bot interstitial or a 5xx says nothing about the listing, so throw
    // and let Crawlee retry on a new session rather than record an error page as a dead product.
    const blocked = await detectBlocked(page, status);
    if (blocked) throw new Error(`${blocked} for ${url} — retrying with a new session`);

    const facts = await readProductFacts(page);
    const verdict = decideProduct(facts, { status, url });

    // A page that says nothing either way is not evidence of a takedown: retry it, and if every
    // attempt lands here the failedRequestHandler records `active: null` rather than a guess.
    if (verdict.active === null) {
        throw new Error(`could not tell whether ${url} is live (${verdict.reason}) — retrying with a new session`);
    }

    log.info(
        `[product] ${outUrl} → active=${verdict.active} | reason=${verdict.reason} ` +
            `(HTTP ${status ?? 'unknown'}) ${verdict.title ? `| ${verdict.title}` : ''}`,
    );

    await pushData(
        statusItem(outUrl, 'product', {
            id: extractProductId(url),
            active: verdict.active,
            reason: verdict.reason,
            title: verdict.title,
            httpStatus: status ?? null,
        }),
    );
}
