import assert from "node:assert/strict";
import test from "node:test";

import {
  createSalesFactsUpstreamService,
} from "../src/services/salesFactsUpstreamService.js";

const sellers = [
  { sid: 8708, countryCode: "US", status: 1 },
  { sid: 8709, countryCode: "US", status: 1 },
];

function completeEvidence(overrides = {}) {
  return {
    pageIndex: 1,
    offset: 0,
    pageRowCount: 1,
    cumulativeRowCount: 1,
    declaredTotal: 1,
    hasNext: false,
    terminalReason: "total-exhausted",
    complete: true,
    safetyLimitHit: false,
    ...overrides,
  };
}

function orderRow(date, overrides = {}) {
  return {
    sid: 8708,
    seller_sku: "MSKU-SECRET",
    currency_code: "USD",
    amount: "10.0000",
    volume: 1,
    report_date: date,
    ...overrides,
  };
}

function service(adapter, options = {}) {
  return createSalesFactsUpstreamService({
    adapter,
    sellers,
    logger: { info() {}, error() {}, warn() {} },
    sleep: async () => {},
    random: () => 0,
    now: () => 1000,
    ...options,
  });
}

test("loads inclusive OrderProfit days serially with explicit currency and complete coverage", async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const adapter = {
    normalizeRecordList: (payload) => payload.data.records,
    async fetchMskuOrderProfit(params, { onPagination }) {
      calls.push(params);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      onPagination(completeEvidence());
      return { data: { records: [orderRow(params.startDate)] } };
    },
  };

  const result = await service(adapter).loadOrderProfitRange({
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    sids: [8708],
    currencyMode: "CNY",
    requestId: "daily-range",
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(calls, [
    { startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyCode: "CNY" },
    { startDate: "2026-08-02", endDate: "2026-08-02", sids: [8708], currencyCode: "CNY" },
  ]);
  assert.deepEqual(result.facts.map(({ factDate, actualCurrencyCode }) => ({ factDate, actualCurrencyCode })), [
    { factDate: "2026-08-01", actualCurrencyCode: "CNY" },
    { factDate: "2026-08-02", actualCurrencyCode: "CNY" },
  ]);
  assert.deepEqual(result.coverage, [
    { factDate: "2026-08-01", sid: 8708, currencyMode: "CNY", rowCount: 1, pageCount: 1 },
    { factDate: "2026-08-02", sid: 8708, currencyMode: "CNY", rowCount: 1, pageCount: 1 },
  ]);
  assert.deepEqual(result.meta, {
    source: "lingxing-order-profit",
    fetchMode: "daily",
    requestId: "daily-range",
    dayCount: 2,
    sidCount: 1,
    factCount: 2,
    pageCount: 2,
  });
});

test("runtime OrderProfit loader rejects monthly mode and invalid input without calling upstream", async () => {
  let calls = 0;
  const upstream = service({ async fetchMskuOrderProfit() { calls += 1; } });
  await assert.rejects(
    upstream.loadOrderProfitRange({
      startDate: "2026-08-01", endDate: "2026-08-31", sids: [8708], currencyMode: "CNY", fetchMode: "monthly",
    }),
    (error) => error.code === "SALES_FACTS_RUNTIME_FETCH_MODE_INVALID",
  );
  await assert.rejects(
    upstream.loadOrderProfitRange({
      startDate: "2026-08-02", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY",
    }),
    (error) => error.code === "SALES_FACTS_DATE_RANGE_INVALID",
  );
  await assert.rejects(
    upstream.loadOrderProfitRange({
      startDate: "2026-08-01", endDate: "2026-08-01", sids: [9999], currencyMode: "CNY",
    }),
    (error) => error.code === "SALES_FACTS_UNKNOWN_SID",
  );
  assert.equal(calls, 0);
});

test("ORIGINAL omits upstream conversion while preserving each fact actual currency", async () => {
  const calls = [];
  const adapter = {
    normalizeRecordList: (payload) => payload.data.records,
    async fetchMskuOrderProfit(params, { onPagination }) {
      calls.push(params);
      onPagination(completeEvidence({ pageRowCount: 2, cumulativeRowCount: 2, declaredTotal: 2 }));
      return { data: { records: [
        orderRow(params.startDate, { currency_code: "USD" }),
        orderRow(params.startDate, { sid: 8709, seller_sku: "MSKU-B", currency_code: "CAD" }),
      ] } };
    },
  };
  const result = await service(adapter).loadOrderProfitRange({
    startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708, 8709], currencyMode: "ORIGINAL",
  });
  assert.equal(calls[0].currencyCode, "ORIGINAL");
  assert.deepEqual(result.facts.map((row) => row.actualCurrencyCode), ["USD", "CAD"]);
});

test("rejects missing, duplicate, incomplete, or contradictory final pagination evidence without retry", async () => {
  const scenarios = [
    { emit() {}, code: "SALES_FACTS_PAGINATION_EVIDENCE_MISSING" },
    {
      emit(onPagination) { onPagination(completeEvidence()); onPagination(completeEvidence()); },
      code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID",
    },
    {
      emit(onPagination) { onPagination(completeEvidence({ complete: false, terminalReason: null })); },
      code: "SALES_FACTS_PAGINATION_INCOMPLETE",
    },
    {
      emit(onPagination) { onPagination(completeEvidence({ cumulativeRowCount: 2, declaredTotal: 1 })); },
      code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID",
    },
  ];
  for (const scenario of scenarios) {
    let attempts = 0;
    const adapter = {
      normalizeRecordList: (payload) => payload.data.records,
      async fetchMskuOrderProfit(_params, { onPagination }) {
        attempts += 1;
        scenario.emit(onPagination);
        return { data: { records: [orderRow("2026-08-01")] } };
      },
    };
    await assert.rejects(
      service(adapter).loadOrderProfitRange({
        startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY",
      }),
      (error) => error.code === scenario.code,
    );
    assert.equal(attempts, 1);
  }
});

test("rejects non-contiguous pagination evidence even when the final totals match", async () => {
  let attempts = 0;
  const adapter = {
    normalizeRecordList: (payload) => payload.data.records,
    async fetchMskuOrderProfit(_params, { onPagination }) {
      attempts += 1;
      onPagination(completeEvidence({
        complete: false,
        terminalReason: null,
        hasNext: true,
      }));
      onPagination(completeEvidence({
        pageIndex: 3,
        offset: 1,
        cumulativeRowCount: 2,
        declaredTotal: 2,
      }));
      return { data: { records: [orderRow("2026-08-01"), orderRow("2026-08-01", { seller_sku: "MSKU-B" })] } };
    },
  };

  await assert.rejects(
    service(adapter).loadOrderProfitRange({
      startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY",
    }),
    (error) => error.code === "SALES_FACTS_PAGINATION_EVIDENCE_INVALID",
  );
  assert.equal(attempts, 1);
});

test("retries only reviewed temporary failures with at most three total attempts", async () => {
  const sleeps = [];
  const logs = [];
  let attempts = 0;
  const adapter = {
    normalizeRecordList: (payload) => payload.data.records,
    async fetchMskuOrderProfit(_params, { onPagination }) {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("SECRET rate payload");
        error.statusCode = 429;
        error.retryAfterMs = attempts === 1 ? 250 : undefined;
        error.code = "HTTP_SECRET_CODE";
        throw error;
      }
      onPagination(completeEvidence());
      return { data: { records: [orderRow("2026-08-01")] } };
    },
  };
  const upstream = service(adapter, {
    sleep: async (delay) => sleeps.push(delay),
    logger: {
      info(message, details) { logs.push({ level: "info", message, details }); },
      warn(message, details) { logs.push({ level: "warn", message, details }); },
      error(message, details) { logs.push({ level: "error", message, details }); },
    },
  });
  await upstream.loadOrderProfitRange({
    startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY", requestId: "retry-safe",
  });
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [250, 400]);
  assert.equal(logs.filter(({ level }) => level === "warn").length, 2);
  assert.doesNotMatch(JSON.stringify(logs), /SECRET|MSKU-SECRET|amount|payload/i);

  let timeoutAttempts = 0;
  await assert.rejects(service({
    async fetchMskuOrderProfit() {
      timeoutAttempts += 1;
      const error = new Error("timeout");
      error.code = "ETIMEDOUT";
      throw error;
    },
  }).loadOrderProfitRange({
    startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY",
  }));
  assert.equal(timeoutAttempts, 3);
});

test("retries exact reviewed Lingxing limit codes but not similar unreviewed codes", async () => {
  for (const { code, expectedAttempts } of [
    { code: "LIMIT", expectedAttempts: 3 },
    { code: "LIMIT_SECRET_SUFFIX", expectedAttempts: 1 },
  ]) {
    let attempts = 0;
    await assert.rejects(service({
      async fetchMskuOrderProfit() {
        attempts += 1;
        throw Object.assign(new Error("rate limit"), { code });
      },
    }).loadOrderProfitRange({
      startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY",
    }));
    assert.equal(attempts, expectedAttempts);
  }
});

test("failure logs preserve controlled classifications and redact untrusted names and codes", async () => {
  const logs = [];
  const logger = {
    info() {},
    warn() {},
    error(message, details) { logs.push({ message, details }); },
  };
  const missingEvidenceAdapter = {
    normalizeRecordList: (payload) => payload.data.records,
    async fetchMskuOrderProfit() {
      return { data: { records: [orderRow("2026-08-01")] } };
    },
  };
  await assert.rejects(service(missingEvidenceAdapter, { logger }).loadOrderProfitRange({
    startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY",
  }));
  assert.equal(logs.at(-1).details.errorCode, "SALES_FACTS_PAGINATION_EVIDENCE_MISSING");
  assert.equal(logs.at(-1).details.errorName, "SalesFactsContractError");

  const hostileAdapter = {
    async fetchMskuOrderProfit() {
      const error = Object.assign(new Error("SECRET body"), {
        name: "SECRET_ERROR_NAME",
        code: "SECRET_ERROR_CODE",
      });
      throw error;
    },
  };
  await assert.rejects(service(hostileAdapter, { logger }).loadOrderProfitRange({
    startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY",
  }));
  assert.equal(logs.at(-1).details.errorCode, "UPSTREAM_REQUEST_FAILED");
  assert.equal(logs.at(-1).details.errorName, "SalesFactsUpstreamError");
  assert.doesNotMatch(JSON.stringify(logs), /SECRET/iu);
});

test("does not retry contract, auth, or ordinary server failures", async () => {
  for (const error of [
    Object.assign(new Error("contract"), { code: "SALES_FACTS_ROW_MALFORMED", statusCode: 422 }),
    Object.assign(new Error("auth"), { statusCode: 401 }),
    Object.assign(new Error("server"), { statusCode: 503 }),
  ]) {
    let attempts = 0;
    const adapter = { async fetchMskuOrderProfit() { attempts += 1; throw error; } };
    await assert.rejects(service(adapter).loadOrderProfitRange({
      startDate: "2026-08-01", endDate: "2026-08-01", sids: [8708], currencyMode: "CNY",
    }));
    assert.equal(attempts, 1);
  }
});

test("loads monthly custom fees only from the complete seller-profit report", async () => {
  const calls = [];
  let otherFeeCalls = 0;
  const adapter = {
    normalizeRecordList: (payload) => payload.data.records,
    normalizeSellerProfitOtherFeeRecords(records, _sellers, month) {
      return records.flatMap((record) => record.otherFeeStr.map((fee) => ({
        sid: record.sid,
        currencyCode: record.currency_code,
        reportDate: month,
        other_fee_type: fee.otherFeeName,
        other_fee_type_id: fee.otherFeeTypeId,
        fee: fee.feeAllocation,
      })));
    },
    async fetchSellerProfitReport(params, { onPagination }) {
      calls.push(params);
      onPagination(completeEvidence());
      return { data: { records: [{
        sid: 8708,
        currency_code: params.currencyCode === "CNY" ? "CNY" : "USD",
        otherFeeStr: [{ otherFeeName: "软件费用", otherFeeTypeId: 2, feeAllocation: "-8.2500" }],
      }] } };
    },
    async fetchOtherFeeList() { otherFeeCalls += 1; },
  };
  const result = await service(adapter).loadCustomFeesByMonth({
    naturalMonths: ["2026-07", "2026-08"],
    sids: [8708],
    currencyMode: "CNY",
    requestId: "fees",
  });
  assert.deepEqual(calls, [
    { startDate: "2026-07", endDate: "2026-07", sids: [8708], currencyCode: "CNY", monthlyQuery: true, summaryEnabled: true },
    { startDate: "2026-08", endDate: "2026-08", sids: [8708], currencyCode: "CNY", monthlyQuery: true, summaryEnabled: true },
  ]);
  assert.equal(otherFeeCalls, 0);
  assert.deepEqual(result.rows[0], {
    naturalMonth: "2026-07", sid: 8708, feeTypeId: "2", feeName: "软件费用",
    feeAmount: -82500n, currencyMode: "CNY", actualCurrencyCode: "CNY",
  });
  assert.deepEqual(result.coverage, [
    { naturalMonth: "2026-07", sid: 8708, currencyMode: "CNY", rowCount: 1, pageCount: 1 },
    { naturalMonth: "2026-08", sid: 8708, currencyMode: "CNY", rowCount: 1, pageCount: 1 },
  ]);
  assert.deepEqual(result.meta, {
    source: "lingxing-seller-profit-other-fee",
    requestId: "fees", monthCount: 2, sidCount: 1, rowCount: 2, pageCount: 2,
  });
});

test("custom fee loader rejects invalid months, unknown SIDs, currency conflicts, and incomplete evidence", async () => {
  const baseAdapter = {
    normalizeRecordList: (payload) => payload.data.records,
    normalizeSellerProfitOtherFeeRecords: (records) => records,
    async fetchSellerProfitReport(_params, { onPagination }) {
      onPagination(completeEvidence({ pageRowCount: 0, cumulativeRowCount: 0, declaredTotal: 0 }));
      return { data: { records: [] } };
    },
  };
  await assert.rejects(
    service(baseAdapter).loadCustomFeesByMonth({ naturalMonths: ["2026-13"], sids: [8708], currencyMode: "CNY" }),
    (error) => error.code === "SALES_FACTS_MONTH_INVALID",
  );
  await assert.rejects(
    service(baseAdapter).loadCustomFeesByMonth({ naturalMonths: ["2026-08"], sids: [9999], currencyMode: "CNY" }),
    (error) => error.code === "SALES_FACTS_UNKNOWN_SID",
  );

  const conflictAdapter = {
    ...baseAdapter,
    normalizeSellerProfitOtherFeeRecords: () => [{
      sid: 8708, currencyCode: "USD", other_fee_type: "软件费用", other_fee_type_id: 2, fee: -8,
    }],
  };
  await assert.rejects(
    service(conflictAdapter).loadCustomFeesByMonth({ naturalMonths: ["2026-08"], sids: [8708], currencyMode: "CNY" }),
    (error) => error.code === "SALES_FACTS_ACTUAL_CURRENCY_CONFLICT",
  );

  let attempts = 0;
  const incompleteAdapter = {
    ...baseAdapter,
    async fetchSellerProfitReport(_params, { onPagination }) {
      attempts += 1;
      onPagination(completeEvidence({
        pageRowCount: 0, cumulativeRowCount: 0, declaredTotal: 0, complete: false, terminalReason: null,
      }));
      return { data: { records: [] } };
    },
  };
  await assert.rejects(
    service(incompleteAdapter).loadCustomFeesByMonth({ naturalMonths: ["2026-08"], sids: [8708], currencyMode: "CNY" }),
    (error) => error.code === "SALES_FACTS_PAGINATION_INCOMPLETE",
  );
  assert.equal(attempts, 1);
});

test("custom fee loader rejects duplicate canonical fee identities before persistence", async () => {
  const adapter = {
    normalizeRecordList: (payload) => payload.data.records,
    normalizeSellerProfitOtherFeeRecords: () => [
      { sid: 8708, currencyCode: "CNY", other_fee_type: "软件费用", other_fee_type_id: 2, fee: -8 },
      { sid: 8708, currencyCode: "CNY", other_fee_type: "软件费用", other_fee_type_id: 2, fee: -3 },
    ],
    async fetchSellerProfitReport(_params, { onPagination }) {
      onPagination(completeEvidence());
      return { data: { records: [{ sid: 8708 }] } };
    },
  };

  await assert.rejects(
    service(adapter).loadCustomFeesByMonth({
      naturalMonths: ["2026-08"], sids: [8708], currencyMode: "CNY",
    }),
    (error) => error.code === "SALES_FACTS_DUPLICATE_CUSTOM_FEE",
  );
});
