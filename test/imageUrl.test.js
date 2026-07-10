import assert from "node:assert/strict";
import test from "node:test";

import {
  cachedSalesImageUrl,
  normalizedSalesImageUrl,
} from "../assets/js/image-url.js";

test("image url helper normalizes supported sales image URLs", () => {
  assert.equal(normalizedSalesImageUrl(""), "");
  assert.equal(normalizedSalesImageUrl("/assets/product.png"), "/assets/product.png");
  assert.equal(normalizedSalesImageUrl("//example.com/product.png"), "//example.com/product.png");
  assert.equal(normalizedSalesImageUrl("https://example.com/product.png"), "https://example.com/product.png");
  assert.equal(normalizedSalesImageUrl("http://example.com/product.png"), "http://example.com/product.png");
  assert.equal(normalizedSalesImageUrl("data:image/png;base64,abc"), "");
  assert.equal(normalizedSalesImageUrl("javascript:alert(1)"), "");
});

test("image url helper routes remote images through the cache endpoint", () => {
  assert.equal(cachedSalesImageUrl("/assets/product.png"), "/assets/product.png");
  assert.equal(cachedSalesImageUrl("//example.com/product.png"), "//example.com/product.png");
  assert.equal(
    cachedSalesImageUrl("https://example.com/product image.png?x=1&y=2"),
    "/api/image-cache?url=https%3A%2F%2Fexample.com%2Fproduct%20image.png%3Fx%3D1%26y%3D2",
  );
  assert.equal(cachedSalesImageUrl("not-a-url"), "");
});
