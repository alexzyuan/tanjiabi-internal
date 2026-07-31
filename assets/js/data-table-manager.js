const TABLE_SELECTOR = ".view table, .table-wrap table, .table-scroll table, table.data-table";
const MIN_COLUMN_WIDTH = 44;
const DEFAULT_COLUMN_WIDTH = 112;
const DEFAULT_SCROLL_HINT = "横向滚动查看更多列";
const COLUMN_WIDTH_STORAGE_PREFIX = "tanjia:tableColumnWidths:v1";
const SMART_WIDTH_DEBUG_STORAGE_KEY = "tanjia:tableWidthDiagnostics";
const WIDTH_MIGRATION_MARKER_SUFFIX = ":migration-complete";
const SORT_INDICATOR_WIDTH = 9;
const smartWidthSignatures = new WeakMap();

const numericHeaderPattern = /(金额|销售额|采购额|应付额|实付额|未付额|数量|销量|采购量|库存|在库|可售|转库|在途|成本|费用|费率|毛利率|净利率|退款率|达成率|占比|税点|采购价|单价|价格|天数|ACOS|ROAS|CPC|CTR|CVR|订单|目标|实际|利润|收入|支出|回款|结算|余额|计提|冲回|统计|申请中|未申请|货件数|店铺数|MSKU\s*数|SKU\s*数|总数|小计|合计|比例|率)$/i;
const exactNumericHeaderPattern = /^(广告花费|退款|采购量|退货量|\d+天日销|review数)$/i;
const textHeaderPattern = /(名称|产品|店铺|国家|负责人|供应商|图片|状态|操作|时间|日期|币种|编码|单号|型号|备注|内容|链接|目录|文件夹|标题|账号|角色|来源|阶段|建议|结论|周期|模块|对象|指标|类型|仓库|承运商|运输方式|feedback|review|ASIN|MSKU|SKU|FNSKU)$/i;
const errorStatePattern = /失败|错误|异常|缺少|missing|error/i;
const loadingStatePattern = /正在|等待|读取|加载|同步|生成中/;
const numericColumnKinds = new Set(["number", "money", "currency", "percent", "rate", "integer", "decimal"]);
const textColumnKinds = new Set(["text", "date", "datetime", "image", "status", "action", "link"]);
const SMART_COLUMN_SAMPLE_LIMIT = 30;

const SMART_COLUMN_PROFILES = Object.freeze({
  selection: Object.freeze({ min: 44, preferred: 48, max: 56, padding: 12, align: "center" }),
  image: Object.freeze({ min: 52, preferred: 56, max: 64, padding: 8, align: "center" }),
  "compact-dimension": Object.freeze({ min: 56, preferred: 64, max: 80, padding: 20, align: "left" }),
  number: Object.freeze({ min: 64, preferred: 76, max: 96, padding: 20, align: "right" }),
  "money-rate": Object.freeze({ min: 80, preferred: 92, max: 112, padding: 20, align: "right" }),
  "date-time": Object.freeze({ min: 96, preferred: 112, max: 136, padding: 20, align: "left" }),
  status: Object.freeze({ min: 84, preferred: 96, max: 128, padding: 20, align: "left" }),
  "short-name": Object.freeze({ min: 84, preferred: 96, max: 140, padding: 20, align: "left" }),
  identifier: Object.freeze({ min: 112, preferred: 136, max: 180, padding: 20, align: "left" }),
  "code-order": Object.freeze({ min: 128, preferred: 152, max: 200, padding: 20, align: "left" }),
  name: Object.freeze({ min: 140, preferred: 176, max: 240, padding: 20, align: "left" }),
  narrative: Object.freeze({ min: 160, preferred: 200, max: 280, padding: 20, align: "left" }),
  action: Object.freeze({ min: 72, preferred: 104, max: 320, padding: 16, align: "left" }),
  text: Object.freeze({ min: 80, preferred: 112, max: 180, padding: 20, align: "left" }),
});

const SMART_COLUMN_PROFILE_PATTERNS = [
  ["selection", /^(选择|全选|勾选|关注|隐藏|序号)$/i],
  ["image", /(图片|产品图|主图|缩略图|image|photo)/i],
  ["action", /^(操作|动作|管理)$/i],
  ["number", /^(AWD|FBA预留|旺季预测|日销建议|补货建议|\d+月日销|\d+天日销|采购量|退货量|review数|(?:货件|店铺|供应商|MSKU|SKU)\s*数)$/i],
  ["short-name", /^(店铺|负责人|所有者|操作人|人员)$/i],
  ["narrative", /(处理结果|结果|说明|备注|内容|建议|结论|原因|描述|下一步|共性信号)/i],
  ["code-order", /(单号|订单号|货件号|编号|编码|仓库代码|物流中心|shipment\s*id|order\s*id)/i],
  ["identifier", /(^|[\s/])(MSKU|SKU|ASIN|FNSKU|SID|Profile)([\s/]|$)/i],
  ["date-time", /(日期|时间|月份|周期|周数|到期|签发|登录|更新|开始日|转账日)/i],
  ["status", /(状态|风险|优先级|阶段|类型|标记)/i],
  ["money-rate", /(金额|销售额|采购额|成本|费用|费率|利润|收入|支出|回款|结算|余额|单价|价格|采购价|税点|比例|占比|达成率|退款率|毛利率|净利率|ACOS|ROAS|CPC|CTR|CVR|预算|花费|退款|(?:销售|退款|利润)目标)/i],
  ["number", /(数量|销量|日销|库存|在库|可售|转库|在途|天数|订单|目标|实际|统计|申请中|未申请|总数|小计|合计|排名|次数|review数)/i],
  ["compact-dimension", /^(国家|站点|币种|平台)$/i],
  ["name", /(名称|产品|品名|供应商|账号|承运商|渠道)/i],
];

function normalizeColumnLabel(label = "") {
  return String(label || "")
    .replace(/调整\s*.*?\s*列宽/g, "")
    .replace(/[（(][^（）()]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferSmartColumnProfile(label = "", explicitProfile = "") {
  const explicit = String(explicitProfile || "").trim().toLowerCase();
  if (SMART_COLUMN_PROFILES[explicit]) return explicit;
  const normalized = normalizeColumnLabel(label);
  for (const [profile, pattern] of SMART_COLUMN_PROFILE_PATTERNS) {
    if (pattern.test(normalized)) return profile;
  }
  return "text";
}

function measuredTextWidth(measureText, value) {
  const measured = measureText(String(value || ""));
  const width = typeof measured === "number" ? measured : measured?.width;
  return Number.isFinite(width) ? Math.max(0, width) : 0;
}

export function estimateSmartColumnWidth({
  label = "",
  values = [],
  explicitProfile = "",
  measureText = (value) => String(value || "").length * 8,
  controlWidth = 0,
  sortControlWidth = 0,
} = {}) {
  const profileName = inferSmartColumnProfile(label, explicitProfile);
  const profile = SMART_COLUMN_PROFILES[profileName];
  const samples = Array.from(values || []).slice(0, SMART_COLUMN_SAMPLE_LIMIT);
  const measuredSamples = samples
    .map((value) => measuredTextWidth(measureText, value))
    .sort((left, right) => left - right);
  const percentileIndex = measuredSamples.length ? Math.floor((measuredSamples.length - 1) * 0.9) : -1;
  const measuredContentWidth = percentileIndex >= 0 ? measuredSamples[percentileIndex] : 0;
  const measuredHeaderWidth = measuredTextWidth(measureText, normalizeColumnLabel(label));
  const measuredSortableHeaderWidth = measuredHeaderWidth + Math.max(0, Number(sortControlWidth) || 0);
  let contentTarget = Math.max(measuredSortableHeaderWidth, measuredContentWidth) + profile.padding;

  if (profileName === "selection" || profileName === "image") {
    contentTarget = profile.preferred;
  } else if (profileName === "action" && Number.isFinite(Number(controlWidth)) && Number(controlWidth) > 0) {
    contentTarget = Math.max(contentTarget, Number(controlWidth) + profile.padding);
  }

  return {
    profile: profileName,
    align: profile.align,
    minWidth: profile.min,
    maxWidth: profile.max,
    measuredContentWidth: Math.round(measuredContentWidth),
    measuredHeaderWidth: Math.round(measuredHeaderWidth),
    sampleCount: samples.length,
    width: Math.min(profile.max, Math.max(profile.min, Math.round(contentTarget))),
  };
}

export function normalizeColumnWidth(value, fallback = DEFAULT_COLUMN_WIDTH) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(MIN_COLUMN_WIDTH, Math.round(number));
}

export function inferTableColumnKind(label = "") {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  if (!text) return "text";
  const normalizedText = text.replace(/[（(][^（）()]*[）)]/g, "").replace(/\s+/g, " ").trim();
  if (exactNumericHeaderPattern.test(normalizedText)) return "number";
  if (textHeaderPattern.test(normalizedText)) return "text";
  if (numericHeaderPattern.test(normalizedText)) return "number";
  return "text";
}

function normalizeExplicitColumnKind(value = "") {
  const kind = String(value || "").trim().toLowerCase();
  if (numericColumnKinds.has(kind)) return "number";
  if (textColumnKinds.has(kind)) return "text";
  return "";
}

function resolveTableColumnKindDetails({ explicitKind = "", explicitType = "", explicitSource = "", label = "" } = {}) {
  if (explicitSource !== "inferred") {
    const explicit = normalizeExplicitColumnKind(explicitKind) || normalizeExplicitColumnKind(explicitType);
    if (explicit) return { kind: explicit, source: "explicit" };
  }
  return { kind: inferTableColumnKind(label), source: "inferred" };
}

export function resolveTableColumnKind(options = {}) {
  return resolveTableColumnKindDetails(options).kind;
}

export function inferTableStateTone(message = "") {
  const text = String(message || "");
  if (errorStatePattern.test(text)) return "error";
  if (loadingStatePattern.test(text)) return "loading";
  return "empty";
}

export function classifyDataTableVariant({ className = "", columnCount = 0 } = {}) {
  const classes = String(className || "");
  if (classes.includes("sales-forecast-table")) return "matrix";
  if (columnCount >= 14) return "wide";
  return "standard";
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function getLeafHeaderCells(table) {
  const rows = Array.from(table?.tHead?.rows || []);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const cells = Array.from(rows[index].cells || []).filter((cell) => cell.tagName === "TH" && Number(cell.colSpan || 1) === 1);
    if (cells.length) return cells;
  }
  return Array.from(table?.querySelectorAll?.("thead th") || []).filter((cell) => Number(cell.colSpan || 1) === 1);
}

function getColumnCount(table) {
  const leafHeaders = getLeafHeaderCells(table);
  if (leafHeaders.length) return leafHeaders.length;
  return Math.max(0, ...Array.from(table?.rows || []).map((row) => Array.from(row.cells || []).reduce((sum, cell) => sum + Number(cell.colSpan || 1), 0)));
}

function tableStorageKey(table) {
  const explicit = table?.dataset?.tableKey || table?.id || "";
  if (explicit) return `${COLUMN_WIDTH_STORAGE_PREFIX}:${explicit}`;
  const headers = getLeafHeaderCells(table).map((header) => String(header.textContent || "").replace(/\s+/g, " ").trim());
  if (!headers.length) return "";
  return `${COLUMN_WIDTH_STORAGE_PREFIX}:${headers.join("|").slice(0, 180)}`;
}

function legacyTableStorageKey(table) {
  const headers = getLeafHeaderCells(table).map((header) => normalizeColumnLabel(header.textContent || ""));
  if (!headers.length) return "";
  return `${COLUMN_WIDTH_STORAGE_PREFIX}:${headers.join("|").slice(0, 180)}`;
}

function columnStorageKey(header, index) {
  const explicit = header?.dataset?.columnKey || header?.getAttribute?.("data-column-key") || "";
  if (explicit) return String(explicit).trim();
  const label = String(header?.textContent || "").replace(/\s+/g, " ").trim();
  return label ? `${index}:${label}` : String(index);
}

function datasetBusinessKey(dataset = {}) {
  const entry = Object.entries(dataset).find(([key, value]) => value && (key === "columnKey" || key.endsWith("Sort")));
  return entry ? String(entry[1]).trim() : "";
}

function ensureStableTableIdentity(table) {
  const existing = String(table?.dataset?.tableKey || table?.id || "").trim();
  if (existing) return existing;
  const view = table?.closest?.(".view[id]");
  if (!view?.id) {
    throw new Error("[data-table-manager] managed table requires an id, data-table-key, or containing view id");
  }
  const tables = Array.from(view.querySelectorAll?.(TABLE_SELECTOR) || []);
  const index = tables.indexOf(table);
  if (index < 0) {
    throw new Error("[data-table-manager] managed table identity could not be resolved");
  }
  table.dataset.tableKey = `${view.id}:table-${index + 1}`;
  return table.dataset.tableKey;
}

function ensureStableColumnIdentities(headers) {
  headers.forEach((header, index) => {
    if (String(header?.dataset?.columnKey || "").trim()) return;
    const control = header?.querySelector?.("button, [data-column-key]");
    header.dataset.columnKey = datasetBusinessKey(header.dataset)
      || datasetBusinessKey(control?.dataset)
      || `column-${index + 1}`;
  });
}

function isAutoSortableHeader(header) {
  if (!header || Number(header.colSpan || 1) > 1) return false;
  if (header.dataset?.columnSortable === "false") return false;
  if (header.querySelector?.(".sort-button")) return false;
  if (header.querySelector?.("input, select, textarea, a, button")) return false;
  return Boolean(String(header.textContent || "").replace(/\s+/g, " ").trim());
}

function ensureHeaderSortButtons(headers) {
  headers.forEach((header, index) => {
    if (!isAutoSortableHeader(header)) return;
    const documentRef = header.ownerDocument || header.closest?.("table")?.ownerDocument;
    if (!documentRef?.createElement || !header.appendChild) return;
    const label = String(header.textContent || "").replace(/\s+/g, " ").trim();
    const button = documentRef.createElement("button");
    if (!button) return;
    button.className = "sort-button";
    button.type = "button";
    button.dataset.tableSort = String(header.dataset?.columnKey || `column-${index + 1}`);
    button.textContent = label;
    header.textContent = "";
    header.appendChild(button);
  });
}

function assertUniqueTableIdentity(table) {
  const key = String(table?.dataset?.tableKey || table?.id || "").trim();
  const allTables = Array.from(table?.ownerDocument?.querySelectorAll?.(TABLE_SELECTOR) || []);
  const duplicates = allTables.filter((candidate) => candidate !== table && String(candidate.dataset?.tableKey || candidate.id || "").trim() === key);
  if (duplicates.length) {
    throw new Error(`[data-table-manager] duplicate managed table key: ${key}`);
  }
}

function parseSavedWidthRecord(raw, key) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.widths && typeof parsed.widths === "object" ? parsed : null;
  } catch (error) {
    console.warn("[data-table-manager] ignored invalid saved column widths", { key, error: error.message });
    return null;
  }
}

function readSavedColumnWidths(table, storage) {
  const key = tableStorageKey(table);
  if (!key || !storage?.getItem) return {};
  return parseSavedWidthRecord(storage.getItem(key), key)?.widths || {};
}

function migrateLegacyColumnWidths(table, headers, storage, legacyKey) {
  const stableKey = tableStorageKey(table);
  if (!stableKey || !legacyKey || stableKey === legacyKey || !storage?.getItem || !storage?.setItem) return;
  const markerKey = `${stableKey}${WIDTH_MIGRATION_MARKER_SUFFIX}`;
  if (storage.getItem(stableKey) || storage.getItem(markerKey)) return;
  const legacyRecord = parseSavedWidthRecord(storage.getItem(legacyKey), legacyKey);
  if (!legacyRecord) return;

  const widths = {};
  headers.forEach((header, index) => {
    const stableColumnKey = columnStorageKey(header, index);
    const legacyLabelKey = `${index}:${normalizeColumnLabel(header?.textContent || "")}`;
    const legacyWidth = legacyRecord.widths[stableColumnKey] ?? legacyRecord.widths[legacyLabelKey] ?? legacyRecord.widths[String(index)];
    if (legacyWidth === undefined) return;
    widths[stableColumnKey] = normalizeColumnWidth(legacyWidth);
  });
  if (!Object.keys(widths).length) return;

  storage.setItem(stableKey, JSON.stringify({
    widths,
    migratedAt: new Date().toISOString(),
    migratedFrom: legacyKey,
  }));
  storage.setItem(markerKey, JSON.stringify({ migratedFrom: legacyKey, migratedAt: new Date().toISOString() }));
  console.info("[data-table-manager] migrated saved column widths", {
    tableKey: stableKey,
    legacyKey,
    columnCount: Object.keys(widths).length,
  });
}

function writeSavedColumnWidths(table, storage) {
  const key = tableStorageKey(table);
  if (!key || !storage?.setItem) return;
  const headers = getLeafHeaderCells(table);
  const columns = Array.from(table.querySelectorAll(":scope > colgroup > col"));
  const widths = {};
  columns.forEach((col, index) => {
    if (!col.dataset.userWidth) return;
    const header = headers[index];
    widths[columnStorageKey(header, index)] = normalizeColumnWidth(col.dataset.userWidth);
  });
  storage.setItem(key, JSON.stringify({ widths, updatedAt: new Date().toISOString() }));
}

function isTableStateRow(row) {
  const firstCell = row?.cells?.[0];
  return Boolean(firstCell && row.cells.length === 1 && Number(firstCell.colSpan || 1) > 1);
}

function extractSampleCellText(cell) {
  if (!cell) return "";
  const clone = cell.cloneNode?.(true);
  if (!clone) return String(cell.textContent || "").replace(/\s+/g, " ").trim();
  clone.querySelectorAll?.(".table-resize-handle, [role='tooltip'], [hidden], .tooltip").forEach((node) => node.remove());
  return String(clone.textContent || "").replace(/\s+/g, " ").trim();
}

function createTextMeasurer(table) {
  try {
    const canvas = table?.ownerDocument?.createElement?.("canvas");
    const context = canvas?.getContext?.("2d");
    if (!context) throw new Error("canvas context unavailable");
    const style = table.ownerDocument?.defaultView?.getComputedStyle?.(table);
    if (style) context.font = style.font || `${style.fontSize || "14px"} ${style.fontFamily || "sans-serif"}`;
    return (value) => context.measureText(String(value || "")).width;
  } catch {
    return (value) => Array.from(String(value || "")).reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 14 : 8), 0);
  }
}

function sampleTableColumns(table, columnCount) {
  const rows = Array.from(table?.tBodies || [])
    .flatMap((tbody) => Array.from(tbody.rows || []))
    .filter((row) => !isTableStateRow(row))
    .slice(0, SMART_COLUMN_SAMPLE_LIMIT);
  const values = Array.from({ length: columnCount }, () => []);
  const actionControlWidths = Array.from({ length: columnCount }, () => 0);

  rows.forEach((row) => {
    Array.from(row.cells || []).forEach((cell, index) => {
      if (index >= columnCount || Number(cell.colSpan || 1) > 1) return;
      values[index].push(extractSampleCellText(cell));
      const controls = Array.from(cell.querySelectorAll?.("button, a, input, select") || []);
      if (!controls.length) return;
      const estimatedControlWidth = controls.reduce((sum, control) => {
        const label = control.getAttribute?.("aria-label") || control.textContent || control.value || "";
        return sum + Math.max(32, Array.from(String(label)).length * 8 + 20);
      }, 0) + Math.max(0, controls.length - 1) * 8;
      actionControlWidths[index] = Math.max(actionControlWidths[index], estimatedControlWidth);
    });
  });

  return { actionControlWidths, rows, values };
}

function applyColumnWidthMetadata(table, headers, index, { align, profile }) {
  const header = headers[index];
  if (header) {
    header.dataset.widthProfile = profile;
    header.dataset.widthAlign = align;
  }
  Array.from(table?.tBodies || []).forEach((tbody) => {
    Array.from(tbody.rows || []).forEach((row) => {
      const cell = row.cells?.[index];
      if (!cell || Number(cell.colSpan || 1) > 1) return;
      cell.dataset.widthProfile = profile;
      cell.dataset.widthAlign = align;
    });
  });
}

function inferHeaderControlProfile(header) {
  if (header?.querySelector?.("input[type='checkbox'], [role='checkbox']")) return "selection";
  return "";
}

function smartWidthSignature(headers, columns, samples, savedWidths) {
  return JSON.stringify({
    columns: headers.map((header, index) => ({
      explicitProfile: header?.getAttribute?.("data-column-profile") || header?.getAttribute?.("data-column-type") || inferHeaderControlProfile(header),
      explicitWidth: header?.getAttribute?.("data-column-width") || "",
      key: columnStorageKey(header, index),
      label: normalizeColumnLabel(header?.textContent || ""),
      userWidth: columns[index]?.dataset?.userWidth || savedWidths[columnStorageKey(header, index)] || "",
    })),
    values: samples.values,
  });
}

function smartWidthDebugEnabled(table, storage) {
  return table?.dataset?.tableWidthDebug === "true" || storage?.getItem?.(SMART_WIDTH_DEBUG_STORAGE_KEY) === "1";
}

function hasSavedUserWidths(table, storage) {
  if (Array.from(table.querySelectorAll(":scope > colgroup > col")).some((column) => column.dataset.userWidth)) return true;
  return Object.keys(readSavedColumnWidths(table, storage)).length > 0;
}

function syncSmartWidthResetControl(table, storage) {
  const wrap = getTableWrap(table);
  const documentRef = table?.ownerDocument;
  if (!wrap?.appendChild || !documentRef?.createElement) return null;
  const tableKey = String(table.dataset.tableKey || table.id || "");
  let control = Array.from(wrap.querySelectorAll?.(":scope > .table-width-reset") || [])
    .find((candidate) => candidate.dataset.tableKey === tableKey);
  if (!control) {
    control = documentRef.createElement("button");
    control.className = "table-width-reset";
    control.type = "button";
    control.dataset.tableKey = tableKey;
    control.setAttribute("aria-label", "恢复智能列宽");
    control.setAttribute("title", "恢复智能列宽");
    control.textContent = "↺";
    wrap.appendChild(control);
  }
  const hasUserWidths = hasSavedUserWidths(table, storage);
  control.hidden = !hasUserWidths;
  wrap.classList?.toggle?.("has-user-column-widths", hasUserWidths);
  return control;
}

export function applySmartColumnWidths(table, storage, { force = false } = {}) {
  const headers = getLeafHeaderCells(table);
  const columns = Array.from(table.querySelectorAll(":scope > colgroup > col"));
  if (!headers.length || !columns.length) return [];
  const savedWidths = readSavedColumnWidths(table, storage);
  const samples = sampleTableColumns(table, headers.length);
  const signature = smartWidthSignature(headers, columns, samples, savedWidths);
  if (!force && smartWidthSignatures.get(table) === signature && columns.every((column) => column.style.width)) {
    return columns.map((column) => Number.parseFloat(column.style.width || "0"));
  }

  const measureText = createTextMeasurer(table);
  const details = [];
  let totalWidth = 0;

  columns.forEach((col, index) => {
    const header = headers[index];
    const columnKey = columnStorageKey(header, index);
    const savedWidth = savedWidths[columnKey];
    const defaultWidth = header?.dataset?.columnWidth || header?.getAttribute?.("data-column-width") || "";
    const explicitProfile = header?.dataset?.columnProfile || header?.getAttribute?.("data-column-profile") || header?.getAttribute?.("data-column-type") || inferHeaderControlProfile(header);
    const estimate = estimateSmartColumnWidth({
      label: header?.textContent || "",
      values: samples.values[index],
      explicitProfile,
      measureText,
      controlWidth: samples.actionControlWidths[index],
      sortControlWidth: header?.querySelector?.(".sort-button") ? SORT_INDICATOR_WIDTH : 0,
    });
    let source = "smart";
    let width = estimate.width;

    if (col.dataset.userWidth) {
      source = "user";
      width = normalizeColumnWidth(col.dataset.userWidth);
    } else if (savedWidth) {
      source = "user";
      width = normalizeColumnWidth(savedWidth);
      col.dataset.userWidth = String(width);
    } else if (defaultWidth) {
      source = "explicit";
      width = normalizeColumnWidth(defaultWidth);
      col.dataset.userWidth = "";
    } else {
      col.dataset.userWidth = "";
    }

    const widthValue = `${width}px`;
    if (col.style.width !== widthValue) col.style.width = widthValue;
    col.dataset.widthProfile = estimate.profile;
    col.dataset.widthSource = source;
    col.dataset.smartWidth = String(estimate.width);
    applyColumnWidthMetadata(table, headers, index, estimate);
    totalWidth += width;
    details.push({
      align: estimate.align,
      columnKey,
      label: normalizeColumnLabel(header?.textContent || ""),
      measuredContentWidth: estimate.measuredContentWidth,
      profile: estimate.profile,
      sampleCount: estimate.sampleCount,
      source,
      width,
    });
  });

  table.style?.setProperty?.("--tj-table-resolved-width", `${totalWidth}px`);
  table.classList.add("is-smart-width", "is-column-resized");
  table.dataset.smartWidthSampleCount = String(samples.rows.length);
  smartWidthSignatures.set(table, smartWidthSignature(headers, columns, samples, savedWidths));
  if (smartWidthDebugEnabled(table, storage)) {
    console.debug("[data-table-manager] smart widths", {
      tableKey: table.dataset.tableKey || table.id || "",
      sampleCount: samples.rows.length,
      totalWidth,
      columns: details,
    });
  }
  return details;
}

function getTableWrap(table) {
  return table?.closest?.(".data-table-wrap, .table-wrap, .table-scroll, .table-shell") || table?.parentElement || null;
}

function setColumnWidth(table, index, width) {
  const col = table?.querySelector?.(`colgroup col[data-column-index="${cssEscape(index)}"]`);
  if (!col) return;
  const normalized = normalizeColumnWidth(width);
  col.style.width = `${normalized}px`;
  col.dataset.userWidth = String(normalized);
  table.classList.add("is-column-resized");
}

function ensureColGroup(table, columnCount) {
  let colgroup = table.querySelector(":scope > colgroup");
  if (!colgroup) {
    colgroup = table.ownerDocument.createElement("colgroup");
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < columnCount) {
    const col = table.ownerDocument.createElement("col");
    col.dataset.columnIndex = String(colgroup.children.length);
    colgroup.appendChild(col);
  }
  while (colgroup.children.length > columnCount) {
    colgroup.lastElementChild.remove();
  }
  Array.from(colgroup.children).forEach((col, index) => {
    col.dataset.columnIndex = String(index);
  });
  return colgroup;
}

function columnWidthFromCell(cell) {
  const rectWidth = cell?.getBoundingClientRect?.().width;
  if (Number.isFinite(rectWidth) && rectWidth > 0) return rectWidth;
  const offsetWidth = cell?.offsetWidth;
  if (Number.isFinite(offsetWidth) && offsetWidth > 0) return offsetWidth;
  return DEFAULT_COLUMN_WIDTH;
}

function lockCurrentColumnWidths(table) {
  const headers = getLeafHeaderCells(table);
  const columns = Array.from(table.querySelectorAll(":scope > colgroup > col"));
  columns.forEach((col, index) => {
    if (col.dataset.userWidth) return;
    const width = columnWidthFromCell(headers[index]) || DEFAULT_COLUMN_WIDTH;
    col.style.width = `${normalizeColumnWidth(width)}px`;
  });
  table.classList.add("is-column-resized");
}

function markColumnKinds(table) {
  const headers = getLeafHeaderCells(table);
  const columns = headers.map((header) => resolveTableColumnKindDetails({
    explicitKind: header.getAttribute("data-column-kind") || "",
    explicitType: header.getAttribute("data-column-type") || "",
    explicitSource: header.getAttribute("data-column-kind-source") || "",
    label: header.textContent || "",
  }));
  const kinds = columns.map((column) => column.kind);
  headers.forEach((header, index) => {
    header.dataset.columnIndex = String(index);
    header.dataset.columnKind = kinds[index];
    header.dataset.columnKindSource = columns[index]?.source || "inferred";
    header.classList.toggle("table-cell--number", kinds[index] === "number");
  });
  Array.from(table.tBodies || []).forEach((tbody) => {
    Array.from(tbody.rows || []).forEach((row) => {
      Array.from(row.cells || []).forEach((cell, index) => {
        if (Number(cell.colSpan || 1) > 1) return;
        const kind = kinds[index] || "text";
        cell.dataset.columnKind = kind;
        cell.classList.toggle("table-cell--number", kind === "number");
      });
    });
  });
  return kinds;
}

function markStateRows(table) {
  Array.from(table.tBodies || []).forEach((tbody) => {
    Array.from(tbody.rows || []).forEach((row) => {
      const firstCell = row.cells?.[0];
      if (!firstCell || Number(firstCell.colSpan || 1) <= 1 || row.cells.length !== 1) return;
      const tone = inferTableStateTone(firstCell.textContent || "");
      row.classList.remove("table-state-row--loading", "table-state-row--empty", "table-state-row--error");
      firstCell.classList.remove("table-state-cell--loading", "table-state-cell--empty", "table-state-cell--error");
      row.classList.add("table-state-row", `table-state-row--${tone}`);
      firstCell.classList.add("table-state-cell", `table-state-cell--${tone}`);
    });
  });
}

function ensureResizeHandles(table) {
  getLeafHeaderCells(table).forEach((header, index) => {
    header.dataset.columnIndex = String(index);
    if (header.querySelector(":scope > .table-resize-handle")) return;
    const handle = table.ownerDocument.createElement("span");
    handle.className = "table-resize-handle";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", `调整 ${String(header.textContent || "").trim() || `第 ${index + 1} 列`} 列宽`);
    handle.dataset.columnIndex = String(index);
    header.appendChild(handle);
  });
}

function getColumnPixelWidth(table, index) {
  const col = table.querySelector(`:scope > colgroup > col[data-column-index="${cssEscape(index)}"]`);
  const explicit = Number.parseFloat(col?.style?.width || "");
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const header = getLeafHeaderCells(table)[index];
  return normalizeColumnWidth(columnWidthFromCell(header));
}

function updateStickyOffsets(table) {
  const headers = getLeafHeaderCells(table);
  const stickyIndexes = headers
    .map((header, index) => (header.classList.contains("sticky-col") ? index : -1))
    .filter((index) => index >= 0);
  if (!stickyIndexes.length) return;

  let left = 0;
  stickyIndexes.forEach((index) => {
    const width = getColumnPixelWidth(table, index);
    const selector = `thead tr:last-child th:nth-child(${index + 1}), tbody tr > td:nth-child(${index + 1})`;
    table.querySelectorAll(selector).forEach((cell) => {
      if (!cell.classList.contains("sticky-col")) return;
      cell.style.left = `${left}px`;
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;
    });
    left += width;
  });

  table.querySelectorAll(".sticky-product-group").forEach((cell) => {
    cell.style.left = "0px";
    cell.style.minWidth = `${left}px`;
  });
}

function updateScrollHint(table) {
  const wrap = getTableWrap(table);
  if (!wrap) return;
  const hasOverflow = wrap.scrollWidth > wrap.clientWidth + 2;
  wrap.classList.toggle("has-horizontal-overflow", hasOverflow);
  wrap.classList.toggle("is-scrolled-start", !hasOverflow || wrap.scrollLeft <= 1);
  wrap.classList.toggle("is-scrolled-end", !hasOverflow || wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 1);
  if (hasOverflow && !wrap.dataset.scrollHint) wrap.dataset.scrollHint = DEFAULT_SCROLL_HINT;
}

function enhanceTable(table) {
  if (!table || table.closest(".login-body")) return null;
  const columnCount = getColumnCount(table);
  if (!columnCount) return null;
  const headers = getLeafHeaderCells(table);
  const legacyKey = legacyTableStorageKey(table);
  ensureStableTableIdentity(table);
  ensureStableColumnIdentities(headers);
  ensureHeaderSortButtons(headers);
  assertUniqueTableIdentity(table);
  const storage = table.ownerDocument?.defaultView?.localStorage || globalThis.localStorage;
  migrateLegacyColumnWidths(table, headers, storage, legacyKey);
  const wrap = getTableWrap(table);
  const variant = classifyDataTableVariant({ className: table.className, columnCount });
  table.classList.add("data-table", `data-table--${variant}`);
  table.dataset.tableManaged = "true";
  table.dataset.columnCount = String(columnCount);
  if (wrap) {
    wrap.classList.add("data-table-wrap");
    wrap.dataset.tableVariant = variant;
  }
  ensureColGroup(table, columnCount);
  markColumnKinds(table);
  applySmartColumnWidths(table, storage);
  markStateRows(table);
  ensureResizeHandles(table);
  updateStickyOffsets(table);
  updateScrollHint(table);
  syncSmartWidthResetControl(table, storage);
  return table;
}

export function createDataTableManager({
  root = globalThis.document,
  windowRef = globalThis,
  tableSelector = TABLE_SELECTOR,
} = {}) {
  let activeResize = null;
  let mutationObserver = null;
  let suppressResizeClick = false;
  let suppressResizeClickTimer = null;

  function enhanceAll() {
    const tables = Array.from(root?.querySelectorAll?.(tableSelector) || []);
    return tables.map(enhanceTable).filter(Boolean);
  }

  function refreshTable(table) {
    const enhanced = enhanceTable(table);
    if (enhanced) updateStickyOffsets(enhanced);
    return enhanced;
  }

  function restoreSmartWidths(table) {
    if (!table) throw new Error("[data-table-manager] restore requires a managed table");
    const storage = table.ownerDocument?.defaultView?.localStorage || windowRef?.localStorage || globalThis.localStorage;
    const key = tableStorageKey(table);
    if (!key || !storage?.removeItem) {
      throw new Error("[data-table-manager] restore requires writable column-width storage");
    }
    storage.removeItem(key);
    Array.from(table.querySelectorAll(":scope > colgroup > col")).forEach((column) => {
      column.dataset.userWidth = "";
    });
    smartWidthSignatures.delete(table);
    const details = applySmartColumnWidths(table, storage, { force: true });
    updateStickyOffsets(table);
    updateScrollHint(table);
    syncSmartWidthResetControl(table, storage);
    console.info("[data-table-manager] restored smart column widths", {
      tableKey: table.dataset.tableKey || table.id || "",
      columnCount: details.length,
    });
    return details;
  }

  function handlePointerDown(event) {
    const handle = event.target?.closest?.(".table-resize-handle");
    if (!handle) return;
    const table = handle.closest("table");
    const header = handle.closest("th");
    if (!table || !header) return;
    const columnIndex = Number.parseInt(handle.dataset.columnIndex || header.dataset.columnIndex || "", 10);
    if (!Number.isFinite(columnIndex)) return;
    lockCurrentColumnWidths(table);
    const startWidth = getColumnPixelWidth(table, columnIndex);
    activeResize = {
      table,
      columnIndex,
      startX: event.clientX,
      startWidth,
    };
    table.classList.add("is-resizing-column");
    root?.body?.classList?.add("is-table-column-resizing");
    event.preventDefault();
  }

  function clearResizeClickSuppression() {
    suppressResizeClick = false;
    if (suppressResizeClickTimer !== null) {
      windowRef?.clearTimeout?.(suppressResizeClickTimer);
      suppressResizeClickTimer = null;
    }
  }

  function scheduleResizeClickSuppression() {
    suppressResizeClick = true;
    if (suppressResizeClickTimer !== null) windowRef?.clearTimeout?.(suppressResizeClickTimer);
    suppressResizeClickTimer = windowRef?.setTimeout?.(clearResizeClickSuppression, 250) ?? null;
  }

  function stopResizeClick(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    event?.stopPropagation?.();
  }

  function handleClick(event) {
    const resetControl = event.target?.closest?.(".table-width-reset");
    if (resetControl) {
      const tableKey = resetControl.dataset.tableKey || "";
      const table = Array.from(root?.querySelectorAll?.(tableSelector) || [])
        .find((candidate) => String(candidate.dataset?.tableKey || candidate.id || "") === tableKey);
      if (!table) throw new Error(`[data-table-manager] reset table not found: ${tableKey}`);
      restoreSmartWidths(table);
      event.preventDefault?.();
      return;
    }
    if (event.target?.closest?.(".table-resize-handle")) {
      clearResizeClickSuppression();
      stopResizeClick(event);
      return;
    }
    if (!suppressResizeClick || !event.target?.closest?.("th")) return;
    clearResizeClickSuppression();
    stopResizeClick(event);
  }

  function handlePointerMove(event) {
    if (!activeResize) return;
    const nextWidth = activeResize.startWidth + (event.clientX - activeResize.startX);
    setColumnWidth(activeResize.table, activeResize.columnIndex, nextWidth);
    updateStickyOffsets(activeResize.table);
    updateScrollHint(activeResize.table);
  }

  function finishResize() {
    if (!activeResize) return;
    activeResize.table.classList.remove("is-resizing-column");
    writeSavedColumnWidths(activeResize.table, activeResize.table.ownerDocument?.defaultView?.localStorage || windowRef?.localStorage || globalThis.localStorage);
    updateStickyOffsets(activeResize.table);
    updateScrollHint(activeResize.table);
    syncSmartWidthResetControl(activeResize.table, activeResize.table.ownerDocument?.defaultView?.localStorage || windowRef?.localStorage || globalThis.localStorage);
    activeResize = null;
    root?.body?.classList?.remove("is-table-column-resizing");
    scheduleResizeClickSuppression();
  }

  function bindTableWrapScroll() {
    root?.querySelectorAll?.(".data-table-wrap").forEach((wrap) => {
      if (typeof wrap?.addEventListener !== "function") return;
      if (wrap.dataset.tableScrollBound === "true") return;
      wrap.dataset.tableScrollBound = "true";
      wrap.addEventListener("scroll", () => {
        wrap.querySelectorAll("table").forEach(updateScrollHint);
      }, { passive: true });
    });
  }

  function setupMutationObserver() {
    if (!windowRef.MutationObserver || !root?.body || mutationObserver) return null;
    mutationObserver = new windowRef.MutationObserver((mutations) => {
      const affectedTables = new Set();
      mutations.filter((mutation) => mutation.type === "childList").forEach((mutation) => {
        const owner = mutation.target?.closest?.("table");
        if (owner?.matches?.(tableSelector)) affectedTables.add(owner);
        Array.from(mutation.addedNodes || []).forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches?.(tableSelector)) affectedTables.add(node);
          node.closest?.("table")?.matches?.(tableSelector) && affectedTables.add(node.closest("table"));
          node.querySelectorAll?.(tableSelector).forEach((table) => affectedTables.add(table));
        });
      });
      if (!affectedTables.size) return;
      affectedTables.forEach(enhanceTable);
      bindTableWrapScroll();
    });
    mutationObserver.observe(root.body, { childList: true, subtree: true });
    return mutationObserver;
  }

  function setupDataTables() {
    enhanceAll();
    bindTableWrapScroll();
    root?.addEventListener?.("pointerdown", handlePointerDown);
    root?.addEventListener?.("click", handleClick, true);
    windowRef?.addEventListener?.("pointermove", handlePointerMove);
    windowRef?.addEventListener?.("pointerup", finishResize);
    windowRef?.addEventListener?.("resize", () => {
      enhanceAll();
      bindTableWrapScroll();
    });
    setupMutationObserver();
    return {
      enhanceAll,
      refreshTable,
      restoreSmartWidths,
      teardown,
    };
  }

  function teardown() {
    root?.removeEventListener?.("pointerdown", handlePointerDown);
    root?.removeEventListener?.("click", handleClick, true);
    windowRef?.removeEventListener?.("pointermove", handlePointerMove);
    windowRef?.removeEventListener?.("pointerup", finishResize);
    clearResizeClickSuppression();
    mutationObserver?.disconnect?.();
    mutationObserver = null;
  }

  return {
    enhanceAll,
    refreshTable,
    restoreSmartWidths,
    setupDataTables,
    teardown,
  };
}

export default createDataTableManager;
