# Legal Sender Brand Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every real Lingxing shop containing `tanjia` or `tandanbo` to the confirmed legal sender without adding a per-shop approval map.

**Architecture:** Keep `src/data/fbaAddressBook.js` as the single legal-profile boundary. Normalize the runtime shop identifier once, match `tandanbo` first and `tanjia` second, and retain fail-fast behavior for every other brand. The runtime seller directory remains the only source that can create selectable shops.

**Tech Stack:** Node.js ES modules, `node:test`, existing FBA service tests and living repository documentation.

---

## File structure and ownership

- Modify `src/data/fbaAddressBook.js`: own brand-marker-to-profile resolution.
- Modify `test/fbaShopDirectory.test.js`: prove regional and case-insensitive brand matching and unknown-brand rejection.
- Modify `test/fbaFreightSheetService.test.js`: prove a real `tanjia-eu-DE` row can render the Tanjia sender in Jiufang output.
- Modify `AGENTS.md`, `CONTEXT.md`, and the seller-directory design: record the confirmed brand rule and remove obsolete per-shop approval wording.
- Do not modify runtime seller loading, static shop lists, routes, frontend files, CSS, credentials, or production files.

### Task 1: Brand-marker legal sender resolution

**Files:**
- Modify: `test/fbaShopDirectory.test.js`
- Modify: `test/fbaFreightSheetService.test.js`
- Modify: `src/data/fbaAddressBook.js:47-52`

- [ ] **Step 1: Write failing tests**

Assert `tanjia-eu-DE`, an uppercase `EU-TANJIA-UK` example and `xiamentanjia-US` resolve to `xiamentanjia`; assert a name containing `tandanbo` resolves to `tandanbo`; assert `unknown-store` remains `null`. Update the FBA shop-directory test so a runtime `tanjia-eu-UK` row becomes a mapped shop while an unknown row stays in `unmappedShops`. Update the Jiufang workbook test so `tanjia-eu-DE` produces a buffer instead of an unmapped-sender error.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/fbaShopDirectory.test.js test/fbaFreightSheetService.test.js
```

Expected: failures show the current prefix-only resolver returns `null` for regional Tanjia names.

- [ ] **Step 3: Implement the minimal resolver**

Replace prefix-only matching with normalized marker matching:

```js
const value = String(shop?.name || shopName).trim().toLowerCase();
if (value.includes("tandanbo")) return fbaAddressProfiles.tandanbo;
if (value.includes("tanjia")) return fbaAddressProfiles.xiamentanjia;
return null;
```

Do not infer from country or SID and do not create a per-shop map.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/fbaShopDirectory.test.js test/fbaFreightSheetService.test.js test/fbaStaService.test.js test/jiufangFbaOrderService.test.js
```

Expected: all selected tests pass and unknown-brand tests still fail fast.

### Task 2: Living documentation and full verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/specs/2026-08-10-seller-identity-directory-design.md`

- [ ] **Step 1: Update the domain rule**

Document that real runtime shop names containing `tandanbo` use the Tandanbo profile, otherwise names containing `tanjia` use the Tanjia profile, regardless of marketplace country. State that this removes the per-shop legal approval map but does not allow static shops to enter the runtime directory.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm run check
npm test
git diff --check
```

Expected: zero failures and no generated CSS diff.

- [ ] **Step 3: Commit**

```bash
git add src/data/fbaAddressBook.js test/fbaShopDirectory.test.js test/fbaFreightSheetService.test.js AGENTS.md CONTEXT.md docs/superpowers/specs/2026-08-10-seller-identity-directory-design.md docs/superpowers/plans/2026-08-10-legal-sender-brand-rule.md
git commit -m "fix: resolve legal senders by shop brand"
```
