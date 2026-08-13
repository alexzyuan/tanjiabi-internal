import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { encodeSalesMetric, SALES_FACT_METRICS } from "./salesFactsMetrics.js";

const SHADOW_METRICS = Object.freeze([
  "totalSalesQuantity",
  "totalSalesAmount",
  "totalSalesRefunds",
  "totalAdsCost",
  "grossProfit",
  "customFeeAmount",
]);

const SHADOW_ALIASES = Object.freeze({
  totalSalesQuantity: ["totalSalesQuantity", "total_sales_quantity", "quantity", "qty", "volume"],
  totalSalesAmount: ["totalSalesAmount", "total_sales_amount", "salesAmount", "sales_amount", "amount"],
  totalSalesRefunds: ["totalSalesRefunds", "total_sales_refunds", "salesRefunds", "sales_refunds", "refundAmount", "refund_amount", "refunds"],
  totalAdsCost: ["totalAdsCost", "total_ads_cost", "adsCost", "ads_cost", "advertisingCost", "advertising_cost", "spend"],
  grossProfit: ["grossProfit", "gross_profit", "orderProfit", "order_profit", "profit", "profitAmount", "profit_amount"],
  customFeeAmount: ["customFeeAmount", "custom_fee_amount", "feeAmount", "fee_amount", "fee"],
});

function log(logger, level, event, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, `[sales-facts-shadow] ${event}`, details);
}

function safeRequestId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(text) ? text : "sales-facts-shadow";
}

function safeErrorName(error) {
  const name = String(error?.name || "");
  return /^(?:SalesFacts|ListingOwner)[A-Za-z]+Error$/u.test(name) ? name : "Error";
}

function isSalesFactsShadowEnabled(env = process.env) {
  return String(env?.SALES_FACTS_SHADOW_READ || "") === "1";
}

function firstValue(row, aliases) {
  for (const alias of aliases) {
    if (Object.hasOwn(row || {}, alias) && row[alias] !== undefined && row[alias] !== "") return row[alias];
  }
  return undefined;
}

function readMetric(row, metricName) {
  const metrics = row?.metrics;
  const value = metrics && typeof metrics === "object" && Object.hasOwn(metrics, metricName)
    ? metrics[metricName]
    : firstValue(row, SHADOW_ALIASES[metricName]);
  if (value === undefined || value === null || value === "") return null;
  if (metricName === "customFeeAmount") {
    const text = String(value).trim().replace(/,/gu, "");
    const match = /^([+-]?)(\d+)(?:\.(\d*))?$/u.exec(text);
    if (!match || (match[3] || "").replace(/0+$/u, "").length > 4) return null;
    const units = BigInt(match[2]) * 10000n + BigInt((match[3] || "").slice(0, 4).padEnd(4, "0") || "0");
    return match[1] === "-" ? -units : units;
  }
  if (!Object.hasOwn(SALES_FACT_METRICS, metricName)) return null;
  try {
    return encodeSalesMetric(metricName, value);
  } catch {
    return null;
  }
}

function rowIdentity(row) {
  const factDate = String(row?.factDate || row?.reportDate || row?.date || "").trim();
  const sid = Number(row?.sid ?? row?.seller_id ?? row?.sellerId ?? row?.store_id ?? row?.storeId);
  const msku = String(row?.mskuKey || row?.msku || row?.seller_sku || row?.sellerSku || "").trim();
  const currencyMode = String(row?.currencyMode || "").trim().toUpperCase()
    || (String(row?.currencyCode || row?.currency_code || "").trim().toUpperCase() === "CNY" ? "CNY" : "ORIGINAL");
  if (!factDate || !Number.isSafeInteger(sid) || sid <= 0 || !msku || !["CNY", "ORIGINAL"].includes(currencyMode)) return null;
  return { factDate, sid, mskuKey: msku.toLocaleLowerCase("en-US"), currencyMode };
}

function identityKey(identity) {
  return `${identity.factDate}|${identity.sid}|${identity.mskuKey}|${identity.currencyMode}`;
}

function hashMsku(mskuKey) {
  return createHash("sha256").update(String(mskuKey)).digest("hex").slice(0, 12);
}

function aggregate(records = []) {
  if (!Array.isArray(records)) throw new TypeError("shadow records must be an array");
  const buckets = new Map();
  for (const record of records) {
    const identity = rowIdentity(record);
    if (!identity) continue;
    const key = identityKey(identity);
    if (!buckets.has(key)) buckets.set(key, { identity, metrics: Object.fromEntries(SHADOW_METRICS.map((metric) => [metric, null])), missing: new Set() });
    const bucket = buckets.get(key);
    for (const metric of SHADOW_METRICS) {
      const value = readMetric(record, metric);
      if (value === null) {
        bucket.missing.add(metric);
      } else if (bucket.metrics[metric] === null) {
        bucket.metrics[metric] = value;
      } else {
        bucket.metrics[metric] += value;
      }
    }
  }
  return buckets;
}

function comparableMetricValue(bucket, metric) {
  return bucket.missing.has(metric) ? null : bucket.metrics[metric];
}

function deltaUnits(delta) {
  if (delta === null) return null;
  if (typeof delta !== "bigint") throw new TypeError("shadow fixed-point delta must be bigint");
  return String(delta);
}

function compareSalesFactsShadow({
  legacyRecords = [],
  newFacts = [],
  requestId = "",
  logger = console,
  now = Date.now,
} = {}) {
  const started = performance.now();
  const legacy = aggregate(legacyRecords);
  const next = aggregate(newFacts);
  const keys = new Set([...legacy.keys(), ...next.keys()]);
  const mismatchMetricUnits = Object.fromEntries(SHADOW_METRICS.map((metric) => [metric, 0n]));
  const samples = [];
  let mismatchCount = 0;
  let missingInLegacyCount = 0;
  let missingInNewCount = 0;
  for (const key of [...keys].sort()) {
    const left = legacy.get(key);
    const right = next.get(key);
    if (!left) missingInLegacyCount += 1;
    if (!right) missingInNewCount += 1;
    let rowMismatch = !left || !right;
    const deltas = {};
    if (left && right) {
      for (const metric of SHADOW_METRICS) {
        const leftValue = comparableMetricValue(left, metric);
        const rightValue = comparableMetricValue(right, metric);
        if (leftValue === null || rightValue === null) {
          if (leftValue !== rightValue) {
            rowMismatch = true;
            mismatchMetricUnits[metric] += 1n;
          }
          continue;
        }
        const delta = rightValue - leftValue;
        if (delta !== 0n) {
          rowMismatch = true;
          mismatchMetricUnits[metric] += delta;
          deltas[metric] = deltaUnits(delta);
        }
      }
    }
    if (rowMismatch) {
      mismatchCount += 1;
      const identity = (right || left).identity;
      if (samples.length < 20) samples.push({
        factDate: identity.factDate,
        sid: identity.sid,
        currencyMode: identity.currencyMode,
        mskuHash: hashMsku(identity.mskuKey),
        deltas,
      });
    }
  }
  const timestamp = typeof now === "function" ? now() : now;
  const result = {
    comparedIdentityCount: keys.size,
    mismatchCount,
    missingInLegacyCount,
    missingInNewCount,
    mismatchMetrics: Object.fromEntries(SHADOW_METRICS.map((metric) => [metric, deltaUnits(mismatchMetricUnits[metric])])),
    sampleCount: samples.length,
    elapsedMs: Math.max(0, Math.round(performance.now() - started)),
  };
  log(logger, "info", "comparison", {
    requestId: safeRequestId(requestId),
    ...result,
    samples,
    observedAtMs: Number.isSafeInteger(Number(timestamp)) ? Number(timestamp) : undefined,
  });
  return result;
}

async function runSalesFactsShadowRead({
  enabled = isSalesFactsShadowEnabled(),
  legacyResult,
  legacyRecords = [],
  readNewFacts,
  compare = compareSalesFactsShadow,
  requestId = "",
  logger = console,
  ...readOptions
} = {}) {
  if (!enabled) return legacyResult;
  const safeId = safeRequestId(requestId);
  const started = performance.now();
  if (typeof readNewFacts !== "function") {
    log(logger, "error", "failure", { requestId: safeId, errorName: "Error", errorCode: "SALES_FACTS_SHADOW_READER_MISSING" });
    return legacyResult;
  }
  try {
    const newFacts = await readNewFacts(readOptions);
    const comparison = compare({ legacyRecords, newFacts, requestId: safeId, logger, ...readOptions });
    log(logger, "info", "complete", {
      requestId: safeId,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      mismatchCount: comparison.mismatchCount,
    });
  } catch (error) {
    log(logger, "error", "failure", {
      requestId: safeId,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      errorName: safeErrorName(error),
      errorCode: /^SALES_FACTS_[A-Z0-9_]+$/u.test(String(error?.code || "")) ? error.code : "SALES_FACTS_SHADOW_READ_FAILED",
    });
  }
  return legacyResult;
}

export { compareSalesFactsShadow, isSalesFactsShadowEnabled, runSalesFactsShadowRead };
