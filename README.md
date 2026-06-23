# DHgate Status Checker

**DHgate Status Checker** tells you whether a **DHgate product listing or store is still active (live) or has been removed**. Give it a list of [DHgate](https://www.dhgate.com) product or store URLs and it returns a clean `active: true/false` flag for each one, with the exact time it was checked. It runs on the [Apify platform](https://apify.com), so you get API access, scheduling, integrations, and run monitoring out of the box.

The Actor uses fast HTTP requests (no headless browser), so it's cheap and quick even when checking thousands of URLs.

## Why use DHgate Status Checker?

- **Catalog hygiene** — find dead product links in your feeds, affiliate pages, or price comparison sites.
- **Seller monitoring** — get alerted when a store you rely on disappears or is taken down.
- **Brand protection** — track whether reported counterfeit listings or stores have actually been removed.
- **Automation** — schedule recurring checks and pipe results into Slack, Google Sheets, or your database via the Apify API and integrations.

## How to use DHgate Status Checker

1. Open the Actor and go to the **Input** tab.
2. Paste one or more DHgate URLs into **Start URLs** (all of the same type).
3. Set **Mode** to **Product** or **Seller / Store** to match those URLs.
4. Click **Start** and read the results in the **Output** tab when the run finishes.

## Input

| Field | Type | Description |
| --- | --- | --- |
| `startUrls` | array | DHgate product or store URLs to check. **Required.** |
| `mode` | string | `product` or `seller` — applied to every URL in the run. Default `product`. **Required.** |
| `maxConcurrency` | integer | Max URLs checked in parallel. Default `10`. |
| `maxRequestsPerCrawl` | integer | Safety cap on total requests including retries. Default `100`. |
| `proxyConfiguration` | object | Optional proxy. DHgate usually works without one. |

Example input:

```json
{
    "startUrls": [
        { "url": "https://www.dhgate.com/product/men-s-polos-luxury-brand-short-sleeve-polo/1064214730.html" }
    ],
    "mode": "product"
}
```

## Output

Each checked URL produces one dataset item. You can download the dataset in various formats such as JSON, HTML, CSV, or Excel.

```json
[
    {
        "url": "https://www.dhgate.com/product/men-s-polos-luxury-brand-short-sleeve-polo/1064214730.html",
        "active": true,
        "reason": "live",
        "checkedAt": "2026-06-23T08:49:47.447Z"
    },
    {
        "url": "https://www.dhgate.com/store/top-selling/99999999.html",
        "active": false,
        "reason": "http_404",
        "checkedAt": "2026-06-23T08:49:47.901Z"
    }
]
```

### Data fields

| Field | Type | Description |
| --- | --- | --- |
| `url` | string | The URL that was checked. |
| `active` | boolean | `true` if the listing/store is live; `false` if removed or marked offline. |
| `reason` | string | Why that verdict was reached (see below). |
| `checkedAt` | string | ISO 8601 timestamp of when the check ran. |

### Reason values

| Reason | Active | Meaning |
| --- | --- | --- |
| `live` | true | Product/store page rendered normally. |
| `http_410` | false | Product removed (HTTP 410). |
| `http_404` | false | Store / product not found (HTTP 404). |
| `error_page` | false | Soft "This item doesn't exist" page served with HTTP 200. |
| `offline` | false | Product page marks the item offline / delisted. |
| `no_product_data` | false | HTTP 200 but no product payload found. |
| `no_store_dom` | false | HTTP 200 but store header markers missing. |

## How status is determined

- **Product** — `active: false` when DHgate returns HTTP **410** (removed) or the page is explicitly marked offline; otherwise `active: true`.
- **Seller / store** — `active: false` when DHgate returns HTTP **404**; otherwise `active: true` when the store page renders.
- If DHgate temporarily blocks a request (an "Access Denied" page or 5xx), the Actor retries with a fresh session instead of reporting a false result.

## Cost estimation

Each check is a single lightweight HTTP request, so costs are minimal — typically a few cents per thousand URLs in compute units, with no proxy required by default. Use the **Auto** mode and a reasonable `maxConcurrency` to keep runs fast and cheap. The Apify free tier is enough to test it.

## FAQ, disclaimers, and support

- **Does it need a proxy?** No. DHgate normally responds to plain HTTP requests. Enable a proxy only if you start seeing blocks.
- **Is scraping DHgate legal?** This Actor only reads publicly available status information (whether a page exists). You are responsible for complying with DHgate's Terms of Service and applicable laws in your jurisdiction.
- **A live-but-sold-out product** is still reported as `active: true` because the listing exists.
- **Feedback / bugs:** open an issue on the Actor's **Issues** tab. Custom variations (extra fields, alerts) can be built on request.
