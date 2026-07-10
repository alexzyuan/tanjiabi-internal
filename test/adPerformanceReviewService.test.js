import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdPerformanceReviewModel,
  classifyAdTarget,
  normalizeAdReviewWindow,
} from "../src/services/adPerformanceReviewService.js";

test("normalizeAdReviewWindow builds same-length previous comparison window", () => {
  const window = normalizeAdReviewWindow({ startDate: "2026-06-23", endDate: "2026-06-26" });
  assert.equal(window.analysisDays, 4);
  assert.deepEqual(window.currentDates, ["2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]);
  assert.deepEqual(window.compareDates, ["2026-06-19", "2026-06-20", "2026-06-21", "2026-06-22"]);
});

test("classifyAdTarget protects core traffic and lowers non-core high ACoS targets", () => {
  assert.equal(classifyAdTarget({
    core: true,
    current: { clicks: 20, orders: 4, cost: 20, sales: 50, acos: 0.4 },
  }, { targetAcos: 0.25 }).action, "保护控费");
  const nonCore = classifyAdTarget({
    core: false,
    current: { clicks: 20, orders: 2, cost: 30, sales: 60, acos: 0.5 },
  }, { targetAcos: 0.25 });
  assert.equal(nonCore.action, "降价");
  assert.equal(nonCore.bidChange, "-15%");
});

test("buildAdPerformanceReviewModel summarizes metrics and creates target/search actions", () => {
  const window = normalizeAdReviewWindow({ startDate: "2026-06-23", endDate: "2026-06-24" });
  const result = buildAdPerformanceReviewModel({
    window,
    rules: { targetAcos: 0.25, avgClicksPerOrder: 7, coreSalesShare: 0.2 },
    targetRows: [
      {
        key: "p:c:a:core:exact",
        targetText: "core boat",
        matchType: "exact",
        campaignId: "c",
        adGroupId: "a",
        profileId: "p",
        sellerName: "xiamen tanjia-US",
        country: "US",
        current: { impressions: 100, clicks: 20, cost: 10, sales: 100, orders: 5, sameSales: 0, sameOrders: 0, units: 0 },
        compare: { impressions: 80, clicks: 16, cost: 8, sales: 80, orders: 4, sameSales: 0, sameOrders: 0, units: 0 },
      },
      {
        key: "p:c:a:waste:broad",
        targetText: "waste click",
        matchType: "broad",
        campaignId: "c",
        adGroupId: "a",
        profileId: "p",
        sellerName: "xiamen tanjia-US",
        country: "US",
        current: { impressions: 100, clicks: 8, cost: 12, sales: 0, orders: 0, sameSales: 0, sameOrders: 0, units: 0 },
        compare: { impressions: 50, clicks: 2, cost: 2, sales: 0, orders: 0, sameSales: 0, sameOrders: 0, units: 0 },
      },
    ],
    searchTermRows: [
      {
        key: "p:c:a:bad query",
        query: "bad query",
        targetText: "waste click",
        campaignId: "c",
        adGroupId: "a",
        profileId: "p",
        sellerName: "xiamen tanjia-US",
        country: "US",
        current: { impressions: 20, clicks: 7, cost: 9, sales: 0, orders: 0, sameSales: 0, sameOrders: 0, units: 0 },
        compare: { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, sameSales: 0, sameOrders: 0, units: 0 },
      },
    ],
  });
  assert.equal(result.summary.current.cost, 22);
  assert.equal(result.summary.current.sales, 100);
  assert.equal(result.summary.current.orders, 5);
  assert.equal(result.kpis.protectedTargets, 1);
  assert.equal(result.kpis.noOrderTargets, 1);
  assert.equal(result.kpis.negativeSearchTerms, 1);
  assert.match(result.markdown, /广告复盘分析/);
});

test("buildAdPerformanceReviewModel applies ASIN scope when report rows contain ASIN", () => {
  const window = normalizeAdReviewWindow({ startDate: "2026-06-23", endDate: "2026-06-23" });
  const result = buildAdPerformanceReviewModel({
    window,
    scope: { asin: "B0MATCH" },
    targetRows: [
      {
        key: "1",
        targetText: "match",
        asin: "B0MATCH",
        sellerName: "store",
        country: "US",
        current: { impressions: 10, clicks: 2, cost: 1, sales: 10, orders: 1, sameSales: 0, sameOrders: 0, units: 0 },
        compare: { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, sameSales: 0, sameOrders: 0, units: 0 },
      },
      {
        key: "2",
        targetText: "other",
        asin: "B0OTHER",
        sellerName: "store",
        country: "US",
        current: { impressions: 10, clicks: 2, cost: 1, sales: 10, orders: 1, sameSales: 0, sameOrders: 0, units: 0 },
        compare: { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, sameSales: 0, sameOrders: 0, units: 0 },
      },
    ],
  });
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].asin, "B0MATCH");
  assert.equal(result.asinSupport.requested, true);
  assert.equal(result.asinSupport.matched, true);
});
