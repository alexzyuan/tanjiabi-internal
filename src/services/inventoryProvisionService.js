import { getConfig } from "../config/index.js";
import { getLingxingAdapter, filterCoreSellers } from "../adapters/lingxingAdapter.js";
import { getPacificTodayText } from "../utils/pacificDate.js";
import {
  listInventoryProvisionSnapshots,
  readMskuDetailCache,
  readInventoryProvisionHistoryCache,
  readInventoryProvisionSnapshot,
  saveMskuDetailCache,
  saveInventoryProvisionHistoryCache,
  saveInventoryProvisionSnapshot,
} from "../utils/cacheStore.js";
import { listFilterValues, matchesAnyFilter } from "../utils/filterUtils.js";
import { getSharedSellers } from "./sharedDataService.js";
import { fetchLingxingListingsBySidMskus } from "./lingxingCatalogLookupService.js";

const ageBuckets = [
  { key: "0_30", label: "0-30天", min: 0, max: 30, rate: 0, color: "#ffbe55" },
  { key: "31_60", label: "31-60天", min: 31, max: 60, rate: 0, color: "#c05586" },
  { key: "61_90", label: "61-90天", min: 61, max: 90, rate: 0, color: "#c85ad6" },
  { key: "91_180", label: "91-180天", min: 91, max: 180, rate: 0.4, color: "#5d75e8" },
  { key: "181_270", label: "181-270天", min: 181, max: 270, rate: 0.8, color: "#15aebd" },
  { key: "271_plus", label: "271天及以上", min: 271, max: Infinity, rate: 1, color: "#ef6f73" },
];

const historicalOwnerSyncVersion = 4;
const provisionMovementBaselineMonth = "2026-03";
const provisionMovementStartMonth = "2026-04";
const emptyListingOwnerFilterValue = "__EMPTY_LISTING_OWNER__";

const mockInventoryRows = [
  ["xiamentanjia-US", "美国", "JM-009Bubble", "七色花泡泡机", "婷婷", 27, 1120, 18.5, 3],
  ["xiamentanjia-US", "美国", "JM-DGC-BLUE", "灯光船蓝色", "婷婷", 118, 780, 28.2, 4.6],
  ["xiamentanjia-US", "美国", "JM-GT-GR", "花园工具绿色", "Alex", 207, 148, 15.1, 3.5],
  ["xiamentanjia-US", "美国", "JM-Rabbit Pack Bubble", "双只兔子泡泡机", "婷婷", 286, 360, 13.2, 3],
  ["tandanbo-US", "美国", "MD-LEGPINK", "粉色洗碗机", "Max", 44, 960, 20.7, 3.7],
  ["tandanbo-US", "美国", "MD-DINOBATH", "恐龙浴缸玩具", "Max", 142, 520, 22.8, 4],
  ["tandanbo-US", "美国", "MD-2Pack Bubble Guns", "双只泡泡枪", "Deril", 236, 280, 14.6, 2.6],
  ["xiamentanjia-CA", "加拿大", "CA-NEWGT", "花园工具加拿大", "Alex", 68, 430, 17.6, 3.2],
  ["xiamentanjia-CA", "加拿大", "JMCA-009Bubble-Pink", "粉色泡泡机", "婷婷", 185, 310, 15.9, 2.6],
  ["tandanbo-CA", "加拿大", "CAMD-LEGBLUE-GM", "蓝色洗碗机英文版", "Max", 92, 620, 19.1, 3.6],
  ["tandanbo-CA", "加拿大", "CAMD-2Pack Bubble Guns", "双只泡泡枪加拿大", "Deril", 276, 410, 14.2, 2.7],
  ["xiamentanjia-AU", "澳洲", "JMAU-HDPPJ", "澳洲泡泡机", "婷婷", 38, 190, 21.7, 3.9],
  ["xiamentanjia-AU", "澳洲", "JMAU-WATERTOY", "澳洲戏水玩具", "Alex", 196, 120, 18.3, 3.8],
  ["tandanbo-AU", "澳洲", "MDAU-BOAT", "澳洲遥控船", "Deril", 314, 86, 25.2, 4.6],
].map(([storeName, country, msku, skuName, listingOwner, ageDays, quantity, purchaseCost, firstLegCost]) => ({
  storeName,
  country,
  msku,
  skuName,
  listingOwner,
  ageDays,
  quantity,
  purchaseCost,
  firstLegCost,
}));

const ageQuantityAliases = [
  { key: "0_30", ageDays: 15, keys: ["age0To30Qty", "age_0_30_qty", "age_0_30_quantity", "qty_0_30", "quantity_0_30", "stock_age_0_30", "inv_age_0_to_30_days"], amountKeys: ["inv_age_0_to_30_days_price", "age_0_30_amount"] },
  { key: "31_60", ageDays: 45, keys: ["age31To60Qty", "age_31_60_qty", "age_31_60_quantity", "qty_31_60", "quantity_31_60", "stock_age_31_60", "inv_age_31_to_60_days"], amountKeys: ["inv_age_31_to_60_days_price", "age_31_60_amount"] },
  { key: "61_90", ageDays: 75, keys: ["age61To90Qty", "age_61_90_qty", "age_61_90_quantity", "qty_61_90", "quantity_61_90", "stock_age_61_90", "inv_age_61_to_90_days"], amountKeys: ["inv_age_61_to_90_days_price", "age_61_90_amount"] },
  { key: "91_180", ageDays: 120, keys: ["age91To180Qty", "age_91_180_qty", "age_91_180_quantity", "qty_91_180", "quantity_91_180", "stock_age_91_180", "inv_age_91_to_180_days"], amountKeys: ["inv_age_91_to_180_days_price", "age_91_180_amount"] },
  { key: "181_270", ageDays: 210, keys: ["age181To270Qty", "age_181_270_qty", "age_181_270_quantity", "qty_181_270", "quantity_181_270", "stock_age_181_270", "inv_age_181_to_270_days"], amountKeys: ["inv_age_181_to_270_days_price", "age_181_270_amount"] },
  { key: "271_plus", ageDays: 300, keys: ["age271PlusQty", "age_271_plus_qty", "age_271_plus_quantity", "qty_271_plus", "quantity_271_plus", "stock_age_271_plus", "age_271_365_qty", "qty_271_365", "age_365_plus_qty", "qty_365_plus", "inv_age_271_to_365_days", "inv_age_365_plus_days"], amountKeys: ["inv_age_271_to_365_days_price", "inv_age_365_plus_days_price", "age_271_plus_amount"] },
];

function todayText() {
  return getPacificTodayText();
}

function monthText(value = todayText()) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : todayText().slice(0, 7);
}

function shiftMonth(value, delta) {
  const [year, month] = monthText(value).split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthDistance(later, earlier) {
  const [laterYear, laterMonth] = monthText(later).split("-").map(Number);
  const [earlierYear, earlierMonth] = monthText(earlier).split("-").map(Number);
  return laterYear * 12 + laterMonth - (earlierYear * 12 + earlierMonth);
}

function canCalculateProvisionMovement(month) {
  return monthDistance(month, provisionMovementStartMonth) >= 0;
}

function isProvisionMovementStartMonth(month) {
  return monthText(month) === provisionMovementStartMonth;
}

function bucketForAge(ageDays) {
  return ageBuckets.find((bucket) => ageDays >= bucket.min && ageDays <= bucket.max) || ageBuckets.at(-1);
}

function round(value, digits = 2) {
  const base = 10 ** digits;
  return Math.round(Number(value || 0) * base) / base;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Boolean))];
}

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function dateTextFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clearanceRecentSalesRange(days = 30) {
  const end = new Date(`${todayText()}T00:00:00`);
  const dayCount = Math.max(1, Number(days) || 30);
  const start = addDays(end, -(dayCount - 1));
  return {
    startDate: dateTextFromDate(start),
    endDate: dateTextFromDate(end),
  };
}

function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function readDeepFirst(item, keys, maxDepth = 4) {
  const direct = readFirst(item, keys);
  if (direct !== "") return direct;
  const normalized = new Set(keys.map((key) => String(key).toLowerCase()));
  let found = "";
  const visit = (value, depth = 0) => {
    if (found || !value || depth > maxDepth) return;
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    Object.entries(value).forEach(([key, child]) => {
      if (!found && normalized.has(String(key).toLowerCase()) && child !== undefined && child !== null && String(child).trim() !== "") {
        found = child;
        return;
      }
      visit(child, depth + 1);
    });
  };
  visit(item);
  return found;
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function readNameList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return readFirst(item, ["principal_name", "principalName", "name", "user_name", "userName", "real_name", "realName"]);
        }
        return item;
      })
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("、");
  }
  return String(value || "").trim();
}

function sellerName(seller) {
  return readFirst(seller, ["name", "seller_name", "shop_name", "store_name", "account_name"]) || "";
}

function sellerCountry(seller) {
  return readFirst(seller, ["country", "countryName", "country_name", "marketplace", "marketplaceName"]) || "";
}

function sellerCountryCode(seller) {
  return readFirst(seller, ["countryCode", "country_code", "region", "marketplaceCode"]) || "";
}

const marketplaceCurrencyCodes = Object.freeze({
  AE: "AED",
  AU: "AUD",
  BR: "BRL",
  CA: "CAD",
  DE: "EUR",
  ES: "EUR",
  FR: "EUR",
  GB: "GBP",
  IN: "INR",
  IT: "EUR",
  JP: "JPY",
  MX: "MXN",
  NL: "EUR",
  PL: "PLN",
  SA: "SAR",
  SE: "SEK",
  SG: "SGD",
  UK: "GBP",
  US: "USD",
});

function sellerCurrencyCode(seller = {}, record = {}) {
  const explicitCurrencyCode = String(readFirst(record, ["currency_code", "currencyCode", "currency"])
    || readFirst(seller, ["currency_code", "currencyCode", "currency"])
    || "").trim().toUpperCase();
  if (explicitCurrencyCode) return explicitCurrencyCode;
  const marketplace = String(sellerCountryCode(seller)
    || readFirst(record, ["country_code", "countryCode", "region", "marketplace"])
    || "").trim().toUpperCase();
  return marketplaceCurrencyCodes[marketplace] || "";
}

function listingOwner(record) {
  const list = readFirst(record, ["asin_principal_list", "listing_principal_list", "principal_list", "principal_info", "principalInfo"]);
  const listText = readNameList(list);
  if (listText) return listText;
  const text = readFirst(record, [
    "listing_owner",
    "listingOwner",
    "listing_principal",
    "listingPrincipal",
    "asin_principal",
    "asinPrincipal",
    "principal",
    "principal_name",
    "principalName",
  ]);
  return readNameList(text);
}

function ownerMapKey({ sid = "", country = "", countryCode = "", msku = "" } = {}) {
  return [
    String(sid || "").trim(),
    String(countryCode || country || "").trim().toUpperCase(),
    String(msku || "").trim().toLowerCase(),
  ].join("|");
}

function buildListingOwnerMap(rows = []) {
  const map = new Map();
  const ownersByMsku = new Map();
  rows.forEach((row) => {
    const owner = String(row.listingOwner || "").trim();
    if (!owner || owner === "-") return;
    const mskuKey = String(row.msku || "").trim().toLowerCase();
    if (mskuKey) {
      if (!ownersByMsku.has(mskuKey)) ownersByMsku.set(mskuKey, new Set());
      ownersByMsku.get(mskuKey).add(owner);
    }
    const keys = [
      ownerMapKey(row),
      ownerMapKey({ ...row, countryCode: "" }),
    ];
    keys.forEach((key) => {
      if (key && !map.has(key)) map.set(key, owner);
    });
  });
  ownersByMsku.forEach((owners, msku) => {
    if (owners.size !== 1) return;
    const owner = [...owners][0];
    const key = ownerMapKey({ sid: "", countryCode: "", msku });
    if (key && !map.has(key)) map.set(key, owner);
  });
  return map;
}

function findListingOwner(ownerMap, row) {
  return ownerMap.get(ownerMapKey(row))
    || ownerMap.get(ownerMapKey({ ...row, countryCode: "" }))
    || ownerMap.get(ownerMapKey({ sid: "", countryCode: "", msku: row?.msku || "" }))
    || "-";
}

function listingOwnerRow(record, fallback = {}) {
  const msku = readNameList(readFirst(record, ["msku", "m_sku", "seller_sku", "sellerSku", "sellerSkuStr", "local_sku", "item_sku", "fnsku"])).trim();
  const owner = listingOwner(record);
  if (!msku || !owner) return null;
  return {
    sid: toNumber(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"])) || fallback.sid || 0,
    countryCode: readFirst(record, ["country_code", "countryCode", "region", "marketplace"]) || fallback.countryCode || "",
    country: readFirst(record, ["country", "country_name", "countryName", "marketplace"]) || fallback.country || "",
    msku,
    listingOwner: owner,
  };
}

async function fetchListingOwnerRows(adapter, rows = []) {
  const rowsBySid = new Map();
  rows.forEach((row) => {
    const sid = Number(row.sid || 0);
    const msku = String(row.msku || "").trim();
    if (!sid || !msku) return;
    if (!rowsBySid.has(sid)) rowsBySid.set(sid, []);
    rowsBySid.get(sid).push(row);
  });

  const ownerRows = [];
  for (const [sid, sidRows] of rowsBySid.entries()) {
    const sellerMskus = uniqueText(sidRows.map((row) => row.msku));
    const fallback = { sid, country: sidRows[0]?.country || "", countryCode: sidRows[0]?.countryCode || "" };
    const records = await fetchLingxingListingsBySidMskus(adapter, sid, sellerMskus, {
      batchSize: 50,
      normalize: (payload) => adapter.normalizeRecordList(payload),
    });
    records
      .map((record) => listingOwnerRow(record, fallback))
      .filter(Boolean)
      .forEach((row) => ownerRows.push(row));
  }
  return ownerRows;
}

function buildSellerMap(sellers = []) {
  return new Map(
    sellers
      .map((seller) => [Number(seller.sid || seller.seller_id || seller.sellerId), seller])
      .filter(([sid]) => Number.isFinite(sid) && sid > 0),
  );
}

function fbaTotalInventory(record) {
  const available = toNumber(readDeepFirst(record, [
    "afn_fulfillable_quantity",
    "total_fulfillable_quantity",
    "amazon_quantity_available",
    "amazonQuantityAvailable",
    "amazon_quantity_fulfillable",
    "amazonQuantityFulfillable",
    "fba_available_quantity",
    "fbaAvailableQuantity",
    "fba_available",
    "fbaAvailable",
    "available_quantity",
    "availableQuantity",
    "fulfillable_quantity",
    "fulfillableQuantity",
  ]));
  const reservedTransfer = toNumber(readDeepFirst(record, [
    "reserved_fc_transfers",
    "reservedFcTransfers",
    "amazon_quantity_waiting",
    "amazonQuantityWaiting",
    "transfer_quantity",
    "transferQuantity",
    "fba_transfer",
    "fbaTransfer",
  ]));
  const reservedProcessing = toNumber(readDeepFirst(record, ["reserved_fc_processing", "reservedFcProcessing"]));
  const reservedCustomerOrders = toNumber(readDeepFirst(record, ["reserved_customerorders", "reserved_customer_orders", "reservedCustomerOrders"]));
  const directReserved = toNumber(readDeepFirst(record, [
    "afn_reserved_quantity",
    "reserved_quantity",
    "reservedQuantity",
    "fba_reserved_quantity",
    "fbaReservedQuantity",
    "fba_reserved",
    "fbaReserved",
  ]));
  const reserved = Math.max(directReserved, reservedProcessing + reservedCustomerOrders);
  if (available || reservedTransfer || reserved) return available + reservedTransfer + reserved;
  return toNumber(readDeepFirst(record, [
    "fba_total_quantity",
    "fbaTotalQuantity",
    "fba_total_inventory",
    "fbaTotalInventory",
    "amazon_quantity_valid",
    "amazonQuantityValid",
    "available_total",
    "total_fulfillable_quantity",
    "afn_fulfillable_quantity",
    "fba_available_quantity",
    "available_quantity",
  ]));
}

function baseLingxingInventoryRow(record, sellersBySid) {
  const sid = toNumber(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"]));
  const seller = sellersBySid.get(sid) || {};
  const countryCode = readFirst(record, ["country_code", "countryCode", "region", "marketplace"]) || sellerCountryCode(seller) || "";
  const purchaseCost = toNumber(readFirst(record, [
    "unit_purchase_cost",
    "purchase_cost",
    "purchaseCost",
    "purchase_price",
    "purchasePrice",
    "local_purchase_cost",
    "product_purchase_cost",
    "cg_price",
    "unit_cg_price",
  ]));
  const firstLegCost = toNumber(readFirst(record, [
    "unit_first_leg_fee",
    "first_leg_cost",
    "firstLegCost",
    "first_transport_fee",
    "head_cost",
    "unit_head_cost",
    "unit_shipping_cost",
    "freight_cost",
    "cg_transport_costs",
    "unit_cg_transport_costs",
  ]));
  const totalInventory = fbaTotalInventory(record);
  const inventoryAmount = toNumber(readFirst(record, [
    "total_amount",
    "totalAmount",
    "inventory_amount",
    "inventoryAmount",
    "total_inventory_amount",
  ]));
  const historicalDaysOfSupply = toNumber(readFirst(record, [
    "historical_days_of_supply",
    "historicalDaysOfSupply",
    "days_of_supply",
    "daysOfSupply",
  ]));
  const estimatedStorageCostNextMonth = toNumber(readFirst(record, [
    "estimated_storage_cost_next_month",
    "estimatedStorageCostNextMonth",
    "next_month_storage_fee",
    "nextMonthStorageFee",
    "estimated_storage_fee",
    "estimatedStorageFee",
    "monthly_storage_fee",
    "monthlyStorageFee",
  ]));

  return {
    sid,
    sellerId: readFirst(seller, ["seller_id", "sellerId"]) || readFirst(record, ["seller_id", "sellerId"]) || "",
    countryCode,
    currencyCode: sellerCurrencyCode(seller, record),
    storeName: sellerName(seller) || readFirst(record, ["store_name", "storeName", "seller_name", "sellerName"]) || `${sid || "-"}`,
    country: sellerCountry(seller) || readFirst(record, ["country", "country_name", "countryName", "marketplace"]) || "",
    msku: readFirst(record, ["msku", "seller_sku", "sellerSku", "fnsku", "sku"]) || "",
    fnsku: readFirst(record, ["fnsku", "FNSKU"]) || "",
    listingOwner: listingOwner(record) || "-",
    skuName: readFirst(record, ["sku_name", "skuName", "local_name", "product_name", "productName", "item_name", "title"]) || "",
    purchaseCost,
    firstLegCost,
    totalInventory,
    inventoryAmount,
    historicalDaysOfSupply,
    estimatedStorageCostNextMonth,
  };
}

function readAgeBucketQuantity(record, alias) {
  if (alias.key !== "271_plus") return toNumber(readFirst(record, alias.keys));
  const directValue = toNumber(readFirst(record, alias.keys.slice(0, 6)));
  if (directValue) return directValue;
  const old271To365 = toNumber(readFirst(record, ["age_271_365_qty", "qty_271_365", "quantity_271_365"]));
  const new271To365 = toNumber(readFirst(record, ["inv_age_271_to_365_days"]));
  const split271To365 = toNumber(readFirst(record, ["inv_age_271_to_330_days"]))
    + toNumber(readFirst(record, ["inv_age_331_to_365_days"]));
  const over365 = toNumber(readFirst(record, ["age_365_plus_qty", "qty_365_plus", "quantity_365_plus", "stock_age_365_plus", "inv_age_365_plus_days"]));
  return (new271To365 || old271To365 || split271To365) + over365;
}

function normalizeLingxingInventoryRows(records = [], sellers = []) {
  const sellersBySid = buildSellerMap(sellers);
  const rows = [];

  records.forEach((record) => {
    const base = baseLingxingInventoryRow(record, sellersBySid);
    const bucketQuantities = ageQuantityAliases
      .map((alias) => ({ ...alias, quantity: readAgeBucketQuantity(record, alias), amount: toNumber(readFirst(record, alias.amountKeys || [])) }))
      .filter((item) => item.quantity > 0);

    if (bucketQuantities.length) {
      const totalAgeQuantity = bucketQuantities.reduce((total, item) => total + Number(item.quantity || 0), 0);
      const storageAllocationBase = base.totalInventory || totalAgeQuantity;
      bucketQuantities.forEach((item) => {
        const storageShare = storageAllocationBase ? Number(item.quantity || 0) / storageAllocationBase : 0;
        rows.push({
          ...base,
          ageDays: item.ageDays,
          quantity: item.quantity,
          ageBucketAmount: item.amount,
          estimatedStorageCostAllocation: round(Number(base.estimatedStorageCostNextMonth || 0) * storageShare),
          storageFeeAllocationRate: round(storageShare * 100, 4),
        });
      });
      return;
    }

    rows.push({
      ...base,
      ageDays: toNumber(readFirst(record, [
        "age_days",
        "ageDays",
        "inventory_age",
        "inventoryAge",
        "storage_age_days",
        "storageAgeDays",
        "fba_inventory_age",
      ])),
      quantity: toNumber(readFirst(record, [
        "fba_available_quantity",
        "fbaAvailableQuantity",
        "fba_available",
        "available_quantity",
        "availableQuantity",
        "afn_fulfillable_quantity",
        "quantity",
        "qty",
        "stock_quantity",
      ])),
      ageBucketAmount: base.inventoryAmount,
      estimatedStorageCostAllocation: Number(base.estimatedStorageCostNextMonth || 0),
      storageFeeAllocationRate: 100,
    });
  });

  return rows.filter((row) => row.quantity > 0 && row.msku);
}

const costModes = {
  purchase: {
    key: "purchase",
    label: "采购成本",
    description: "按单位采购成本计算",
  },
  landed: {
    key: "landed",
    label: "采购成本 + 单位头程费用",
    description: "按单位采购成本加单位头程费用计算",
  },
};

function resolveCostMode(value) {
  return costModes[value] || costModes.purchase;
}

function toProvisionRow(row, costMode = costModes.purchase) {
  const bucket = bucketForAge(Number(row.ageDays || 0));
  const purchaseCost = Number(row.purchaseCost || 0);
  const firstLegCost = Number(row.firstLegCost || 0);
  const unitCost = round(costMode.key === "landed" ? purchaseCost + firstLegCost : purchaseCost);
  const amount = round(Number(row.quantity || 0) * unitCost);
  return {
    ...row,
    purchaseCost,
    firstLegCost,
    unitCost,
    bucketKey: bucket.key,
    bucketLabel: bucket.label,
    provisionRate: bucket.rate,
    amount,
    provisionAmount: round(amount * bucket.rate),
  };
}

function sumBy(rows, field) {
  return round(rows.reduce((total, row) => total + Number(row[field] || 0), 0));
}

function groupBucketAmounts(rows, movementRows = [], { useEndingProvisionAsNet = false } = {}) {
  const totalAmount = sumBy(rows, "amount");
  const movementByBucket = movementRows.reduce((map, row) => {
    const key = row.reversalBucketKey || row.monthlyProvisionBucketKey || "";
    if (!key) return map;
    if (!map[key]) map[key] = { monthlyProvisionAmount: 0, reversalAmount: 0 };
    if (row.monthlyProvisionAmount > 0) {
      map[key].monthlyProvisionAmount = round(map[key].monthlyProvisionAmount + row.monthlyProvisionAmount);
    }
    if (row.reversalAmount > 0 && row.reversalBucketKey) {
      map[key].reversalAmount = round(map[key].reversalAmount + row.reversalAmount);
    }
    return map;
  }, {});
  return ageBuckets.map((bucket) => {
    const bucketRows = rows.filter((row) => row.bucketKey === bucket.key);
    const amount = sumBy(bucketRows, "amount");
    const provisionAmount = sumBy(bucketRows, "provisionAmount");
    const monthlyProvisionAmount = movementByBucket[bucket.key]?.monthlyProvisionAmount || 0;
    const reversalAmount = movementByBucket[bucket.key]?.reversalAmount || 0;
    return {
      ...bucket,
      amount,
      provisionAmount,
      monthlyProvisionAmount,
      reversalAmount,
      netProvisionAmount: useEndingProvisionAsNet ? provisionAmount : round(monthlyProvisionAmount - reversalAmount),
      percent: totalAmount ? round((amount / totalAmount) * 100) : 0,
    };
  });
}

function groupStoreAmounts(rows) {
  const storeNames = [...new Set(rows.map((row) => row.storeName))];
  return storeNames.map((storeName) => {
    const storeRows = rows.filter((row) => row.storeName === storeName);
    const values = Object.fromEntries(ageBuckets.map((bucket) => [
      bucket.key,
      sumBy(storeRows.filter((row) => row.bucketKey === bucket.key), "amount"),
    ]));
    const amount = sumBy(storeRows, "amount");
    const provisionAmount = sumBy(storeRows, "provisionAmount");
    return {
      storeName,
      country: storeRows[0]?.country || "",
      values,
      amount,
      provisionAmount,
      provisionRate: amount ? round((provisionAmount / amount) * 100) : 0,
    };
  }).sort((left, right) => right.provisionAmount - left.provisionAmount);
}

function filterSourceRows(sourceRows, { country, storeName, owner, keyword }) {
  return sourceRows
    .filter((row) => matchesAnyFilter(row.country, country))
    .filter((row) => matchesAnyFilter(row.storeName, storeName))
    .filter((row) => {
      if (!owner) return true;
      const listingOwner = String(row.listingOwner || "").trim();
      if (owner === emptyListingOwnerFilterValue) return !listingOwner || listingOwner === "-";
      return listingOwner === owner;
    })
    .filter((row) => !keyword || `${row.msku} ${row.skuName} ${row.listingOwner}`.toLowerCase().includes(keyword));
}

function provisionEntityKey(row) {
  return [
    String(row.storeName || "").trim(),
    String(row.country || "").trim(),
    String(row.msku || "").trim(),
  ].join("|").toLowerCase();
}

function groupProvisionRows(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = provisionEntityKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        rows: [],
        provisionAmount: 0,
      });
    }
    const group = groups.get(key);
    group.rows.push(row);
    group.provisionAmount = round(group.provisionAmount + Number(row.provisionAmount || 0));
  });
  return groups;
}

function groupRowsByValue(rows, valueGetter) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = valueGetter(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        rows: [],
        quantity: 0,
        provisionAmount: 0,
      });
    }
    const group = groups.get(key);
    group.rows.push(row);
    group.quantity = round(group.quantity + Number(row.quantity || 0));
    group.provisionAmount = round(group.provisionAmount + Number(row.provisionAmount || 0));
  });
  return groups;
}

function hasCompleteCohortMonths(rows) {
  return rows.every((row) => String(row.cohortMonth || "").trim());
}

function canUseCohortProvisionMovements(currentRows, previousRows) {
  const rows = currentRows.concat(previousRows);
  return rows.length > 0 && hasCompleteCohortMonths(rows);
}

function addBucketMovementRow(bucketMovementRows, movement) {
  if (movement.monthlyProvisionAmount > 0) {
    bucketMovementRows.push({
      monthlyProvisionAmount: movement.monthlyProvisionAmount,
      monthlyProvisionBucketKey: movement.monthlyProvisionBucketKey || "",
    });
  }
  if (movement.reversalAmount > 0) {
    bucketMovementRows.push({
      reversalAmount: movement.reversalAmount,
      reversalBucketKey: movement.reversalBucketKey || "",
    });
  }
}

function distributeMovementToRows(rows, amount, field, bucketField, bucketKey) {
  if (!rows.length || amount <= 0) return;
  const positiveRows = rows.filter((row) => Number(row.provisionAmount || 0) > 0);
  const targetRows = positiveRows.length ? positiveRows : rows;
  const totalWeight = sumBy(targetRows, positiveRows.length ? "provisionAmount" : "quantity");
  let remaining = amount;
  targetRows.forEach((row, index) => {
    const weight = positiveRows.length ? Number(row.provisionAmount || 0) : Number(row.quantity || 0);
    const movementAmount = index === targetRows.length - 1
      ? remaining
      : totalWeight
        ? round(amount * weight / totalWeight)
        : 0;
    if (movementAmount <= 0) return;
    remaining = round(remaining - movementAmount);
    row[field] = round(Number(row[field] || 0) + movementAmount);
    row[bucketField] = row[bucketField] || bucketKey || "";
  });
}

function addReversalToBucketRows(targetRows, previousRows, reversalAmount) {
  const positiveRows = previousRows.filter((row) => row.provisionAmount > 0);
  const previousProvisionAmount = sumBy(positiveRows, "provisionAmount");
  if (!positiveRows.length || !previousProvisionAmount) return;

  let remaining = reversalAmount;
  positiveRows.forEach((row, index) => {
    const amount = index === positiveRows.length - 1
      ? remaining
      : round(reversalAmount * Number(row.provisionAmount || 0) / previousProvisionAmount);
    if (amount <= 0) return;
    remaining = round(remaining - amount);
    targetRows.push({
      reversalAmount: amount,
      reversalBucketKey: row.bucketKey,
    });
  });
}

function addMonthlyProvisionToRows(currentRows, monthlyProvisionAmount) {
  const positiveRows = currentRows.filter((row) => row.provisionAmount > 0);
  const currentProvisionAmount = sumBy(positiveRows, "provisionAmount");
  if (!positiveRows.length || !currentProvisionAmount) return [];

  const movementRows = [];
  let remaining = monthlyProvisionAmount;
  positiveRows.forEach((row, index) => {
    const amount = index === positiveRows.length - 1
      ? remaining
      : round(monthlyProvisionAmount * Number(row.provisionAmount || 0) / currentProvisionAmount);
    if (amount <= 0) return;
    remaining = round(remaining - amount);
    row.monthlyProvisionAmount = round(Number(row.monthlyProvisionAmount || 0) + amount);
    row.monthlyProvisionBucketKey = row.monthlyProvisionBucketKey || row.bucketKey;
    movementRows.push({
      monthlyProvisionAmount: amount,
      monthlyProvisionBucketKey: row.bucketKey,
    });
  });
  return movementRows;
}

function buildReversalOnlyRow(previousRows, reversalAmount) {
  const [base] = previousRows
    .slice()
    .sort((left, right) => Number(right.provisionAmount || 0) - Number(left.provisionAmount || 0));
  if (!base) return null;
  return {
    ...base,
    ageDays: 0,
    quantity: 0,
    amount: 0,
    provisionAmount: 0,
    monthlyProvisionAmount: 0,
    provisionRate: 0,
    bucketKey: "released",
    bucketLabel: "本期已售/库存减少",
    reversalAmount,
    reversalBucketKey: base.bucketKey,
    netProvisionAmount: -reversalAmount,
    released: true,
  };
}

function applyAggregateProvisionMovementForGroup({
  currentGroup,
  previousGroup,
  bucketMovementRows,
  reversalOnlyRows,
}) {
  let monthlyProvisionAmount = 0;
  let reversalAmount = 0;
  const currentProvisionAmount = currentGroup?.provisionAmount || 0;
  const previousProvisionAmount = previousGroup?.provisionAmount || 0;

  const groupMonthlyProvisionAmount = round(currentProvisionAmount - previousProvisionAmount);
  if (groupMonthlyProvisionAmount > 0 && currentGroup?.rows?.length) {
    monthlyProvisionAmount = groupMonthlyProvisionAmount;
    bucketMovementRows.push(...addMonthlyProvisionToRows(currentGroup.rows, groupMonthlyProvisionAmount));
  }

  const groupReversalAmount = round(previousProvisionAmount - currentProvisionAmount);
  if (groupReversalAmount > 0 && previousGroup?.rows?.length) {
    reversalAmount = groupReversalAmount;
    addReversalToBucketRows(bucketMovementRows, previousGroup.rows, groupReversalAmount);

    if (currentGroup?.rows?.length) {
      const [target] = currentGroup.rows
        .slice()
        .sort((left, right) => Number(right.provisionAmount || 0) - Number(left.provisionAmount || 0));
      target.reversalAmount = round(Number(target.reversalAmount || 0) + groupReversalAmount);
      target.reversalBucketKey = target.reversalBucketKey || previousGroup.rows.find((row) => row.provisionAmount > 0)?.bucketKey || "";
    } else {
      const releasedRow = buildReversalOnlyRow(previousGroup.rows, groupReversalAmount);
      if (releasedRow) reversalOnlyRows.push(releasedRow);
    }
  }

  return { monthlyProvisionAmount, reversalAmount };
}

function applyCohortProvisionMovementForGroup({
  currentGroup,
  previousGroup,
  bucketMovementRows,
  reversalOnlyRows,
}) {
  const currentCohorts = groupRowsByValue(currentGroup?.rows || [], (row) => String(row.cohortMonth || "").trim());
  const previousCohorts = groupRowsByValue(previousGroup?.rows || [], (row) => String(row.cohortMonth || "").trim());
  const cohortKeys = new Set([...currentCohorts.keys(), ...previousCohorts.keys()]);
  let monthlyProvisionAmount = 0;
  let reversalAmount = 0;

  cohortKeys.forEach((cohortKey) => {
    const currentCohort = currentCohorts.get(cohortKey);
    const previousCohort = previousCohorts.get(cohortKey);
    const currentQuantity = currentCohort?.quantity || 0;
    const previousQuantity = previousCohort?.quantity || 0;
    const currentProvisionAmount = currentCohort?.provisionAmount || 0;
    const previousProvisionAmount = previousCohort?.provisionAmount || 0;
    const currentProvisionPerUnit = currentQuantity ? currentProvisionAmount / currentQuantity : 0;
    const previousProvisionPerUnit = previousQuantity ? previousProvisionAmount / previousQuantity : 0;
    const matchedQuantity = Math.min(currentQuantity, previousQuantity);
    const consumedQuantity = Math.max(0, previousQuantity - currentQuantity);
    const newQuantity = Math.max(0, currentQuantity - previousQuantity);
    const retainedIncrease = round(matchedQuantity * Math.max(0, currentProvisionPerUnit - previousProvisionPerUnit));
    const retainedDecrease = round(matchedQuantity * Math.max(0, previousProvisionPerUnit - currentProvisionPerUnit));
    const newProvision = round(newQuantity * currentProvisionPerUnit);
    const consumedReversal = round(consumedQuantity * previousProvisionPerUnit);
    const cohortMonthlyProvisionAmount = round(retainedIncrease + newProvision);
    const cohortReversalAmount = round(retainedDecrease + consumedReversal);
    const monthlyBucketKey = currentCohort?.rows?.find((row) => row.provisionAmount > 0)?.bucketKey || "";
    const reversalBucketKey = previousCohort?.rows?.find((row) => row.provisionAmount > 0)?.bucketKey || "";

    if (cohortMonthlyProvisionAmount > 0 && currentCohort?.rows?.length) {
      monthlyProvisionAmount = round(monthlyProvisionAmount + cohortMonthlyProvisionAmount);
      distributeMovementToRows(currentCohort.rows, cohortMonthlyProvisionAmount, "monthlyProvisionAmount", "monthlyProvisionBucketKey", monthlyBucketKey);
      addBucketMovementRow(bucketMovementRows, {
        monthlyProvisionAmount: cohortMonthlyProvisionAmount,
        monthlyProvisionBucketKey: monthlyBucketKey,
      });
    }

    if (cohortReversalAmount <= 0) return;

    reversalAmount = round(reversalAmount + cohortReversalAmount);
    addBucketMovementRow(bucketMovementRows, {
      reversalAmount: cohortReversalAmount,
      reversalBucketKey,
    });

    if (currentCohort?.rows?.length) {
      distributeMovementToRows(currentCohort.rows, cohortReversalAmount, "reversalAmount", "reversalBucketKey", reversalBucketKey);
      return;
    }

    const releasedRow = buildReversalOnlyRow(previousCohort?.rows || [], cohortReversalAmount);
    if (releasedRow) reversalOnlyRows.push(releasedRow);
  });

  return { monthlyProvisionAmount, reversalAmount };
}

export function applyProvisionMovements(currentRows, previousRows) {
  const rows = currentRows.map((row) => ({
    ...row,
    monthlyProvisionAmount: 0,
    monthlyProvisionBucketKey: "",
    reversalAmount: 0,
    reversalBucketKey: "",
    netProvisionAmount: 0,
  }));
  const currentGroups = groupProvisionRows(rows);
  const previousGroups = groupProvisionRows(previousRows);
  const reversalOnlyRows = [];
  const bucketMovementRows = [];
  let monthlyProvisionAmount = 0;
  let reversalAmount = 0;

  const groupKeys = new Set([...currentGroups.keys(), ...previousGroups.keys()]);
  groupKeys.forEach((key) => {
    const currentGroup = currentGroups.get(key);
    const previousGroup = previousGroups.get(key);
    const movement = canUseCohortProvisionMovements(currentGroup?.rows || [], previousGroup?.rows || [])
      ? applyCohortProvisionMovementForGroup({
        currentGroup,
        previousGroup,
        bucketMovementRows,
        reversalOnlyRows,
      })
      : applyAggregateProvisionMovementForGroup({
        currentGroup,
        previousGroup,
        bucketMovementRows,
        reversalOnlyRows,
      });
    monthlyProvisionAmount = round(monthlyProvisionAmount + movement.monthlyProvisionAmount);
    reversalAmount = round(reversalAmount + movement.reversalAmount);
  });

  rows.forEach((row) => {
    row.netProvisionAmount = round(Number(row.monthlyProvisionAmount || 0) - Number(row.reversalAmount || 0));
  });

  return {
    rows: rows.concat(reversalOnlyRows),
    bucketMovementRows,
    monthlyProvisionAmount,
    reversalAmount,
    netProvisionAmount: round(monthlyProvisionAmount - reversalAmount),
  };
}

function buildInitialProvisionMovements(currentRows) {
  return {
    rows: currentRows.map((row) => ({
      ...row,
      monthlyProvisionAmount: 0,
      monthlyProvisionBucketKey: "",
      reversalAmount: 0,
      reversalBucketKey: "",
      netProvisionAmount: 0,
    })),
    bucketMovementRows: [],
    monthlyProvisionAmount: 0,
    reversalAmount: 0,
    netProvisionAmount: 0,
  };
}

function inventoryProvisionSummaryKey(row) {
  return [
    String(row.storeName || "").trim(),
    String(row.country || "").trim(),
    String(row.msku || "").trim(),
    String(row.listingOwner || "").trim(),
  ].join("|").toLowerCase();
}

function buildInventoryProvisionSummaryRows(batchRows = []) {
  const groups = new Map();
  batchRows.forEach((row) => {
    const key = inventoryProvisionSummaryKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        rowKey: key,
        storeName: row.storeName || "",
        country: row.country || "",
        msku: row.msku || "",
        skuName: row.skuName || "",
        listingOwner: row.listingOwner || "",
        quantity: 0,
        amount: 0,
        provisionAmount: 0,
        monthlyProvisionAmount: 0,
        reversalAmount: 0,
        netProvisionAmount: 0,
        batchRows: [],
      });
    }
    const group = groups.get(key);
    if (!group.skuName && row.skuName) group.skuName = row.skuName;
    group.quantity = round(group.quantity + Number(row.quantity || 0));
    group.amount = round(group.amount + Number(row.amount || 0));
    group.provisionAmount = round(group.provisionAmount + Number(row.provisionAmount || 0));
    group.monthlyProvisionAmount = round(group.monthlyProvisionAmount + Number(row.monthlyProvisionAmount || 0));
    group.reversalAmount = round(group.reversalAmount + Number(row.reversalAmount || 0));
    group.netProvisionAmount = round(group.netProvisionAmount + Number(row.netProvisionAmount || 0));
    group.batchRows.push(row);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      batchRows: group.batchRows.slice().sort((left, right) => (
        Math.max(Math.abs(Number(right.netProvisionAmount || 0)), Number(right.provisionAmount || 0))
        - Math.max(Math.abs(Number(left.netProvisionAmount || 0)), Number(left.provisionAmount || 0))
      )),
    }))
    .sort((left, right) => (
      Math.max(Math.abs(Number(right.netProvisionAmount || 0)), Number(right.provisionAmount || 0))
      - Math.max(Math.abs(Number(left.netProvisionAmount || 0)), Number(left.provisionAmount || 0))
    ));
}

function buildSnapshotTrendRow(date, sourceRows, filters, costMode) {
  const rows = filterSourceRows(sourceRows, filters).map((row) => toProvisionRow(row, costMode));
  return {
    month: date.slice(5, 7).replace(/^0/, "") + "月",
    date,
    values: Object.fromEntries(ageBuckets.map((bucket) => [
      bucket.key,
      sumBy(rows.filter((row) => row.bucketKey === bucket.key), "amount"),
    ])),
  };
}

async function buildMonthTrend(snapshotDates, filters, costMode) {
  const latestByMonth = new Map();
  snapshotDates.forEach((date) => {
    const month = date.slice(0, 7);
    if (!latestByMonth.has(month) || latestByMonth.get(month) < date) latestByMonth.set(month, date);
  });
  const dates = [...latestByMonth.values()].sort().slice(-5);
  const snapshots = await Promise.all(dates.map((date) => readInventoryProvisionSnapshot(date)));
  return snapshots
    .map((snapshot, index) => snapshot?.data?.rows?.length
      ? buildSnapshotTrendRow(dates[index], snapshot.data.rows, filters, costMode)
      : null)
    .filter(Boolean);
}

export async function loadFbaInventoryDetailRows({
  sellersOverride = null,
  adapter = getLingxingAdapter(),
  getSellers = getSharedSellers,
} = {}) {
  const sellers = sellersOverride?.length
    ? filterCoreSellers(sellersOverride)
    : filterCoreSellers((await getSellers({ adapter })).sellers || []);
  const sids = uniqueNumbers(sellers.map((seller) => seller.sid));
  const records = await adapter.fetchAllFbaInventoryDetails(sids);
  return {
    rows: normalizeLingxingInventoryRows(records, sellers),
    sellers,
    rawCount: records.length,
  };
}

async function loadInventoryRowsFromLingxing(sellersOverride = null) {
  return loadFbaInventoryDetailRows({ sellersOverride });
}

function clearanceSalesKey(row) {
  return `${Number(row.sid || 0)}|${String(row.msku || "").trim().toLowerCase()}`;
}

function clearanceStorageFeeKey(row) {
  return `${Number(row.sid || 0)}|${String(row.fnsku || "").trim().toLowerCase()}`;
}

function clearanceInventoryGroupKey(row) {
  return [
    Number(row.sid || 0),
    String(row.storeName || "").trim().toLowerCase(),
    String(row.msku || "").trim().toLowerCase(),
    String(row.fnsku || "").trim().toLowerCase(),
  ].join("|");
}

function groupClearanceInventoryRows(detailRows = [], includeFinancials = false) {
  const groups = new Map();
  detailRows
    .filter((row) => !row.released && Number(row.quantity || 0) > 0)
    .forEach((row) => {
      const key = clearanceInventoryGroupKey(row);
      if (!groups.has(key)) {
        groups.set(key, {
          sid: Number(row.sid || 0),
          storeName: row.storeName || "",
          country: row.country || "",
          msku: row.msku || "",
          fnsku: row.fnsku || "",
          productName: row.skuName || "",
          listingOwner: row.listingOwner && row.listingOwner !== "-" ? row.listingOwner : "",
          ageDays: 0,
          ageBuckets: new Set(),
          ageBucket: "",
          ageBucketInventory: 0,
          inventory: 0,
          purchaseCost: includeFinancials ? Number(row.purchaseCost || 0) : "",
          firstLegCost: includeFinancials ? Number(row.firstLegCost || 0) : "",
          unitCost: includeFinancials ? Number(row.unitCost || row.purchaseCost || 0) : "",
          totalInventory: Number(row.totalInventory || 0),
          totalEstimatedStorageCostNextMonth: round(Number(row.estimatedStorageCostNextMonth || 0)),
          estimatedStorageCostAllocation: 0,
          monthlyStorageFee: 0,
          dailyStorageFee: 0,
          storageFeeAllocationRate: Number(row.storageFeeAllocationRate || 0),
        });
      }
      const target = groups.get(key);
      const quantity = Number(row.quantity || 0);
      target.ageBucketInventory = round(Number(target.ageBucketInventory || 0) + quantity);
      target.totalInventory = Math.max(Number(target.totalInventory || 0), Number(row.totalInventory || 0));
      target.inventory = target.totalInventory || target.ageBucketInventory;
      target.ageDays = Math.max(Number(target.ageDays || 0), Number(row.ageDays || 0));
      if (row.bucketLabel) target.ageBuckets.add(row.bucketLabel);
      target.ageBucket = [...target.ageBuckets].join(" / ");
      target.estimatedStorageCostAllocation = round(Number(target.estimatedStorageCostAllocation || 0) + Number(row.estimatedStorageCostAllocation || 0));
      if (includeFinancials && !Number(target.purchaseCost || 0)) target.purchaseCost = Number(row.purchaseCost || 0);
      if (includeFinancials && !Number(target.firstLegCost || 0)) target.firstLegCost = Number(row.firstLegCost || 0);
      if (includeFinancials && !Number(target.unitCost || 0)) target.unitCost = Number(row.unitCost || row.purchaseCost || 0);
    });
  return [...groups.values()]
    .map((row) => ({
      ...row,
      ageBuckets: undefined,
      inventory: Number(row.inventory || row.ageBucketInventory || 0),
    }))
    .filter((row) => row.msku && row.inventory > 0);
}

function readOptionalNumber(record = {}, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const number = Number(String(value).replace(/,/g, "").replace(/%/g, ""));
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function fetchClearanceRecentSales(rows = []) {
  const targetRows = rows.filter((row) => Number(row.sid || 0) && String(row.msku || "").trim());
  if (!targetRows.length) {
    return {
      salesByKey: new Map(),
      range: clearanceRecentSalesRange(30),
      recent7Range: clearanceRecentSalesRange(7),
      warning: "",
      mainSalesFailed: false,
    };
  }

  const adapter = getLingxingAdapter();
  const sellers = filterCoreSellers((await getSharedSellers({ adapter })).sellers || []);
  const selectedSids = uniqueNumbers(targetRows.map((row) => row.sid));
  const selectedKeys = new Set(targetRows.map(clearanceSalesKey));
  const range = clearanceRecentSalesRange(30);
  const recent7Range = clearanceRecentSalesRange(7);
  const salesByKey = new Map();
  const ensureTarget = (key) => {
    if (!salesByKey.has(key)) {
      salesByKey.set(key, {
        recent30Sales: 0,
        recent30SalesAmount: 0,
        recent30GrossProfit: 0,
        recent7GrossProfit: 0,
        recent7AverageGrossProfit: 0,
        recent30PurchaseCost: 0,
        recent30FirstLegCost: 0,
        recent30StorageFee: 0,
        averageGrossProfitWeightedTotal: 0,
        averageGrossProfitWeight: 0,
      });
    }
    return salesByKey.get(key);
  };

  let warning = "";

  try {
    const recent30Payload = await adapter.fetchMskuOrderProfit({
        startDate: range.startDate,
        endDate: range.endDate,
        sids: selectedSids,
        currencyCode: "ORIGINAL",
    });
    const records = adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(recent30Payload), sellers);
    records.forEach((record) => {
      const key = clearanceSalesKey(record);
      if (!selectedKeys.has(key)) return;
      const target = ensureTarget(key);
      const salesQuantity = toNumber(record.totalSalesQuantity ?? record.volume);
      const reportAverageGrossProfit = readOptionalNumber(record, [
        "averageGrossProfit",
        "avgGrossProfit",
        "avg_gross_profit",
        "average_gross_profit",
      ]);
      target.recent30Sales = round(target.recent30Sales + salesQuantity);
      target.recent30SalesAmount = round(target.recent30SalesAmount + toNumber(record.totalSalesAmount ?? record.amount));
      target.recent30GrossProfit = round(target.recent30GrossProfit + toNumber(record.grossProfit ?? record.gross_profit), 4);
      target.recent30PurchaseCost = round(target.recent30PurchaseCost + Math.abs(toNumber(record.purchaseCost ?? record.purchase_cost)), 4);
      target.recent30FirstLegCost = round(target.recent30FirstLegCost + Math.abs(toNumber(record.firstLegCost ?? record.first_leg_cost)), 4);
      target.recent30StorageFee = round(target.recent30StorageFee + Math.abs(toNumber(record.storageFee)));
      if (reportAverageGrossProfit !== null && salesQuantity > 0) {
        target.averageGrossProfitWeightedTotal = round(target.averageGrossProfitWeightedTotal + reportAverageGrossProfit * salesQuantity, 4);
        target.averageGrossProfitWeight = round(target.averageGrossProfitWeight + salesQuantity, 4);
      }
    });
  } catch (error) {
    return { salesByKey, range, recent7Range, warning: `近30天订单利润读取失败：${error.message}`, mainSalesFailed: true };
  }

  try {
    const recent7Payload = await adapter.fetchMskuOrderProfit({
      startDate: recent7Range.startDate,
      endDate: recent7Range.endDate,
      sids: selectedSids,
      currencyCode: "ORIGINAL",
    });
    const recent7Records = adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(recent7Payload), sellers);
    recent7Records.forEach((record) => {
      const key = clearanceSalesKey(record);
      if (!selectedKeys.has(key)) return;
      const target = ensureTarget(key);
      target.recent7GrossProfit = round(target.recent7GrossProfit + toNumber(record.grossProfit ?? record.gross_profit), 4);
    });
  } catch (error) {
    warning = `近7天订单利润读取失败：${error.message}`;
  }

  salesByKey.forEach((item) => {
    item.dailyVelocity = item.recent30Sales ? round(item.recent30Sales / 30, 4) : 0;
    item.averageSalePrice = item.recent30Sales ? round(item.recent30SalesAmount / item.recent30Sales) : 0;
    item.averageGrossProfit = item.averageGrossProfitWeight
      ? round(item.averageGrossProfitWeightedTotal / item.averageGrossProfitWeight, 4)
      : item.recent30Sales ? round(item.recent30GrossProfit / item.recent30Sales, 4) : 0;
    item.recent7AverageGrossProfit = round(Number(item.recent7GrossProfit || 0) / 7, 4);
    item.averagePurchaseCost = item.recent30Sales ? round(item.recent30PurchaseCost / item.recent30Sales, 4) : 0;
    item.averageFirstLegCost = item.recent30Sales ? round(item.recent30FirstLegCost / item.recent30Sales, 4) : 0;
    item.averageLandedCost = item.recent30Sales ? round((item.recent30PurchaseCost + item.recent30FirstLegCost) / item.recent30Sales, 4) : 0;
  });
  return { salesByKey, range, recent7Range, warning, mainSalesFailed: false };
}

function normalizeStorageFeeMonthRecord(record) {
  return {
    sid: Number(record.sid || 0),
    fnsku: String(record.fnsku || "").trim(),
    asin: String(record.asin || "").trim(),
    productName: String(record.product_name || record.productName || "").trim(),
    fulfillmentCenter: String(record.fulfillment_center || record.fulfillmentCenter || "").replace(/^'+|'+$/g, ""),
    month: String(record.month_of_charge || record.month || "").trim(),
    currency: String(record.currency || "").trim(),
    itemVolume: toNumber(record.item_volume),
    averageQuantityOnHand: toNumber(record.average_quantity_on_hand),
    estimatedMonthlyStorageFee: toNumber(record.estimated_monthly_storage_fee),
  };
}

function buildStorageFeeMonthMap(records = []) {
  const map = new Map();
  records.map(normalizeStorageFeeMonthRecord)
    .filter((record) => record.sid && record.fnsku)
    .forEach((record) => {
      const key = clearanceStorageFeeKey(record);
      if (!map.has(key)) {
        map.set(key, {
          sid: record.sid,
          fnsku: record.fnsku,
          asin: record.asin,
          productName: record.productName,
          month: record.month,
          currency: record.currency,
          itemVolume: record.itemVolume,
          averageQuantityOnHand: 0,
          estimatedMonthlyStorageFee: 0,
          fulfillmentCenters: new Set(),
        });
      }
      const target = map.get(key);
      target.averageQuantityOnHand = round(target.averageQuantityOnHand + record.averageQuantityOnHand, 4);
      target.estimatedMonthlyStorageFee = round(target.estimatedMonthlyStorageFee + record.estimatedMonthlyStorageFee, 4);
      if (!target.itemVolume && record.itemVolume) target.itemVolume = record.itemVolume;
      if (!target.currency && record.currency) target.currency = record.currency;
      if (!target.month && record.month) target.month = record.month;
      if (record.fulfillmentCenter) target.fulfillmentCenters.add(record.fulfillmentCenter);
    });
  map.forEach((item) => {
    item.monthlyStorageFeePerUnit = item.averageQuantityOnHand
      ? round(item.estimatedMonthlyStorageFee / item.averageQuantityOnHand, 6)
      : 0;
    item.fulfillmentCenters = [...item.fulfillmentCenters];
  });
  return map;
}

async function fetchClearanceStorageFeeMonth(rows = [], month) {
  const targetRows = rows.filter((row) => Number(row.sid || 0) && String(row.fnsku || "").trim());
  const selectedSids = uniqueNumbers(targetRows.map((row) => row.sid));
  const targetKeys = new Set(targetRows.map(clearanceStorageFeeKey));
  if (!selectedSids.length || !month) return { feeByKey: new Map(), month, warning: "" };

  const cacheKey = JSON.stringify({ source: "fba-storage-fee-month", month, sids: selectedSids.sort((a, b) => a - b) });
  const cached = await readMskuDetailCache(cacheKey, 24 * 60 * 60 * 1000);
  if (cached?.data?.records) {
    return {
      feeByKey: buildStorageFeeMonthMap(cached.data.records.filter((record) => targetKeys.has(clearanceStorageFeeKey(record)))),
      month: cached.data.month || month,
      warning: "",
      cacheHit: true,
    };
  }

  const adapter = getLingxingAdapter();
  const records = [];
  const warnings = [];
  for (const [index, sid] of selectedSids.entries()) {
    try {
      const sidRecords = await adapter.fetchAllFbaStorageFeeMonth(sid, month);
      records.push(...sidRecords);
    } catch (error) {
      warnings.push(`${sid}: ${error.message}`);
    }
    if (index < selectedSids.length - 1) await sleep(1200);
  }
  if (records.length) {
    await saveMskuDetailCache(cacheKey, { month, records });
  }

  return {
    feeByKey: buildStorageFeeMonthMap(records.filter((record) => targetKeys.has(clearanceStorageFeeKey(record)))),
    month,
    warning: warnings.join("；"),
    cacheHit: false,
  };
}

function historyRowKey(sellerId, countryCode, msku) {
  return `${sellerId || ""}|${String(countryCode || "").toUpperCase()}|${String(msku || "").trim()}`;
}

function removeOldestCohorts(cohorts, quantity) {
  let remaining = quantity;
  const ordered = cohorts.slice().sort((left, right) => left.month.localeCompare(right.month));
  for (const cohort of ordered) {
    const removed = Math.min(cohort.quantity, remaining);
    cohort.quantity -= removed;
    remaining -= removed;
    if (remaining <= 0) break;
  }
  return ordered.filter((cohort) => cohort.quantity > 0.0001);
}

function rebuildMonthlyCohorts(records, months) {
  const recordsByMonth = new Map(records.map((record) => [record.date, record]));
  let cohorts = [];

  months.forEach((month) => {
    const record = recordsByMonth.get(month);
    if (!record) return;
    if (!cohorts.length && toNumber(record.startingWarehouseBalance) > 0) {
      cohorts.push({ month: shiftMonth(month, -1), quantity: toNumber(record.startingWarehouseBalance) });
    }
    const inflow = [
      record.receipts,
      record.customerReturns,
      record.warehouseTransferInOrOut,
      record.found,
      record.otherEvents,
    ].reduce((total, value) => total + Math.max(0, toNumber(value)), 0);
    if (inflow > 0) cohorts.push({ month, quantity: inflow });

    const target = Math.max(0, toNumber(record.endingWareHouseBalance));
    const cohortTotal = cohorts.reduce((total, cohort) => total + cohort.quantity, 0);
    if (cohortTotal > target) {
      cohorts = removeOldestCohorts(cohorts, cohortTotal - target);
    } else if (cohortTotal < target) {
      cohorts.push({ month, quantity: target - cohortTotal });
    }
  });

  return cohorts;
}

function ageDaysForHistoricalMonth(selectedMonth, cohortMonth) {
  const distance = monthDistance(selectedMonth, cohortMonth);
  if (distance <= 0) return 15;
  if (distance === 1) return 45;
  if (distance === 2) return 75;
  if (distance <= 5) return 120;
  if (distance <= 8) return 210;
  return 300;
}

function sellableHistoryRow(row) {
  const sellable = (row.child_data || []).find((item) => item.disposition === "sellable");
  return sellable ? { ...row, ...sellable, parent_node: true } : row;
}

async function loadHistoricalInventoryRowsFromLingxing(selectedMonth) {
  const cached = await readInventoryProvisionHistoryCache(selectedMonth);
  if (cached?.data?.rows?.length && cached.data.ownerSyncVersion === historicalOwnerSyncVersion) {
    return { ...cached.data, cacheUpdatedAt: cached.updatedAt || "" };
  }

  const adapter = getLingxingAdapter();
  const sellers = filterCoreSellers((await getSharedSellers({ adapter })).sellers || []);
  const sellerIds = [...new Set(sellers.map((seller) => seller.seller_id).filter(Boolean))];
  const sids = uniqueNumbers(sellers.map((seller) => seller.sid));
  const sellerBySid = new Map(sellers.map((seller) => [Number(seller.sid), seller]));
  const ownerRecords = await adapter.fetchAllFbaInventoryDetails(sids, {
    maxRows: 5000,
    params: { is_hide_zero_stock: "0" },
  });
  const months = Array.from({ length: 10 }, (_, index) => shiftMonth(selectedMonth, index - 9));
  const ledgerRecords = [];

  for (const month of months) {
    const payload = await adapter.fetchMonthlyInventoryLedgerSummary({
      sellerIds,
      startDate: month,
      endDate: month,
    });
    ledgerRecords.push(...(payload?.data?.records || []));
  }

  const historyPayload = await adapter.fetchFbaInventoryHistory({
    start_date: selectedMonth,
    end_date: selectedMonth,
    seller_id: sellerIds,
  });
  const historyRows = (historyPayload?.data?.row_data || [])
    .map(sellableHistoryRow)
    .filter((row) => toNumber(row.end_count) > 0);
  const historyOwnerLookupRows = historyRows.map((row) => {
    const seller = sellerBySid.get(Number(row.sid)) || {};
    return {
      sid: Number(row.sid) || 0,
      country: sellerCountry(seller) || row.country_code || "",
      countryCode: row.country_code || "",
      msku: row.msku || "",
    };
  });
  const listingOwnerRows = await fetchListingOwnerRows(adapter, historyOwnerLookupRows);
  const directOwnerMap = buildListingOwnerMap([
    ...normalizeLingxingInventoryRows(ownerRecords, sellers),
    ...listingOwnerRows,
  ]);
  const unresolvedMskus = uniqueText(
    historyOwnerLookupRows
      .filter((row) => findListingOwner(directOwnerMap, row) === "-")
      .map((row) => row.msku),
  );
  const globalListingOwnerRows = unresolvedMskus.length
    ? await fetchListingOwnerRows(
      adapter,
      sids.flatMap((sid) => unresolvedMskus.map((msku) => ({ sid, msku }))),
    )
    : [];
  const ownerMap = buildListingOwnerMap([
    ...normalizeLingxingInventoryRows(ownerRecords, sellers),
    ...listingOwnerRows,
    ...globalListingOwnerRows,
  ]);
  const ledgerByKey = new Map();
  ledgerRecords.forEach((record) => {
    const key = historyRowKey(record.sellerId, record.location, record.msku);
    if (!ledgerByKey.has(key)) ledgerByKey.set(key, []);
    ledgerByKey.get(key).push(record);
  });

  let matchedRows = 0;
  const rows = historyRows.flatMap((row) => {
    const seller = sellerBySid.get(Number(row.sid)) || {};
    const quantity = toNumber(row.end_count);
    const purchaseAmount = toNumber(row.end_other_amount);
    const firstLegAmount = toNumber(row.end_logistic_amount);
    const records = ledgerByKey.get(historyRowKey(seller.seller_id, row.country_code, row.msku)) || [];
    let cohorts = rebuildMonthlyCohorts(records, months);
    if (records.length) matchedRows += 1;
    if (!cohorts.length) cohorts = [{ month: months[0], quantity }];

    const cohortQuantity = cohorts.reduce((total, cohort) => total + cohort.quantity, 0);
    if (cohortQuantity && Math.abs(cohortQuantity - quantity) > 0.01) {
      cohorts = cohorts.map((cohort) => ({
        ...cohort,
        quantity: cohort.quantity * quantity / cohortQuantity,
      }));
    }

    const purchaseCost = quantity ? purchaseAmount / quantity : 0;
    const firstLegCost = quantity ? firstLegAmount / quantity : 0;
    return cohorts.map((cohort) => ({
      sid: Number(row.sid) || 0,
      sellerId: seller.seller_id || row.seller_id || "",
      countryCode: row.country_code || "",
      storeName: sellerName(seller) || `${row.sid || "-"}`,
      country: sellerCountry(seller) || row.country_code || "",
      msku: row.msku || "",
      skuName: row.local_name || "",
      listingOwner: findListingOwner(ownerMap, {
        sid: Number(row.sid) || 0,
        country: sellerCountry(seller) || row.country_code || "",
        countryCode: row.country_code || "",
        msku: row.msku || "",
      }),
      ageDays: ageDaysForHistoricalMonth(selectedMonth, cohort.month),
      cohortMonth: cohort.month,
      quantity: cohort.quantity,
      purchaseCost,
      firstLegCost,
    }));
  });

  const data = {
    rows,
    sellers,
    rawCount: historyRows.length,
    ledgerCount: ledgerRecords.length,
    matchedRows,
    ownerSyncVersion: historicalOwnerSyncVersion,
    ownerRecordCount: ownerRecords.length,
    listingOwnerRecordCount: listingOwnerRows.length,
    globalListingOwnerRecordCount: globalListingOwnerRows.length,
    reportStartDate: historyPayload?.data?.start_date || `${selectedMonth}-01`,
    reportEndDate: historyPayload?.data?.end_date || selectedMonth,
  };
  await saveInventoryProvisionHistoryCache(selectedMonth, data);
  return data;
}

export async function captureInventoryProvisionSnapshot({ date = todayText(), sellers = null } = {}) {
  const result = await loadInventoryRowsFromLingxing(sellers);
  await saveInventoryProvisionSnapshot(date, result);
  return {
    date,
    rowCount: result.rows.length,
    rawCount: result.rawCount,
  };
}

export async function debugInventoryProvisionSource() {
  const config = getConfig();
  const adapter = getLingxingAdapter();
  const endpoint = config.lingxing.fbaInventoryEndpoint;
  const sellers = filterCoreSellers((await getSharedSellers({ adapter })).sellers || []);
  const sids = uniqueNumbers(sellers.map((seller) => seller.sid));
  const requestParams = {
    sid: sids.join(","),
    offset: 0,
    length: 20,
    is_hide_zero_stock: "1",
    fulfillment_channel_type: "FBA",
    query_fba_storage_quantity_list: true,
  };

  try {
    const payload = await adapter.fetchFbaInventoryDetails(requestParams);
    const records = adapter.normalizeRecordList(payload);
    const normalizedRows = normalizeLingxingInventoryRows(records, sellers);
    const sample = records[0] || null;
    return {
      ok: true,
      endpoint,
      sellerCount: sellers.length,
      sids,
      requestParams,
      code: payload.code,
      message: payload.message || payload.msg || "",
      total: payload.total ?? payload.data?.total ?? null,
      recordCount: records.length,
      normalizedCount: normalizedRows.length,
      sampleKeys: sample ? Object.keys(sample).slice(0, 80) : [],
      sample,
      normalizedSample: normalizedRows[0] || null,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      sellerCount: sellers.length,
      sids,
      requestParams,
      error: error.message,
      details: error.details || null,
    };
  }
}

export async function getInventoryProvisionDashboard(filters = {}) {
  const config = getConfig();
  const date = monthText(filters.date || todayText());
  const currentDate = todayText();
  const currentMonth = monthText(currentDate);
  const country = listFilterValues(filters.country);
  const storeName = listFilterValues(filters.storeName);
  const owner = String(filters.owner || filters.listingOwner || "").trim();
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  const costMode = resolveCostMode(filters.costMode || filters.cost_mode);
  let sourceRows = config.dataProvider === "lingxing" ? [] : mockInventoryRows;
  let source = config.dataProvider === "lingxing" ? "领星 ERP · FBA库存明细" : "模拟数据 · FBA在库库龄";
  let syncStatus = config.dataProvider === "lingxing" ? "等待领星 FBA 库存明细返回" : "本地模拟库龄数据";
  let snapshotAvailable = true;
  let snapshotUpdatedAt = "";
  let availableDates = [];
  let previousPeriod = "";
  let previousSourceRows = [];
  let reversalStatus = "";
  let movementComparisonEnabled = false;

  if (config.dataProvider === "lingxing") {
    if (date === currentMonth) {
      try {
        const result = await loadInventoryRowsFromLingxing();
        sourceRows = result.rows;
        await saveInventoryProvisionSnapshot(currentDate, result);
        syncStatus = result.rows.length
          ? `实时读取并保存今日快照：明细 ${result.rows.length} 条，原始记录 ${result.rawCount} 条`
          : `今日实时库存暂无可计提数据，原始记录 ${result.rawCount} 条`;
      } catch (error) {
        console.error("[inventory-provision] live inventory read failed", {
          date: currentDate,
          requestedMonth: date,
          error: error.message,
        });
        throw new Error(`库存减值实时库存读取失败，未使用今日快照：${error.message}`);
      }
    } else {
      source = "领星 ERP · FBA历史库存月报";
      try {
        const result = await loadHistoricalInventoryRowsFromLingxing(date);
        sourceRows = result.rows;
        snapshotUpdatedAt = result.cacheUpdatedAt || "";
        syncStatus = `${date} 月末历史库存 · FBA月报 ${result.rawCount} 个MSKU · 库存分类账 ${result.ledgerCount} 条 · 库龄匹配 ${result.matchedRows}/${result.rawCount}${snapshotUpdatedAt ? ` · 缓存 ${snapshotUpdatedAt}` : ""}`;
      } catch (error) {
        snapshotAvailable = false;
        syncStatus = `${date} 历史库存读取失败：${error.message}`;
      }
    }
    availableDates = await listInventoryProvisionSnapshots();
    if (snapshotAvailable) {
      if (canCalculateProvisionMovement(date)) {
        previousPeriod = shiftMonth(date, -1);
        try {
          const previousResult = await loadHistoricalInventoryRowsFromLingxing(previousPeriod);
          previousSourceRows = previousResult.rows || [];
          movementComparisonEnabled = true;
          reversalStatus = `本月计提对比 ${previousPeriod} 期末库存计提余额`;
        } catch (error) {
          reversalStatus = `本月计提对比期读取失败：${error.message}`;
        }
      } else {
        reversalStatus = `${provisionMovementBaselineMonth} 期末库存作为起始余额，${provisionMovementStartMonth} 起计算本月计提金额`;
      }
    }
  }

  const activeFilters = { country, storeName, owner, keyword };
  const rows = filterSourceRows(sourceRows, activeFilters)
    .map((row) => toProvisionRow(row, costMode));
  const previousRows = filterSourceRows(previousSourceRows, activeFilters)
    .map((row) => toProvisionRow(row, costMode));
  const movementResult = movementComparisonEnabled
    ? applyProvisionMovements(rows, previousRows)
    : buildInitialProvisionMovements(rows);
  const totalAmount = sumBy(rows, "amount");
  const provisionAmount = sumBy(rows, "provisionAmount");
  const useOpeningBalanceInNet = movementComparisonEnabled && isProvisionMovementStartMonth(date);
  if (useOpeningBalanceInNet) {
    movementResult.rows = movementResult.rows.map((row) => ({
      ...row,
      netProvisionAmount: row.released ? 0 : Number(row.provisionAmount || 0),
    }));
    movementResult.netProvisionAmount = provisionAmount;
  }
  const batchDetailRows = movementResult.rows.sort((left, right) => (
    Math.max(Math.abs(Number(right.netProvisionAmount || 0)), Number(right.provisionAmount || 0))
    - Math.max(Math.abs(Number(left.netProvisionAmount || 0)), Number(left.provisionAmount || 0))
  ));
  const detailRows = buildInventoryProvisionSummaryRows(batchDetailRows);
  const monthlyProvisionAmount = movementResult.monthlyProvisionAmount;
  const reversalAmount = movementResult.reversalAmount;
  const netProvisionAmount = movementResult.netProvisionAmount;
  const over180Amount = sumBy(rows.filter((row) => row.ageDays >= 181), "amount");
  const provisionRate = totalAmount ? round((provisionAmount / totalAmount) * 100) : 0;
  const countryOptions = [...new Set(sourceRows.map((row) => row.country).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
    .map((name) => ({ name }));
  const storeOptions = [...new Set(sourceRows.map((row) => row.storeName))]
    .map((name) => {
      const match = sourceRows.find((row) => row.storeName === name);
      return { name, country: match?.country || "" };
    });
  const ownerOptions = [...new Set(sourceRows.map((row) => row.listingOwner).filter((item) => item && item !== "-"))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((name) => ({ name }));
  const hasEmptyOwner = sourceRows.some((row) => {
    const value = String(row.listingOwner || "").trim();
    return !value || value === "-";
  });
  if (hasEmptyOwner) ownerOptions.push({ name: "负责人留空", value: emptyListingOwnerFilterValue });

  return {
    meta: {
      source,
      syncStatus,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      date,
      currentDate,
      currentMonth,
      previousPeriod,
      provisionMovementBaselineMonth,
      provisionMovementStartMonth,
      useOpeningBalanceInNet,
      historicalMode: date !== currentMonth,
      costMode: costMode.key,
      costModeLabel: costMode.label,
      costModeDescription: costMode.description,
      snapshotAvailable,
      snapshotUpdatedAt,
      availableDates,
      reversalStatus,
      ruleText: `计提资产减值规则：91-180天*40%、181-270天*80%、271天及以上*100%；当前成本计算=${costMode.label}`,
    },
    filters: {
      countryOptions,
      storeOptions,
      ownerOptions,
    },
    buckets: ageBuckets,
    kpis: {
      inventoryAmount: totalAmount,
      provisionAmount,
      monthlyProvisionAmount,
      reversalAmount,
      netProvisionAmount,
      provisionRate,
      over180Amount,
      skuCount: detailRows.length,
    },
    bucketSummary: groupBucketAmounts(rows, movementResult.bucketMovementRows, { useEndingProvisionAsNet: useOpeningBalanceInNet }),
    storeDistribution: groupStoreAmounts(rows),
    monthTrend: config.dataProvider === "lingxing"
      ? date === currentMonth
        ? await buildMonthTrend(availableDates, activeFilters, costMode)
        : [buildSnapshotTrendRow(date, sourceRows, activeFilters, costMode)]
      : [buildSnapshotTrendRow(date, sourceRows, activeFilters, costMode)],
    detailRows,
    batchDetailRows,
  };
}

function clearanceCacheTtlMs(now = new Date()) {
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  return Math.max(60 * 1000, nextMidnight.getTime() - now.getTime());
}

function clearanceDashboardCacheKey(filters = {}) {
  return JSON.stringify({
    source: "clearance-dashboard-daily-v9",
    date: filters.date || todayText(),
    includeFinancials: Boolean(filters.includeFinancials),
    storageFeeMonth: filters.storageFeeMonth || shiftMonth(monthText(filters.date || todayText()), -1),
    costMode: filters.costMode || "purchase",
  });
}

function buildClearanceDashboardFromRows(baseRows = [], context = {}) {
  const includeFinancials = Boolean(context.includeFinancials);
  const selectedCountries = listFilterValues(context.country);
  const selectedStoreNames = listFilterValues(context.storeName);
  const selectedOwner = String(context.listingOwner || context.owner || "").trim();
  const keyword = String(context.keyword || "").trim().toLowerCase();
  const optionRows = baseRows.slice();
  let rows = baseRows
    .filter((row) => matchesAnyFilter(row.country, selectedCountries))
    .filter((row) => matchesAnyFilter(row.storeName, selectedStoreNames))
    .filter((row) => {
      if (!selectedOwner) return true;
      const listingOwner = String(row.listingOwner || "").trim();
      if (selectedOwner === emptyListingOwnerFilterValue) return !listingOwner || listingOwner === "-";
      return listingOwner === selectedOwner;
    })
    .filter((row) => !keyword || `${row.country} ${row.storeName} ${row.listingOwner} ${row.msku} ${row.productName}`.toLowerCase().includes(keyword));

  rows = rows.sort((left, right) => {
    const leftDays = left.saleableDays === Infinity ? Number.POSITIVE_INFINITY : Number(left.saleableDays || 0);
    const rightDays = right.saleableDays === Infinity ? Number.POSITIVE_INFINITY : Number(right.saleableDays || 0);
    const leftPriority = left.clearanceSuggestion === "建议清" ? 2 : left.clearanceSuggestion === "无销量" ? 1 : 0;
    const rightPriority = right.clearanceSuggestion === "建议清" ? 2 : right.clearanceSuggestion === "无销量" ? 1 : 0;
    return rightPriority - leftPriority
      || Number(right.grossProfitGap ?? -999999) - Number(left.grossProfitGap ?? -999999)
      || rightDays - leftDays
      || Number(right.naturalStorageCost || 0) - Number(left.naturalStorageCost || 0)
      || String(left.storeName || "").localeCompare(String(right.storeName || ""), "zh-CN")
      || String(left.msku || "").localeCompare(String(right.msku || ""), "zh-CN");
  });

  const countryOptions = [...new Set(optionRows.map((row) => row.country).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
    .map((name) => ({ name }));
  const storeOptions = [...new Set(optionRows.map((row) => row.storeName).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
    .map((name) => {
      const match = optionRows.find((row) => row.storeName === name);
      return { name, country: match?.country || "" };
    });
  const ownerOptions = [...new Set(optionRows.map((row) => row.listingOwner).filter((item) => item && item !== "-"))]
    .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
    .map((name) => ({ name }));
  if (optionRows.some((row) => {
    const value = String(row.listingOwner || "").trim();
    return !value || value === "-";
  })) ownerOptions.push({ name: "负责人留空", value: emptyListingOwnerFilterValue });

  const totalInventory = round(rows.reduce((sum, row) => sum + Number(row.inventory || 0), 0));
  const finiteStorageRows = rows.filter((row) => Number.isFinite(row.naturalStorageCost));
  const totalDailyStorageFee = round(rows.reduce((sum, row) => sum + Number(row.dailyStorageFee || 0), 0), 4);
  const totalNaturalStorageCost = round(finiteStorageRows.reduce((sum, row) => sum + Number(row.naturalStorageCost || 0), 0), 4);
  const totalInventoryCost = includeFinancials ? round(rows.reduce((sum, row) => sum + Number(row.inventoryCost || 0), 0), 4) : "";
  const totalLandedInventoryCost = includeFinancials ? round(rows.reduce((sum, row) => sum + Number(row.landedInventoryCost || 0), 0), 4) : "";
  const totalRecent30Sales = round(rows.reduce((sum, row) => sum + Number(row.recent30Sales || 0), 0), 4);
  const totalRecent30GrossProfit = round(rows.reduce((sum, row) => sum + Number(row.recent30GrossProfit || 0), 0), 4);
  const totalRecent7GrossProfit = round(rows.reduce((sum, row) => sum + Number(row.recent7GrossProfit || 0), 0), 4);
  const averageRecent7GrossProfit = round(totalRecent7GrossProfit / 7, 4);
  const totalRecent30PurchaseCost = round(rows.reduce((sum, row) => sum + Number(row.recent30PurchaseCost || 0), 0), 4);
  const totalRecent30FirstLegCost = round(rows.reduce((sum, row) => sum + Number(row.recent30FirstLegCost || 0), 0), 4);
  const averageGrossProfitWeight = rows.reduce((sum, row) => sum + Number(row.recent30Sales || 0), 0);
  const weightedAverageGrossProfit = averageGrossProfitWeight
    ? round(rows.reduce((sum, row) => sum + Number(row.averageGrossProfit || 0) * Number(row.recent30Sales || 0), 0) / averageGrossProfitWeight, 4)
    : 0;
  const weightedAverageLandedUnitCost = includeFinancials && totalRecent30Sales
    ? round((totalRecent30PurchaseCost + totalRecent30FirstLegCost) / totalRecent30Sales, 4)
    : "";
  const totalGrossProfitGap = includeFinancials
    ? round(rows.reduce((sum, row) => sum + (row.grossProfitGap === null ? 0 : Number(row.grossProfitGap || 0) * Number(row.inventory || 0)), 0), 4)
    : "";
  const clearanceCandidateCount = rows.filter((row) => row.clearanceSuggestion === "建议清").length;
  const storageToCostRate = includeFinancials && Number(totalInventoryCost || 0)
    ? round(totalNaturalStorageCost / Number(totalInventoryCost || 0) * 100, 2)
    : null;
  const noSalesCount = rows.filter((row) => row.saleableDays === Infinity).length;
  const bucketSummary = rows.reduce((list, row) => {
    const key = row.saleableDays === Infinity
      ? "无日销"
      : row.saleableDays > 365
        ? "365天以上"
        : row.saleableDays > 180
          ? "181-365天"
          : "121-180天";
    let target = list.find((item) => item.label === key);
    if (!target) {
      target = { label: key, mskuCount: 0, inventory: 0, dailyStorageFee: 0, naturalStorageCost: 0 };
      list.push(target);
    }
    target.mskuCount += 1;
    target.inventory = round(target.inventory + Number(row.inventory || 0));
    target.dailyStorageFee = round(target.dailyStorageFee + Number(row.dailyStorageFee || 0), 4);
    target.naturalStorageCost = Number.isFinite(row.naturalStorageCost)
      ? round(target.naturalStorageCost + Number(row.naturalStorageCost || 0), 4)
      : target.naturalStorageCost;
    return list;
  }, []);

  return {
    meta: {
      source: context.source || "",
      syncStatus: context.syncStatus || "",
      updatedAt: context.updatedAt || new Date().toLocaleString("zh-CN", { hour12: false }),
      date: context.date || monthText(todayText()),
      includeFinancials,
      costModeLabel: context.costModeLabel || "采购成本",
      recentSalesRange: context.recentSalesRange,
      recent7SalesRange: context.recent7SalesRange,
      storageFeeMonth: context.storageFeeMonth || "",
      storageFeeCacheHit: Boolean(context.storageFeeCacheHit),
      clearanceCacheHit: Boolean(context.clearanceCacheHit),
      clearanceCacheUpdatedAt: context.clearanceCacheUpdatedAt || "",
      clearanceCachePolicy: "每日0点后首次刷新，之后当天读取缓存",
      storageFeeSource: context.storageFeeSource || "",
      salesSource: context.salesSource || "",
      dataWarning: context.dataWarning || "",
    },
    filters: {
      ...(context.dataFilters || {}),
      countryOptions,
      storeOptions,
      ownerOptions,
    },
    kpis: {
      mskuCount: rows.length,
      totalInventory,
      totalDailyStorageFee,
      totalNaturalStorageCost,
      totalInventoryCost,
      totalLandedInventoryCost,
      totalRecent30Sales,
      totalRecent30GrossProfit,
      totalRecent7GrossProfit,
      averageRecent7GrossProfit,
      totalRecent30PurchaseCost,
      totalRecent30FirstLegCost,
      weightedAverageGrossProfit,
      weightedAverageLandedUnitCost,
      totalGrossProfitGap,
      clearanceCandidateCount,
      storageToCostRate,
      noSalesCount,
    },
    bucketSummary,
    rows,
  };
}

export async function getClearanceInventoryDashboard(filters = {}) {
  const includeFinancials = Boolean(filters.includeFinancials);
  const storageFeeMonth = filters.storageFeeMonth || shiftMonth(monthText(filters.date || todayText()), -1);
  const cacheKey = clearanceDashboardCacheKey({ ...filters, includeFinancials, storageFeeMonth });
  const cached = await readMskuDetailCache(cacheKey, clearanceCacheTtlMs());
  if (cached?.data?.rows) {
    return buildClearanceDashboardFromRows(cached.data.rows, {
      ...(cached.data.context || {}),
      ...filters,
      includeFinancials,
      clearanceCacheHit: true,
      clearanceCacheUpdatedAt: cached.updatedAt || "",
    });
  }

  const data = await getInventoryProvisionDashboard({
    date: filters.date || "",
    storeName: "",
    listingOwner: "",
    keyword: "",
    costMode: filters.costMode || "purchase",
  });
  let rows = groupClearanceInventoryRows(data.detailRows || [], includeFinancials);
  const isLingxingSource = data.meta?.source?.includes("领星");
  const salesMetrics = isLingxingSource
    ? await fetchClearanceRecentSales(rows)
    : { salesByKey: new Map(), range: clearanceRecentSalesRange(), warning: "" };
  const storageMetrics = isLingxingSource
    ? await fetchClearanceStorageFeeMonth(rows, storageFeeMonth)
    : { feeByKey: new Map(), month: storageFeeMonth, warning: "", cacheHit: false };
  rows.forEach((row) => {
    const sales = salesMetrics.salesByKey.get(clearanceSalesKey(row)) || {};
    const storageFee = storageMetrics.feeByKey.get(clearanceStorageFeeKey(row)) || {};
    const monthlyStorageFee = storageFee.monthlyStorageFeePerUnit
      ? storageFee.monthlyStorageFeePerUnit * Number(row.inventory || 0)
      : 0;
    row.recent30Sales = Number(sales.recent30Sales || 0);
    row.dailyVelocity = Number(sales.dailyVelocity || 0);
    row.recent30SalesAmount = Number(sales.recent30SalesAmount || 0);
    row.recent30GrossProfit = Number(sales.recent30GrossProfit || 0);
    row.recent7GrossProfit = Number(sales.recent7GrossProfit || 0);
    row.recent7AverageGrossProfit = Number(sales.recent7AverageGrossProfit || 0);
    row.recent30PurchaseCost = Number(sales.recent30PurchaseCost || 0);
    row.recent30FirstLegCost = Number(sales.recent30FirstLegCost || 0);
    row.averageSalePrice = Number(sales.averageSalePrice || 0);
    row.averageGrossProfit = Number(sales.averageGrossProfit || 0);
    row.averagePurchaseCost = Number(sales.averagePurchaseCost || 0);
    row.averageFirstLegCost = Number(sales.averageFirstLegCost || 0);
    row.recent30StorageFee = Number(sales.recent30StorageFee || 0);
    row.monthlyStorageFee = round(monthlyStorageFee, 4);
    row.dailyStorageFee = round(monthlyStorageFee / 30.44, 4);
    row.storageFeeMonth = storageFee.month || storageMetrics.month || "";
    row.storageFeeCurrency = storageFee.currency || "";
    row.storageFeeAverageQuantity = Number(storageFee.averageQuantityOnHand || 0);
    row.storageFeePerUnit = Number(storageFee.monthlyStorageFeePerUnit || 0);
    row.cubicFeet = Number(storageFee.itemVolume || 0);
    row.saleableDays = row.dailyVelocity > 0 ? round(Number(row.inventory || 0) / row.dailyVelocity, 2) : Infinity;
    row.inventoryPurchaseCost = includeFinancials ? Number(row.purchaseCost || row.unitCost || 0) : "";
    row.inventoryFirstLegCost = includeFinancials ? Number(row.firstLegCost || 0) : "";
    row.purchaseCost = includeFinancials && Number(row.recent30Sales || 0) > 0 ? Number(row.averagePurchaseCost || 0) : "";
    row.firstLegCost = includeFinancials && Number(row.recent30Sales || 0) > 0 ? Number(row.averageFirstLegCost || 0) : "";
    row.landedUnitCost = includeFinancials && Number(row.recent30Sales || 0) > 0
      ? round(Number(sales.averageLandedCost || 0), 4)
      : "";
    row.inventoryCost = includeFinancials ? round(Number(row.inventory || 0) * Number(row.unitCost || 0)) : "";
    row.landedInventoryCost = includeFinancials ? round(Number(row.inventory || 0) * Number(row.landedUnitCost || 0), 4) : "";
    row.averageGrossProfitAbs = Math.abs(Number(row.averageGrossProfit || 0));
    row.grossProfitGap = includeFinancials && Number(row.recent30Sales || 0) > 0
      ? round(Number(row.averageGrossProfitAbs || 0) - Number(row.landedUnitCost || 0), 4)
      : null;
    row.grossProfitToLandedCostRate = includeFinancials && Number(row.landedUnitCost || 0) && Number(row.recent30Sales || 0) > 0
      ? round(Number(row.averageGrossProfitAbs || 0) / Number(row.landedUnitCost || 0) * 100, 2)
      : null;
    row.clearanceSuggestion = Number(row.recent30Sales || 0) <= 0
      ? "无销量"
      : row.grossProfitGap !== null && row.grossProfitGap > 0
        ? "建议清"
        : "可观察";
    row.naturalStorageCost = Number.isFinite(row.saleableDays) ? round(row.saleableDays * row.dailyStorageFee, 4) : Infinity;
    row.storageCostToInventoryCostRate = includeFinancials && Number(row.inventoryCost || 0) && Number.isFinite(row.naturalStorageCost)
      ? round(row.naturalStorageCost / row.inventoryCost * 100, 2)
      : null;
    row.storageCostMinusInventoryCost = includeFinancials && Number(row.inventoryCost || 0) && Number.isFinite(row.naturalStorageCost)
      ? round(row.naturalStorageCost - row.inventoryCost, 4)
      : null;
  });
  rows = rows
    .filter((row) => Number(row.recent30Sales || 0) > 0 && Number(row.averageGrossProfit || 0) < 0 && Number(row.inventory || 0) > 10);
  const context = {
      source: data.meta?.source || "",
      syncStatus: data.meta?.syncStatus || "",
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      date: data.meta?.date || monthText(filters.date || todayText()),
      includeFinancials,
      costModeLabel: data.meta?.costModeLabel || "采购成本",
      recentSalesRange: salesMetrics.range,
      recent7SalesRange: salesMetrics.recent7Range,
      storageFeeMonth: storageMetrics.month || storageFeeMonth,
      storageFeeCacheHit: Boolean(storageMetrics.cacheHit),
      storageFeeSource: isLingxingSource
        ? "领星 FBA月仓储费报表 storageFeeMonth，按 FNSKU 单件月费匹配 MSKU"
        : "模拟数据未含 ERP 仓储费",
      salesSource: isLingxingSource ? "领星订单利润 MSKU 近30天 + 近7天" : "模拟数据未含近30天销售",
      dataWarning: [salesMetrics.warning ? `订单利润读取异常：${salesMetrics.warning}` : "", storageMetrics.warning ? `月仓储费读取失败：${storageMetrics.warning}` : ""].filter(Boolean).join("；"),
      dataFilters: data.filters || {},
  };
  if (!salesMetrics.mainSalesFailed) {
    await saveMskuDetailCache(cacheKey, { rows, context });
  }
  return buildClearanceDashboardFromRows(rows, { ...context, ...filters, includeFinancials });
}

function sheetDateLabel(date) {
  return String(date || "").replace(/[^0-9-]/g, "") || monthText();
}

function exportFileName(date) {
  return `库存减值明细-${sheetDateLabel(date)}.xlsx`;
}

function setSheetWidths(sheet, widths) {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
}

export async function exportInventoryProvisionDetailXlsx(filters = {}) {
  const data = await getInventoryProvisionDashboard(filters);
  const module = await import("xlsx");
  const XLSX = module.default || module;
  const workbook = XLSX.utils.book_new();
  const exportMonth = data.meta?.date || monthText(filters.date || todayText());

  const detailHeaders = [
    "月份",
    "店铺",
    "国家",
    "MSKU",
    "商品名",
    "Listing负责人",
    "数量",
    "到库金额（库存金额）",
    "期末计提余额",
    "本月新增计提",
    "本月计提冲回",
    "本月计提金额",
  ];
  const detailRows = (data.detailRows || []).map((row) => [
    exportMonth,
    row.storeName || "",
    row.country || "",
    row.msku || "",
    row.skuName || "",
    row.listingOwner && row.listingOwner !== "-" ? row.listingOwner : "负责人留空",
    Number(row.quantity || 0),
    Number(row.amount || 0),
    Number(row.provisionAmount || 0),
    Number(row.monthlyProvisionAmount || 0),
    Number(row.reversalAmount || 0),
    Number(row.netProvisionAmount || 0),
  ]);
  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
  detailSheet["!autofilter"] = { ref: `A1:L${Math.max(1, detailRows.length + 1)}` };
  setSheetWidths(detailSheet, [10, 18, 10, 26, 34, 14, 12, 18, 14, 14, 14, 14]);
  XLSX.utils.book_append_sheet(workbook, detailSheet, "库存减值明细");

  const batchHeaders = [
    "月份",
    "店铺",
    "国家",
    "MSKU",
    "商品名",
    "Listing负责人",
    "库存批次月份",
    "库龄",
    "数量",
    "单位采购成本",
    "单位头程费用",
    "成本计算单价",
    "库存金额",
    "计提比例",
    "期末计提余额",
    "本月新增计提",
    "本月计提冲回",
    "本月计提金额",
  ];
  const batchRows = (data.batchDetailRows || []).map((row) => [
    exportMonth,
    row.storeName || "",
    row.country || "",
    row.msku || "",
    row.skuName || "",
    row.listingOwner && row.listingOwner !== "-" ? row.listingOwner : "负责人留空",
    row.cohortMonth || "",
    `${row.ageDays || 0}天 · ${row.bucketLabel || ""}`,
    Number(row.quantity || 0),
    Number(row.purchaseCost || 0),
    Number(row.firstLegCost || 0),
    Number(row.unitCost || 0),
    Number(row.amount || 0),
    `${Math.round(Number(row.provisionRate || 0) * 100)}%`,
    Number(row.provisionAmount || 0),
    Number(row.monthlyProvisionAmount || 0),
    Number(row.reversalAmount || 0),
    Number(row.netProvisionAmount || 0),
  ]);
  const batchSheet = XLSX.utils.aoa_to_sheet([batchHeaders, ...batchRows]);
  batchSheet["!autofilter"] = { ref: `A1:R${Math.max(1, batchRows.length + 1)}` };
  setSheetWidths(batchSheet, [10, 18, 10, 26, 34, 14, 14, 18, 12, 14, 14, 14, 14, 10, 14, 14, 14, 14]);
  XLSX.utils.book_append_sheet(workbook, batchSheet, "批次追溯明细");

  const summaryHeaders = ["月份", "库龄", "计提比例", "库存金额", "占比", "期末计提余额", "本月增加计提（当月）", "已计提冲回", "本月计提金额"];
  const summaryRows = (data.bucketSummary || []).map((row) => [
    exportMonth,
    row.label || "",
    `${Math.round(Number(row.rate || 0) * 100)}%`,
    Number(row.amount || 0),
    `${Number(row.percent || 0).toFixed(2)}%`,
    Number(row.provisionAmount || 0),
    Number(row.monthlyProvisionAmount || 0),
    Number(row.reversalAmount || 0),
    Number(row.netProvisionAmount || 0),
  ]);
  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
  summarySheet["!autofilter"] = { ref: `A1:I${Math.max(1, summaryRows.length + 1)}` };
  setSheetWidths(summarySheet, [10, 16, 10, 14, 10, 14, 14, 14, 14]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "库龄汇总");

  const metaRows = [
    ["导出月份", exportMonth],
    ["数据源", data.meta?.source || ""],
    ["成本计算", data.meta?.costModeLabel || ""],
    ["本月计提对比", data.meta?.reversalStatus || ""],
    ["计提起始规则", `${data.meta?.provisionMovementBaselineMonth || provisionMovementBaselineMonth} 期末库存作为起始余额，${data.meta?.provisionMovementStartMonth || provisionMovementStartMonth} 起计算本月计提金额`],
    ["利润扣减口径", `${data.meta?.provisionMovementStartMonth || provisionMovementStartMonth} 本月计提金额 = ${data.meta?.provisionMovementBaselineMonth || provisionMovementBaselineMonth} 期末库存计提余额 + 本月增加计提（当月） - 已计提冲回；后续月份 = 本月增加计提（当月） - 已计提冲回`],
    ["同步状态", data.meta?.syncStatus || ""],
    ["导出时间", new Date().toLocaleString("zh-CN", { hour12: false })],
  ];
  const metaSheet = XLSX.utils.aoa_to_sheet([["项目", "内容"], ...metaRows]);
  setSheetWidths(metaSheet, [16, 100]);
  XLSX.utils.book_append_sheet(workbook, metaSheet, "导出说明");

  return {
    filename: exportFileName(exportMonth),
    buffer: XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }),
    rowCount: detailRows.length,
  };
}

export const inventoryProvisionTestUtils = {
  buildInventoryProvisionSummaryRows,
  costModes,
  normalizeLingxingInventoryRows,
  toProvisionRow,
};
