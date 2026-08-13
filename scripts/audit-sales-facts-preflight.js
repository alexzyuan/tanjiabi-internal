import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getLingxingAdapter } from "../src/adapters/lingxingAdapter.js";
import { auditAllListingOwners } from "../src/services/listingOwnerHistoryService.js";
import { getSellerDirectory } from "../src/services/sellerDirectoryService.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

function safeRequestId(value) {
  const text = String(value || "").trim();
  return REQUEST_ID_PATTERN.test(text) && !/(token|secret|password|payload|raw|body)/iu.test(text)
    ? text
    : `sales-facts-owner-audit-${randomUUID()}`;
}

function hasAuditFailure(counts = {}) {
  return Number(counts.multiple || 0) > 0
    || Number(counts.malformed || 0) > 0
    || Number(counts.failedSidCount || 0) > 0
    || Number(counts.paginationIncomplete || 0) > 0;
}

function controlledFailure(requestId, code) {
  return {
    ok: false,
    exitCode: 1,
    requestId,
    error: { code },
  };
}

export async function runSalesFactsOwnerAuditCli({
  adapter = getLingxingAdapter(),
  getDirectory = getSellerDirectory,
  auditOwners = auditAllListingOwners,
  requestId: suppliedRequestId = "",
  writeOutput = (text) => process.stdout.write(`${text}\n`),
} = {}) {
  const requestId = safeRequestId(suppliedRequestId);
  let sellers;
  try {
    const directory = await getDirectory({
      adapter,
      forceRefresh: true,
      saveCache: async () => {},
      logger: { info() {}, error() {} },
    });
    sellers = directory.sellers;
  } catch {
    const failure = controlledFailure(requestId, "SELLER_DIRECTORY_FAILED");
    writeOutput(JSON.stringify(failure));
    return failure;
  }

  let audit;
  try {
    audit = await auditOwners({ sellers, adapter, requestId });
  } catch {
    const failure = controlledFailure(requestId, "LISTING_OWNER_AUDIT_FAILED");
    writeOutput(JSON.stringify(failure));
    return failure;
  }
  const failed = hasAuditFailure(audit.counts);
  const report = {
    ok: !failed,
    exitCode: failed ? 1 : 0,
    requestId,
    sellerCount: Number(audit.sellerCount || 0),
    sidCount: Number(audit.sidCount || 0),
    rowCount: Number(audit.rowCount || 0),
    pageCount: Number(audit.pageCount || 0),
    counts: { ...audit.counts },
    anomalies: Array.isArray(audit.anomalies) ? audit.anomalies : [],
    failedSids: Array.isArray(audit.failedSids) ? audit.failedSids : [],
  };
  writeOutput(JSON.stringify(report));
  return report;
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath && scriptPath === path.resolve(fileURLToPath(import.meta.url))) {
  const result = await runSalesFactsOwnerAuditCli();
  process.exitCode = result.exitCode;
}
