const DATE_TEXT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function freezeContract(contract) {
  return Object.freeze({
    boundary: contract.boundary,
    dateKeys: Object.freeze([...(contract.dateKeys || [])]),
    docsUrl: contract.docsUrl || "",
    dateFormat: contract.dateFormat || "Y-m-d",
    notes: contract.notes || "",
  });
}

const CONTRACT_DEFINITIONS = {
  "/erp/sc/data/mws/orders": {
    boundary: "exclusive",
    dateKeys: ["end_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/Sale/Orderlists",
    dateFormat: "Y-m-d or Y-m-d H:i:s",
    notes: "官方明确左闭右开。",
  },
  "/erp/sc/data/fba_report/shipmentList": {
    boundary: "exclusive",
    dateKeys: ["end_date", "end_extra_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/FBA/FBAShipmentList",
    dateFormat: "Y-m-d",
    notes: "货件创建日期和货件修改日期均明确左闭右开。",
  },
  "/erp/sc/data/mws/listing": {
    boundary: "undocumented",
    dateKeys: ["end_date", "endDate"],
    docsUrl: "https://apidoc.lingxing.com/docs/Sale/Listing",
    notes: "官方页面未明确日期边界，不追加一天。",
  },
  "/pb/openapi/newad/portfolios": {
    boundary: "undocumented",
    dateKeys: ["end_date", "endDate"],
    docsUrl: "https://apidoc.lingxing.com/docs/newAd/baseData/portfolios",
    notes: "官方页面未明确日期边界，不追加一天。",
  },
  "/basicOpen/platformStatisticsV2/saleStat/pageList": {
    boundary: "undocumented",
    dateKeys: ["end_date", "endDate"],
    docsUrl: "https://apidoc.lingxing.com/docs/Statistics/PlatformStatisticsSaleStatPageListV2",
    dateFormat: "Y-m-d",
    notes: "官方只说明日期格式和最长范围，不追加一天。",
  },
  "/bd/profit/statistics/open/seller/list": {
    boundary: "inclusive",
    dateKeys: ["endDate", "end_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/Statistics/statisticsOpenSeller",
    dateFormat: "Y-m-d",
    notes: "官方明确双闭区间。",
  },
  "/bd/profit/report/open/report/seller/list": {
    boundary: "inclusive",
    dateKeys: ["endDate", "end_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/Finance/bdSeller",
    dateFormat: "Y-m-d or Y-m",
    notes: "官方明确结算时间双闭区间；月度查询使用 Y-m。",
  },
  "/bd/profit/report/open/report/order/list": {
    boundary: "undocumented",
    dateKeys: ["endDate", "end_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/Finance/bdOrder",
    notes: "旧接口文档未明确左右边界，不追加一天。",
  },
  "/basicOpen/finance/mreport/OrderProfit": {
    boundary: "inclusive",
    dateKeys: ["endDate"],
    docsUrl: "https://apidoc.lingxing.com/docs/Finance/OrderProfitListMSKU",
    dateFormat: "Y-m-d or Y-m-d H:i:s",
    notes: "官方明确双闭区间；店铺经营月报主数据源。",
  },
  "/bd/fee/management/open/feeManagement/otherFee/list": {
    boundary: "undocumented",
    dateKeys: ["end_date", "endDate"],
    docsUrl: "",
    dateFormat: "Y-m-d",
    notes: "当前公开文档未提供该路径的边界说明，按默认规则不追加一天。",
  },
  "/bd/productPerformance/openApi/asinList": {
    boundary: "inclusive",
    dateKeys: ["end_date", "endDate"],
    docsUrl: "https://apidoc.lingxing.com/docs/Statistics/AsinListNew",
    dateFormat: "YYYY-MM-DD",
    notes: "官方明确双闭区间。",
  },
  "/basicOpen/salesAnalysis/returnOrder/analysisLists": {
    boundary: "undocumented",
    dateKeys: ["endDate", "end_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/Statistics/ReturnOrderAnalysisLists",
    notes: "官方只说明日期格式和最大范围，不追加一天。",
  },
  "/basicOpen/openapi/service/v3/data/mws/reviews": {
    boundary: "undocumented",
    dateKeys: ["end_date", "endDate"],
    docsUrl: "https://apidoc.lingxing.com/docs/Service/reviewV2",
    notes: "官方只说明日期格式，不追加一天。",
  },
  "/bd/sp/api/open/settlement/summary/list": {
    boundary: "undocumented",
    dateKeys: ["endDate", "end_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/Finance/settlementSummaryList",
    notes: "官方只说明日期字段和最长范围，不追加一天。",
  },
  "/basicOpen/finance/requestFundsPool/purchase/list": {
    boundary: "inclusive",
    dateKeys: ["end_time"],
    docsUrl: "https://apidoc.lingxing.com/docs/Finance/requestFundsPoolPurchaseList",
    dateFormat: "Y-m-d",
    notes: "官方明确闭区间。",
  },
  "/basicOpen/finance/requestFundsPool/logistics/list": {
    boundary: "inclusive",
    dateKeys: ["end_time"],
    docsUrl: "https://apidoc.lingxing.com/docs/Finance/requestFundsPoolLogisticsList",
    dateFormat: "Y-m-d",
    notes: "官方明确闭区间。",
  },
  "/basicOpen/finance/requestFundsPool/customFee/list": {
    boundary: "inclusive",
    dateKeys: ["end_time"],
    docsUrl: "https://apidoc.lingxing.com/docs/Finance/requestFundsPoolCustomFeeList",
    dateFormat: "Y-m-d",
    notes: "官方明确闭区间。",
  },
  "/erp/sc/routing/data/local_inventory/purchaseOrderList": {
    boundary: "inclusive",
    dateKeys: ["end_date", "endDate"],
    docsUrl: "https://apidoc.lingxing.com/docs/Purchase/PurchaseOrderList",
    dateFormat: "Y-m-d",
    notes: "官方明确双闭区间。",
  },
  "/cost/center/ods/summary/query": {
    boundary: "inclusive",
    dateKeys: ["endDate", "end_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/Finance/summaryQuery",
    dateFormat: "Y-m or Y-m-d",
    notes: "官方明确闭区间；月度和日度查询均不追加一天。",
  },
  "/erp/sc/data/sales_report/sales": {
    boundary: "inclusive",
    dateKeys: ["end_date"],
    docsUrl: "https://apidoc.lingxing.com/docs/Statistics/StoreSales",
    dateFormat: "Y-m-d",
    notes: "官方明确闭区间。",
  },
};

export const LINGXING_DATE_CONTRACTS = Object.freeze(Object.fromEntries(
  Object.entries(CONTRACT_DEFINITIONS).map(([endpoint, contract]) => [endpoint, freezeContract(contract)]),
));

const DEFAULT_LINGXING_DATE_CONTRACT = freezeContract({
  boundary: "undocumented",
  dateKeys: ["end_date", "endDate", "end_time", "created_end_time"],
  notes: "未登记接口默认按闭区间处理，不追加一天。",
});

export function addDaysToDateText(dateText, days = 1) {
  const text = String(dateText || "").trim();
  const match = text.match(DATE_TEXT_RE);
  if (!match) throw new Error(`Invalid Lingxing date: ${dateText}`);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`Invalid Lingxing date: ${dateText}`);
  }
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function lingxingExclusiveEndDate(endDate) {
  if (endDate === undefined || endDate === null || String(endDate).trim() === "") return endDate;
  return addDaysToDateText(endDate, 1);
}

export function getLingxingDateContract(endpoint) {
  return LINGXING_DATE_CONTRACTS[endpoint] || DEFAULT_LINGXING_DATE_CONTRACT;
}

export function withLingxingDateContract(endpoint, params = {}) {
  const contract = getLingxingDateContract(endpoint);
  const next = { ...params };
  const visibleEnds = [];
  const apiEnds = [];

  for (const key of contract.dateKeys) {
    const value = next[key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    visibleEnds.push(`${key}=${value}`);
    if (contract.boundary === "exclusive") {
      next[key] = lingxingExclusiveEndDate(value);
    }
    apiEnds.push(`${key}=${next[key]}`);
  }

  if (process.env.LINGXING_DATE_DEBUG === "1") {
    console.debug("[lingxing-date-contract]", {
      endpoint,
      boundary: contract.boundary,
      visibleEnd: visibleEnds.join(","),
      apiEnd: apiEnds.join(","),
    });
  }
  return next;
}

export function withLingxingExclusiveEndDate(params = {}, { endKeys = ["end_date", "endDate"] } = {}) {
  const next = { ...params };
  for (const key of endKeys) {
    if (next[key] !== undefined && next[key] !== null && String(next[key]).trim() !== "") {
      next[key] = lingxingExclusiveEndDate(next[key]);
    }
  }
  return next;
}

export function buildLingxingDateRangeParams(
  { startDate, endDate } = {},
  { startKey = "start_date", endKey = "end_date" } = {},
) {
  return {
    [startKey]: startDate,
    [endKey]: lingxingExclusiveEndDate(endDate),
  };
}
