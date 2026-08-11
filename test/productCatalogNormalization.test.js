import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogProductToRepositoryRows,
  mergeCatalogProduct,
  normalizeCatalogListing,
  normalizeCatalogProduct,
} from "../src/services/productCatalogNormalization.js";
import {
  findListingSharedCatalogMatches,
  readListingSharedCatalogRecords,
} from "../src/services/listingSharedCatalogService.js";

test("normalizes declaration and FBA packaging fields into the canonical product", () => {
  const product = normalizeCatalogProduct({
    sku: "TJ033", product_name: "双支蜘蛛船", supplier_name: "汕头工厂",
    purchase_price: "38", special_attr: ["1"], bg_export_hs_code: "9503008390",
    cg_box_pcs: "6", cg_box_length: "40", cg_box_width: "30", cg_box_height: "20",
    cg_box_weight: "8", cg_box_length_unit: "CM", cg_box_weight_unit: "KG",
  });
  assert.equal(product.internalSku, "TJ033");
  assert.equal(product.isBattery, "是");
  assert.equal(product.packQuantity, 6);
  assert.deepEqual(product.boxSpec.dimensions, {
    length: 40,
    width: 30,
    height: 20,
    unitOfMeasurement: "CM",
  });
  assert.deepEqual(product.boxSpec.weight, { value: 8, unit: "KG" });
});

test("does not expose raw upstream records or arbitrary fields", () => {
  const product = normalizeCatalogProduct({ sku: "TJ001", token: "secret", unexpected: "value" });
  assert.equal(Object.hasOwn(product, "raw"), false);
  assert.equal(Object.hasOwn(product, "token"), false);
  assert.equal(Object.hasOwn(product, "unexpected"), false);
});

test("keeps Listing seller_sku/MSKU separate from ERP local_sku and exposes local_sku as listingSku", () => {
  const listing = normalizeCatalogListing({
    sid: "8708",
    seller_sku: "AMAZON-SELLER-SKU",
    local_sku: "TJ033",
    asin: "B000000001",
    title: "Listing title",
    token: "secret",
  });
  assert.deepEqual(listing, {
    sid: 8708,
    msku: "AMAZON-SELLER-SKU",
    internalSku: "TJ033",
    listingSku: "TJ033",
    asin: "B000000001",
    productName: "Listing title",
  });
  assert.equal(Object.hasOwn(listing, "seller_sku"), false);
  assert.equal(Object.hasOwn(listing, "token"), false);
});

test("merges only canonical product fields and preserves non-empty values", () => {
  const merged = mergeCatalogProduct(
    { internalSku: "TJ001", productName: "旧品名", purchasePrice: 0, token: "secret" },
    { internalSku: "TJ001", productName: "新品名", purchasePrice: 38, brand: "JOI MEW", raw: { token: "secret" } },
  );
  assert.equal(merged.productName, "新品名");
  assert.equal(merged.purchasePrice, 38);
  assert.equal(merged.brand, "JOI MEW");
  assert.equal(Object.hasOwn(merged, "raw"), false);
  assert.equal(Object.hasOwn(merged, "token"), false);
});

test("maps normalized catalog products to repository rows with canonical keys and provenance", () => {
  const product = normalizeCatalogProduct({
    sku: " TJ001 ", product_name: "灯光船", product_id: 101, sku_identifier: "SID-1",
  });
  const rows = catalogProductToRepositoryRows({
    product,
    listing: normalizeCatalogListing({ sid: 8708, seller_sku: "MSKU-1", local_sku: "TJ001" }),
    source: "lingxing",
    sourceUpdatedAtMs: 1720000000000,
    refreshedAtMs: 1720000000000,
  });
  assert.equal(rows.product.internalSkuKey, "tj001");
  assert.equal(rows.product.internalSku, "TJ001");
  assert.equal(rows.listing.mskuKey, "msku-1");
  assert.equal(rows.listing.internalSkuKey, "tj001");
  assert.equal(rows.listing.listingSku, "TJ001");
  assert.equal(rows.aliases.some((alias) => alias.aliasType === "listing_sku" && alias.sourceField === "local_sku"), true);
  assert.equal(rows.aliases.some((alias) => alias.aliasValue === "MSKU-1"), false);
});

test("matches Listing shared-catalog records by SID and normalized MSKU", () => {
  const records = [
    { SID: 8708, MSKU: "MSKU-1", SKU: "TJ001", token: "secret" },
    { SID: 8709, MSKU: "MSKU-1", SKU: "TJ002" },
  ];
  const matches = findListingSharedCatalogMatches([
    { sid: 8708, msku: " msku-1 ", mskuKey: "msku-1", key: "8708:msku-1" },
    { sid: 9000, msku: "MSKU-1", key: "9000:msku-1" },
  ], records);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].internalSku, "TJ001");
  assert.equal(Object.hasOwn(matches[0], "raw"), false);
});

test("Listing shared-catalog reader preserves empty-directory semantics", async () => {
  assert.deepEqual(await readListingSharedCatalogRecords({ directory: "/tmp/catalog-directory-that-does-not-exist" }), []);
});
