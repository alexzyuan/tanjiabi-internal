# Shared Smart Table Width Design

## Goal

All managed BI tables use one shared, deterministic column-width system. The system combines column-name semantics with a sample of the first 30 business rows, while preserving explicit business constraints and each browser's saved user widths.

The result must reduce unnecessary horizontal space, prevent long outliers from stretching tables, and remove page-by-page width tuning as the default development pattern.

## Scope

- Applies to every table enhanced by `assets/js/data-table-manager.js`.
- Covers static tables in `index.html` and dynamically rendered feature tables.
- Replaces ordinary page-level fixed column widths with shared semantic profiles.
- Keeps justified special behavior such as sticky columns, matrix tables, and action controls.
- Does not add account-level or cross-device preference sync in this change. Saved user widths remain browser-local.

## Source Of Truth

`assets/js/data-table-manager.js` owns width classification, measurement, precedence, application, persistence, migration, and diagnostics.

Shared CSS owns only presentation invariants such as table layout, truncation, wrapping, numeric alignment, resize handles, and density. Page CSS must not assign ordinary business column widths. A page may provide semantic metadata when the shared classifier cannot infer the business meaning reliably.

## Width Precedence

The manager resolves each column in this order:

1. Saved user width for the stable table and column key.
2. Explicit `data-column-width` for a justified business constraint.
3. Shared smart width calculated from semantic profile and sampled content.
4. Shared generic fallback when neither the label nor content can be classified.

User widths are never overwritten by rerendering, refreshing data, or smart recalculation. A new "restore smart widths" command removes only the current table's saved user widths and recalculates that table.

## Stable Identity And Migration

Every managed table must have a stable `id` or `data-table-key`. Every managed column must have a stable `data-column-key` where a durable business key exists.

The existing `tanjia:tableColumnWidths:v1` records are preserved. When a table receives a new stable identity, the manager checks the former header-derived key once, copies matching widths to the stable key, and records the migration. Invalid saved JSON is reported through the existing warning path and is not silently accepted.

Header labels are display text, not persistent identity. Renaming a label must not reset a user's width after stable keys are introduced.

## Semantic Profiles

Each profile defines minimum, preferred, and maximum widths. Exact values may be calibrated during implementation tests, but must stay inside these accepted ranges:

| Profile | Typical labels | Accepted range |
| --- | --- | ---: |
| selection | checkbox, focus, hide | 44-56 px |
| image | image, product image | 52-64 px |
| compact-dimension | country, site, currency | 56-80 px |
| number | quantity, stock, sales | 64-96 px |
| money-rate | amount, cost, price, ACOS, rate | 80-112 px |
| date-time | date, created time, delivery time | 96-136 px |
| status | shipment status, state, risk | 84-128 px |
| short-name | store, owner, operator | 84-140 px |
| identifier | SKU, MSKU, ASIN, FNSKU | 112-180 px |
| code-order | order number, shipment number, warehouse code | 128-200 px |
| name | product name, supplier, carrier, channel | 140-240 px |
| narrative | description, result, note, recommendation | 160-280 px |
| action | operation controls | 72-320 px |

Classification uses normalized labels, header controls, and explicit `data-column-profile` metadata. A header checkbox is classified as `selection` even when the header has no text. Specific patterns must run before broad patterns so that `货件单号` is classified as `code-order`, not generic text, `采购成本小计` is classified as `money-rate`, not generic number, and short organizational labels such as `店铺` do not inherit long-name widths.

Unknown labels use a generic text profile and are observable in diagnostics so the vocabulary can be improved centrally.

## Content Sampling

The manager samples at most the first 30 non-state business rows from each table body.

- It reads plain visible cell text and ignores resize handles, tooltips, hidden helper text, and state rows.
- It measures the header and sampled values using the table's effective font through a shared canvas text-measurement context.
- It uses a robust high-percentile sample rather than the single longest value, so one malformed or unusually long value cannot stretch a column.
- It adds profile-specific padding and room for sort indicators or controls.
- It clamps the result to the profile minimum and maximum.
- Image and selection columns do not grow from textual fallback content.
- Action columns estimate visible button/control widths and gaps, with a hard maximum.
- Narrative columns wrap or truncate after reaching their maximum width.

Empty tables still receive stable widths from their column labels and semantic profiles.

## Recalculation And Performance

Smart widths are calculated after headers and current rows exist, before the table is considered enhanced for that render.

The manager reads labels and samples in one pass, calculates widths without DOM writes, then applies all `colgroup` widths in one write pass. It must not interleave per-cell layout reads and writes.

Each table receives a lightweight signature derived from stable column keys and the sampled content. Mutation-driven enhancement skips recalculation when the signature is unchanged. Measurement is capped at 30 rows and only managed columns are processed.

Dynamic data refresh recalculates smart widths only for columns without saved user widths or justified explicit widths. The table must not visibly oscillate during unrelated mutations.

## Shared Presentation Rules

- Tables with calculated widths use fixed layout through the shared manager.
- Numeric values and numeric headers align right with tabular numerals.
- Selection and image columns align center.
- Text, identifier, name, status, and narrative columns align left.
- Short standard tables may fit the available container instead of inheriting a universal 980 px minimum.
- Wide and matrix tables keep horizontal scrolling.
- Overflowing identifiers use ellipsis and a native or accessible full-value affordance.
- Narrative fields wrap within their maximum width.
- Sticky offsets are recalculated from the resolved shared widths.

## Restore Smart Widths

Each managed table toolbar can expose one icon command named `恢复智能列宽`.

The command:

1. Deletes saved user widths for that table only.
2. Re-samples the current first 30 business rows.
3. Applies shared smart widths.
4. Updates sticky offsets and overflow hints.
5. Logs the reset with table identity and resolved widths.

Tables without an existing toolbar may use a shared compact table-controls area rather than page-specific button markup.

## Observability And Failure Behavior

Development diagnostics record:

- stable table key;
- stable column key and display label;
- resolved semantic profile and whether it was explicit or inferred;
- sampled row count;
- measured content width;
- final clamped width;
- source: user, explicit, smart, fallback, or migrated;
- unknown labels and migration failures.

Diagnostics use a consistent `[data-table-manager]` prefix and structured objects. Invalid configuration, duplicate stable keys in the same document, and malformed persisted data must be visible warnings or errors. The implementation must not silently replace malformed configuration with unrelated page-specific defaults.

## Migration Of Existing Tables

Implementation proceeds centrally, then removes conflicting page rules:

1. Add the shared classifier, measurement engine, cache, diagnostics, and reset API.
2. Add stable table keys and column keys to static and dynamic managed tables.
3. Convert existing page-specific widths to semantic metadata only where required.
4. Remove ordinary fixed widths that conflict with the shared source of truth.
5. Preserve special sticky and matrix behavior using resolved widths from the manager.
6. Verify every BI module with static structure tests and representative rendered checks.

Sales Forecast remains the hardest matrix case and is the first rendered calibration surface. FBA Freight, Supplier Board, Factory Inventory, Payables, Inventory Provision, and Review Rating provide representative action, image, identifier, financial, wide, and compact cases.

## Testing And Acceptance

Unit tests cover:

- semantic classification for the project's common Chinese and English BI labels;
- profile precedence and clamping;
- first-30-row sampling;
- high-percentile outlier resistance;
- empty tables;
- action, image, selection, identifier, money, date, status, and narrative profiles;
- user width precedence;
- explicit width precedence;
- old-key migration;
- reset behavior;
- stable results after repeated enhancement;
- duplicate key and malformed storage diagnostics.

Structure tests require stable identities and reject new ordinary page-level column width rules unless explicitly allowlisted as a special table constraint.

Rendered verification covers desktop and narrow viewports and confirms:

- no page-level horizontal overflow outside table wrappers;
- no overlapping sticky columns;
- compact fields remain compact;
- names and identifiers remain readable;
- action controls remain usable;
- manual widths survive reload;
- restore smart widths returns to the shared calculation;
- data refresh does not overwrite user widths or cause repeated layout shifts.

The full existing test suite and deployment integrity checks must pass before release.

## Non-Goals

- Machine-learning-based width prediction.
- Server-side account preference storage or cross-device synchronization.
- User-defined table themes or row-density profiles.
- Replacing existing table sorting, filtering, or data-loading behavior.
