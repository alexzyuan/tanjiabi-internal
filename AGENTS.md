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
10. Jiufang ShipFrom must use the documented fields `CompanyNameCn`, `CompanyNameEn`, `AttentionName`, `Phone`, and `EnterpriseCreditCode`; dry-run must fail before real create if any of these legal sender fields are missing. Store owner, not destination country, determines the legal sender: any `xiamentanjia*` store uses 厦门探嘉网络科技有限公司 / 91350206MAD64HGE0K / English address `Unit 2302-3-2D, No. 56 Chengyi North Street, Phase III Software Park, Xiamen Torch High-tech Zone`; any `tandanbo*` store uses 厦门坦蛋伯网络科技有限公司 / 91350206MADNM7UF44 / English address `Unit 2302-3-1D, No. 56 Chengyi North Street, Phase III Software Park, Xiamen Torch High-tech Zone`. Jiufang `ShipFrom.AttentionName` is always `justin`. Runtime `.env` values may override company, credit-code, phone, city/province/postal data, but Jiufang ShipFrom address must prefer the dedicated English address fields (`FBA_TANJIA_ADDRESS_LINE1_EN`, `FBA_TANDANBO_ADDRESS_LINE1_EN`) over Chinese legal address fields. Do not infer legal sender data from country or invent unknown store mappings.
11. Jiufang FBA orders must not send an `Importer` object by default, so the website's 进出口委托 section is not filled from BI payload data. Do not copy `ShipFrom` company name or credit code into `Importer` unless a reviewed customs-declaration workflow explicitly requires it.
12. Jiufang invoice rows must use Jiufang-documented field names such as `ShipmentId`, `ReferenceId`, `Sku`, `ProductNameCn`, `ProductNameEn`, `HsCode`, `CustomsClearanceCode`, `PurchasingPrice`, `Num`, `DeclareValue`, `IsCharged`, `ImageUrl`, `PerSuitNum`, and `MeasurementUnit`. Jiufang `DeclareValue` is the declared unit price and must default to fixed value `2` for this FBA workflow. Jiufang package details must use `Sku` and `Num`. Do not send only legacy/local names such as `ShipmentID`, `SKU`, `EnglishName`, `CustomsCode`, `UnitPrice`, `Quantity`, or package-detail `ProductName`.

## Lingxing Date Ranges

Lingxing date-range APIs that document `start_date`/`end_date` as `左闭右开` must treat the user-facing end date as inclusive and the API `end_date` as exclusive. Frontend controls, dashboard filters, cache keys, logs, and visible metadata keep the real date selected by the user. Only backend request parameters sent to Lingxing add one day to the end boundary. For example, a visible range ending `2026-07-14` is sent to Lingxing as `end_date=2026-07-15`.

Use `src/utils/lingxingDateRange.js` to build or normalize Lingxing request params. Do not hand-roll date `+1` logic in feature services, adapters, routes, or frontend code.

If a change would add a large new feature, prefer adding a focused module under `src/` for backend code and a focused feature module under `assets/js/features/` for frontend code instead of adding an unbounded block to `app.js`.

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

## Frontend Verification

Before claiming a frontend task is complete, run browser-based verification when the change affects layout, interactions or rendered data. Prefer the in-app browser or Chrome DevTools MCP when available; otherwise use Playwright against a local server.

Minimum checks:

1. The target view renders without console errors.
2. The changed controls can be used with mouse and keyboard.
3. Text does not overlap or overflow at desktop and narrow widths.
4. Relevant requests contain the expected query/body fields.
5. Screenshots or DOM checks confirm the UI state that was changed.

For complex components, create an isolated component preview harness as a temporary local page or route, render only the target component/state, inspect layout and DOM there, then remove the harness before final delivery unless the user asks to keep it.
