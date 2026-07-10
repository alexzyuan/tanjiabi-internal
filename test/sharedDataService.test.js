import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSharedProductCatalogMap,
  getSharedSellers,
  listingMskuCatalogKey,
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
      image_url: "https://img.example.com/local-blue.jpg",
    }],
  });

  const bySku = map.get(productCatalogKey("TJ001"));
  const byMsku = map.get(listingMskuCatalogKey(8708, "JM-DGC-BLUE"));

  assert.equal(bySku.productName, "灯光船蓝色本地品名");
  assert.equal(bySku.imageUrl, "https://img.example.com/local-blue.jpg");
  assert.equal(bySku.supplier, "汕头工厂");
  assert.equal(bySku.purchasePrice, 38);
  assert.equal(byMsku.productName, "灯光船蓝色本地品名");
  assert.equal(byMsku.imageUrl, "https://img.example.com/local-blue.jpg");
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
