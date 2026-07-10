# Native UI Components

Date: 2026-07-07

This project remains native HTML/CSS/JavaScript. Reusable UI behavior is expressed as small render/config helpers instead of React components.

## Component Architecture

`assets/js/ui-components.js` owns reusable UI rendering primitives that are shared by feature modules:

- `renderKpiProgress(props)` renders accessible KPI progress bars.
- `renderMeterBar(props)` renders accessible proportional bars for compact dashboard rows.
- `renderChartSwatch(props)` and `chartBucketClass(key, index)` map data buckets to reusable CSS classes instead of inline colors.
- `configureModalElement(modalTarget, props)` applies dialog semantics to native modal shells.

Styling lives in CSS component/page layers:

- Shared meters: `assets/css/components/34-dashboard-data-primitives.css`
- Sales KPI progress tones: `assets/css/pages/22-sales-dashboard.css`
- Inventory bucket color classes: `assets/css/pages/55-inventory-provision.css`
- Modal shell/backdrop: `assets/css/components/50-modal-backdrop.css` and `55-modal-shell.css`

## Props Design

`renderKpiProgress({ value, tone, label, className })`

- `value`: number-like percent. Clamped to `0..100`.
- `tone`: `blue`, `green`, `positive`, `success`, `orange`, `warning`, `red`, `danger`, `error`, `neutral`.
- `label`: accessible name for `aria-label`.
- `className`: defaults to `kpi-progress`.

`renderMeterBar({ value, max, tone, label, className, barClassName })`

- `value`: number-like current value.
- `max`: denominator. Invalid or zero values fall back to `1`.
- `tone`: same tone vocabulary as progress.
- `label`: accessible name for `role="meter"`.
- `className`: defaults to `ui-meter`.
- `barClassName`: defaults to `ui-meter__bar`.

`renderChartSwatch({ key, index, label, className })`

- `key`: stable business bucket key such as `91_180` or `271_plus`.
- `index`: fallback visual index when a key is new.
- `label`: visible swatch label.
- `className`: defaults to `bucket-dot`.

`configureModalElement(modalTarget, { root, dialogSelector, labelledBy, describedBy })`

- `modalTarget`: selector or element.
- `root`: document-like root.
- `dialogSelector`: defaults to `article`.
- `labelledBy`: optional title id.
- `describedBy`: optional description/status id.

## State Design

These helpers are stateless. Feature modules keep business state locally and pass normalized props into the helper at render time.

Modal open state remains controlled by `setModalOpenState()` in `assets/js/ui-utils.js`, which now also applies `role="dialog"` and `aria-modal="true"` as a safety net.

## Usage Examples

```js
renderKpiProgress({
  value: item.progress,
  tone: item.tone,
  label: `${item.title} ${item.value}`,
});

renderMeterBar({
  value: unpaid,
  max: payable,
  tone: "danger",
  label: "供应商未付金额",
});

renderChartSwatch({
  key: "271_plus",
  index: 3,
  label: "271天以上",
});
```

## Loading / Empty / Error

- Loading, empty and error text stays in feature modules or `loadDashboardSection()`.
- Component helpers only render presentational primitives for the current state.
- Empty chart states should render text inside the SVG or table cell instead of empty graphics.
- Error states should use existing status text or `empty-state` containers with explicit messages.

## Accessibility

- KPI progress uses `role="progressbar"` with `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`.
- Meter bars use `role="meter"`.
- Icon-only modal close buttons must have `aria-label`.
- Dialog articles must have `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`.
- Color must not be the only state signal; text labels remain visible beside visual bars.

## Edge Cases

- Non-numeric progress values clamp to `0`.
- Values above 100 clamp to 100 for visual bars.
- `max <= 0` in meter bars falls back to `1` to avoid division by zero.
- Unknown tones fall back to neutral or blue depending on component context.
- Unknown chart bucket keys receive a normalized class and an index fallback class.
- Labels are escaped before insertion into HTML attributes or text snippets.

## Design Decisions

- Dynamic width remains a CSS custom property because the value is data-dependent and not representable as a finite class set.
- Dynamic color moved from inline style to semantic CSS classes.
- Shell and login visual effects use semantic tokens with `color-mix()` for translucency instead of page-local hex or `rgba()` literals.
- CSS source remains layered under `assets/css/*`; `styles.css` is generated and should not be edited directly.
- No React island was introduced; the API shape intentionally resembles component props while staying native.
- Existing feature state machines were not moved into the helper, keeping helpers reusable and business-agnostic.
