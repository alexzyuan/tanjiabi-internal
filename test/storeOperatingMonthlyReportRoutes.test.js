import assert from "node:assert/strict";
import test from "node:test";
import { createFinancePurchaseRoutes } from "../routes/finance-purchase.js";

const monthlyReportPath = "/api/finance/store-operating-monthly-report";
const monthlyReportExportPath = `${monthlyReportPath}/export`;

test("monthly report route is finance-protected and forwards repeated filter values", async () => {
  let payload;
  const route = createFinancePurchaseRoutes({
    sendJson: (_res, _status, value) => { payload = value; },
    getStoreOperatingMonthlyReport: async (filters) => ({ ok: true, filters }),
  }).find((item) => item.path === monthlyReportPath);

  assert.equal(route.auth, "finance");
  await route.handler({
    res: {},
    url: new URL("http://localhost/api/finance/store-operating-monthly-report?startMonth=2026-06&endMonth=2026-07&stores=A&stores=B&countries=%E7%BE%8E%E5%9B%BD"),
  });

  assert.deepEqual(payload.filters, {
    startMonth: "2026-06",
    endMonth: "2026-07",
    stores: ["A", "B"],
    countries: ["美国"],
  });
});

test("monthly report export is finance-protected and writes only the same-source XLSX result", async () => {
  let receivedFilters;
  let statusCode;
  let headers;
  let bytes;
  const route = createFinancePurchaseRoutes({
    contentDispositionAttachment: (filename) => `attachment; filename=${filename}`,
    exportStoreOperatingMonthlyReportXlsx: async (filters) => {
      receivedFilters = filters;
      return { filename: "店铺经营月报-2026-06至2026-07.xlsx", buffer: Buffer.from("xlsx") };
    },
  }).find((item) => item.path === monthlyReportExportPath);

  assert.equal(route.auth, "finance");
  await route.handler({
    res: {
      writeHead: (status, value) => { statusCode = status; headers = value; },
      end: (value) => { bytes = value; },
    },
    url: new URL("http://localhost/api/finance/store-operating-monthly-report/export?startMonth=2026-06&endMonth=2026-07&stores=A&stores=B&countries=%E7%BE%8E%E5%9B%BD"),
  });

  assert.deepEqual(receivedFilters, {
    startMonth: "2026-06",
    endMonth: "2026-07",
    stores: ["A", "B"],
    countries: ["美国"],
  });
  assert.equal(statusCode, 200);
  assert.deepEqual(headers, {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": "attachment; filename=店铺经营月报-2026-06至2026-07.xlsx",
    "cache-control": "no-store",
  });
  assert.deepEqual(bytes, Buffer.from("xlsx"));
});
