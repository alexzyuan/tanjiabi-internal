export function createFbaUtils({
  root = globalThis.document,
  trimmedFieldValue,
} = {}) {
  if (typeof trimmedFieldValue !== "function") throw new Error("createFbaUtils requires trimmedFieldValue.");

  function fbaValue(selector) {
    return trimmedFieldValue(selector, "", root);
  }

  return {
    fbaValue,
  };
}
