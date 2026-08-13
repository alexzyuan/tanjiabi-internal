import { createHash } from "node:crypto";

import {
  SalesFactsConflictError,
  SalesFactsContractError,
  SalesFactsInputError,
} from "./salesFactsIdentity.js";
import { SALES_FACT_METRICS, normalizeOrderProfitMetricValues } from "./salesFactsMetrics.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_FIELDS = Object.freeze([
  "factDate",
  "fact_date",
  "reportDate",
  "report_date",
  "date",
  "posted_date_locale",
  "purchase_date_locale",
  "order_date",
]);
const SID_FIELDS = Object.freeze(["sid", "seller_id", "sellerId", "store_id", "storeId"]);
const MSKU_FIELDS = Object.freeze(["msku", "seller_sku", "sellerSku", "m_sku"]);
const CURRENCY_FIELDS = Object.freeze(["actualCurrencyCode", "currency_code", "currencyCode", "currency"]);

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function validDate(value) {
  const text = String(value || "").trim();
  if (!DATE_PATTERN.test(text)) return "";
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? "" : text;
}

function actualDate(record, requestedDateRange, allowRequestedDateFallback) {
  const direct = validDate(firstValue(record, DATE_FIELDS));
  if (direct) return direct;
  if (allowRequestedDateFallback && requestedDateRange?.startDate === requestedDateRange?.endDate) {
    const fallback = validDate(requestedDateRange.startDate);
    if (fallback) return fallback;
  }
  throw new SalesFactsContractError("OrderProfit 行缺少真实事实日期。", {
    code: "SALES_FACTS_DATE_MISSING",
  });
}

function normalizeSellerMap(sellers) {
  return new Map((Array.isArray(sellers) ? sellers : [])
    .map((seller) => [Number(seller?.sid ?? seller?.seller_id ?? seller?.sellerId), seller])
    .filter(([sid]) => Number.isInteger(sid) && sid > 0));
}

function normalizedCurrency(record, currencyMode) {
  if (currencyMode === "CNY") return "CNY";
  const code = String(firstValue(record, CURRENCY_FIELDS)).trim().toUpperCase();
  if (!code) {
    throw new SalesFactsContractError("原币 OrderProfit 行缺少实际币种。", {
      code: "SALES_FACTS_ACTUAL_CURRENCY_MISSING",
    });
  }
  return code;
}

function identityKey(fact) {
  return `${fact.factDate}|${fact.sid}|${fact.mskuKey}|${fact.currencyMode}`;
}

export function normalizeOrderProfitRows(rawRows, {
  requestedDateRange,
  currencyMode = "CNY",
  sellers = [],
  allowRequestedDateFallback = false,
} = {}) {
  if (!Array.isArray(rawRows)) {
    throw new SalesFactsInputError("OrderProfit 行必须为数组。", { code: "SALES_FACTS_ROWS_INVALID" });
  }
  const startDate = validDate(requestedDateRange?.startDate);
  const endDate = validDate(requestedDateRange?.endDate);
  if (!startDate || !endDate || startDate > endDate) {
    throw new SalesFactsInputError("OrderProfit 校验范围无效。", { code: "SALES_FACTS_DATE_RANGE_INVALID" });
  }
  const mode = String(currencyMode || "").trim().toUpperCase();
  if (!new Set(["CNY", "ORIGINAL"]).has(mode)) {
    throw new SalesFactsInputError("OrderProfit 币种模式无效。", { code: "SALES_FACTS_CURRENCY_MODE_INVALID" });
  }
  const sellerBySid = normalizeSellerMap(sellers);
  const facts = rawRows.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new SalesFactsContractError("OrderProfit 行结构异常。", { code: "SALES_FACTS_ROW_MALFORMED" });
    }
    const factDate = actualDate(record, requestedDateRange, allowRequestedDateFallback);
    if (factDate < startDate || factDate > endDate) {
      throw new SalesFactsContractError("OrderProfit 行日期超出请求范围。", {
        code: "SALES_FACTS_DATE_OUT_OF_RANGE",
      });
    }
    const sid = Number(firstValue(record, SID_FIELDS));
    if (!Number.isInteger(sid) || sid <= 0 || !sellerBySid.has(sid)) {
      throw new SalesFactsContractError("OrderProfit 行引用未知 SID。", { code: "SALES_FACTS_UNKNOWN_SID" });
    }
    const msku = String(firstValue(record, MSKU_FIELDS)).trim();
    const mskuKey = msku.toLocaleLowerCase("en-US");
    if (!mskuKey) throw new SalesFactsContractError("OrderProfit 行缺少 MSKU。", { code: "SALES_FACTS_MSKU_MISSING" });
    return {
      factDate,
      sid,
      msku,
      mskuKey,
      currencyMode: mode,
      actualCurrencyCode: normalizedCurrency(record, mode),
      metrics: normalizeOrderProfitMetricValues(record),
    };
  });

  const actualCurrencies = new Map();
  for (const fact of facts) {
    const key = identityKey(fact);
    const existing = actualCurrencies.get(key);
    if (existing && existing !== fact.actualCurrencyCode) {
      throw new SalesFactsConflictError("同一 OrderProfit 身份出现多个实际币种。", {
        code: "SALES_FACTS_ACTUAL_CURRENCY_CONFLICT",
      });
    }
    actualCurrencies.set(key, fact.actualCurrencyCode);
  }
  return facts;
}

function aggregateFacts(rows) {
  const byIdentity = new Map();
  for (const fact of rows) {
    const key = identityKey(fact);
    let aggregate = byIdentity.get(key);
    if (!aggregate) {
      aggregate = { key, metrics: {} };
      byIdentity.set(key, aggregate);
    }
    for (const [metricName, value] of Object.entries(fact.metrics)) {
      if (value === null) {
        if (!Object.hasOwn(aggregate.metrics, metricName)) aggregate.metrics[metricName] = null;
        continue;
      }
      if (aggregate.metrics[metricName] === null || aggregate.metrics[metricName] === undefined) {
        aggregate.metrics[metricName] = value;
      } else {
        aggregate.metrics[metricName] += value;
      }
    }
  }
  return byIdentity;
}

function identityHashPrefix(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function storedUnitDelta(left, right) {
  if (left === undefined && right === undefined) return 0n;
  if (left === null && right === null) return 0n;
  if (left === null || right === null || left === undefined || right === undefined) return null;
  const delta = left - right;
  return delta < 0n ? -delta : delta;
}

function safeDelta(delta) {
  if (delta === null) return null;
  const number = Number(delta);
  return Number.isSafeInteger(number) ? number : "overflow";
}

export function compareMonthlyAndDailyFacts({ monthlyRows = [], dailyRows = [] } = {}) {
  const monthly = aggregateFacts(monthlyRows);
  const daily = aggregateFacts(dailyRows);
  const identities = [...new Set([...monthly.keys(), ...daily.keys()])].sort();
  const mismatches = [];
  let identityMismatchCount = 0;
  let metricMismatchCount = 0;
  for (const identity of identities) {
    const left = monthly.get(identity);
    const right = daily.get(identity);
    if (!left || !right) {
      identityMismatchCount += 1;
      mismatches.push({ identityHashPrefix: identityHashPrefix(identity), metricName: "identity", storedUnitDelta: null });
      continue;
    }
    for (const [metricName, definition] of Object.entries(SALES_FACT_METRICS)) {
      const delta = storedUnitDelta(left.metrics[metricName], right.metrics[metricName]);
      const allowed = definition.kind === "money" ? 1n : 0n;
      if (delta === null || delta > allowed) {
        metricMismatchCount += 1;
        mismatches.push({
          identityHashPrefix: identityHashPrefix(identity),
          metricName,
          storedUnitDelta: safeDelta(delta),
        });
      }
    }
  }
  return {
    approvedFetchMode: identityMismatchCount === 0 && metricMismatchCount === 0 ? "monthly" : "daily",
    monthlyFactCount: monthlyRows.length,
    dailyFactCount: dailyRows.length,
    identityCount: identities.length,
    identityMismatchCount,
    metricMismatchCount,
    mismatches,
  };
}
