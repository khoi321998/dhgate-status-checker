import { createPlaywrightRouter } from '@crawlee/playwright';

import { handleProduct } from './handlers/product.js';
import { handleSeller } from './handlers/seller.js';

/** Request labels used to route each URL to the correct handler. */
export const LABELS = {
    PRODUCT: 'product',
    SELLER: 'seller',
} as const;

/** The router: one handler per page kind, both of which push exactly one status row. */
export function createRouter() {
    const router = createPlaywrightRouter();

    router.addHandler(LABELS.PRODUCT, handleProduct);
    router.addHandler(LABELS.SELLER, handleSeller);

    return router;
}
