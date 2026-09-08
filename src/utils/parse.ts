/**
 * URL handling shared with the DHGate data scraper — the same normalization, so both Actors see
 * DHGate through the same door. Only the pieces a status check needs are kept.
 */

/** Pull the DHGate product id out of a product URL, e.g. ".../1064214730.html?..." -> "1064214730". */
export function extractProductId(url: string): string | null {
    const match = url.match(/\/(\d+)\.html/);
    return match ? match[1] : null;
}

/** Pull the DHGate seller/store id out of a store URL, e.g. ".../store/top-selling/21880856.html" -> "21880856". */
export function extractSellerId(url: string | null | undefined): string | null {
    if (!url) return null;
    const match = url.match(/\/(\d+)\.html/);
    return match ? match[1] : null;
}

/**
 * DHGate's regional hosts, taken from the `hreflang` alternates the product pages emit.
 * The subdomain selects the *language*; the ship-to country is a separate cookie, which is
 * why we can normalize the host to `www` (English markup) and still keep the regional
 * commercial context by shipping the matching country in `b2b_ship_country`.
 *
 * `ar` is deliberately absent: it selects Arabic, which maps to no single country.
 * Anything unlisted falls back to {@link DEFAULT_SHIP_COUNTRY}.
 */
const SHIP_COUNTRY_BY_SUBDOMAIN: Record<string, string> = {
    de: 'DE',
    es: 'ES',
    fr: 'FR',
    ie: 'IE',
    it: 'IT',
    jp: 'JP',
    kr: 'KR',
    nl: 'NL',
    pl: 'PL',
    pt: 'PT',
    ru: 'RU',
    se: 'SE',
    tr: 'TR',
};

/** Ship-to country used for `www`, the mobile host, and any unrecognized subdomain. */
export const DEFAULT_SHIP_COUNTRY = 'US';

/**
 * Derive the ship-to country from a DHGate URL's subdomain, e.g.
 * `https://es.dhgate.com/...` -> `"ES"`. Falls back to {@link DEFAULT_SHIP_COUNTRY} for
 * `www`, `m`, Arabic, non-DHGate hosts, and unparseable input.
 *
 * Call this BEFORE {@link normalizeDhgateHost} — normalizing destroys the subdomain.
 */
export function extractDhgateShipCountry(url: string): string {
    try {
        const { hostname } = new URL(url);
        if (!/(^|\.)dhgate\.com$/i.test(hostname)) return DEFAULT_SHIP_COUNTRY;
        const [subdomain] = hostname.toLowerCase().split('.');
        return SHIP_COUNTRY_BY_SUBDOMAIN[subdomain] ?? DEFAULT_SHIP_COUNTRY;
    } catch {
        return DEFAULT_SHIP_COUNTRY;
    }
}

/**
 * Force a DHGate URL onto the canonical `www` host.
 *
 * Regional subdomains (`es.`, `fr.`, `de.`, …) serve the same product under the same id, but:
 * - they render in the local language, and the `language=en` cookie does NOT override the
 *   subdomain — so the English-keyed checks would silently read empty/wrong values;
 * - they sit behind their own Cloudflare challenge (clearance is per hostname).
 *
 * The regional context is not lost: {@link extractDhgateShipCountry} turns the subdomain into
 * a ship-to country, which the caller applies as a cookie.
 *
 * Non-DHGate or unparseable URLs are returned unchanged.
 */
export function normalizeDhgateHost(url: string): string {
    try {
        const parsed = new URL(url);
        if (!/(^|\.)dhgate\.com$/i.test(parsed.hostname)) return url;
        if (parsed.hostname.toLowerCase() === 'www.dhgate.com') return url;
        parsed.hostname = 'www.dhgate.com';
        return parsed.toString();
    } catch {
        return url;
    }
}
