import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getFbaAddressProfile } from "../data/fbaAddressBook.js";
import { findLingxingShop, lingxingShopMap } from "../data/lingxingShopMap.js";
import {
  applySharedProductCatalogToRows,
  getSharedProductCatalogMap,
} from "./sharedDataService.js";
import { getFbaShipmentCandidates } from "./fbaShipmentCandidateService.js";
import { listJiufangOrdersByShipmentIds } from "./jiufangOrderStore.js";
import { readZipEntries, writeZipEntries } from "../utils/zipArchive.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const freightTemplateDir = path.join(appRoot, "assets", "freight-templates");
const fbaForwarderTemplates = [
  {
    id: "jiufang",
    name: "九方通逊",
    filename: "jiufang.xlsx",
    sheetName: "下单模板",
    worksheetPath: "xl/worksheets/sheet1.xml",
    dataStartRow: 20,
  },
  {
    id: "tongpao",
    name: "同袍物流",
    filename: "tongpao.xlsx",
    sheetName: "装箱单和发票",
    worksheetPath: "xl/worksheets/sheet1.xml",
    dataStartRow: 5,
  },
];

const freightSheetColumns = [
  { key: "country", label: "国家" },
  { key: "storeName", label: "店铺" },
  { key: "productImageUrl", label: "发货产品图片" },
  { key: "shipmentName", label: "货件名称" },
  { key: "shipmentId", label: "货件单号" },
  { key: "shippedQuantity", label: "发货数量" },
  { key: "shipmentStatus", label: "货件状态" },
  { key: "fulfillmentCenterCode", label: "物流中心编码" },
  { key: "createdAt", label: "创建时间" },
];

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizedCountryName(value = "") {
  const text = String(value || "").trim();
  const compact = text.toLowerCase().replace(/[\s_-]/g, "");
  if (!compact) return "";
  if (["us", "usa", "unitedstates", "unitedstatesofamerica", "美国"].includes(compact)) return "美国";
  if (["ca", "canada", "加拿大"].includes(compact)) return "加拿大";
  if (["mx", "mexico", "墨西哥"].includes(compact)) return "墨西哥";
  if (["au", "australia", "澳洲", "澳大利亚"].includes(compact)) return "澳洲";
  if (["uk", "gb", "unitedkingdom", "英国"].includes(compact)) return "英国";
  return text;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function recordList(payload) {
  const data = payload?.data || payload || {};
  const list = data.list || data.records || data.rows || data.data;
  return Array.isArray(list) ? list : [];
}

function buildSellersBySid(extraSellers = []) {
  const map = new Map();
  for (const shop of lingxingShopMap) {
    map.set(Number(shop.sid), shop);
  }
  for (const seller of extraSellers || []) {
    const sid = Number(seller?.sid);
    if (!sid) continue;
    map.set(sid, {
      sid,
      name: firstText(seller.name, seller.seller, seller.seller_name, seller.shop_name, seller.store_name),
      displayName: firstText(seller.displayName, seller.display_name, seller.name, seller.seller),
      country: firstText(seller.country, seller.countryName, seller.country_name, seller.marketplace),
    });
  }
  return map;
}

function normalizeItem(item = {}) {
  return {
    msku: firstText(item.msku, item.seller_sku),
    fnsku: firstText(item.fnsku),
    sku: firstText(item.sku),
    productName: firstText(item.product_name, item.productName, item.title),
    title: firstText(item.title, item.product_name, item.productName),
    imageUrl: firstText(item.url, item.image_url, item.imageUrl, item.pic_url),
    shippedQuantity: numberValue(item.quantity_shipped ?? item.quantity ?? item.quantityShipped),
    receivedQuantity: numberValue(item.quantity_received ?? item.quantityReceived),
    quantityInCase: numberValue(item.quantity_in_case ?? item.quantityInCase),
  };
}

function shippedQuantityForRow(items = [], row = {}) {
  const itemTotal = items.reduce((sum, item) => sum + numberValue(item.shippedQuantity), 0);
  if (itemTotal > 0) return itemTotal;
  return numberValue(row.quantity_shipped ?? row.item_count ?? row.itemCount);
}

function countryFromRow(row = {}, seller = {}) {
  return normalizedCountryName(firstText(
    row.ship_to_address?.country_code,
    row.ship_to_address?.countryCode,
    row.ship_to_address?.country,
    row.country_code,
    row.countryCode,
    row.country,
    row.country_name,
    row.marketplace,
    seller.country,
  ));
}

function storeNameFromRow(row = {}, seller = {}) {
  return firstText(
    seller.displayName,
    seller.name,
    row.seller,
    row.seller_name,
    row.shop_name,
    row.store_name,
    row.sid ? String(row.sid) : "",
  );
}

export function normalizeFbaFreightShipments(payload, { sellersBySid = null, sellers = [] } = {}) {
  const sellerMap = sellersBySid || buildSellersBySid(sellers);
  return recordList(payload).map((row) => {
    const sid = Number(row.sid || 0);
    const seller = sellerMap.get(sid) || findLingxingShop(sid) || {};
    const items = (Array.isArray(row.item_list) ? row.item_list : row.itemList || []).map(normalizeItem);
    const firstImageItem = items.find((item) => item.imageUrl) || {};
    const shipmentId = firstText(row.shipment_id, row.shipmentId, row.shipmentConfirmationId, row.sta_shipment_id);
    const staShipmentId = firstText(row.sta_shipment_id, row.staShipmentId);
    const inboundPlanId = firstText(row.sta_inbound_plan_id, row.staInboundPlanId);
    return {
      id: firstText(row.id, shipmentId, staShipmentId),
      sid,
      country: countryFromRow(row, seller),
      storeName: storeNameFromRow(row, seller),
      productImageUrl: firstImageItem.imageUrl || "",
      shipmentName: firstText(row.shipment_name, row.shipmentName, row.sta_plan_name),
      shipmentId,
      staShipmentId,
      inboundPlanId,
      shippedQuantity: shippedQuantityForRow(items, row),
      shipmentStatus: firstText(row.shipment_status, row.status, row.shipmentStatus),
      fulfillmentCenterCode: firstText(row.destination_fulfillment_center_id, row.warehouseId, row.wareHouseId),
      createdAt: firstText(row.gmt_create, row.createdAt, row.working_time),
      updatedAt: firstText(row.gmt_modified, row.updatedAt),
      shippingMode: firstText(row.shipping_mode, row.shippingMode),
      shippingSolution: firstText(row.shipping_solution, row.shippingSolution),
      alphaCode: firstText(row.alpha_code, row.alphaCode),
      trackingNumbers: row.tracking_number_list || row.trackingNumberList || [],
      shipFromAddress: row.ship_from_address || row.sendAddress || {},
      shipToAddress: row.ship_to_address || row.shippingAddress || {},
      items,
      raw: row,
    };
  });
}

export function applyProductCatalogToFbaFreightShipments(shipments = [], catalogMap = new Map()) {
  if (!catalogMap.size) return shipments;
  return shipments.map((shipment) => {
    const itemRows = (shipment.items || []).map((item) => ({
      sid: shipment.sid,
      storeName: shipment.storeName,
      country: shipment.country,
      msku: item.msku,
      sku: item.sku,
      productName: item.productName || item.title,
      imageUrl: item.imageUrl,
    }));
    const enrichedItems = applySharedProductCatalogToRows(itemRows, catalogMap);
    const items = (shipment.items || []).map((item, index) => {
      const enriched = enrichedItems[index] || {};
      return {
        ...item,
        imageUrl: item.imageUrl || enriched.imageUrl || "",
        internalSku: item.internalSku || enriched.internalSku || "",
        productName: item.productName || enriched.productName || "",
        title: item.title || enriched.productName || "",
        brand: item.brand || enriched.brand || "",
        model: item.model || enriched.model || "",
        material: item.material || enriched.material || "",
        purpose: item.purpose || enriched.purpose || "",
        customsCode: item.customsCode || enriched.customsCode || "",
        isBattery: item.isBattery || enriched.isBattery || "",
        unit: item.unit || enriched.unit || "",
        declaredValue: item.declaredValue || enriched.declaredValue || "",
        asin: item.asin || enriched.asin || "",
      };
    });
    const firstImageItem = items.find((item) => item.imageUrl) || {};
    return {
      ...shipment,
      productImageUrl: shipment.productImageUrl || firstImageItem.imageUrl || "",
      items,
    };
  });
}

export function listFbaForwarderTemplates() {
  return fbaForwarderTemplates.map(({ id, name }) => ({ id, name }));
}

function resolveFbaForwarderTemplate(templateId) {
  const template = fbaForwarderTemplates.find((item) => item.id === templateId);
  if (!template) throw new Error("请选择货代模板后再转表格。");
  return {
    ...template,
    path: path.join(freightTemplateDir, template.filename),
  };
}

function cloneCell(cell = {}) {
  const next = {};
  if (cell.s) next.s = JSON.parse(JSON.stringify(cell.s));
  if (cell.z) next.z = cell.z;
  return next;
}

function setCellValue(ws, rowNumber, colIndex, value, templateRowNumber = rowNumber) {
  const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: colIndex });
  const templateAddress = XLSX.utils.encode_cell({ r: templateRowNumber - 1, c: colIndex });
  const base = cloneCell(ws[templateAddress] || ws[address] || {});
  if (value === undefined || value === null || value === "") {
    ws[address] = { ...base, t: "s", v: "" };
  } else if (typeof value === "number" && Number.isFinite(value)) {
    ws[address] = { ...base, t: "n", v: value };
  } else {
    ws[address] = { ...base, t: "s", v: String(value) };
  }
}

function updateSheetRef(ws, rowNumber, colIndex) {
  const current = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  current.e.r = Math.max(current.e.r, rowNumber - 1);
  current.e.c = Math.max(current.e.c, colIndex);
  ws["!ref"] = XLSX.utils.encode_range(current);
}

function copyRowStyle(ws, fromRowNumber, toRowNumber, maxColIndex) {
  for (let colIndex = 0; colIndex <= maxColIndex; colIndex += 1) {
    const fromAddress = XLSX.utils.encode_cell({ r: fromRowNumber - 1, c: colIndex });
    const toAddress = XLSX.utils.encode_cell({ r: toRowNumber - 1, c: colIndex });
    if (ws[fromAddress] && !ws[toAddress]) ws[toAddress] = cloneCell(ws[fromAddress]);
  }
  if (ws["!rows"]?.[fromRowNumber - 1]) {
    ws["!rows"][toRowNumber - 1] = { ...ws["!rows"][fromRowNumber - 1] };
  }
}

function shiftRowsDown(ws, startRowNumber, count) {
  if (count <= 0) return;
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const cells = Object.keys(ws)
    .filter((key) => !key.startsWith("!"))
    .map((key) => [key, XLSX.utils.decode_cell(key)])
    .filter(([, cell]) => cell.r >= startRowNumber - 1)
    .sort((a, b) => b[1].r - a[1].r || b[1].c - a[1].c);
  for (const [address, cell] of cells) {
    const nextAddress = XLSX.utils.encode_cell({ r: cell.r + count, c: cell.c });
    ws[nextAddress] = ws[address];
    delete ws[address];
  }
  if (ws["!merges"]) {
    ws["!merges"] = ws["!merges"].map((merge) => {
      const next = JSON.parse(JSON.stringify(merge));
      if (next.s.r >= startRowNumber - 1) {
        next.s.r += count;
        next.e.r += count;
      }
      return next;
    });
  }
  if (ws["!rows"]) {
    for (let rowIndex = ws["!rows"].length - 1; rowIndex >= startRowNumber - 1; rowIndex -= 1) {
      ws["!rows"][rowIndex + count] = ws["!rows"][rowIndex];
      delete ws["!rows"][rowIndex];
    }
  }
  range.e.r += count;
  ws["!ref"] = XLSX.utils.encode_range(range);
}

function toKg(value, unit = "") {
  const number = numberValue(value);
  return String(unit || "").toUpperCase() === "LB" ? number * 0.45359237 : number;
}

function toCm(value, unit = "") {
  const number = numberValue(value);
  return String(unit || "").toUpperCase() === "IN" ? number * 2.54 : number;
}

function shipmentReferenceId(shipment = {}) {
  return firstText(shipment.raw?.reference_id, shipment.referenceId, shipment.raw?.referenceId);
}

function shipmentWarehouseAddress(shipment = {}) {
  const address = shipment.shipToAddress || shipment.raw?.ship_to_address || {};
  return [
    shipment.fulfillmentCenterCode,
    address.addressLine1,
    address.addressLine2,
    address.postalCode,
    address.city,
    address.stateOrProvinceCode,
    address.countryCode || address.country,
  ].filter(Boolean).join(" - ");
}

function boxesForShipment(shipment = {}, boxPayloadsByShipmentId = new Map()) {
  const payload = boxPayloadsByShipmentId.get(shipment.shipmentId) || boxPayloadsByShipmentId.get(shipment.staShipmentId) || {};
  const list = payload.data?.shipmentList || payload.shipmentList || [];
  const matched = list.find((item) => !shipment.staShipmentId || item.shipmentId === shipment.staShipmentId) || list[0] || {};
  return Array.isArray(matched.shipmentPackingList) ? matched.shipmentPackingList : [];
}

function boxRangeText(boxes = []) {
  const ids = boxes.map((box) => Number(box.localBoxId)).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!ids.length) return boxes.length ? `1~${boxes.length}` : "";
  return ids[0] === ids[ids.length - 1] ? String(ids[0]) : `${ids[0]}~${ids[ids.length - 1]}`;
}

function normalizeForwarderLines(shipments = [], boxPayloadsByShipmentId = new Map()) {
  const lines = [];
  for (const shipment of shipments) {
    const boxes = boxesForShipment(shipment, boxPayloadsByShipmentId);
    if (!boxes.length) {
      for (const item of shipment.items || []) {
        lines.push({
          shipment,
          item,
          boxes: [],
          sku: item.sku || item.msku,
          internalSku: item.internalSku || "",
          msku: item.msku,
          asin: item.asin || "",
          productName: item.productName || item.title || item.msku,
          title: item.title || item.productName || item.msku,
          imageUrl: item.imageUrl || shipment.productImageUrl || "",
          brand: item.brand || "",
          material: item.material || "",
          purpose: item.purpose || "",
          customsCode: item.customsCode || "",
          isBattery: item.isBattery || "",
          unit: item.unit || "",
          declaredValue: item.declaredValue || "",
          quantity: item.shippedQuantity || shipment.shippedQuantity || 0,
          quantityInBox: item.quantityInCase || 0,
          boxCount: 0,
        });
      }
      continue;
    }

    const grouped = new Map();
    for (const box of boxes) {
      for (const product of box.productList || []) {
        const key = firstText(product.msku, product.sku, product.asin, "unknown");
        const item = (shipment.items || []).find((candidate) =>
          candidate.msku === product.msku
          || candidate.sku === product.sku
          || candidate.internalSku === product.sku
        ) || {};
        const existing = grouped.get(key) || {
          shipment,
          item,
          boxes: [],
          sku: firstText(product.sku, product.msku),
          internalSku: firstText(item.internalSku),
          msku: firstText(product.msku),
          asin: firstText(product.asin),
          productName: firstText(product.productName, product.title),
          title: firstText(product.title, product.productName),
          imageUrl: firstText(product.url),
          brand: firstText(product.brand, product.brandName, product.brand_name),
          material: firstText(product.material, product.materialName, product.material_name),
          purpose: firstText(product.purpose, product.usage, product.use),
          customsCode: firstText(product.customsCode, product.customs_code, product.hsCode, product.hs_code),
          isBattery: firstText(product.isBattery, product.is_battery, product.battery),
          unit: firstText(product.unit, product.unitName, product.unit_name),
          quantity: 0,
          quantityInBox: numberValue(product.quantityInBox),
          weightKg: roundNumber(toKg(box.weight, box.weightUnit), 3),
          lengthCm: roundNumber(toCm(box.length, box.lengthUnit), 2),
          widthCm: roundNumber(toCm(box.width, box.lengthUnit), 2),
          heightCm: roundNumber(toCm(box.height, box.lengthUnit), 2),
        };
        existing.boxes.push(box);
        existing.quantity += numberValue(product.quantityInBox || box.total);
        if (!existing.imageUrl && product.url) existing.imageUrl = product.url;
        grouped.set(key, existing);
      }
    }
    lines.push(...grouped.values());
  }
  return lines.map((line) => {
    const boxCount = line.boxes.length || line.boxCount || (line.quantityInBox ? Math.ceil(numberValue(line.quantity) / numberValue(line.quantityInBox)) : 0);
    const quantityInBox = line.quantityInBox || (boxCount ? numberValue(line.quantity) / boxCount : 0);
    const lengthCm = line.lengthCm || 0;
    const widthCm = line.widthCm || 0;
    const heightCm = line.heightCm || 0;
    return {
      ...line,
      boxCount,
      quantityInBox,
      totalWeightKg: roundNumber((line.weightKg || 0) * boxCount, 3),
      volumeCbm: roundNumber(boxCount * lengthCm * widthCm * heightCm / 1000000, 4),
      boxRange: boxRangeText(line.boxes),
      imageUrl: line.imageUrl || line.item?.imageUrl || line.shipment?.productImageUrl || "",
      internalSku: line.internalSku || line.item?.internalSku || "",
      productName: line.productName || line.item?.productName || line.item?.title || line.sku,
      title: line.title || line.productName || line.item?.title || line.sku,
      asin: line.asin || line.item?.asin || "",
      brand: line.brand || line.item?.brand || "",
      model: line.model || line.item?.model || "",
      material: line.material || line.item?.material || "",
      purpose: line.purpose || line.item?.purpose || "",
      customsCode: line.customsCode || line.item?.customsCode || "",
      isBattery: line.isBattery || line.item?.isBattery || "",
      unit: line.unit || line.item?.unit || "",
    };
  });
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function worksheetXmlParts(xml) {
  const start = xml.indexOf("<sheetData>");
  const end = xml.indexOf("</sheetData>");
  if (start < 0 || end < 0) throw new Error("货代模板工作表结构异常：缺少 sheetData。");
  return {
    before: xml.slice(0, start + "<sheetData>".length),
    sheetData: xml.slice(start + "<sheetData>".length, end),
    after: xml.slice(end),
  };
}

function rowXml(sheetData, rowNumber) {
  const match = sheetData.match(new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[\\s\\S]*?</row>`));
  if (!match) throw new Error(`货代模板缺少第 ${rowNumber} 行。`);
  return match[0];
}

function replaceRowXml(sheetData, rowNumber, nextRowXml) {
  return sheetData.replace(new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[\\s\\S]*?</row>`), nextRowXml);
}

function parseWorksheetRows(sheetData) {
  return [...sheetData.matchAll(/<row\b(?=[^>]*\br="(\d+)")[\s\S]*?<\/row>/g)]
    .map((match) => ({ rowNumber: Number(match[1]), xml: match[0] }));
}

function renumberRowXml(xml, fromRow, toRow) {
  return xml
    .replace(new RegExp(`(<row\\b[^>]*\\br=")${fromRow}(")`), `$1${toRow}$2`)
    .replace(new RegExp(`([A-Z]{1,3})${fromRow}(?=")`, "g"), `$1${toRow}`);
}

function shiftRowXml(xml, startRow, delta) {
  if (!delta) return xml;
  return xml
    .replace(/(<row\b[^>]*\br=")(\d+)(")/, (_, prefix, row, suffix) => {
      const next = Number(row) >= startRow ? Number(row) + delta : Number(row);
      return `${prefix}${next}${suffix}`;
    })
    .replace(/(<c\b[^>]*\br=")([A-Z]{1,3})(\d+)(")/g, (_, prefix, col, row, suffix) => {
      const next = Number(row) >= startRow ? Number(row) + delta : Number(row);
      return `${prefix}${col}${next}${suffix}`;
    });
}

function shiftReferenceText(value, startRow, delta) {
  return value.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_, col, row) => {
    const rowNumber = Number(row);
    return `${col}${rowNumber >= startRow ? rowNumber + delta : rowNumber}`;
  });
}

function shiftWorksheetTailReferences(xml, startRow, delta) {
  if (!delta) return xml;
  return xml.replace(/\b(ref|sqref)="([^"]+)"/g, (_, attr, value) => (
    `${attr}="${shiftReferenceText(value, startRow, delta)}"`
  ));
}

function cellXmlPattern(address) {
  return new RegExp(`<c\\b(?=[^>]*\\br="${address}")[\\s\\S]*?</c>|<c\\b(?=[^>]*\\br="${address}")[^>]*/>`);
}

function cellStyleAttribute(cellXml = "") {
  return cellXml.match(/\bs="[^"]+"/)?.[0] || "";
}

function makeCellXml(address, value, templateCellXml = "") {
  const style = cellStyleAttribute(templateCellXml);
  const attrs = [`r="${address}"`, style].filter(Boolean).join(" ");
  if (value === undefined || value === null || value === "") return `<c ${attrs}/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c ${attrs}><v>${value}</v></c>`;
  const text = escapeXml(value);
  const space = /^\s|\s$|\n/.test(String(value)) ? ' xml:space="preserve"' : "";
  return `<c ${attrs} t="inlineStr"><is><t${space}>${text}</t></is></c>`;
}

function setCellXml(row, rowNumber, colIndex, value) {
  const address = `${XLSX.utils.encode_col(colIndex)}${rowNumber}`;
  const pattern = cellXmlPattern(address);
  const currentCell = row.match(pattern)?.[0] || "";
  const nextCell = makeCellXml(address, value, currentCell);
  if (currentCell) return row.replace(pattern, nextCell);
  return row.replace("</row>", `${nextCell}</row>`);
}

function setRowValuesXml(row, rowNumber, values) {
  return values.reduce((nextRow, value, colIndex) => setCellXml(nextRow, rowNumber, colIndex, value), row);
}

function jiufangChannelForCountry(country = "") {
  const normalized = normalizedCountryName(country);
  if (normalized === "美国") return "美国海派(包税)";
  if (normalized === "加拿大") return "加拿大卡派(包税)";
  if (normalized === "澳洲") return "宁波澳洲卡派(包税)";
  return "";
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function jiufangHeaderValues(shipments = []) {
  const countries = uniqueNonEmpty(shipments.map((shipment) => normalizedCountryName(shipment.country)));
  const warehouses = uniqueNonEmpty(shipments.map((shipment) => shipment.fulfillmentCenterCode));
  const stores = uniqueNonEmpty(shipments.map((shipment) => shipment.storeName || shipment.raw?.seller || shipment.sid));
  const profile = stores.length === 1 ? getFbaAddressProfile(stores[0]) : null;
  return {
    channelName: countries.length === 1 ? jiufangChannelForCountry(countries[0]) : "",
    country: countries.length === 1 ? countries[0] : "",
    warehouseCode: warehouses.length === 1 ? warehouses[0] : "",
    companyName: profile?.companyName || "",
    address: [profile?.addressLine1, profile?.addressLine2, profile?.city].filter(Boolean).join(", "),
    contact: firstText(profile?.contact, profile?.contactName),
    telephone: profile?.phoneNumber || "",
  };
}

function fillJiufangHeaderXml(sheetData, shipments = []) {
  const values = jiufangHeaderValues(shipments);
  let next = sheetData;
  const updates = [
    [2, 2, values.channelName],
    [4, 1, values.companyName],
    [5, 1, values.address],
    [7, 1, values.contact],
    [8, 1, values.telephone],
    [9, 4, values.country],
    [12, 1, values.warehouseCode],
  ];
  for (const [rowNumber, colIndex, value] of updates) {
    const currentRow = rowXml(next, rowNumber);
    next = replaceRowXml(next, rowNumber, setCellXml(currentRow, rowNumber, colIndex, value));
  }
  return next;
}

function jiufangValuesForLine(line) {
  if (!line) return new Array(24).fill("");
  const shipment = line.shipment || {};
  return [
    shipment.shipmentId,
    shipmentReferenceId(shipment),
    line.boxRange || (line.boxCount ? `1~${line.boxCount}` : ""),
    line.boxCount || "",
    line.sku || line.msku,
    line.title,
    line.productName,
    line.brand || "",
    line.material || "",
    line.purpose || "",
    line.customsCode || "",
    line.asin,
    line.isBattery || "",
    line.sku || line.msku,
    numberValue(line.quantity) || "",
    line.unit || "",
    line.quantityInBox || "",
    "",
    "",
    line.imageUrl,
    line.weightKg || "",
    line.lengthCm || "",
    line.widthCm || "",
    line.heightCm || "",
  ];
}

function tongpaoValuesForLine(line) {
  const shipment = line.shipment || {};
  const declareUnitPrice = "";
  const declareTotal = declareUnitPrice ? roundNumber(declareUnitPrice * numberValue(line.quantity), 2) : "";
  return [
    "",
    [line.title, line.productName].filter(Boolean).join("、"),
    line.boxCount || "",
    line.quantityInBox || "",
    numberValue(line.quantity) || "",
    line.weightKg || "",
    line.totalWeightKg || "",
    line.totalWeightKg || "",
    line.lengthCm || "",
    line.widthCm || "",
    line.heightCm || "",
    line.volumeCbm || "",
    declareUnitPrice,
    declareTotal,
    "",
    "",
    "",
    line.sku || line.msku,
    "",
    "",
    "",
    "",
    "",
    "",
    line.imageUrl,
    shipment.shipmentId,
    shipmentReferenceId(shipment),
    shipment.fulfillmentCenterCode,
    shipmentWarehouseAddress(shipment),
    "",
  ];
}

function fillJiufangTemplateXml(xml, shipments, boxPayloadsByShipmentId) {
  const lines = normalizeForwarderLines(shipments, boxPayloadsByShipmentId);
  const parts = worksheetXmlParts(xml);
  const startRow = 20;
  const templateRow = rowXml(parts.sheetData, startRow);
  let sheetData = fillJiufangHeaderXml(parts.sheetData, shipments);
  for (let row = startRow; row <= 198; row += 1) {
    const line = lines[row - startRow];
    const nextRow = setRowValuesXml(renumberRowXml(templateRow, startRow, row), row, jiufangValuesForLine(line));
    sheetData = replaceRowXml(sheetData, row, nextRow);
  }
  return `${parts.before}${sheetData}${parts.after}`;
}

function fillTongpaoTemplateXml(xml, shipments, boxPayloadsByShipmentId) {
  const lines = normalizeForwarderLines(shipments, boxPayloadsByShipmentId);
  const parts = worksheetXmlParts(xml);
  const startRow = 5;
  const lineCount = Math.max(lines.length, 1);
  const extraRows = Math.max(0, lineCount - 1);
  const dataTemplateRow = rowXml(parts.sheetData, 5);
  const totalTemplateRow = rowXml(parts.sheetData, 6);
  const parsedRows = parseWorksheetRows(parts.sheetData);
  const renderedRows = [];

  for (const row of parsedRows.filter((item) => item.rowNumber < startRow)) renderedRows.push(row.xml);
  lines.forEach((line, index) => {
    const rowNumber = startRow + index;
    renderedRows.push(setRowValuesXml(renumberRowXml(dataTemplateRow, 5, rowNumber), rowNumber, tongpaoValuesForLine(line)));
  });

  const totalRow = startRow + lineCount;
  const totals = lines.reduce((acc, line) => {
    acc.boxCount += numberValue(line.boxCount);
    acc.quantity += numberValue(line.quantity);
    acc.weight += numberValue(line.totalWeightKg);
    acc.volume += numberValue(line.volumeCbm);
    return acc;
  }, { boxCount: 0, quantity: 0, weight: 0, volume: 0 });
  const totalValues = new Array(30).fill("");
  totalValues[0] = "总计";
  totalValues[2] = totals.boxCount || "";
  totalValues[4] = totals.quantity || "";
  totalValues[6] = roundNumber(totals.weight, 3) || "";
  totalValues[11] = roundNumber(totals.volume, 4) || "";
  renderedRows.push(setRowValuesXml(renumberRowXml(totalTemplateRow, 6, totalRow), totalRow, totalValues));
  for (const row of parsedRows.filter((item) => item.rowNumber > 6)) {
    renderedRows.push(shiftRowXml(row.xml, 6, extraRows));
  }

  return `${parts.before}${renderedRows.join("")}${shiftWorksheetTailReferences(parts.after, 6, extraRows)}`;
}

export function buildFbaForwarderWorkbookBuffer(shipments = [], { templateId, boxPayloadsByShipmentId = new Map() } = {}) {
  const template = resolveFbaForwarderTemplate(templateId);
  const entries = readZipEntries(readFileSync(template.path));
  const worksheetEntry = entries.find((entry) => entry.name === template.worksheetPath);
  if (!worksheetEntry) throw new Error(`货代模板缺少工作表文件：${template.worksheetPath}`);
  const xml = worksheetEntry.data.toString("utf8");
  if (template.id === "jiufang") worksheetEntry.data = Buffer.from(fillJiufangTemplateXml(xml, shipments, boxPayloadsByShipmentId), "utf8");
  if (template.id === "tongpao") worksheetEntry.data = Buffer.from(fillTongpaoTemplateXml(xml, shipments, boxPayloadsByShipmentId), "utf8");
  return writeZipEntries(entries);
}

async function fetchBoxPayloadsByShipmentId(adapter, shipments = []) {
  const map = new Map();
  for (const shipment of shipments) {
    if (!shipment.inboundPlanId || !shipment.staShipmentId || !shipment.sid) continue;
    try {
      const payload = await adapter.fetchFbaCargoShipmentBoxes({
        inboundPlanId: shipment.inboundPlanId,
        shipmentIdList: [shipment.staShipmentId],
        sid: shipment.sid,
      });
      map.set(shipment.shipmentId, payload);
      if (shipment.staShipmentId) map.set(shipment.staShipmentId, payload);
    } catch (error) {
      console.warn("[fba-freight] fetch shipment boxes failed", {
        shipmentId: shipment.shipmentId,
        staShipmentId: shipment.staShipmentId,
        inboundPlanId: shipment.inboundPlanId,
        sid: shipment.sid,
        error: error.message,
      });
    }
  }
  return map;
}

function rowsForWorkbook(shipments = []) {
  return shipments.map((row) =>
    Object.fromEntries(freightSheetColumns.map((column) => [column.label, row[column.key] ?? ""])),
  );
}

export function buildFbaFreightWorkbookBuffer(shipments = []) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rowsForWorkbook(shipments), {
    header: freightSheetColumns.map((column) => column.label),
  });
  sheet["!cols"] = [
    { wch: 10 },
    { wch: 18 },
    { wch: 42 },
    { wch: 34 },
    { wch: 20 },
    { wch: 10 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "货代表格");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export function normalizeFbaFreightFilters(filters = {}) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(filters.startDate || "")
    ? filters.startDate
    : `${yyyy}-${mm}-01`;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(filters.endDate || "") ? filters.endDate : today;
  const sids = String(filters.sids || filters.sid || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Boolean);
  return {
    startDate,
    endDate,
    sids: sids.length ? sids : lingxingShopMap.map((shop) => Number(shop.sid)).filter(Boolean),
    shipmentId: firstText(filters.shipmentId, filters.shipment_id),
    shipmentStatus: firstText(filters.shipmentStatus, filters.shipment_status),
    offset: Math.max(0, Number(filters.offset || 0) || 0),
    length: Math.min(500, Math.max(1, Number(filters.length || 100) || 100)),
  };
}

function buildLingxingShipmentParams(filters) {
  const params = {
    sid: filters.sids.join(","),
    start_date: filters.startDate,
    end_date: filters.endDate,
    offset: filters.offset,
    length: filters.length,
  };
  if (filters.shipmentId) params.shipment_id = filters.shipmentId;
  if (filters.shipmentStatus) params.shipment_status = filters.shipmentStatus;
  return params;
}

export async function getFbaFreightShipments(filters = {}, {
  adapter = getLingxingAdapter(),
  sellers = [],
  productCatalogRequired = false,
  forceProductCatalogRefresh = false,
  jiufangOrderStore = {
    listByShipmentIds: (shipmentIds) => listJiufangOrdersByShipmentIds(shipmentIds),
  },
} = {}) {
  const result = await getFbaShipmentCandidates(filters, {
    adapter,
    sellers,
    productCatalogRequired,
    forceProductCatalogRefresh,
  });
  const shipmentIds = result.rows.map((row) => row.shipmentId).filter(Boolean);
  const jiufangOrdersByShipmentId = await jiufangOrderStore.listByShipmentIds(shipmentIds);
  const rows = result.rows.map((row) => {
    const jiufangOrder = jiufangOrdersByShipmentId.get(row.shipmentId);
    if (!jiufangOrder) return row;
    return {
      ...row,
      jiufangOrderNumber: jiufangOrder.jiufangOrderNumber,
      jiufangChannelCode: jiufangOrder.channelCode || "",
      jiufangCreatedAt: jiufangOrder.createdAt || "",
    };
  });
  console.info("[fba-freight] normalized shipments", {
    shipmentCount: rows.length,
    itemCount: rows.reduce((total, shipment) => total + (shipment.items || []).length, 0),
    jiufangOrderCount: rows.filter((row) => row.jiufangOrderNumber).length,
    imageCatalogStatus: result.imageCatalogStatus || "",
    cacheHit: Boolean(result.cache?.hit),
  });
  return { ...result, rows };
}

export async function exportFbaFreightShipments(filters = {}, options = {}) {
  const result = await getFbaFreightShipments(filters, options);
  return {
    ...result,
    filename: `货代表格-${result.filters.startDate}-${result.filters.endDate}.xlsx`,
    buffer: buildFbaFreightWorkbookBuffer(result.rows),
  };
}

function selectedShipmentIdSet(values = []) {
  return new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean));
}

function filterShipmentsByIds(shipments = [], shipmentIds = []) {
  const set = selectedShipmentIdSet(shipmentIds);
  if (!set.size) return shipments;
  return shipments.filter((shipment) => set.has(shipment.shipmentId) || set.has(shipment.staShipmentId) || set.has(shipment.id));
}

function safeFilenamePart(value = "") {
  return String(value || "").trim().replace(/[\\/:*?"<>|]/g, "-") || "货代模板";
}

function assertSingleJiufangHeaderScope(rows = []) {
  const countries = uniqueNonEmpty(rows.map((shipment) => normalizedCountryName(shipment.country)));
  const warehouses = uniqueNonEmpty(rows.map((shipment) => shipment.fulfillmentCenterCode));
  if (countries.length !== 1) throw new Error(`九方通逊模板一次只能生成同一目的国家的货件，当前为：${countries.join("、") || "缺失目的国家"}`);
  if (warehouses.length !== 1) throw new Error(`九方通逊模板一次只能生成同一物流中心的货件，当前为：${warehouses.join("、") || "缺失物流中心编码"}`);
}

function assertJiufangDeclarationFields(rows = [], boxPayloadsByShipmentId = new Map()) {
  const lines = normalizeForwarderLines(rows, boxPayloadsByShipmentId);
  const requiredFields = [
    ["brand", "Brand品牌"],
    ["material", "材质"],
    ["purpose", "用途"],
    ["customsCode", "清关编码"],
    ["isBattery", "是否带电"],
    ["unit", "单位"],
  ];
  const missing = [];
  lines.forEach((line) => {
    const label = line.msku || line.sku || line.asin || line.productName || "未知商品";
    requiredFields.forEach(([key, name]) => {
      if (!firstText(line[key])) missing.push(`${label} 缺少${name}`);
    });
  });
  if (missing.length) {
    throw new Error(`ERP 产品管理资料不完整，无法生成九方通逊模板：${missing.slice(0, 12).join("；")}${missing.length > 12 ? "；..." : ""}`);
  }
}

export async function convertFbaFreightShipmentsToForwarderTemplate({
  templateId,
  shipmentIds = [],
  filters = {},
} = {}, { adapter = getLingxingAdapter(), sellers = [] } = {}) {
  const template = resolveFbaForwarderTemplate(templateId);
  const result = await getFbaFreightShipments(filters, {
    adapter,
    sellers,
    productCatalogRequired: true,
    forceProductCatalogRefresh: true,
  });
  const rows = filterShipmentsByIds(result.rows, shipmentIds);
  if (!rows.length) throw new Error("请选择要转表格的货件。");
  const boxPayloadsByShipmentId = await fetchBoxPayloadsByShipmentId(adapter, rows);
  if (template.id === "jiufang") {
    assertSingleJiufangHeaderScope(rows);
    assertJiufangDeclarationFields(rows, boxPayloadsByShipmentId);
  }
  console.info("[fba-freight] converting forwarder template", {
    templateId: template.id,
    shipmentCount: rows.length,
    shipmentIds: rows.map((row) => row.shipmentId).filter(Boolean),
  });
  return {
    ok: true,
    template: { id: template.id, name: template.name },
    rows,
    filename: `${safeFilenamePart(template.name)}-${rows.length === 1 ? safeFilenamePart(rows[0].shipmentId) : `${rows.length}个货件`}.xlsx`,
    buffer: buildFbaForwarderWorkbookBuffer(rows, { templateId: template.id, boxPayloadsByShipmentId }),
  };
}

export const fbaFreightSheetTestUtils = {
  buildLingxingShipmentParams,
  buildSellersBySid,
  freightSheetColumns,
  normalizeForwarderLines,
  normalizeItem,
  recordList,
};
