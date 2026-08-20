import assert from "node:assert/strict";
import test from "node:test";
import { createProductCertificateRoutes } from "../routes/product-certificates.js";

function createHarness(overrides = {}) {
  const sent = [];
  const calls = { list: [], save: [], update: [], delete: [], import: [] };
  const routes = createProductCertificateRoutes({
    readJsonBody: async () => ({ country: "美国", productSku: "SKU-1" }),
    sendJson: (_res, statusCode, payload) => sent.push({ statusCode, payload }),
    contentDispositionAttachment: (fileName) => `attachment; filename=${fileName}`,
    listCertificates: async (filters) => { calls.list.push(filters); return { rows: [], summary: {}, filters: {} }; },
    saveCertificate: async (payload) => { calls.save.push(payload); return { id: "certificate-1", ...payload }; },
    updateCertificate: async (id, payload) => { calls.update.push({ id, payload }); return { id, ...payload }; },
    deleteCertificate: async (id) => { calls.delete.push(id); return { id }; },
    importCertificates: async (payload) => { calls.import.push(payload); return { importedCount: 1, updatedCount: 0, totalCount: 1 }; },
    createCertificateImportTemplate: async () => Buffer.from("xlsx"),
    ...overrides,
  });
  return { routes, sent, calls };
}

test("certificate routes are session-protected and return filtered ledger data", async () => {
  const { routes, calls, sent } = createHarness();
  assert.equal(routes.length, 6);
  assert.ok(routes.every((route) => route.auth === "session"));
  const listRoute = routes.find((route) => route.path === "/api/product-certificates" && route.method === "GET");
  await listRoute.handler({
    res: {},
    url: new URL("http://localhost/api/product-certificates?country=%E7%BE%8E%E5%9B%BD&certificateType=FCC&status=%E9%A2%84%E8%AD%A6&keyword=sku"),
  });
  assert.deepEqual(calls.list, [{ country: "美国", certificateType: "FCC", status: "预警", keyword: "sku" }]);
  assert.deepEqual(sent, [{ statusCode: 200, payload: { rows: [], summary: {}, filters: {} } }]);
});

test("certificate write routes forward JSON bodies and return saved records", async () => {
  const { routes, calls, sent } = createHarness({
    readJsonBody: async () => ({ fileName: "证书.xlsx", base64: "YWJj" }),
  });
  const createRoute = routes.find((route) => route.method === "POST" && route.path === "/api/product-certificates");
  const updateRoute = routes.find((route) => route.method === "PUT");
  const deleteRoute = routes.find((route) => route.method === "DELETE");
  const importRoute = routes.find((route) => route.method === "POST" && route.path === "/api/product-certificates/import");

  await createRoute.handler({ req: {}, res: {} });
  await updateRoute.handler({ req: {}, res: {}, params: { id: "certificate-1" } });
  await deleteRoute.handler({ res: {}, params: { id: "certificate-1" } });
  await importRoute.handler({ req: {}, res: {} });

  assert.deepEqual(calls.save, [{ fileName: "证书.xlsx", base64: "YWJj" }]);
  assert.deepEqual(calls.update, [{ id: "certificate-1", payload: { fileName: "证书.xlsx", base64: "YWJj" } }]);
  assert.deepEqual(calls.delete, ["certificate-1"]);
  assert.deepEqual(calls.import, [{ fileName: "证书.xlsx", base64: "YWJj" }]);
  assert.equal(sent.length, 4);
  assert.ok(sent.every((response) => response.statusCode === 200 && response.payload.ok === true));
});

test("certificate template route serves an XLSX attachment", async () => {
  const { routes } = createHarness();
  const templateRoute = routes.find((route) => route.path === "/api/product-certificates/template");
  let headers = null;
  let body = null;
  const res = {
    writeHead(_statusCode, receivedHeaders) { headers = receivedHeaders; },
    end(receivedBody) { body = receivedBody; },
  };
  await templateRoute.handler({ res });
  assert.match(headers["content-type"], /spreadsheetml/u);
  assert.match(headers["content-disposition"], /产品证书有效期导入模板\.xlsx/u);
  assert.equal(body.toString(), "xlsx");
});
