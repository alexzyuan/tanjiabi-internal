import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import XLSX from "xlsx";

const serviceUrl = pathToFileURL(path.resolve("src/services/budgetTargetService.js"));

async function withTempService(fn) {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-budget-service-"));
  process.chdir(dir);
  try {
    const service = await import(`${serviceUrl.href}?case=${Date.now()}-${Math.random()}`);
    await fn(service, dir);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

function workbookBuffer({ storeTitle = "探嘉美国店铺预算报表", msku = "JM-DGC-BLUE", salesQty = 10, salesAmount = 200, adBudget = 20 } = {}) {
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    [storeTitle],
    ["预算月份", "2026-07", "", 7],
    ["销售收入", salesAmount],
    ["广告费用", adBudget],
    ["退款金额", 5],
    ["商品采购成本", 60],
    ["头程运费", 12],
    ["营业利润", 73.5],
  ];
  const budgetRows = [
    ["MSKU", "ASIN", "产品名称", "SKU负责人", "销售价($)", "销售数量", "销额($)", "广告费用($)", "退款金额($)", "FBA配送费($)", "总成本($)", "总头程费用($)", "仓储费($)", "优惠券佣金($)", "发货数量"],
    [msku, "B000TEST", "灯光船", "婷婷", 20, salesQty, salesAmount, adBudget, 5, 8, 60, 12, 3, 2, 4],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "汇总");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(budgetRows), "销售预算");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function uploadPayload(overrides = {}) {
  return {
    fileName: "探嘉美国-2026年7月预算.xlsx",
    budgetMonth: "2026-07",
    base64: workbookBuffer(overrides).toString("base64"),
  };
}

test("saveBudgetUpload parses a workbook and exposes aggregate budget targets", async () => {
  await withTempService(async ({ saveBudgetUpload, listBudgetTargets, getBudgetTargetContext }) => {
    const upload = await saveBudgetUpload(uploadPayload());
    const targets = await listBudgetTargets();
    const context = await getBudgetTargetContext({ budgetMonth: "2026-07" });

    assert.equal(upload.status, "已解析");
    assert.equal(upload.summary.month, "2026-07");
    assert.equal(upload.summary.storeName, "探嘉美国");
    assert.equal(upload.summary.skuCount, 1);
    assert.equal(upload.summary.salesTarget, 200);
    assert.equal(upload.summary.adBudget, 20);
    assert.equal(upload.summary.mskuRows[0].msku, "JM-DGC-BLUE");
    assert.equal(targets.rows.length, 1);
    assert.equal(targets.mskuRows.length, 1);
    assert.equal(targets.totals.salesTarget, 200);
    assert.equal(context.matched, true);
    assert.equal(context.totals.profitTarget, 73.5);
  });
});

test("saveBudgetUpload rejects invalid month, extension, and empty file content", async () => {
  await withTempService(async ({ saveBudgetUpload }) => {
    await assert.rejects(
      () => saveBudgetUpload({ ...uploadPayload(), budgetMonth: "2026-13" }),
      /请先选择预算月份/,
    );
    await assert.rejects(
      () => saveBudgetUpload({ ...uploadPayload(), fileName: "budget.csv" }),
      /只支持上传 \.xlsx 预算模板/,
    );
    await assert.rejects(
      () => saveBudgetUpload({ ...uploadPayload(), base64: "" }),
      /上传文件内容为空/,
    );
  });
});

test("listBudgetUploads ignores AppleDouble files and empty upload directories", async () => {
  await withTempService(async ({ listBudgetUploads }, dir) => {
    assert.deepEqual(await listBudgetUploads(), []);

    const uploadDir = path.join(dir, "uploads", "budget-targets");
    await writeFile(path.join(uploadDir, "._探嘉美国-2026年7月预算.xlsx"), "metadata").catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
      await import("node:fs/promises").then(({ mkdir }) => mkdir(uploadDir, { recursive: true }));
      await writeFile(path.join(uploadDir, "._探嘉美国-2026年7月预算.xlsx"), "metadata");
    });

    assert.deepEqual(await listBudgetUploads(), []);
  });
});

test("saveBudgetUpload replaces an existing upload for the same store and month", async () => {
  await withTempService(async ({ saveBudgetUpload, listBudgetUploads, listBudgetTargets }) => {
    const first = await saveBudgetUpload(uploadPayload({ salesAmount: 200, adBudget: 20 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await saveBudgetUpload(uploadPayload({ msku: "JM-DGC-RED", salesAmount: 300, adBudget: 45 }));
    const uploads = await listBudgetUploads();
    const targets = await listBudgetTargets();

    assert.equal(first.replacedCount, 0);
    assert.equal(second.replacedCount, 1);
    assert.equal(second.status, "已覆盖旧预算");
    assert.equal(uploads.length, 1);
    assert.equal(targets.rows.length, 1);
    assert.equal(targets.rows[0].salesTarget, 300);
    assert.equal(targets.mskuRows[0].msku, "JM-DGC-RED");
  });
});
