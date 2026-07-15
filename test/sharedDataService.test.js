import assert from "node:assert/strict";
import test from "node:test";
import {
  applySharedProductCatalogToRows,
  buildSharedProductCatalogMap,
  getSharedProductCatalogMap,
  getSharedSellers,
  listingCountryMskuCatalogKey,
  listingMskuCatalogKey,
  listingStoreMskuCatalogKey,
  productCatalogKey,
} from "../src/services/sharedDataService.js";

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
