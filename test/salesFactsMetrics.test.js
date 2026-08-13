import assert from "node:assert/strict";
import test from "node:test";

import {
  SALES_FACT_METRICS,
  decodeSalesMetric,
  encodeSalesMetric,
  normalizeOrderProfitMetricValues,
  reconstructSalesFactMapperRecord,
} from "../src/services/salesFactsMetrics.js";

test("registry encodes fixed-point values and preserves null and zero", () => {
  assert.equal(encodeSalesMetric("totalSalesAmount", "12.3456"), 123456n);
  assert.equal(decodeSalesMetric("totalSalesAmount", 123456n), 12.3456);
  assert.equal(encodeSalesMetric("otherIncome", "0.123456"), 123456n);
  assert.equal(decodeSalesMetric("otherIncome", 123456n), 0.123456);
  assert.equal(encodeSalesMetric("totalSalesRefunds", 0), 0n);
  assert.equal(encodeSalesMetric("totalSalesRefunds", null), null);
  assert.throws(() => encodeSalesMetric("unknownField", 1), /未注册/);
  assert.throws(() => encodeSalesMetric("totalSalesAmount", "1.23456"), /精度/);
});

test("canonical normalization returns only registry fields and never raw", () => {
  const fact = normalizeOrderProfitMetricValues({
    amount: "10.50",
    volume: 2,
    refund_amount: 0,
    token: "secret",
    raw: { private: true },
  });
  assert.deepEqual(fact, {
    totalSalesQuantity: 20000n,
    totalSalesAmount: 105000n,
    totalSalesRefunds: 0n,
  });
  assert.equal("token" in fact, false);
  assert.equal("raw" in fact, false);
});

test("rejects conflicting aliases and invalid numeric values", () => {
  assert.throws(
    () => normalizeOrderProfitMetricValues({ amount: 10, totalSalesAmount: 11 }),
    /别名值冲突/,
  );
  assert.throws(
    () => normalizeOrderProfitMetricValues({ amount: "not-a-number" }),
    /数字无效/,
  );
});

test("reconstructs current mapper inputs entirely from the canonical registry", () => {
  const source = {
    volume: 2,
    multi_channel_volume: 1,
    ad_sales_amount: "20.25",
    ad_volume: 1,
    amount: "100.25",
    net_amount: "90.25",
    gross_profit: "30.50",
    profit: "25.25",
    shipping_cost: "2.50",
    promotion_discount: "1.25",
    refund_amount: "5.00",
    return_quantity: 1,
    refund_quantity: 1,
    inventory_credit: "0.50",
    total_other_granted: "0.25",
    selling_fee: "-10.00",
    fulfillment_fee: "-8.00",
    other_order_fee: "-1.00",
    total_stock_fee: "-2.00",
    spend: "-4.00",
    promotion_fee: "-0.75",
    shared_fba_international_inbound_fee: "-3.00",
    shared_fba_inbound_convenience_fee: "-0.50",
    adjustments: "-0.25",
    total_platform_other_fee: "-0.10",
    purchase_costs: "-30.00",
    logistics_costs: "-6.00",
    other_product_cost: "-0.20",
    cgUnitPrice: "-15.00",
    cgTransportUnitCosts: "-3.00",
    total_stock_fee_rate: "0.02",
    selling_fee_rate: "0.10",
    fulfillment_fee_rate: "0.08",
    proportionOfCg: "0.30",
    proportionOfCgTransport: "0.06",
    secret: "must-not-survive",
  };
  const stored = normalizeOrderProfitMetricValues(source);
  const mapperRecord = reconstructSalesFactMapperRecord(stored);

  assert.deepEqual(Object.keys(mapperRecord).sort(), Object.keys(SALES_FACT_METRICS).sort());
  assert.equal(mapperRecord.totalSalesQuantity, 2);
  assert.equal(mapperRecord.totalSalesAmount, 100.25);
  assert.equal(mapperRecord.purchaseUnitCost, -15);
  assert.equal(mapperRecord.storageFeeRate, 0.02);
  assert.equal("secret" in mapperRecord, false);
});
