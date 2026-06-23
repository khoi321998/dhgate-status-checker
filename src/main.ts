// For more information, see https://crawlee.dev
import { setTimeout } from 'node:timers/promises';

import { CheerioCrawler } from '@crawlee/cheerio';
// For more information, see https://docs.apify.com/sdk/js
import { Actor, log } from 'apify';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import { LABELS, router } from './routes.js';

type Mode = 'product' | 'seller';

interface Input {
    startUrls: { url: string }[];
    mode: Mode;
    maxConcurrency: number;
    maxRequestsPerCrawl: number;
    proxyConfiguration?: { useApifyProxy?: boolean; [key: string]: unknown };
}

// Initialize the Apify SDK
await Actor.init();

// Structure of input is defined in input_schema.json
const {
    startUrls = [],
    mode = 'product',
    maxConcurrency = 10,
    maxRequestsPerCrawl = 100,
    proxyConfiguration: proxyInput,
} = (await Actor.getInput<Input>()) ?? ({} as Input);

if (!startUrls.length) {
    log.warning('No startUrls provided, exiting.');
    await Actor.exit();
}

// Every URL in a run is checked with the same mode (product or seller).
const label = mode === 'seller' ? LABELS.SELLER : LABELS.PRODUCT;
const startRequests = startUrls.map(({ url }) => ({ url: url.trim(), label }));

// Only create a proxy configuration when the user explicitly enabled it.
const proxyConfiguration = proxyInput?.useApifyProxy
    ? await Actor.createProxyConfiguration(proxyInput)
    : undefined;

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency,
    maxRequestsPerCrawl,
    maxRequestRetries: 3,
    useSessionPool: true,
    persistCookiesPerSession: true,
    requestHandler: router,
    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                ...(request.headers ?? {}),
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Upgrade-Insecure-Requests': '1',
            };
        },
    ],
});

// Gracefully shut down when the Actor is aborted to minimize cost.
Actor.on('aborting', async () => {
    await setTimeout(1000);
    await Actor.exit();
});

await crawler.run(startRequests);

// Exit successfully
await Actor.exit();
