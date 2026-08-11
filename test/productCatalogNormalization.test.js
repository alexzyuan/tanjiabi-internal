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

test("does not treat local_sku as an Amazon MSKU fallback", () => {
  assert.equal(normalizeCatalogListing({ sid: 8708, local_sku: "TJ001" }), null);
});

test("keeps an ERP sku fallback separate from local_sku provenance", () => {
  const listing = normalizeCatalogListing({
    sid: 8708,
    seller_sku: "AMAZON-MSKU-1",
    sku: "TJ001",
  });
  assert.equal(listing.internalSku, "TJ001");
  assert.equal(listing.listingSku, "");
  const rows = catalogProductToRepositoryRows({
    product: normalizeCatalogProduct({ sku: "TJ001" }),
    listing,
    source: "test",
    sourceUpdatedAtMs: 1720000000000,
    refreshedAtMs: 1720000000000,
  });
  assert.equal(rows.aliases.some((alias) => alias.aliasType === "listing_sku"), false);
});

test("preserves photo-only image URLs and canonical sku/asin fields", () => {
  const product = normalizeCatalogProduct({
    sku: "TJ001",
    asin: "B000000001",
    photo: "https://img.example.com/photo.jpg",
  });
  assert.equal(product.sku, "TJ001");
  assert.equal(product.asin, "B000000001");
  assert.equal(product.imageUrl, "https://img.example.com/photo.jpg");
  assert.equal(JSON.parse(JSON.stringify(product)).asin, "B000000001");
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
  assert.equal(listing.sid, 8708);
  assert.equal(listing.msku, "AMAZON-SELLER-SKU");
  assert.equal(listing.internalSku, "TJ033");
  assert.equal(listing.listingSku, "TJ033");
  assert.equal(listing.asin, "B000000001");
  assert.equal(listing.productName, "Listing title");
  assert.equal({ ...listing }.internalSkuSourceField, "local_sku");
  assert.equal(JSON.parse(JSON.stringify(listing)).listingSkuSourceField, "local_sku");
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

test("clones only whitelisted box fields", () => {
  const merged = mergeCatalogProduct({}, {
    internalSku: "TJ001",
    boxSpec: {
      dimensions: { length: 40, width: 30, token: "secret" },
      weight: { value: 8, unit: "KG", unexpected: "value" },
      raw: "secret",
    },
  });
  assert.deepEqual(merged.boxSpec, {
    dimensions: { length: 40, width: 30, height: null, unitOfMeasurement: null },
    weight: { value: 8, unit: "KG" },
  });
});

test("maps normalized catalog products to repository rows with canonical keys and provenance", () => {
  const product = normalizeCatalogProduct({
    sku: " TJ001 ", asin: "B000000001", product_name: "灯光船", product_id: 101, sku_identifier: "SID-1",
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
  assert.equal(Object.hasOwn(rows.product, "asin"), false);
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
