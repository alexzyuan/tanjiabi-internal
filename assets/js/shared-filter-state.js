const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const CURRENCY_PATTERN = /^[A-Z][A-Z0-9]{2,11}$/;

export const SHARED_FILTER_KEYS = Object.freeze([
  "date",
  "country",
  "sid",
  "store",
  "owner",
  "currency",
  "msku",
  "asin",
  "sku",
]);

const LIST_FILTER_KEYS = Object.freeze(["country", "sid", "store", "owner", "msku", "asin", "sku"]);
const URL_KEY_ALIASES = Object.freeze({
  country: ["countries", "country"],
  sid: ["sids", "sid"],
  store: ["stores", "store"],
  owner: ["listingOwner", "owner"],
  currency: ["currencyCode", "currency"],
});
const CANONICAL_URL_KEYS = Object.freeze([
  "startDate",
  "endDate",
  "countries",
  "sids",
  "stores",
  "listingOwner",
  "currencyCode",
  "msku",
  "asin",
  "sku",
]);
const ALL_RECOGNIZED_URL_KEYS = Object.freeze([
  ...CANONICAL_URL_KEYS,
  "country",
  "sid",
  "store",
  "owner",
  "currency",
]);

export const DEFAULT_SHARED_FILTER_STATE = Object.freeze({
  date: Object.freeze({ start: "", end: "" }),
  country: Object.freeze([]),
  sid: Object.freeze([]),
  store: Object.freeze([]),
  owner: Object.freeze([]),
  currency: "CNY",
  msku: Object.freeze([]),
  asin: Object.freeze([]),
  sku: Object.freeze([]),
});

export class SharedFilterStateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SharedFilterStateError";
    this.code = details.code || "SHARED_FILTER_STATE_INVALID";
    this.field = details.field || "";
    this.value = details.value;
  }
}

function own(object, key) {
  return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function assertDate(value, field) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!DATE_PATTERN.test(text)) {
    throw new SharedFilterStateError(`共享筛选状态的 ${field} 不是有效日期。`, {
      code: "SHARED_FILTER_DATE_INVALID",
      field,
      value,
    });
  }
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new SharedFilterStateError(`共享筛选状态的 ${field} 不是有效日期。`, {
      code: "SHARED_FILTER_DATE_INVALID",
      field,
      value,
    });
  }
  return text;
}

function readDate(input = {}) {
  const date = asObject(input.date);
  const startValue = own(date, "start") ? date.start : own(date, "startDate") ? date.startDate : input.startDate;
  const endValue = own(date, "end") ? date.end : own(date, "endDate") ? date.endDate : input.endDate;
  const start = assertDate(startValue, "startDate");
  const end = assertDate(endValue, "endDate");
  if (start && end && end < start) {
    throw new SharedFilterStateError("共享筛选状态的 endDate 不能早于 startDate。", {
      code: "SHARED_FILTER_DATE_ORDER_INVALID",
      field: "date",
      value: { start, end },
    });
  }
  return { start, end };
}

function rawListValue(input, key, aliases = []) {
  for (const candidate of [key, ...aliases]) {
    if (own(input, candidate)) return input[candidate];
  }
  return undefined;
}

function listValues(value, field) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  const normalized = [];
  for (const item of values) {
    if (item === undefined || item === null || item === "") continue;
    if (typeof item === "object") {
      throw new SharedFilterStateError(`共享筛选状态的 ${field} 含有不可识别的值。`, {
        code: "SHARED_FILTER_LIST_INVALID",
        field,
        value: item,
      });
    }
    const text = String(item).trim();
    if (text) normalized.push(text);
  }
  return normalized;
}

function normalizeList(input, key, aliases = []) {
  const values = listValues(rawListValue(input, key, aliases), key);
  const unique = [...new Set(values)];
  if (key === "sid") {
    const numeric = unique.map((value) => {
      if (!/^\d+$/.test(value)) {
        throw new SharedFilterStateError(`共享筛选状态的 SID 无效：${value}`, {
          code: "SHARED_FILTER_SID_INVALID",
          field: key,
          value,
        });
      }
      const sid = Number(value);
      if (!Number.isSafeInteger(sid) || sid <= 0) {
        throw new SharedFilterStateError(`共享筛选状态的 SID 无效：${value}`, {
          code: "SHARED_FILTER_SID_INVALID",
          field: key,
          value,
        });
      }
      return sid;
    });
    return numeric.sort((left, right) => left - right).map(String);
  }
  return unique.sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" }));
}

function normalizeCurrency(input) {
  const raw = rawListValue(input, "currency", ["currencyCode"]);
  const currency = String(raw ?? "CNY").trim().toUpperCase() || "CNY";
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new SharedFilterStateError(`共享筛选状态的 currency 无效：${currency}`, {
      code: "SHARED_FILTER_CURRENCY_INVALID",
      field: "currency",
      value: raw,
    });
  }
  return currency;
}

export function normalizeSharedFilterState(input = {}) {
  const source = asObject(input);
  return {
    date: readDate(source),
    country: normalizeList(source, "country", ["countries"]),
    sid: normalizeList(source, "sid", ["sids"]),
    store: normalizeList(source, "store", ["stores"]),
    owner: normalizeList(source, "owner", ["listingOwner"]),
    currency: normalizeCurrency(source),
    msku: normalizeList(source, "msku"),
    asin: normalizeList(source, "asin"),
    sku: normalizeList(source, "sku"),
  };
}

function valuesForUrl(params, aliases, { splitComma = false } = {}) {
  const values = aliases.flatMap((key) => params.getAll(key));
  return values.flatMap((value) => (splitComma ? String(value).split(",") : [value]));
}

function readSingleUrlValue(params, aliases, fallback = undefined) {
  const values = aliases.flatMap((key) => params.getAll(key)).filter((value) => String(value).trim());
  const unique = [...new Set(values.map((value) => String(value).trim()))];
  if (unique.length > 1) {
    throw new SharedFilterStateError(`共享筛选状态的 URL 参数冲突：${aliases.join(" / ")}`, {
      code: "SHARED_FILTER_URL_CONFLICT",
      field: aliases[0],
      value: unique,
    });
  }
  return unique[0] ?? fallback;
}

function toSearchParams(search) {
  if (search instanceof URLSearchParams) return new URLSearchParams(search);
  if (search?.searchParams instanceof URLSearchParams) return new URLSearchParams(search.searchParams);
  const text = String(search ?? "");
  return new URLSearchParams(text.startsWith("?") ? text.slice(1) : text);
}

export function decodeSharedFilterState(search = "") {
  const params = toSearchParams(search);
  return normalizeSharedFilterState({
    startDate: params.get("startDate") || "",
    endDate: params.get("endDate") || "",
    country: valuesForUrl(params, URL_KEY_ALIASES.country),
    sid: valuesForUrl(params, URL_KEY_ALIASES.sid, { splitComma: true }),
    store: valuesForUrl(params, URL_KEY_ALIASES.store),
    owner: valuesForUrl(params, URL_KEY_ALIASES.owner),
    currency: readSingleUrlValue(params, URL_KEY_ALIASES.currency, "CNY"),
    msku: params.getAll("msku"),
    asin: params.getAll("asin"),
    sku: params.getAll("sku"),
  });
}

function appendList(params, key, values) {
  values.forEach((value) => params.append(key, value));
}

export function encodeSharedFilterState(input = {}, { include = SHARED_FILTER_KEYS } = {}) {
  const state = normalizeSharedFilterState(input);
  const included = new Set(include);
  const params = new URLSearchParams();
  if (included.has("date")) {
    if (state.date.start) params.set("startDate", state.date.start);
    if (state.date.end) params.set("endDate", state.date.end);
  }
  if (included.has("currency") && state.currency) params.set("currencyCode", state.currency);
  if (included.has("country")) appendList(params, "countries", state.country);
  if (included.has("sid") && state.sid.length) params.set("sids", state.sid.join(","));
  if (included.has("store")) appendList(params, "stores", state.store);
  if (included.has("owner")) appendList(params, "listingOwner", state.owner);
  if (included.has("msku")) appendList(params, "msku", state.msku);
  if (included.has("asin")) appendList(params, "asin", state.asin);
  if (included.has("sku")) appendList(params, "sku", state.sku);
  return params;
}

export function mergeSharedFilterState(base = {}, patch = {}) {
  const current = normalizeSharedFilterState(base);
  const update = asObject(patch);
  const mergedDate = own(update, "date")
    ? { ...current.date, ...asObject(update.date) }
    : {
      start: own(update, "startDate") ? update.startDate : current.date.start,
      end: own(update, "endDate") ? update.endDate : current.date.end,
    };
  return normalizeSharedFilterState({
    ...current,
    ...update,
    date: mergedDate,
    country: own(update, "country") || own(update, "countries") ? rawListValue(update, "country", ["countries"]) : current.country,
    sid: own(update, "sid") || own(update, "sids") ? rawListValue(update, "sid", ["sids"]) : current.sid,
    store: own(update, "store") || own(update, "stores") ? rawListValue(update, "store", ["stores"]) : current.store,
    owner: own(update, "owner") || own(update, "listingOwner") ? rawListValue(update, "owner", ["listingOwner"]) : current.owner,
    currency: own(update, "currency") || own(update, "currencyCode") ? rawListValue(update, "currency", ["currencyCode"]) : current.currency,
  });
}

function stateEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function activeUrlPath(locationRef) {
  const pathname = String(locationRef?.pathname || "");
  const hash = String(locationRef?.hash || "");
  return { pathname, hash };
}

export function createSharedFilterStateStore({
  initialState,
  locationRef = globalThis.location,
  historyRef = globalThis.history,
  syncUrl = true,
  onChange,
} = {}) {
  const initial = initialState === undefined
    ? decodeSharedFilterState(locationRef?.search || "")
    : normalizeSharedFilterState(initialState);
  let state = initial;
  const listeners = new Set();
  if (typeof onChange === "function") listeners.add(onChange);

  function writeUrl(nextState) {
    if (!syncUrl || typeof historyRef?.replaceState !== "function" || !locationRef) return false;
    const params = new URLSearchParams(locationRef.search || "");
    ALL_RECOGNIZED_URL_KEYS.forEach((key) => params.delete(key));
    const encoded = encodeSharedFilterState(nextState);
    encoded.forEach((value, key) => params.append(key, value));
    const { pathname, hash } = activeUrlPath(locationRef);
    const suffix = params.toString();
    historyRef.replaceState({}, "", `${pathname}${suffix ? `?${suffix}` : ""}${hash}`);
    return true;
  }

  function set(nextInput, { source = "set", syncUrl: shouldSyncUrl = syncUrl } = {}) {
    const nextState = normalizeSharedFilterState(nextInput);
    const changedKeys = SHARED_FILTER_KEYS.filter((key) => !stateEqual(state[key], nextState[key]));
    if (!changedKeys.length) return state;
    state = nextState;
    const urlSynced = shouldSyncUrl ? writeUrl(state) : false;
    const meta = { source, changedKeys, urlSynced };
    listeners.forEach((listener) => listener(state, meta));
    return state;
  }

  function patch(patchInput, options = {}) {
    return set(mergeSharedFilterState(state, patchInput), options);
  }

  return {
    get: () => state,
    set,
    patch,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("shared filter state listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toSearchParams({ include = SHARED_FILTER_KEYS } = {}) {
      return encodeSharedFilterState(state, { include });
    },
  };
}

export { ALL_RECOGNIZED_URL_KEYS, CANONICAL_URL_KEYS, LIST_FILTER_KEYS };
