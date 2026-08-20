import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { createProductCertificateService } from "../src/services/productCertificateService.js";

function record(overrides = {}) {
  return {
    country: "美国",
    productSku: "SKU-100",
    certificateType: "FCC",
    certificateNumber: "FCC-100",
    issuedDate: "2026-01-01",
    expiryDate: "2026-12-31",
    ...overrides,
  };
}

async function withService(options, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-certificates-"));
  try {
    await run(createProductCertificateService({ directory, logger: { info() {} }, ...options }), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function workbookPayload(rows) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["国家", "产品SKU", "证书类型", "证书编号", "签发日期", "过期日期"],
    ...rows.map((row) => [
      row.country,
      row.productSku,
      row.certificateType,
      row.certificateNumber,
      row.issuedDate,
      row.expiryDate,
    ]),
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "证书有效期台账");
  return {
    fileName: "产品证书有效期台账.xlsx",
    base64: XLSX.write(workbook, { bookType: "xlsx", type: "base64" }),
  };
}

test("certificate status uses expiry priority at 30 and 60 day boundaries", async () => {
  await withService({ now: () => new Date("2026-08-20T08:00:00+08:00") }, async (service) => {
    for (const [certificateNumber, expiryDate] of [
      ["EXPIRED", "2026-08-19"],
      ["WARNING-30", "2026-09-19"],
      ["ATTENTION-31", "2026-09-20"],
      ["ATTENTION-60", "2026-10-19"],
      ["VALID-61", "2026-10-20"],
    ]) {
      await service.saveCertificate(record({ certificateNumber, expiryDate }));
    }

    const data = await service.listCertificates();
    assert.deepEqual(data.rows.map((row) => row.status), ["已过期", "预警", "注意", "注意", "有效"]);
    assert.deepEqual(data.summary, { valid: 1, warning: 1, attention: 2, expired: 1, total: 5 });
  });
});

test("certificate options expose fixed countries, country-linked recommendations, and catalog SKU matches", async () => {
  await withService({
    searchProductSkus: async ({ keyword, limit }) => {
      assert.equal(keyword, "blue");
      assert.equal(limit, 20);
      return [{ sku: "TJ-BLUE-001", productName: "蓝色商品" }];
    },
  }, async (service) => {
    const options = await service.listCertificateOptions({ country: "美国", keyword: "blue" });
    assert.deepEqual(options.countries, ["美国", "加拿大", "德国", "英国"]);
    assert.deepEqual(options.certificateTypes, ["CPC全套"]);
    assert.deepEqual(options.productSkus, [{ sku: "TJ-BLUE-001", productName: "蓝色商品" }]);
  });
});

test("certificate writes and imports reject countries outside the fixed selector", async () => {
  await withService({}, async (service) => {
    await assert.rejects(() => service.saveCertificate(record({ country: "澳洲" })), /国家选项无效/u);
    await assert.rejects(() => service.listCertificateOptions({ country: "澳洲" }), /国家选项无效/u);
  });
});

test("certificate rejects invalid dates, inverted dates, and duplicate business keys", async () => {
  await withService({}, async (service) => {
    await assert.rejects(() => service.saveCertificate(record({ expiryDate: "2026-02-30" })), /过期日期/u);
    await assert.rejects(() => service.saveCertificate(record({ issuedDate: "2026-10-01", expiryDate: "2026-09-30" })), /不得早于签发日期/u);
    await service.saveCertificate(record());
    await assert.rejects(
      () => service.saveCertificate(record({ productSku: " sku-100 ", certificateType: "fcc", certificateNumber: " FCC-100 " })),
      /已存在/u,
    );
  });
});

test("certificate update replaces one record without allowing a collision with another key", async () => {
  await withService({}, async (service) => {
    const first = await service.saveCertificate(record({ certificateNumber: "FCC-1" }));
    await service.saveCertificate(record({ certificateNumber: "FCC-2" }));
    const updated = await service.updateCertificate(first.id, record({ certificateNumber: "FCC-1", expiryDate: "2027-01-01" }));
    assert.equal(updated.expiryDate, "2027-01-01");
    await assert.rejects(() => service.updateCertificate(first.id, record({ certificateNumber: "FCC-2" })), /已存在/u);
  });
});

test("certificate import rejects one invalid row without changing the existing ledger", async () => {
  await withService({}, async (service, directory) => {
    await service.saveCertificate(record({ certificateNumber: "OLD" }));
    await assert.rejects(
      () => service.importCertificates(workbookPayload([
        record({ certificateNumber: "NEW" }),
        record({ certificateNumber: "BAD", expiryDate: "invalid-date" }),
      ])),
      /第3行.*过期日期/u,
    );
    const data = await service.listCertificates();
    assert.deepEqual(data.rows.map((row) => row.certificateNumber), ["OLD"]);
    const ledger = JSON.parse(await readFile(path.join(directory, "product-certificates-v1.json"), "utf8"));
    assert.equal(ledger.rows.length, 1);
  });
});

test("certificate import rejects workbook duplicate keys and upserts a matching existing record", async () => {
  await withService({}, async (service) => {
    await service.saveCertificate(record({ certificateNumber: "UPSERT", expiryDate: "2026-12-31" }));
    await assert.rejects(
      () => service.importCertificates(workbookPayload([
        record({ certificateNumber: "DUPLICATE" }),
        record({ certificateNumber: " duplicate " }),
      ])),
      /重复/u,
    );
    const result = await service.importCertificates(workbookPayload([
      record({ certificateNumber: "UPSERT", expiryDate: "2027-12-31" }),
    ]));
    assert.deepEqual(result, { importedCount: 1, updatedCount: 1, totalCount: 1 });
    assert.equal((await service.listCertificates()).rows[0].expiryDate, "2027-12-31");
  });
});

test("certificate template uses the fixed import headers in order", async () => {
  await withService({}, async (service) => {
    const workbook = XLSX.read(await service.createCertificateImportTemplate(), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    assert.deepEqual(
      XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })[0],
      ["国家", "产品SKU", "证书类型", "证书编号", "签发日期", "过期日期"],
    );
  });
});
