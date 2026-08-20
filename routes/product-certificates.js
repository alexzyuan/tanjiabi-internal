export const PRODUCT_CERTIFICATE_IMPORT_MAX_BODY_BYTES = 5 * 1024 * 1024;

function certificateFilters(url) {
  return {
    country: url.searchParams.get("country") || "",
    certificateType: url.searchParams.get("certificateType") || "",
    status: url.searchParams.get("status") || "",
    keyword: url.searchParams.get("keyword") || "",
  };
}

export function createProductCertificateRoutes(deps = {}) {
  const {
    readJsonBody,
    sendJson,
    contentDispositionAttachment,
    listCertificates,
    saveCertificate,
    updateCertificate,
    deleteCertificate,
    importCertificates,
    createCertificateImportTemplate,
  } = deps;

  return [
    {
      method: "GET",
      path: "/api/product-certificates",
      auth: "session",
      handler: async ({ res, url }) => sendJson(res, 200, await listCertificates(certificateFilters(url))),
    },
    {
      method: "GET",
      path: "/api/product-certificates/template",
      auth: "session",
      handler: async ({ res }) => {
        const buffer = await createCertificateImportTemplate();
        res.writeHead(200, {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": contentDispositionAttachment("产品证书有效期导入模板.xlsx"),
          "cache-control": "no-store",
        });
        res.end(buffer);
      },
    },
    {
      method: "POST",
      path: "/api/product-certificates",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => sendJson(res, 200, { ok: true, certificate: await saveCertificate(await readJsonBody(req)) }),
    },
    {
      method: "POST",
      path: "/api/product-certificates/import",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => sendJson(res, 200, {
        ok: true,
        result: await importCertificates(await readJsonBody(req, { maxBytes: PRODUCT_CERTIFICATE_IMPORT_MAX_BODY_BYTES })),
      }),
    },
    {
      method: "PUT",
      pattern: /^\/api\/product-certificates\/(?<id>[^/]+)$/u,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => sendJson(res, 200, {
        ok: true,
        certificate: await updateCertificate(decodeURIComponent(params.id), await readJsonBody(req)),
      }),
    },
    {
      method: "DELETE",
      pattern: /^\/api\/product-certificates\/(?<id>[^/]+)$/u,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ res, params }) => sendJson(res, 200, {
        ok: true,
        certificate: await deleteCertificate(decodeURIComponent(params.id)),
      }),
    },
  ];
}
