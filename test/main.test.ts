import { CheerioCrawler, purgeDefaultStorages } from '@crawlee/cheerio';
import { beforeAll, describe, expect, it } from 'vitest';

import { LABELS, router } from '../src/routes.js';

describe('DHgate status checker', () => {
    beforeAll(async () => {
        await purgeDefaultStorages();
    });

    it('marks a non-existent store as inactive (HTTP 404)', async () => {
        const crawler = new CheerioCrawler({
            maxRequestsPerCrawl: 5,
            requestHandler: router,
        });

        await crawler.run([
            { url: 'https://www.dhgate.com/store/top-selling/99999999.html', label: LABELS.SELLER },
        ]);

        const { items } = await crawler.getData();
        const result = items.find((i) => i.url.includes('99999999'));
        expect(result).toBeDefined();
        expect(result?.active).toBe(false);
        expect(result?.checkedAt).toBeDefined();
    }, 60_000);

    it('marks a removed product as inactive (HTTP 410)', async () => {
        const crawler = new CheerioCrawler({
            maxRequestsPerCrawl: 5,
            requestHandler: router,
        });

        await crawler.run([
            { url: 'https://www.dhgate.com/product/fake-removed/9999999999.html', label: LABELS.PRODUCT },
        ]);

        const { items } = await crawler.getData();
        const result = items.find((i) => i.url.includes('9999999999'));
        expect(result).toBeDefined();
        expect(result?.active).toBe(false);
        expect(result?.checkedAt).toBeDefined();
    }, 60_000);
});
