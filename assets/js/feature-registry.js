import { SHARED_FILTER_KEYS, normalizeSharedFilterState } from "./shared-filter-state.js";

const ALL_CONTEXT_FILTERS = Object.freeze([...SHARED_FILTER_KEYS]);

export const DEFAULT_FEATURE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "sales-dashboard",
    supportedFilters: ALL_CONTEXT_FILTERS,
    queryFilters: Object.freeze(["date", "sid", "owner", "currency"]),
  }),
  Object.freeze({
    id: "store-operating-monthly-report",
    supportedFilters: Object.freeze(["date", "country", "sid", "store", "currency"]),
    queryFilters: Object.freeze(["date", "country", "store", "currency"]),
  }),
]);

export class FeatureRegistryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "FeatureRegistryError";
    this.code = details.code || "FEATURE_REGISTRY_INVALID";
    this.featureId = details.featureId || "";
  }
}

export class UnsupportedFeatureFilterError extends FeatureRegistryError {
  constructor(featureId, unsupportedKeys) {
    super(`Feature ${featureId} 不支持共享筛选字段：${unsupportedKeys.join("、")}`, {
      code: "FEATURE_FILTER_UNSUPPORTED",
      featureId,
    });
    this.name = "UnsupportedFeatureFilterError";
    this.unsupportedKeys = Object.freeze([...unsupportedKeys]);
  }
}

function unique(values = []) {
  return [...new Set(values)];
}

function normalizeDefinition(definition = {}) {
  const id = String(definition.id || "").trim();
  if (!id) throw new FeatureRegistryError("Feature definition requires an id.");
  const supportedFilters = unique(definition.supportedFilters || []);
  const queryFilters = unique(definition.queryFilters || []);
  const unknown = [...new Set([...supportedFilters, ...queryFilters])]
    .filter((key) => !SHARED_FILTER_KEYS.includes(key));
  if (unknown.length) {
    throw new FeatureRegistryError(`Feature ${id} has unknown filter: ${unknown.join(", ")}`, {
      code: "FEATURE_FILTER_UNKNOWN",
      featureId: id,
    });
  }
  const notSupported = queryFilters.filter((key) => !supportedFilters.includes(key));
  if (notSupported.length) {
    throw new FeatureRegistryError(`Feature ${id} queryFilters must be included in supportedFilters: ${notSupported.join(", ")}`, {
      code: "FEATURE_QUERY_FILTER_UNSUPPORTED",
      featureId: id,
    });
  }
  return Object.freeze({
    id,
    supportedFilters: Object.freeze(supportedFilters),
    queryFilters: Object.freeze(queryFilters),
  });
}

function hasActiveValue(state, key) {
  if (key === "date") return Boolean(state.date.start || state.date.end);
  if (key === "currency") return Boolean(state.currency);
  return Array.isArray(state[key]) && state[key].length > 0;
}

function stateForKeys(state, keys) {
  const input = {};
  keys.forEach((key) => {
    input[key] = state[key];
  });
  return normalizeSharedFilterState(input);
}

export function createFeatureRegistry(definitions = DEFAULT_FEATURE_DEFINITIONS) {
  if (!Array.isArray(definitions)) throw new FeatureRegistryError("Feature definitions must be an array.");
  const entries = new Map();
  definitions.map(normalizeDefinition).forEach((definition) => {
    if (entries.has(definition.id)) {
      throw new FeatureRegistryError(`Duplicate feature definition: ${definition.id}`, {
        code: "FEATURE_REGISTRY_DUPLICATE",
        featureId: definition.id,
      });
    }
    entries.set(definition.id, definition);
  });

  function get(featureId) {
    const id = String(featureId || "").trim();
    const definition = entries.get(id);
    if (!definition) {
      throw new FeatureRegistryError(`Unknown feature: ${id || "(empty)"}`, {
        code: "FEATURE_REGISTRY_UNKNOWN",
        featureId: id,
      });
    }
    return definition;
  }

  function supports(featureId, filterKey, purpose = "context") {
    const definition = get(featureId);
    const key = purpose === "query" ? "queryFilters" : "supportedFilters";
    return definition[key].includes(filterKey);
  }

  function getUnsupportedFilterKeys(featureId, inputState) {
    const definition = get(featureId);
    const state = normalizeSharedFilterState(inputState);
    return SHARED_FILTER_KEYS.filter((key) => hasActiveValue(state, key) && !definition.supportedFilters.includes(key));
  }

  function assertSupports(featureId, inputState) {
    const unsupportedKeys = getUnsupportedFilterKeys(featureId, inputState);
    if (unsupportedKeys.length) throw new UnsupportedFeatureFilterError(featureId, unsupportedKeys);
    return true;
  }

  function projectState(featureId, inputState, { purpose = "query", strict = false } = {}) {
    const definition = get(featureId);
    const state = normalizeSharedFilterState(inputState);
    const unsupportedKeys = getUnsupportedFilterKeys(featureId, state);
    if (strict && unsupportedKeys.length) throw new UnsupportedFeatureFilterError(featureId, unsupportedKeys);
    const allowedKeys = purpose === "context" ? definition.supportedFilters : definition.queryFilters;
    const omittedKeys = SHARED_FILTER_KEYS.filter((key) => hasActiveValue(state, key) && !allowedKeys.includes(key));
    return {
      state: stateForKeys(state, allowedKeys),
      omittedKeys,
      unsupportedKeys,
      feature: definition,
    };
  }

  return Object.freeze({
    get,
    list() {
      return [...entries.values()];
    },
    supports,
    getUnsupportedFilterKeys,
    assertSupports,
    projectState,
  });
}

export const defaultFeatureRegistry = createFeatureRegistry();
