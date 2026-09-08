import { Actor } from 'apify';

/** What kind of page a URL was checked as. */
export type CheckMode = 'product' | 'seller';

/** One dataset item: the status of a single checked product/store URL. */
export interface StatusItem {
    url: string;
    mode: CheckMode;
    /** The DHGate product/store id parsed off the URL, when it has one. */
    id: string | null;
    /**
     * `true` the listing/store is still up, `false` it is gone, `null` we could not tell — the page
     * never loaded through Cloudflare. `null` is deliberate: reporting "gone" for a page we never
     * saw would turn an anti-bot problem into a false takedown report.
     */
    active: boolean | null;
    /** Why {@link active} is what it is — see `check.ts` for the full list. */
    reason: string;
    /** The product heading / store name we read, when there was one. Handy for eyeballing a run. */
    title: string | null;
    /** The status of the navigation, or `null` when a Cloudflare challenge hid the real one. */
    httpStatus: number | null;
    /** Only set when `active` is `null`: the last error that stopped the check. */
    error: string | null;
    checkedAt: string;
    /** Apify run that produced this item; null when running outside the platform. */
    actorRunId: string | null;
}

/**
 * Apify run ID of the current run, or null when running locally.
 * Read on every call (never cached) so it reflects the actual runtime environment.
 * This is the only place `Actor.getEnv()` is read for the run ID.
 */
export function currentActorRunId(): string | null {
    return Actor.getEnv().actorRunId ?? null;
}

/** A fully-defaulted row, so every push has the same shape whatever path built it. */
export function statusItem(url: string, mode: CheckMode, fields: Partial<StatusItem> = {}): StatusItem {
    return {
        url,
        mode,
        id: null,
        active: null,
        reason: 'unknown',
        title: null,
        httpStatus: null,
        error: null,
        checkedAt: new Date().toISOString(),
        actorRunId: currentActorRunId(),
        ...fields,
    };
}
