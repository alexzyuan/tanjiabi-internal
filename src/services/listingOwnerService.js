function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
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

function uniqueText(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function sellerName(seller = {}) {
  return readFirst(seller, ["name", "seller_name", "shop_name", "store_name", "account_name"]) || "";
}

function sellerCountry(seller = {}) {
  return readFirst(seller, ["country", "countryName", "country_name", "marketplace", "marketplaceName"]) || "";
}

function sellerCountryCode(seller = {}) {
  return readFirst(seller, ["countryCode", "country_code", "region", "marketplaceCode", "marketplace"]) || "";
}

function listingOwner(record = {}) {
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

export function ownerMapKey({ sid = "", country = "", countryCode = "", msku = "" } = {}) {
  return [
    String(sid || "").trim(),
    String(countryCode || country || "").trim().toUpperCase(),
    String(msku || "").trim().toLowerCase(),
  ].join("|");
}

export function buildListingOwnerMap(rows = []) {
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
    [ownerMapKey(row), ownerMapKey({ ...row, countryCode: "" })].forEach((key) => {
      if (key && !map.has(key)) map.set(key, owner);
    });
  });
  ownersByMsku.forEach((owners, msku) => {
    if (owners.size !== 1) return;
    const key = ownerMapKey({ sid: "", countryCode: "", msku });
    if (key && !map.has(key)) map.set(key, [...owners][0]);
  });
  return map;
}

export function findListingOwner(ownerMap, row) {
  return ownerMap.get(ownerMapKey(row))
    || ownerMap.get(ownerMapKey({ ...row, countryCode: "" }))
    || ownerMap.get(ownerMapKey({ sid: "", countryCode: "", msku: row?.msku || "" }))
    || "-";
}

export function ownerOptionsFromRows(rows = []) {
  return uniqueText(rows.map((row) => row.listingOwner).filter((item) => item && item !== "-"))
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"))
    .map((name) => ({ name, value: name }));
}

export function normalizeInventoryOwnerRows(records = [], sellers = []) {
  const sellerBySid = new Map(
    sellers
      .map((seller) => [Number(seller.sid || seller.seller_id || seller.sellerId), seller])
      .filter(([sid]) => Number.isFinite(sid) && sid > 0),
  );
  return records.map((record) => {
    const sid = toNumber(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"]));
    const seller = sellerBySid.get(sid) || {};
    return {
      sid,
      country: sellerCountry(seller) || readFirst(record, ["country", "country_name", "countryName", "marketplace"]) || "",
      countryCode: readFirst(record, ["country_code", "countryCode", "region", "marketplace"]) || sellerCountryCode(seller),
      storeName: sellerName(seller) || readFirst(record, ["store_name", "storeName", "seller_name", "sellerName"]) || `${sid || "-"}`,
      msku: readFirst(record, ["msku", "seller_sku", "sellerSku", "fnsku", "sku"]) || "",
      listingOwner: listingOwner(record) || "-",
    };
  }).filter((row) => row.msku);
}

export function ownerLookupRowsFromRecords(records = []) {
  return records.map((record) => ({
    sid: toNumber(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"])),
    country: readFirst(record, ["country", "country_name", "countryName", "marketplace", "site", "siteName"]) || "",
    countryCode: readFirst(record, ["country_code", "countryCode", "region", "marketplace"]) || "",
    msku: readFirst(record, ["msku", "sellerSku", "seller_sku", "sku", "asin"]) || "",
  })).filter((row) => row.sid && row.msku);
}

async function fetchListingRecords(adapter, baseParams) {
  const records = [];
  let offset = 0;
  const length = 1000;
  while (offset < 5000) {
    const payload = await adapter.fetchListings({ ...baseParams, offset, length });
    const pageRows = adapter.normalizeRecordList(payload);
    records.push(...pageRows);
    const total = Number(payload?.data?.total || payload?.total || 0);
    if (!pageRows.length || pageRows.length < length || (total && records.length >= total)) break;
    offset += length;
  }
  return records;
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

export async function fetchListingOwnerRows(adapter, rows = []) {
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
    for (const batch of chunkArray(sellerMskus, 50)) {
      const baseParams = {
        is_pair: 1,
        is_delete: 0,
        search_field: "seller_sku",
        search_value: batch,
        exact_search: 1,
      };
      const variants = [{ sid }, { sids: [sid] }, { seller_id: sid }, { sellerId: sid }];
      let records = [];
      for (const variant of variants) {
        try {
          records = await fetchListingRecords(adapter, { ...baseParams, ...variant });
          if (!records.length) records = await fetchListingRecords(adapter, { ...baseParams, exact_search: 0, ...variant });
          if (records.length) break;
        } catch {
          records = [];
        }
      }
      records.map((record) => listingOwnerRow(record, fallback)).filter(Boolean).forEach((row) => ownerRows.push(row));
    }
  }
  return ownerRows;
}
