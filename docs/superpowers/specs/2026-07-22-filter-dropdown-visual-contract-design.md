# Shared Filter Dropdown Visual Contract

## Goal

Prevent multi-select filter labels from overflowing their controls while keeping the selected state immediately understandable. Apply the rule to every shared `.filters` multi-select, not only the sales dashboard.

## Scope and ownership

- `assets/js/filter-controls.js` owns the selected-state summary and accessibility metadata for enhanced native multi-selects.
- `assets/css/components/30-surfaces-and-filters.css` owns filter-bar control layout, dropdown anchoring, clipping, and responsive constraints.
- `assets/css/components/32-form-controls.css` remains the owner of generic multi-select affordance, menu elevation, scrolling, and option-row behavior.
- `styles.css` is generated only by `npm run build:css`; it must not be edited directly.
- `index.html`, feature-specific modules, API code, and business filter semantics are out of scope.

## Selected-state rule

1. No selected value: display the native select's all-label, such as `全部国家`.
2. Exactly one selected value: display its label, truncated inside the available text area when unusually long.
3. Two or more selected values: display `已选 N 项`; do not concatenate labels.
4. The trigger keeps dedicated space for its disclosure icon. Text never paints beyond the button border or over a neighboring control.
5. The complete selected-label list is exposed as an accessible button label and tooltip text, while the visible summary remains compact.

## Dropdown visual rules

- The popup begins at the trigger's leading edge and is at least as wide as the trigger, with a practical minimum for options.
- Its maximum width respects viewport side gutters; on a narrow viewport it remains inside the viewport instead of creating page-level horizontal overflow.
- Option rows retain a fixed checkbox column and ellipsize only the option text.
- The popup retains a capped, scrollable option region and the existing focus-visible / keyboard semantics.

## Historical visual issues addressed

1. The current JavaScript concatenates one or two selected labels, but the trigger has no clipping contract; two long shop names overflow the fixed filter field.
2. The existing shared trigger does not reserve icon space or define safe text overflow, so a single pathological label can also crowd the disclosure arrow.
3. The filter popup combines an intrinsic width with a viewport cap but does not explicitly anchor to the trigger's available viewport side; the narrow right-edge case needs bounded alignment.

## Verification

The target flow is: any dashboard with a shared multi-select -> select one, then two long labels -> the trigger changes from a label to `已选 2 项` without overlap; opening the popup near the narrow viewport edge keeps it visible and scrollable.

Verification will include targeted unit coverage for the summary logic where practical, `npm test`, `npm run check`, and browser checks on the sales dashboard at desktop and narrow widths. Browser checks must cover page identity, meaningful content, console health, screenshot evidence, keyboard/mouse opening, and selected-state updates.
