# G4A — Frontend Shared Filter State + Feature Registry

## Goal

建立可跨页面复用的 BI 页面上下文，统一承载日期、国家、SID、店铺、负责人、币种和产品标识（MSKU、ASIN、SKU），并让每个页面显式声明自己支持和转发哪些筛选字段。共享上下文先服务于 URL 深链接和后续 G4B 跨看板联动，不改变后端数据口径。

## Scope

本阶段包含：

- 一个纯前端共享筛选状态模块，提供规范化、URL 编解码、合并和可订阅状态存储。
- 一个 feature registry，区分页面可理解的上下文字段和当前 API 请求实际转发的字段。
- 销售看板、销售壳层和店铺经营月报接入同一个状态存储；现有 API 查询只转发各自明确声明的字段。
- 未被页面支持或未被 API 转发的字段必须通过返回值显式报告，不能静默丢弃。

本阶段不包含：

- G4B 点击 MSKU 后跨库存、广告、售后页面的导航联动。
- Sales Facts、Inventory SQLite、缓存 TTL、后端路由或数据库改动。
- 新 CSS 或窄屏测试。

## Canonical state

```js
{
  date: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" },
  country: ["美国"],
  sid: ["8708"],
  store: ["xiamentanjia-US"],
  owner: ["负责人"],
  currency: "CNY",
  msku: ["listing-msku"],
  asin: ["B000000000"],
  sku: ["ERP-SKU"]
}
```

Lists are trimmed, de-duplicated and serialized in a stable order. Empty values are omitted from the URL. SID values are normalized to positive integer strings. Currency is normalized to uppercase. Recognized malformed values raise a controlled `SharedFilterStateError`.

## URL contract

The shared URL keys remain compatible with the current page and API vocabulary:

| State field | URL key |
| --- | --- |
| `date.start` / `date.end` | `startDate` / `endDate` |
| `country` | repeated `countries` |
| `sid` | comma-separated `sids` |
| `store` | repeated `stores` |
| `owner` | repeated `listingOwner` |
| `currency` | `currencyCode` |
| `msku` / `asin` / `sku` | same-named repeated keys |

The state store replaces only these canonical keys and preserves unrelated query parameters. It uses `history.replaceState`, so filter changes are shareable without a full page reload.

## Feature registry

Each feature definition has:

- `supportedFilters`: fields the page can understand as page context.
- `queryFilters`: fields its current API contract is allowed to receive.

The initial definitions are:

- `sales-dashboard`: context supports date, country, SID, store, owner, currency and MSKU; the current weekly API query forwards date, SID, owner and currency.
- `store-operating-monthly-report`: context supports date, country, SID, store and currency; the monthly report query forwards date, country, store and currency.

Projecting a state for a feature returns the omitted fields explicitly. Strict context validation throws when a non-empty field is not supported.

## Integration boundaries

- `assets/js/shared-filter-state.js` owns state and URL semantics.
- `assets/js/feature-registry.js` owns feature capabilities and projection diagnostics.
- `assets/js/sales-shell.js`, `assets/js/front-shop-filters.js` and `assets/js/features/store-operating-monthly-report.js` only read/write the injected shared store; they retain their existing feature-specific rendering and API logic.
- `app.js` creates the shared store and registry and passes them into feature factories. It does not own feature-specific filter state machines.

## Verification

- Unit tests cover malformed input, stable URL round trips, unknown query preservation, registry validation and explicit omitted-field diagnostics.
- Existing full Node tests, JS checks and generated CSS checks must remain green.
- Desktop browser verification covers sales and monthly-report URL state hydration and filter changes. No narrow/mobile viewport test is run.
