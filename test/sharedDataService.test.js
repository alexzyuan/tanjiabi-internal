import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";
XLSX.set_fs(fs);
import {
  applySharedProductCatalogToRows,
  buildSharedProductCatalogMap,
  findListingSharedCatalogMatches,
  getSharedProductCatalogMap,
  getSharedSellers,
  listingCountryMskuCatalogKey,
  listingMskuCatalogKey,
  listingStoreMskuCatalogKey,
  productCatalogKey,
  readListingSharedCatalogRecords,
} from "../src/services/sharedDataService.js";

test("共享商品目录跳过缺少内部 SKU 的产品记录", () => {
  assert.doesNotThrow(() => {
    const map = buildSharedProductCatalogMap({
      productRecords: [{ product_name: "缺少 SKU", token: "secret" }],
    });
    assert.equal(map.size, 0);
  });
});

test("共享商品目录保留规范产品的 sku 和 asin 白名单字段", () => {
  const map = buildSharedProductCatalogMap({
    sourceRows: [{ sid: 8708, msku: "MSKU-1", sku: "TJ001" }],
    productRecords: [{
      sku: "TJ001",
      asin: "B000000001",
      photo: "https://img.example.com/photo.jpg",
    }],
  });
  const product = map.get(productCatalogKey("TJ001"));
  assert.equal(product.sku, "TJ001");
  assert.equal(product.asin, "B000000001");
  assert.equal(product.imageUrl, "https://img.example.com/photo.jpg");
  assert.equal(JSON.parse(JSON.stringify(product)).asin, "B000000001");
});

test("Listing shared-catalog matches require internal SKU and clone no-SID rows per scope", async () => {
  const records = [{ MSKU: "SHARED-M", SKU: "TJ001", 店铺: "", 国家: "" }];
  const matches = findListingSharedCatalogMatches([
    { sid: 101, msku: "SHARED-M", storeName: "店铺 A", country: "美国" },
    { sid: 202, msku: "SHARED-M", storeName: "店铺 B", country: "加拿大" },
  ], records);
  assert.equal(matches.length, 2);
  assert.notEqual(matches[0], matches[1]);
  assert.equal(matches[0].internalSku, "TJ001");
  assert.equal(matches[1].internalSku, "TJ001");
  assert.deepEqual(
    findListingSharedCatalogMatches([{ sid: 101, msku: "SHARED-M" }], [{ MSKU: "SHARED-M" }]),
    [],
  );

  const result = await getSharedProductCatalogMap({
    async fetchListings() { return { data: { list: [] } }; },
    async fetchLocalProductInfos() { return { data: [{ sku: "TJ001", product_name: "共享商品" }] }; },
  }, [
    { sid: 101, storeName: "店铺 A", country: "美国", msku: "SHARED-M", sku: "SHARED-M" },
    { sid: 202, storeName: "店铺 B", country: "加拿大", msku: "SHARED-M", sku: "SHARED-M" },
  ], {
    forceRefresh: true,
    readProductCatalogCache: async () => null,
    saveProductCatalogCache: async () => {},
    listingSharedCatalogRecords: records,
  });
  assert.equal(result.map.get(listingMskuCatalogKey(101, "SHARED-M")).internalSku, "TJ001");
  assert.equal(result.map.get(listingMskuCatalogKey(202, "SHARED-M")).internalSku, "TJ001");
});

test("Listing shared-catalog reader honors configured XLSX files and all sheets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "listing-shared-catalog-review-"));
  const filePath = path.join(directory, "configured.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["MSKU", "SKU"], ["M-1", "TJ001"]]), "第一张");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["MSKU", "SKU"], ["M-2", "TJ002"]]), "第二张");
  await writeFile(filePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  const previous = process.env.LISTING_SHARED_CATALOG_FILE;
  process.env.LISTING_SHARED_CATALOG_FILE = filePath;
  try {
    const records = await readListingSharedCatalogRecords({ directory: path.join(directory, "missing") });
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((record) => [record.MSKU, record.SKU]), [["M-1", "TJ001"], ["M-2", "TJ002"]]);
  } finally {
    if (previous === undefined) delete process.env.LISTING_SHARED_CATALOG_FILE;
    else process.env.LISTING_SHARED_CATALOG_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("共享商品目录合并 listing、本地商品、图片、采购信息并按 MSKU/SKU 建索引", () => {
  const map = buildSharedProductCatalogMap({
    sourceRows: [{ sid: 8708, msku: "JM-DGC-BLUE", sku: "TJ001" }],
    listingRecords: [{
      sid: 8708,
      seller_sku: "JM-DGC-BLUE",
      sku: "TJ001",
      product_name: "灯光船蓝色 listing",
      small_image_url: "https://img.example.com/listing-blue.jpg",
    }],
    productRecords: [{
      sku: "TJ001",
      product_name: "灯光船蓝色本地品名",
      supplier_name: "汕头工厂",
      purchase_price: "38",
      cg_product_material: "塑料玩具",
      declaration_purpose: "Toy",
      bg_customs_import_price: "2.000000",
      bg_export_hs_code: "9503008390",
      image_url: "https://img.example.com/local-blue.jpg",
    }],
  });

  const bySku = map.get(productCatalogKey("TJ001"));
  const byMsku = map.get(listingMskuCatalogKey(8708, "JM-DGC-BLUE"));

  assert.equal(bySku.productName, "灯光船蓝色本地品名");
  assert.equal(bySku.imageUrl, "https://img.example.com/local-blue.jpg");
  assert.equal(bySku.supplier, "汕头工厂");
  assert.equal(bySku.purchasePrice, 38);
  assert.equal(bySku.material, "塑料玩具");
  assert.equal(bySku.purpose, "Toy");
  assert.equal(bySku.customsCode, "9503008390");
  assert.equal(bySku.declaredValue, 2);
  assert.equal(byMsku.productName, "灯光船蓝色本地品名");
  assert.equal(byMsku.imageUrl, "https://img.example.com/local-blue.jpg");
  assert.equal(byMsku.declaredValue, 2);
});

test("共享商品目录读取产品管理物流报关清关嵌套字段", () => {
  const map = buildSharedProductCatalogMap({
    sourceRows: [{ sid: 8708, msku: "JM-E3902", sku: "TJ033" }],
    listingRecords: [{
      sid: 8708,
      seller_sku: "JM-E3902",
      sku: "TJ033",
    }],
    productRecords: [{
      sku: "TJ033",
      product_name: "双支蜘蛛船",
      brand_name: "JOI MEW",
      special_attr: ["1"],
      declaration: {
        customs_import_price: "2.00",
        customs_declaration_hs_code: "9503008390",
        customs_declaration_unit: "件",
      },
      clearance: {
        customs_clearance_material: "塑料",
        customs_clearance_en_usage: "kids tool",
      },
    }],
  });

  const product = map.get(listingMskuCatalogKey(8708, "JM-E3902"));
  assert.equal(product.brand, "JOI MEW");
  assert.equal(product.material, "塑料");
  assert.equal(product.purpose, "kids tool");
  assert.equal(product.customsCode, "9503008390");
  assert.equal(product.isBattery, "是");
  assert.equal(product.unit, "件");
  assert.equal(product.declaredValue, 2);
});

test("共享商品目录将领星普货属性码 8 标准化为非带电", () => {
  const map = buildSharedProductCatalogMap({
    sourceRows: [{ sid: 11500, msku: "MD-889-382", sku: "TJ040" }],
    listingRecords: [{
      sid: 11500,
      seller_sku: "MD-889-382",
      local_sku: "TJ040",
    }],
    productRecords: [{
      sku: "TJ040",
      special_attr: ["8"],
    }],
  });

  const product = map.get(listingMskuCatalogKey(11500, "MD-889-382"));
  assert.equal(product.isBattery, "否");
});

test("共享商品目录通过 listing seller_sku 映射到领星内部 SKU", () => {
  const map = buildSharedProductCatalogMap({
    sourceRows: [{ sid: 8708, msku: "JMCA-DGC-Spider", sku: "JMCA-DGC-Spider" }],
    listingRecords: [{
      sid: 8708,
      seller_sku: "JMCA-DGC-Spider",
      local_sku: "TJ033",
      local_name: "双支蜘蛛船",
    }],
    productRecords: [{
      sku: "TJ033",
      product_name: "双支蜘蛛船",
      brand_name: "JOI MEW",
      material: "塑料",
      purpose: "kids tool",
      customs_code: "9503008390",
      unit: "件",
      declared_value: "2.00",
    }],
  });

  const product = map.get(listingMskuCatalogKey(8708, "JMCA-DGC-Spider"));
  assert.equal(product.sku, "TJ033");
  assert.equal(product.productName, "双支蜘蛛船");
  assert.equal(product.declaredValue, 2);

  const [row] = applySharedProductCatalogToRows([
    { sid: 8708, msku: "JMCA-DGC-Spider", sku: "JMCA-DGC-Spider" },
  ], map);
  assert.equal(row.sku, "JMCA-DGC-Spider");
  assert.equal(row.internalSku, "TJ033");
  assert.equal(row.brand, "JOI MEW");
  assert.equal(row.customsCode, "9503008390");
});

test("共享商品目录应用到行时合并所有命中的索引，避免空店铺索引遮挡内部 SKU 商品资料", () => {
  const map = new Map([
    [productCatalogKey(listingStoreMskuCatalogKey("探嘉加拿大", "JMCA-DGC-Spider")), {
      sid: 8709,
      storeName: "探嘉加拿大",
      country: "加拿大",
      msku: "JMCA-DGC-Spider",
      sku: "TJ033",
      internalSku: "",
    }],
    [productCatalogKey(listingCountryMskuCatalogKey("加拿大", "JMCA-DGC-Spider")), {
      sid: 8709,
      country: "加拿大",
      msku: "JMCA-DGC-Spider",
      sku: "TJ033",
      internalSku: "TJ033",
    }],
    [productCatalogKey(listingMskuCatalogKey(8709, "JMCA-DGC-Spider")), {
      sid: 8709,
      country: "加拿大",
      msku: "JMCA-DGC-Spider",
      sku: "TJ033",
      internalSku: "TJ033",
    }],
    [productCatalogKey("TJ033"), {
      sku: "TJ033",
      internalSku: "TJ033",
      product_name: "双支蜘蛛船",
      productName: "双支蜘蛛船",
      brand: "JOI MEW",
      material: "塑料",
      purpose: "kids tool",
      customsCode: "9503008390",
      isBattery: "是",
      unit: "套",
      declaredValue: 2,
    }],
  ]);

  const [row] = applySharedProductCatalogToRows([
    {
      sid: 8709,
      storeName: "探嘉加拿大",
      country: "加拿大",
      msku: "JMCA-DGC-Spider",
      sku: "TJ033",
    },
  ], map);

  assert.equal(row.internalSku, "TJ033");
  assert.equal(row.brand, "JOI MEW");
  assert.equal(row.material, "塑料");
  assert.equal(row.purpose, "kids tool");
  assert.equal(row.customsCode, "9503008390");
  assert.equal(row.isBattery, "是");
  assert.equal(row.unit, "套");
  assert.equal(row.declaredValue, 2);
});

test("共享商品目录在 ERP Listing API 缺失时用 Listing 共享目录兜底内部 SKU", async () => {
  let listingApiCalled = false;
  const productLookupSkus = [];
  const result = await getSharedProductCatalogMap({
    async fetchListings() {
      listingApiCalled = true;
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos(params) {
      productLookupSkus.push(...(params.skus || []));
      return {
        data: [{
          sku: "TJ033",
          product_name: "双支蜘蛛船",
          brand_name: "JOI MEW",
          material: "塑料",
          purpose: "kids tool",
          customs_code: "9503008390",
          unit: "件",
          declared_value: "2.00",
        }],
      };
    },
  }, [{
    sid: 8708,
    storeName: "xiamentanjia-CA",
    country: "加拿大",
    msku: "JMCA-DGC-Spider",
    sku: "JMCA-DGC-Spider",
  }], {
    forceRefresh: true,
    listingSharedCatalogRecords: [{
      MSKU: "JMCA-DGC-Spider",
      店铺: "xiamentanjia-CA",
      国家: "加拿大",
      品名: "双支蜘蛛船",
      SKU: "TJ033",
    }],
  });

  const product = result.map.get(listingMskuCatalogKey(8708, "JMCA-DGC-Spider"));
  assert.equal(listingApiCalled, true);
  assert.equal(productLookupSkus.includes("TJ033"), true);
  assert.equal(product.internalSku, "TJ033");
  assert.equal(product.productName, "双支蜘蛛船");
  assert.equal(product.customsCode, "9503008390");
  assert.equal(result.performance.scope, "shared-product-catalog");
  assert.equal(result.performance.counters.cacheHit, 0);
  assert.equal(result.performance.counters.sourceRows, 1);
  assert.equal(result.performance.counters.outputRecords, result.map.size);
  assert.equal(result.performance.counters.lingxingListingRequests > 0, true);
  assert.equal(result.performance.counters.lingxingProductInfoRequests > 0, true);
});

test("共享商品目录缓存命中返回性能元数据且不调用 Lingxing", async () => {
  let listingCalls = 0;
  const result = await getSharedProductCatalogMap({
    async fetchListings() {
      listingCalls += 1;
      throw new Error("should not fetch listings on cache hit");
    },
  }, [{
    sid: 8708,
    storeName: "xiamentanjia-US",
    country: "美国",
    msku: "JM-DGC-BLUE",
    sku: "TJ001",
  }], {
    readProductCatalogCache: async () => ({
      updatedAt: "2026-07-15 10:00:00",
      data: {
        records: [{
          key: listingMskuCatalogKey(8708, "JM-DGC-BLUE"),
          product: {
            sid: 8708,
            msku: "JM-DGC-BLUE",
            sku: "TJ001",
            productName: "灯光船蓝色",
          },
        }],
      },
    }),
  });

  assert.equal(listingCalls, 0);
  assert.equal(result.cacheHit, true);
  assert.equal(result.map.size, 1);
  assert.equal(result.performance.scope, "shared-product-catalog");
  assert.equal(result.performance.counters.cacheHit, 1);
  assert.equal(result.performance.counters.outputRecords, 1);
  assert.equal(result.performance.counters.lingxingListingRequests || 0, 0);
});

test("共享商品目录并发相同缓存键时合并刷新请求", async () => {
  let releaseListing;
  const listingGate = new Promise((resolve) => {
    releaseListing = resolve;
  });
  let listingCalls = 0;
  let productCalls = 0;
  let saveCalls = 0;
  const rows = [{
    sid: 8708,
    storeName: "xiamentanjia-US",
    country: "美国",
    msku: "JM-DGC-BLUE",
    sku: "TJ001",
  }];
  const adapter = {
    async fetchListings() {
      listingCalls += 1;
      await listingGate;
      return {
        data: {
          total: 1,
          list: [{
            sid: 8708,
            seller_sku: "JM-DGC-BLUE",
            local_sku: "TJ001",
          }],
        },
      };
    },
    async fetchLocalProductInfos() {
      productCalls += 1;
      return {
        data: [{
          sku: "TJ001",
          product_name: "灯光船蓝色",
        }],
      };
    },
  };
  const options = {
    readProductCatalogCache: async () => null,
    saveProductCatalogCache: async () => {
      saveCalls += 1;
    },
    listingSharedCatalogRecords: [],
  };

  const first = getSharedProductCatalogMap(adapter, rows, options);
  const second = getSharedProductCatalogMap(adapter, rows, options);
  releaseListing();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(listingCalls, 1);
  assert.equal(productCalls, 2);
  assert.equal(saveCalls, 1);
  assert.equal(firstResult.map.size, secondResult.map.size);
  assert.equal(secondResult.performance.counters.joinedInFlight, 1);
});

test("统一店铺缓存命中时不再调用 Lingxing fetchSellers", async () => {
  const cached = {
    sellers: [{ sid: 8708, name: "xiamentanjia-US", status: 1 }],
    updatedAt: "2026-07-01 10:00:00",
  };
  let calls = 0;
  const result = await getSharedSellers({
    readCache: async () => cached,
    saveCache: async () => {},
    adapter: {
      async fetchSellers() {
        calls += 1;
        return { data: [{ sid: 1, name: "should-not-load" }] };
      },
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.cacheHit, true);
  assert.equal(result.sellers.length, 1);
  assert.equal(result.sellers[0].sid, 8708);
});
