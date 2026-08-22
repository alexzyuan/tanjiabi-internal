# Repository UI Rules

## Default Design System

Adobe React Spectrum is the default design system for all new UI work in this repository.

Official sources:

- Repository: https://github.com/adobe/react-spectrum
- Documentation: https://react-spectrum.adobe.com/

Follow these rules:

1. Use Spectrum interaction, accessibility, spacing, typography, state and responsive behavior as the default.
2. Preserve established product-specific layout decisions documented in `design.md`.
3. The current frontend is native HTML, CSS and JavaScript. Use the semantic tokens and native component mappings in `design.md`; do not add isolated React islands.
4. If the frontend is migrated to React, use `@adobe/react-spectrum` with a root `Provider` and `defaultTheme`.
5. Prefer semantic controls, visible labels, keyboard access and `:focus-visible` states. Do not replace accessible native controls with non-semantic `div` interactions.
6. New colors, spacing, radii and control sizes must use the semantic tokens documented in `design.md` and implemented in `styles.css` instead of one-off literals.
7. Do not copy source code or private implementation details from the React Spectrum repository. Use the public package and documented APIs.

## Structure And Module Boundaries

This project is a native HTML/CSS/JS application. The frontend has been partially split out of the former `app.js` monolith into focused ES modules under `assets/js/*` and `assets/js/features/*`. New work must preserve that direction and must not move feature-specific logic back into `app.js`.

Before implementing any non-trivial feature or UI change, write down the intended structure in the working notes or response:

1. Which view, service, adapter, mapper, or UI utility owns the change.
2. Which existing function or CSS block will be extended.
3. Whether a reusable helper/component/token is needed.
4. Which files should not be touched.
5. How the change will be verified.

Default ownership:

- View markup stays in `index.html` until a planned frontend split is approved.
- `app.js` is the bootstrap/composition layer. It may wire shared dependencies and feature factories, but should not receive new feature-specific state machines, renderers, API loaders, or event binding blocks.
- Feature-specific frontend state, event binding, API loading and rendering stay in focused modules under `assets/js/features/*`.
- Shared frontend utilities stay in `assets/js/*` files such as `ui-utils.js`, `dashboard-loader.js`, `filter-controls.js`, `navigation-utils.js`, `sales-shell.js`, `table-sorter.js`, `date-utils.js`, `file-utils.js`, `image-url.js` and `fba-utils.js`.
- Shared formatting, parsing, table sorting and filter helpers must stay generic and not include feature-specific business rules.
- Visual rules stay in generated `styles.css` using Spectrum or project semantic tokens.
- The single CSS target is generated `styles.css` from `assets/css/*`. Do not hand-edit `styles.css`; edit layered source files under `assets/css/*`, run `npm run build:css`, and verify rendered screenshots for shell, sidebar, topbar, filters, tables, and modal changes.
- Do not append one-off rules to `styles.css`.
- API routing and auth stay in `server.js`.
- External API calls stay in `src/adapters/*`.
- Business composition stays in `src/services/*`.
- Field-name translation and metric mapping stay in mapper files such as `src/services/lingxingDashboardMapper.js`.

## Deployment Guard

Production deploys are package-based, so the deployment source branch must be guarded before the archive reaches the server.

1. Generate deploy packages only from a clean, committed worktree.
2. The current production branch is `main` unless the operator explicitly sets `PRODUCTION_DEPLOY_BRANCH`.
3. `scripts/package-deploy.js` must require `DEPLOY_CONFIRM_BRANCH=<current branch>` and write `.deploy-manifest.json` with branch, commit, clean state, CSS mode, and confirmed branch.
4. `deploy.sh` must reject archives without `.deploy-manifest.json`, archives from an unconfirmed branch, or archives whose branch differs from `PRODUCTION_DEPLOY_BRANCH` unless `ALLOW_NON_PRODUCTION_DEPLOY=1` is explicitly set.
5. Do not bypass these guards by hand-copying runtime files into `/opt/tanjia-bi`.
6. Every deployment must SHA-256 snapshot `data-cache/inventory-provision-history` and `data-cache/inventory-ledger-raw` into its release backup before extracting application files. Normal rollback preserves these runtime directories; restoring them requires the explicit `--restore-inventory-provision-cache` rollback flag and a verified snapshot manifest. `INVENTORY_LEDGER_REBUILD_ENABLED` defaults to `false`; do not enable automatic cache-writing rebuilds until a real exported-file dry-run is reviewed.

## BI SQLite Cache Architecture

- Lingxing remains the source of truth. SQLite files are local derived caches, split by domain.
- Stage 1 uses `data-cache/product-catalog/product-catalog-v1.sqlite` with `SID + normalized MSKU` Listing identity and normalized internal-SKU product identity.
- Existing catalog rows never refresh by age. New missing identities may be filled once; updates require an explicit current-page product refresh.
- Product refresh is all-or-nothing, validates runtime seller SID, and never persists raw upstream payloads or credentials.
- Stage 2 `sales-facts.sqlite` is governed by the approved `docs/superpowers/specs/2026-08-13-sales-facts-sqlite-design.md` and is active as an independent project: daily `SID + normalized MSKU + currency mode` OrderProfit facts, monthly custom fees, effective-dated Listing owners, explicit coverage, atomic scope refresh, and revision-aware 12-hour derived caches. It remains separate from the product catalog and inventory snapshots. Runtime sales weekly and monthly report consumers must use this facts service; old sales JSON is never a success fallback.
- Stage 3 `inventory-snapshots.sqlite` remains a later stage and requires its own detailed design before implementation.

Frontend G4A is now an independent layer above these domain caches. `assets/js/shared-filter-state.js` owns the canonical URL-backed page context (`date`, `country`, `sid`, `store`, `owner`, `currency`, `MSKU`, `ASIN`, `SKU`), and `assets/js/feature-registry.js` declares each feature's supported context fields and API query projection. Sales review and the store operating monthly report share this state through `app.js`; fields not forwarded to a feature API are reported by the projection instead of being silently discarded. G4B cross-dashboard drilldown remains a separate follow-up slice.

Operationally, the native `better-sqlite3` dependency is checked with the disposable product-catalog smoke and the full sales-facts WAL/CRUD/commit/rollback/quick-check/integrity smoke immediately after `npm ci`. Each package manifest declares `deployScope=standard` or `sales-facts` and the matching `requiresSalesFactsPreflight` boolean. Deployment always validates the sales-facts schema; only a `sales-facts` scope validates an operator-supplied SHA-256-pinned approved read-only preflight artifact before the deterministic legacy product-catalog migration and PM2 restart, followed by `/api/health` and deployed-integrity checks. An operator may explicitly set `SKIP_SALES_FACTS_PREFLIGHT=1` only for a reviewed `sales-facts` deployment that must bypass the business preflight; this does not bypass package-manifest, branch-confirmation, CSS, SQLite, schema, migration, PM2, health, or deployed-integrity guards. The sales facts database is `data-cache/sales-facts/sales-facts-v1.sqlite`; its WAL/SHM companions remain under `data-cache/` and are excluded from deploy archives while being preserved by rollback. Legacy sales OrderProfit/weekly/monthly JSON remains read-only for reconciliation, and legacy `shared-product-catalog` and `supplier-board-product-map` JSON files remain read-only during the observation period; deleting or rewriting any of them requires a separate cleanup approval.

Legacy product-catalog retirement is a manual two-phase operation. Phase 1 only permits `--dry-run` and creation of a verified archive outside the application directory. It requires 30 stable days, three retained release manifests advertising `product-catalog-sqlite-v1`, healthy SQLite, and an exact migrated manifest match. It must never move or delete the source JSON. Quarantine, restore, purge, archive retention and compatibility-code removal require a later reviewed phase. SQLite/WAL/SHM files, Listing shared XLSX files and every other `data-cache` domain are never retirement targets.

## Inventory Ledger Raw Rebuild

- The formal input for historical inventory-provision quantities and FIFO ages is the complete original Lingxing export file for Amazon `GET_LEDGER_DETAIL_VIEW_DATA`. For every seller scope and source month, create the export task, poll it to a terminal success state, renew its download URL when required, download the binary report, archive it unchanged, verify its SHA-256, then parse it. `/cost/center/ods/detail/query` may be used for diagnosis or reconciliation only; it is never a formal rebuild input or a silent fallback when an export fails.
- The exported reports beginning in `2024-10` must themselves provide the opening ledger event required for FIFO. If the report sequence cannot establish an opening quantity or any outflow overdraws it, fail the entire rebuild; never call the FBA monthly-inventory JSON API, use an old cache, or invent a receipt date to fill the gap. Write target history from `2025-10`, and keep costs in the separate product-management cost-refresh workflow.
- `src/services/inventoryLedgerRawReportService.js` orchestrates export-task lifecycle, strict report parsing, FIFO reconstruction, and all-or-nothing historical-cache replacement. `src/services/inventoryLedgerRawReportStore.js` owns archived report binaries, manifests, job state, SHA-256 verification, and atomic history-directory commits. Do not add binary I/O to `src/utils/cacheStore.js`.
- The scheduler runs after the 10th at `INVENTORY_LEDGER_REBUILD_AT` (default `02:00`, `Asia/Shanghai`) and uses `withJobLock`. Its admin status endpoint is read-only; raw report files must never be exposed as a browser download route.
- Every seller scope must contain the Lingxing `seller_id` and `marketplaceId`; do not infer either from SID, name, or country. A missing scope, export-task creation/poll/download failure, unknown required report field or event, malformed date, report SHA-256 mismatch, FIFO overdraw, or incomplete month coverage must fail the run and leave the prior `inventory-provision-history` directory unchanged. `--dry-run` must perform the same retrieval, parsing, and FIFO validation without archiving or committing.
- Original report binaries and redacted manifests remain in `data-cache/inventory-ledger-raw/<YYYY-MM>/`. A manifest records the report type, task/document identifiers, store scope, region, date range, compression, byte count, SHA-256, download time, and parsing counts, but never access tokens or report contents.

## FBA Logistics API Ordering

The FBA freight workflow now supports direct external logistics API ordering in addition to Excel template export and Lingxing ready-send shipment-order creation.

Rules for this path:

1. Jiufang HTTP details live in `src/adapters/jiufangAdapter.js`; FBA-to-Jiufang payload composition lives in `src/services/jiufangFbaOrderService.js`; persisted Jiufang order state lives in `src/services/jiufangOrderStore.js`.
2. Never hard-code Jiufang login, password, password hash, or token in source code, tests, docs, or UI. Runtime credentials must come from `.env` through `JIUFANG_USERNAME`, `JIUFANG_PASSWORD_MD5`, and `JIUFANG_TOKEN`.
3. The UI must call `/api/fba/jiufang/orders/dry-run` before `/api/fba/jiufang/orders/create`. Real create calls require an explicit `confirmed: true` request body.
4. Store only redacted request/response payloads. Logs may include shipment ID, Jiufang order number, channel code, endpoint, and request status, but must not include token or password hash.
5. Duplicate protection is part of the business rule: do not create a second Jiufang order for a shipment with a stored Jiufang order number unless a future workflow explicitly adds a reviewed force-retry path.
6. Do not call Jiufang real create endpoints during automated tests or exploratory debugging. Use injected adapters/mocks for tests and run a real shipment only after a successful dry-run has been reviewed.
7. FBA shipment MSKU/SKU values can be Amazon listing SKUs. Before building Jiufang declaration data, resolve `seller_sku` through Lingxing `/erp/listing` first and use Listing `local_sku` as the ERP internal SKU for product-management lookup and Jiufang payload SKU fields. A local `data-cache/listing-shared-catalog/*.xlsx` Listing 共享目录 may be read only as a backup when the API result is missing an internal SKU; it is not a frontend upload workflow.
8. Jiufang `/v3/shipment` requires `ShipmentServiceOptions.ChannelCapacity`. Derive it from ERP product declaration `isBattery`: all non-battery SKUs use code `1` (普货), any battery SKU uses code `5` (内置锂离子电池) unless a reviewed workflow adds a more specific battery-type field.
9. Jiufang `/v3/shipment` requires `ShipmentServiceOptions.ExportLicence` for 是否报关. FBA Jiufang orders default this to `false` unless a reviewed customs-declaration workflow explicitly changes it.
10. Jiufang ShipFrom must use the documented fields `CompanyNameCn`, `CompanyNameEn`, `AttentionName`, `Phone`, and `EnterpriseCreditCode`; dry-run must fail before real create if any of these legal sender fields are missing. Store owner, not destination country, determines the legal sender: any runtime-directory store whose name contains `tanjia` (case-insensitive) or the equivalent Chinese display marker `探嘉`, including `xiamentanjia-*` and `tanjia-eu-*`, uses 厦门探嘉网络科技有限公司 / 91350206MAD64HGE0K / English address `Unit 2302-3-2D, No. 56 Chengyi North Street, Phase III Software Park, Xiamen Torch High-tech Zone`; any runtime-directory store whose name contains `tandanbo` or `坦蛋伯` uses 厦门坦蛋伯网络科技有限公司 / 91350206MADNM7UF44 / English address `Unit 2302-3-1D, No. 56 Chengyi North Street, Phase III Software Park, Xiamen Torch High-tech Zone`. This brand rule replaces per-shop legal-sender approval mappings but never creates a runtime shop. STA and other logistics paths must resolve the canonical runtime seller by SID and reject a conflicting supplied name before applying the brand rule. Names containing neither marker must fail explicitly. Jiufang `ShipFrom.AttentionName` is always `justin`. Runtime `.env` values may override company, credit-code, phone, city/province/postal data, but Jiufang ShipFrom address must prefer the dedicated English address fields (`FBA_TANJIA_ADDRESS_LINE1_EN`, `FBA_TANDANBO_ADDRESS_LINE1_EN`) over Chinese legal address fields. Do not infer legal sender data from country or invent unknown store mappings.
11. Jiufang FBA orders must not send an `Importer` object by default, so the website's 进出口委托 section is not filled from BI payload data. Do not copy `ShipFrom` company name or credit code into `Importer` unless a reviewed customs-declaration workflow explicitly requires it.
12. Jiufang invoice rows must use Jiufang-documented field names such as `ShipmentId`, `ReferenceId`, `Sku`, `ProductNameCn`, `ProductNameEn`, `HsCode`, `CustomsClearanceCode`, `PurchasingPrice`, `Num`, `DeclareValue`, `IsCharged`, `ImageUrl`, `PerSuitNum`, and `MeasurementUnit`. Jiufang `DeclareValue` is the declared unit price and must default to fixed value `2` for this FBA workflow. Jiufang package details must use `Sku` and `Num`. Do not send only legacy/local names such as `ShipmentID`, `SKU`, `EnglishName`, `CustomsCode`, `UnitPrice`, `Quantity`, or package-detail `ProductName`.

## 店铺经营月报币种口径

店铺经营月报的币种筛选默认使用 `CNY`（人民币汇总），并通过页面筛选和 API `currencyCode` 显式传递。只有用户明确选择 `ORIGINAL` 且有效范围为单一国家时，才按领星订单利润返回的原币分币种展示；跨国家原币请求必须返回校验错误，不得静默改成其他币种或混合求和。

店铺经营月报的字段树必须严格按已确认的领星订单利润表：基础信息仅有 `店铺/国家`；一级项目固定为 `平台收入`、`平台支出`、`商品成本支出`、`自定义费用`、`利润`。明细顺序和名称唯一以 `src/services/storeOperatingMonthlyReportMapper.js` 的 `METRIC_DEFINITIONS` 为准：平台收入为 `销量`、`平均日销`、`多渠道销量`、`广告销售额`、`广告销量`、`销售额`、`净销售额`、`买家运费`、`促销折扣`、`退款金额`、`退货量`、`退款量`、`FBA库存赔偿`、`其它收入`；在平台收入与平台支出之间固定插入不折叠的结果行 `销售净额`，计算公式为 `净销售额 + 买家运费 - 退款金额 + FBA库存赔偿 + 其它收入`，任一依赖不可用时该行不可用。平台支出为 `平台费`、`FBA发货费`、`其他订单费用`、`仓储费`、`广告费`、`推广费`、`FBA国际物流运费`、`入库配置费`、`调整费`、`平台其它费`。退货率、退款率不作为月报明细行，表格通用 `占比` 列仍保留；商品成本支出为 `采购成本`、`头程成本`、`其它成本`；自定义费用为 `站外推广费`、`办公费用`、`办公费用-租金`、`认证检测费`、`办公用品`、`店铺保险费`、`软件费用`、`产品外观设计费`、`产品平面设计费`、`服务商费用`、`办公费用-快递费`、`办公费用-水电费`、`信用卡广告费`、`办公费用-店铺通讯费`、`样品费`、`送测佣金（刷单）`、`差旅费`、`员工福利费`；利润为 `毛利润`、`毛利率`、`净毛利率`。mapper 负责把领星字段归入这些项目，前端和 Excel 导出不得另行维护一套分类名称。

月报表头直接展示店铺/国家筛选范围，不渲染“基础信息”小计；平台收入小计使用原销售额，其他一级小计按已返回的可用明细汇总。缺失明细仍标记为不可用，不得静默补零。

月报实际值统一以领星 `OrderProfit` 接口 `POST /basicOpen/finance/mreport/OrderProfit` 为主来源；官方文档明确其 `startDate`/`endDate` 为双闭区间，每个自然月传入月初和月末日期，适配器不得追加一天。自定义费用明细来自店铺利润报表 `POST /bd/profit/report/open/report/seller/list` 的 `otherFeeStr[]`，每项读取 `otherFeeName`、`otherFeeTypeId` 和 `feeAllocation` 并按店铺归属合并；`/bd/fee/management/open/feeManagement/otherFee/list` 在该月报口径下返回不完整数据，不得再参与月报汇总。已识别类型映射到月报自定义费用科目，未识别类型必须在日志和 `meta` 中保留，不得静默丢弃。OrderProfit 字段映射固定为：`volume`→销量、`amount`→销售额、`net_amount`→净销售额、`gross_profit`→毛利润、`shipping_cost`→买家运费、`inventory_credit`→FBA库存赔偿、`total_other_granted`→其它收入；`shipping_cost` 不得同时作为头程成本。

## Lingxing Date Ranges

The complete endpoint contract matrix lives in [docs/lingxing-date-rules.md](docs/lingxing-date-rules.md) and the executable registry lives in `src/utils/lingxingDateRange.js`.

- Only endpoints whose official documentation explicitly says `左闭右开` convert the user-facing inclusive end date to the next API day. Current examples are `/erp/sc/data/mws/orders` and `/erp/sc/data/fba_report/shipmentList`.
- Endpoints documented as `闭区间`/`双闭区间`, and endpoints whose documentation does not state the boundary, send the selected end date unchanged. Unknown endpoints use the same no-conversion default.
- Frontend controls, dashboard filters, cache keys, logs, and visible metadata keep the real date selected by the user. For a visible range ending `2026-07-14`, only a registered exclusive endpoint may receive `2026-07-15`.
- Every date-bearing adapter method must call the endpoint-aware shared helper. Do not hand-roll date `+1` logic in feature services, adapters, routes, or frontend code.
- Payable-pool requests must use the documented `start_time`/`end_time` plus `time_field` or `search_field_time` fields; do not reintroduce `created_start_time`/`created_end_time` aliases.

If a change would add a large new feature, prefer adding a focused module under `src/` for backend code and a focused feature module under `assets/js/features/` for frontend code instead of adding an unbounded block to `app.js`.

## Store Inspection Persistence And Mail Parsing

- Store inspection latest/history data is authoritative in `data-cache/store-inspection-state.json` (version 1). The older `store-inspection-latest.json` and `store-inspection-history.json` files are read-only migration sources; malformed, inaccessible, or schema-invalid JSON must fail fast and must never be replaced with defaults.
- All JSON writes use `src/utils/jsonStore.js` atomic writes. A post-rename directory fsync failure is reported as `commitState=unknown`, blocks subsequent writes for that path until an operator reconciles the current file SHA-256, and is exposed through the admin-only `/api/store-inspection/persistence` and `/api/store-inspection/persistence/reconcile` endpoints.
- After-sales and ERP mailbox parsing must reject missing, zero-length, or whitespace-only raw sources with `MAIL_PARSE_FAILED`; callers must not convert parser failures into empty message collections. Logs may include mailbox/account identifiers and UIDs, but never raw message content.

Current frontend module examples:

- Dashboard loaders and common async UI state: `assets/js/dashboard-loader.js`.
- Shared filter dropdowns and grouped multi-selects: `assets/js/filter-controls.js`.
- Navigation and sidebar behavior: `assets/js/navigation-utils.js`, `assets/js/features/sidebar-shell.js`.
- Feature surfaces: `assets/js/features/payables-dashboard.js`, `assets/js/features/supplier-detail.js`, `assets/js/features/knowledge-library.js`, `assets/js/features/fba-automation.js`, and related files.

## Refactor Checkpoints

After each small feature is working, do a local cleanup pass before finishing:

1. Remove duplicated selectors, formatting logic and one-off CSS.
2. Fold patch-only code into the nearest existing helper or feature section.
3. Check that state is initialized once and event listeners are not rebound repeatedly.
4. Check table rendering and filter updates for avoidable full-page work.
5. Keep unrelated refactors out of the task unless they are needed for stability.

When the user asks for repeated detail adjustments in the same area, proactively suggest or perform a scoped cleanup of that feature before adding another patch.

## Design Tokens And Reusable UI

Use `design.md` as the source of truth for UI decisions. For new or changed UI:

1. Reuse existing semantic tokens and component classes first.
2. Add new tokens only when the concept is reusable across pages.
3. Add feature-specific CSS only when it cannot reasonably be expressed as a shared component or token.
4. Prefer improving a shared component class over adding page-only overrides.
5. Document reusable visual patterns in `design.md` when they become part of the product language.
6. When a module banner 后紧跟 .filters 或 .filter-toolbar, use the shared banner-adjacent sticky filter rule in `assets/css/components/30-surfaces-and-filters.css`; do not add page-specific sticky filter rules.

## Shared Table Widths

`assets/js/data-table-manager.js` is the single source of truth for managed BI table column widths.

1. New and existing managed tables must use the shared semantic profiles and first-30-business-row sampling; do not add ordinary page-level `width` or `min-width` rules for business columns.
2. Use stable `data-table-key` and `data-column-key` values when durable business identities exist. Display labels are not persistence keys.
3. User-resized widths have the highest precedence and remain browser-local. Explicit `data-column-width` is allowed only for a reviewed business constraint; shared smart widths are the normal default.
4. When a label is not classified correctly, improve the central profile vocabulary or add semantic `data-column-profile` metadata. Do not patch the page with a fixed pixel width.
5. Selection controls, image columns, numeric values, short organizational names, identifiers, narrative fields, and action controls must retain their shared alignment and width behavior.
6. Layout changes to tables require desktop viewport checks for page-level overflow, table-contained horizontal scrolling, manual-width persistence, and per-table restore behavior. This project does not run narrow/mobile viewport tests.
7. Narrow viewports must keep the document, application shell, dashboard, and view at viewport width. Never use a page-level fixed `min-width` to accommodate a table; the relevant table wrapper owns horizontal scrolling.
8. Shared table presentation belongs in `assets/css/components/45-table-controls.css`: use `.data-table--middle` for whole-table vertical centering and `.data-table-wrap--detail` with `.data-table--detail` for reusable detail-table sticky-header presentation. Do not recreate these in page or legacy CSS.
9. Shared table sort affordances are mandatory for managed BI tables. Plain leaf headers are wrapped by `assets/js/data-table-manager.js` with `.sort-button` and use the generic sorter; feature-owned sort buttons may add `data-msku-sort`, `data-supplier-sort`, or `data-factory-sort`, but must reuse the same `.sort-button` class and shared icon spacing. Do not add page-specific sort icon CSS or active-sort padding overrides.

## Frontend Verification

Before claiming a frontend task is complete, run browser-based verification when the change affects layout, interactions or rendered data. Prefer the in-app browser or Chrome DevTools MCP when available; otherwise use Playwright against a local server.

Minimum checks:

1. The target view renders without console errors.
2. The changed controls can be used with mouse and keyboard.
3. Text does not overlap or overflow at the desktop viewport. Do not run narrow/mobile viewport tests for this project.
4. Relevant requests contain the expected query/body fields.
5. Screenshots or DOM checks confirm the UI state that was changed.

For complex components, create an isolated component preview harness as a temporary local page or route, render only the target component/state, inspect layout and DOM there, then remove the harness before final delivery unless the user asks to keep it.
