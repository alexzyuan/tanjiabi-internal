const MAX_DIAGNOSTIC_LENGTH = 120;

const KNOWN_DIAGNOSTICS = new Map([
  ["ok", "ok"],
  ["disk i/o error", "disk I/O error"],
  ["database disk image is malformed", "database disk image is malformed"],
  ["database is locked", "database is locked"],
  ["database is busy", "database is busy"],
]);

const SQL_KEYWORD_PATTERN = /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH|DETACH|VACUUM|BEGIN|COMMIT|ROLLBACK)\b/iu;
const ABSOLUTE_PATH_PATTERN = /(?:^|\s)\/|[A-Za-z]:[\\/]|\\\\/u;
const URI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const STACK_PATTERN = /\bat\s+(?:[A-Za-z]:[\\/]|\/|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/iu;

/**
 * Keep SQLite quick-check output bounded and intentionally allowlisted.
 * Anything that could contain a path, URI, SQL, stack, or arbitrary payload
 * is collapsed to the controlled unavailable state.
 */
export function safeQuickCheckDiagnostic(value) {
  let raw;
  try {
    raw = String(value ?? "");
  } catch {
    return "unavailable";
  }
  if (!raw || raw.length > MAX_DIAGNOSTIC_LENGTH || /[\u0000-\u001f\u007f]/u.test(raw)) return "unavailable";
  const text = raw.trim().replace(/\s+/gu, " ");
  if (!text || text.length > MAX_DIAGNOSTIC_LENGTH) return "unavailable";
  if (ABSOLUTE_PATH_PATTERN.test(text) || URI_PATTERN.test(text) || STACK_PATTERN.test(text)) return "unavailable";
  if (SQL_KEYWORD_PATTERN.test(text)) return "unavailable";
  return KNOWN_DIAGNOSTICS.get(text.toLowerCase()) || "unavailable";
}
