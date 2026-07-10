import assert from "node:assert/strict";
import test from "node:test";

import {
  isRepositoryMetadataPath,
  isSourceTraversalPath,
} from "../src/utils/pathFilters.js";

test("repository metadata paths are recognized across platforms", () => {
  assert.equal(isRepositoryMetadataPath(".DS_Store"), true);
  assert.equal(isRepositoryMetadataPath("src/.DS_Store"), true);
  assert.equal(isRepositoryMetadataPath("assets/css/._00-reset.css"), true);
  assert.equal(isRepositoryMetadataPath("assets/css/.AppleDouble/00-reset.css"), true);
  assert.equal(isRepositoryMetadataPath("assets/css/.LSOverride"), true);
  assert.equal(isRepositoryMetadataPath("assets\\css\\._00-reset.css"), true);

  assert.equal(isRepositoryMetadataPath("assets/css/base/00-reset.css"), false);
  assert.equal(isRepositoryMetadataPath("src/config/index.js"), false);
});

test("source traversal paths exclude local caches, deployment output, and metadata", () => {
  assert.equal(isSourceTraversalPath("assets/css/base/00-reset.css"), true);
  assert.equal(isSourceTraversalPath("test/stylesStructure.test.js"), true);

  assert.equal(isSourceTraversalPath("node_modules/undici/package.json"), false);
  assert.equal(isSourceTraversalPath("data-cache/sync.json"), false);
  assert.equal(isSourceTraversalPath("uploads/import.xlsx"), false);
  assert.equal(isSourceTraversalPath("tanjia-bi-deploy.tar.gz"), false);
  assert.equal(isSourceTraversalPath("assets/css/._base"), false);
});
