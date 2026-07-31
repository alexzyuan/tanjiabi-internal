import path from "node:path";
import { readJson, updateJsonAtomic } from "../utils/jsonStore.js";

const INITIAL_STATE = Object.freeze({ version: 1, reports: [] });

export class SlowMovingRiskSnapshotConflictError extends Error {
  constructor(reportKey) {
    super(`Slow-moving risk report already exists: ${reportKey}`);
    this.name = "SlowMovingRiskSnapshotConflictError";
    this.reportKey = reportKey;
  }
}

export function slowMovingRiskSnapshotFile(dataDir = process.cwd()) {
  return path.join(dataDir, "data-cache", "slow-moving-risk-reports.json");
}

function reportTimestamp(reportKey) {
  const value = String(reportKey || "");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`Invalid slow-moving risk report key: ${value}`);
  const timestamp = new Date(`${value}T00:00:00.000Z`).getTime();
  if (Number.isNaN(timestamp)) throw new Error(`Invalid slow-moving risk report key: ${value}`);
  return timestamp;
}

function retentionBoundary(now) {
  const date = new Date(now);
  const boundary = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 6, date.getUTCDate()));
  return boundary.getTime();
}

function normalizeState(state) {
  return {
    version: 1,
    reports: Array.isArray(state?.reports) ? state.reports : [],
  };
}

function retainedReports(reports, now) {
  const boundary = retentionBoundary(now);
  return reports.filter((report) => reportTimestamp(report.reportKey) >= boundary);
}

function sortReports(reports) {
  return reports.slice().sort((left, right) => String(right.reportKey).localeCompare(String(left.reportKey)));
}

function snapshotSuccess({ reportKey, dashboard, generatedAt }) {
  if (!dashboard || typeof dashboard !== "object") throw new Error("Slow-moving risk success snapshot requires dashboard.");
  return { reportKey, status: "success", generatedAt, dashboard };
}

export function createSlowMovingRiskSnapshotStore({
  dataDir = process.cwd(),
  now = () => new Date(),
  read = readJson,
  update = updateJsonAtomic,
} = {}) {
  const filePath = slowMovingRiskSnapshotFile(dataDir);

  async function prune() {
    return update(filePath, (current) => {
      const state = normalizeState(current);
      return { ...state, reports: retainedReports(state.reports, now()) };
    }, INITIAL_STATE);
  }

  async function list() {
    await prune();
    const state = normalizeState(await read(filePath, INITIAL_STATE));
    return sortReports(state.reports);
  }

  async function readReport(reportKey) {
    reportTimestamp(reportKey);
    await prune();
    const state = normalizeState(await read(filePath, INITIAL_STATE));
    return state.reports.find((report) => report.reportKey === reportKey) || null;
  }

  async function saveSuccess({ reportKey, dashboard }) {
    reportTimestamp(reportKey);
    const generatedAt = now().toISOString();
    let conflict = false;
    const state = await update(filePath, (current) => {
      const normalized = normalizeState(current);
      const reports = retainedReports(normalized.reports, now());
      if (reports.some((report) => report.reportKey === reportKey && report.status === "success")) {
        conflict = true;
        return { ...normalized, reports };
      }
      return {
        ...normalized,
        reports: [...reports.filter((report) => report.reportKey !== reportKey), snapshotSuccess({ reportKey, dashboard, generatedAt })],
      };
    }, INITIAL_STATE);
    if (conflict) throw new SlowMovingRiskSnapshotConflictError(reportKey);
    return normalizeState(state).reports.find((report) => report.reportKey === reportKey) || null;
  }

  async function saveFailure({ reportKey, error, observability = {} }) {
    reportTimestamp(reportKey);
    const attemptedAt = now().toISOString();
    const state = await update(filePath, (current) => {
      const normalized = normalizeState(current);
      const reports = retainedReports(normalized.reports, now());
      if (reports.some((report) => report.reportKey === reportKey && report.status === "success")) return { ...normalized, reports };
      return {
        ...normalized,
        reports: [...reports.filter((report) => report.reportKey !== reportKey), {
          reportKey,
          status: "failed",
          attemptedAt,
          error: { source: error?.source || "unknown", message: error?.message || String(error || "Unknown error") },
          observability,
        }],
      };
    }, INITIAL_STATE);
    return normalizeState(state).reports.find((report) => report.reportKey === reportKey) || null;
  }

  return { list, read: readReport, saveSuccess, saveFailure, prune };
}
