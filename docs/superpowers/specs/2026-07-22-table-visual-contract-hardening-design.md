# Shared Table Visual Contract Hardening

## Goal

Make every managed BI table keep user column widths on the same business column, apply consistent semantic width/alignment rules, and keep horizontal scrolling and rendering work contained to the affected table.

## Decisions

1. A durable table uses `data-table-key` (or a stable existing `id`); a durable column uses `data-column-key`. Positional fallback remains only for legacy markup and is observable through a warning.
2. Dynamic renderers must emit their column key plus `data-column-kind` and `data-column-profile`. The advertising column definition is the source of truth; payables emits fixed semantic keys for each view mode.
3. Column semantics are resolved through one shared contract. Explicit metadata always wins. Header inference remains compatibility-only and is expanded for known financial, quantity, review, daily-sales, and date labels.
4. Table baseline styling is owned by `45-table-controls.css` and applies to `.data-table`. Sort affordance is limited to sortable controls; vertical centering is opt-in through `.data-table--middle`.
5. Every resolved table wrapper receives `.data-table-wrap`; its own scroll listener updates the scroll hint. Mutation handling batches and refreshes affected tables only.
6. The unused FBA shipment-order feature and its page CSS are removed after confirming no application import or markup references remain.

## Acceptance Criteria

- Changing advertising visible columns or switching payables detail modes never applies a saved width to a different business column.
- `结算开始日` is date-time/left; `广告花费` and `退款` are money-rate/right; quantity and review-count fields are numeric/right.
- Non-sortable table headers do not use a pointer cursor; ordinary tables do not inherit middle vertical alignment.
- FBA freight and freight-rate table shells hide the horizontal scroll hint at the end of scrolling.
- An unrelated DOM mutation does not call a full-table enhancement sweep.
- `npm test`, `npm run check`, generated CSS verification, desktop/mobile visual checks, and deployment integrity pass.
