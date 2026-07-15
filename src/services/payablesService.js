import { getConfig } from "../config/index.js";
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { formatDate, getPacificTodayDate } from "../utils/pacificDate.js";
import { normalizeRecordList, readFirst, toNumber } from "../utils/recordAccess.js";

const metricDocs = [
  ["供应商金额来源", "领星 ERP - 请款池 - 采购 - 现结货款。"],
  ["承运商金额来源", "领星 ERP - 请款池 - 头程款。"],
  ["其他应付金额来源", "领星 ERP - 费用管理 - 其他应付款。"],
  ["应付金额", "优先取请款池行的应付金额字段。若接口只返回采购金额/到货金额，则用采购金额或到货金额兜底。"],
  ["实付金额", "取请款池行的实付金额/已付金额字段。"],
  ["未付金额", "优先取请款池行未付金额；缺失时按应付金额 - 实付金额计算。"],
  ["未申请/申请中", "取请款池行对应字段，用于区分尚未进入请款和正在审批中的金额。"],
];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function defaultRange() {
  const end = getPacificTodayDate();
  return {
    startDate: formatDate(addDays(end, -29)),
    endDate: formatDate(end),
  };
}

function normalizeDateText(value) {
  if (!value) return "";
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : formatDate(date);
}

function monthText(value) {
  return normalizeDateText(value).slice(0, 7) || "未分月";
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function totalCountOf(payload, recordsLength = 0) {
  const data = payload?.data || payload || {};
  return Number(data.total ?? data.count ?? data.totalCount ?? payload?.total ?? recordsLength) || recordsLength;
}

function statusText(row) {
  const status = String(readFirst(row, [
    "status_text",
    "statusText",
    "payment_status_text",
    "paymentStatusText",
    "apply_status_text",
    "applyStatusText",
    "status",
  ]) || "");
  if (status) return status;
  const raw = String(readFirst(row, ["payment_status", "paymentStatus", "apply_status", "applyStatus"]) || "");
  if (raw === "0") return "未申请";
  if (raw === "1") return "申请中";
  if (raw === "2") return "已付清";
  if (raw === "3") return "部分付款";
  return raw || "-";
}

function normalizePayableRow(row, type) {
  const payableAmount = round(readFirst(row, [
    "payable_amount",
    "payableAmount",
    "amount_payable",
    "amountPayable",
    "need_pay_amount",
    "needPayAmount",
    "payment_amount",
    "paymentAmount",
    "apply_amount",
    "applyAmount",
    "total_amount",
    "totalAmount",
    "purchase_amount",
    "purchaseAmount",
    "arrive_amount",
    "arriveAmount",
    "arrival_amount",
    "arrivalAmount",
    "freight_amount",
    "freightAmount",
    "expense_amount",
    "expenseAmount",
    "fee_amount",
    "feeAmount",
    "other_payable_amount",
    "otherPayableAmount",
    "head_amount",
    "headAmount",
    "head_stock_cost",
  ]));
  const paidAmount = round(readFirst(row, [
    "paid_amount",
    "paidAmount",
    "actual_paid_amount",
    "actualPaidAmount",
    "real_pay_amount",
    "realPayAmount",
    "actual_amount",
    "actualAmount",
    "pay_amount",
    "payAmount",
  ]));
  const explicitUnpaid = readFirst(row, [
    "unpaid_amount",
    "unpaidAmount",
    "not_pay_amount",
    "notPayAmount",
    "remaining_amount",
    "remainingAmount",
    "wait_pay_amount",
    "waitPayAmount",
  ]);
  const unapplied = round(readFirst(row, [
    "not_apply_amount",
    "notApplyAmount",
    "unapplied_amount",
    "unappliedAmount",
    "not_requested_amount",
    "notRequestedAmount",
  ]));
  const applying = round(readFirst(row, [
    "applying_amount",
    "applyingAmount",
    "applying",
    "in_apply_amount",
    "inApplyAmount",
    "requesting_amount",
    "requestingAmount",
  ]));
  const unpaidAmount = explicitUnpaid === "" ? round(payableAmount - paidAmount) : round(explicitUnpaid);
  const date = normalizeDateText(readFirst(row, [
    "created_at",
    "createdAt",
    "create_time",
    "createTime",
    "bill_date",
    "billDate",
    "payment_time",
    "paymentTime",
    "date",
  ]));
  const nameKeys = {
    carrier: ["carrier_name", "carrierName", "logistics_provider_name", "logisticsProviderName", "logistics_name", "logisticsName", "provider_name", "providerName", "supplier_name", "supplierName", "name"],
    other: ["payee_name", "payeeName", "object_name", "objectName", "vendor_name", "vendorName", "supplier_name", "supplierName", "provider_name", "providerName", "name"],
    supplier: ["supplier_name", "supplierName", "provider_name", "providerName", "vendor_name", "vendorName", "name"],
  };
  const name = String(readFirst(row, nameKeys[type] || nameKeys.supplier) || "-").trim();

  return {
    category: type === "carrier" ? "头程款" : type === "other" ? "其他应付款" : "现结货款",
    org: String(readFirst(row, ["org_name", "orgName", "organization_name", "organizationName", "company_name", "companyName", "department_name", "departmentName"]) || ""),
    name,
    accountType: String(readFirst(row, ["request_dimension_text", "requestDimensionText", "dimension_text", "dimensionText", "payment_method_text", "paymentMethodText"]) || "-"),
    month: monthText(date),
    date,
    orderNo: String(readFirst(row, type === "carrier"
      ? ["freight_no", "freightNo", "shipment_no", "shipmentNo", "transport_no", "transportNo", "order_no", "orderNo", "sn"]
      : type === "other"
        ? ["expense_no", "expenseNo", "fee_no", "feeNo", "bill_no", "billNo", "order_no", "orderNo", "sn"]
        : ["purchase_order_no", "purchaseOrderNo", "purchase_order_sn", "purchaseOrderSn", "po_no", "poNo", "order_no", "orderNo", "sn"]) || ""),
    purchaser: String(readFirst(row, ["purchaser_name", "purchaserName", "buyer_name", "buyerName", "purchase_user_name", "purchaseUserName", "creator_name", "creatorName"]) || ""),
    status: statusText(row),
    purchaseQuantity: round(readFirst(row, ["purchase_quantity", "purchaseQuantity", "purchase_qty", "purchaseQty", "quantity", "qty"])),
    arrivedQuantity: round(readFirst(row, ["arrival_quantity", "arrivalQuantity", "arrive_quantity", "arriveQuantity", "received_quantity", "receivedQuantity"])),
    purchaseAmount: round(readFirst(row, ["purchase_amount", "purchaseAmount", "total_purchase_amount", "totalPurchaseAmount"])),
    arrivedAmount: round(readFirst(row, ["arrive_amount", "arriveAmount", "arrival_amount", "arrivalAmount", "received_amount", "receivedAmount"])),
    refundAmount: round(readFirst(row, ["refund_amount", "refundAmount", "return_amount", "returnAmount"])),
    payable: payableAmount,
    paid: paidAmount,
    unpaid: unpaidAmount,
    unapplied,
    applying,
    discountAmount: round(readFirst(row, ["discount_amount", "discountAmount", "deduction_amount", "deductionAmount"])),
    raw: row,
  };
}

function groupRows(rows, keys) {
  const grouped = rows.reduce((result, row) => {
    const id = keys.map((key) => row[key]).join("|");
    if (!result[id]) {
      result[id] = {
        category: row.category,
        org: row.org,
        name: row.name,
        accountType: keys.includes("accountType") ? row.accountType : "全部",
        month: keys.includes("month") ? row.month : "全部",
        payable: 0,
        paid: 0,
        unpaid: 0,
        unapplied: 0,
        applying: 0,
        purchaseAmount: 0,
        arrivedAmount: 0,
        refundAmount: 0,
        discountAmount: 0,
      };
    }
    result[id].payable += row.payable;
    result[id].paid += row.paid;
    result[id].unpaid += row.unpaid;
    result[id].unapplied += row.unapplied;
    result[id].applying += row.applying;
    result[id].purchaseAmount += row.purchaseAmount;
    result[id].arrivedAmount += row.arrivedAmount;
    result[id].refundAmount += row.refundAmount;
    result[id].discountAmount += row.discountAmount;
    return result;
  }, {});

  return Object.values(grouped).map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "number" ? round(value) : value]),
  ));
}

function summaryOf(rows) {
  const summary = rows.reduce((result, row) => {
    result.payable += row.payable;
    result.paid += row.paid;
    result.unpaid += row.unpaid;
    result.unapplied += row.unapplied;
    result.applying += row.applying;
    return result;
  }, { payable: 0, paid: 0, unpaid: 0, unapplied: 0, applying: 0 });
  return Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, round(value)]));
}

function monthlyRows(rows) {
  return groupRows(rows, ["month"]).map((row) => ({
    month: row.month,
    paid: row.paid,
    unpaid: row.unpaid,
    unapplied: row.unapplied,
    applying: row.applying,
  })).sort((a, b) => a.month.localeCompare(b.month));
}

function buildRequestParams({ startDate, endDate, keyword = "" }, offset = 0, length = 200) {
  const params = {
    offset,
    length,
    start_date: startDate,
    end_date: endDate,
    startDate,
    endDate,
    created_start_time: startDate,
    created_end_time: endDate,
    date_type: "create_time",
    dateType: "create_time",
    status: "",
  };
  if (keyword) {
    params.keyword = keyword;
    params.search_value = keyword;
    params.purchase_order_no = keyword;
  }
  return params;
}

async function fetchAllRows(call, filters, type) {
  const rows = [];
  let offset = 0;
  const length = 200;
  let lastPayload = null;
  for (let page = 0; page < 20; page += 1) {
    const payload = await call(buildRequestParams(filters, offset, length));
    lastPayload = payload;
    const records = normalizeRecordList(payload);
    rows.push(...records.map((record) => normalizePayableRow(record, type)));
    const total = totalCountOf(payload, records.length);
    if (!records.length || rows.length >= total || records.length < length) break;
    offset += length;
  }
  return { rows, payload: lastPayload };
}

function includesKeyword(value, keyword) {
  if (!keyword) return true;
  return String(value || "").toLowerCase().includes(String(keyword).trim().toLowerCase());
}

function applyFilters(rows, { supplier = "", carrier = "" }, type) {
  return rows.filter((row) => {
    if (type === "supplier" && !includesKeyword(row.name, supplier)) return false;
    if (type === "carrier" && !includesKeyword(row.name, carrier)) return false;
    return true;
  });
}

function emptyPayload(filters, message) {
  return {
    meta: {
	      source: "领星 ERP",
      syncStatus: message,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      requestRange: filters,
    },
	    summary: {
	      total: { payable: 0, paid: 0, unpaid: 0, unapplied: 0, applying: 0 },
	      supplier: { payable: 0, paid: 0, unpaid: 0, unapplied: 0, applying: 0 },
	      carrier: { payable: 0, paid: 0, unpaid: 0, unapplied: 0, applying: 0 },
	      other: { payable: 0, paid: 0, unpaid: 0, unapplied: 0, applying: 0 },
	    },
	    supplierMonthly: [],
	    carrierMonthly: [],
	    otherMonthly: [],
	    supplierRows: [],
	    carrierRows: [],
	    otherRows: [],
    forecastRows: [],
    metricDocs,
    filters: { supplierOptions: [], carrierOptions: [] },
  };
}

export async function getPayablesDashboard(filters = {}) {
  const fallback = defaultRange();
	  const normalizedFilters = {
	    startDate: normalizeDateText(filters.startDate) || fallback.startDate,
	    endDate: normalizeDateText(filters.endDate) || fallback.endDate,
	    supplier: String(filters.supplier || ""),
	    carrier: String(filters.carrier || ""),
	    keyword: String(filters.keyword || "").trim(),
  };
  if (normalizedFilters.startDate > normalizedFilters.endDate) {
    [normalizedFilters.startDate, normalizedFilters.endDate] = [normalizedFilters.endDate, normalizedFilters.startDate];
  }

  if (getConfig().dataProvider !== "lingxing") {
    return emptyPayload(normalizedFilters, "当前不是 lingxing 数据源，应付账款未显示模拟数据。");
  }

	  try {
	    const adapter = getLingxingAdapter();
	    const [supplierResult, carrierResult, otherResult] = await Promise.all([
	      fetchAllRows((params) => adapter.fetchPayablePurchasePool(params), normalizedFilters, "supplier"),
	      fetchAllRows((params) => adapter.fetchPayableFreightPool(params), normalizedFilters, "carrier"),
	      fetchAllRows((params) => adapter.fetchPayableOtherPool(params), normalizedFilters, "other"),
	    ]);
	    const supplierRows = applyFilters(supplierResult.rows, normalizedFilters, "supplier");
	    const carrierRows = applyFilters(carrierResult.rows, normalizedFilters, "carrier");
	    const otherRows = otherResult.rows;
	    const totalRows = [...supplierRows, ...carrierRows, ...otherRows];
	    const supplierSummary = summaryOf(supplierRows);
	    const carrierSummary = summaryOf(carrierRows);
	    const otherSummary = summaryOf(otherRows);
	    const totalSummary = summaryOf(totalRows);
	    const otherStatus = adapter.config.payableOtherEndpoint ? `其他应付款 ${otherRows.length} 条` : "其他应付款接口未配置";
	
	    return {
	      meta: {
	        source: "领星 ERP",
	        syncStatus: `供应商取 采购-现结货款 ${supplierRows.length} 条；承运商取 头程款 ${carrierRows.length} 条；${otherStatus}`,
	        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
	        requestRange: normalizedFilters,
	      },
	      summary: {
	        total: totalSummary,
	        supplier: supplierSummary,
	        carrier: carrierSummary,
	        other: otherSummary,
	      },
	      supplierMonthly: monthlyRows(supplierRows),
	      carrierMonthly: monthlyRows(carrierRows),
	      otherMonthly: monthlyRows(otherRows),
	      supplierRows,
	      carrierRows,
	      otherRows,
	      forecastRows: [],
      metricDocs,
      filters: {
        supplierOptions: [...new Set(supplierResult.rows.map((row) => row.name).filter(Boolean))].sort(),
        carrierOptions: [...new Set(carrierResult.rows.map((row) => row.name).filter(Boolean))].sort(),
      },
    };
  } catch (error) {
    const data = emptyPayload(normalizedFilters, `领星请款池读取失败：${error.message}`);
    data.error = error.message;
    data.details = error.details || null;
    throw Object.assign(new Error(data.meta.syncStatus), { payload: data });
  }
}
