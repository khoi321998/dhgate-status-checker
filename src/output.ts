import { Actor } from 'apify';

/** One dataset item: the status of a single checked product/seller URL. */
export interface StatusItem {
    url: string;
    active: boolean;
    reason: string;
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
