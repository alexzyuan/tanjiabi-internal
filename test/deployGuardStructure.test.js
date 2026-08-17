import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deploy package requires explicit branch confirmation and writes source manifest", async () => {
  const source = await readFile(new URL("../scripts/package-deploy.js", import.meta.url), "utf8");

  assert.match(source, /const DEPLOY_MANIFEST = "\.deploy-manifest\.json"/);
  assert.match(source, /buildDeployIntegrity/);
  assert.match(source, /PRODUCTION_DEPLOY_BRANCH \|\| "main"/);
  assert.match(source, /DEPLOY_CONFIRM_BRANCH/);
  assert.match(source, /runGit\(\["status", "--porcelain"\]\)/);
  assert.match(source, /detached HEAD/);
  assert.match(source, /confirmedBranch: confirmedDeployBranch/);
  assert.match(source, /deployMetadata\.integrity = await buildDeployIntegrity\(ROOT, manifest\)/);
  assert.match(source, /JSON\.stringify\(deployMetadata, null, 2\)/);
});

test("server deployment rejects packages without a confirmed production branch manifest", async () => {
  const source = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");

  assert.match(source, /PRODUCTION_DEPLOY_BRANCH="\$\{PRODUCTION_DEPLOY_BRANCH:-main\}"/);
  assert.match(source, /validate_deploy_manifest\(\)/);
  assert.match(source, /tar -xOzf "\$ARCHIVE" \.deploy-manifest\.json/);
  assert.match(source, /manifest_confirmed_branch.*manifest_branch/);
  assert.match(source, /ALLOW_NON_PRODUCTION_DEPLOY/);
  assert.match(source, /SKIP_SALES_FACTS_PREFLIGHT/);
  assert.match(source, /deploy_integrity_check\(\)/);
  assert.match(source, /node scripts\/deploy-integrity\.js verify-deployed/);
  assert.match(source, /validate_deploy_manifest[\s\S]*if \[ "\$\{ALLOW_CSS_DEPLOY:-0\}" != "1" \]/);
  assert.match(source, /health_check[\s\S]*deploy_integrity_check[\s\S]*cleanup_old_releases/);
});

test("deployment package source lists catalog smoke and migration scripts explicitly", async () => {
  const source = await readFile(new URL("../scripts/package-deploy.js", import.meta.url), "utf8");
  assert.match(source, /scripts\/product-catalog-sqlite-smoke\.js/);
  assert.match(source, /scripts\/migrate-product-catalog\.js/);
});

test("deployment package includes the controlled inventory-ledger rebuild command", async () => {
  const source = await readFile(new URL("../scripts/package-deploy.js", import.meta.url), "utf8");
  assert.match(source, /scripts\/rebuild-inventory-ledger\.js/);
});

test("deployment protects inventory provision caches and rollback restores them only when explicitly requested", async () => {
  const [deploySource, rollbackSource, packageSource] = await Promise.all([
    readFile(new URL("../deploy.sh", import.meta.url), "utf8"),
    readFile(new URL("../rollback.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package-deploy.js", import.meta.url), "utf8"),
  ]);
  assert.match(packageSource, /scripts\/inventory-provision-deploy-snapshot\.js/);
  assert.match(deploySource, /backup_inventory_provision_runtime_data\(\)/);
  assert.match(deploySource, /node "\$snapshot_tool" snapshot/);
  assert.match(deploySource, /backup_inventory_provision_runtime_data\nbackup_sales_forecast_runtime_data/);
  assert.match(rollbackSource, /--restore-inventory-provision-cache/);
  assert.match(rollbackSource, /node "\$snapshot_tool" restore/);
});

test("deployment package advertises and includes the sales facts SQLite capability", async () => {
  const source = await readFile(new URL("../scripts/package-deploy.js", import.meta.url), "utf8");
  assert.match(source, /capabilities:\s*\[[\s\S]*product-catalog-sqlite-v1[\s\S]*sales-facts-sqlite-v1/);
  assert.match(source, /scripts\/sales-facts-sqlite-smoke\.js/);
  assert.match(source, /scripts\/validate-sales-facts-schema\.js/);
  assert.match(source, /scripts\/audit-sales-facts-preflight\.js/);
});

test("deployment source runs catalog checks before PM2 restart", async () => {
  const source = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");
  const installIndex = source.indexOf("npm ci");
  const smokeIndex = source.indexOf("node scripts/product-catalog-sqlite-smoke.js");
  const migrateIndex = source.indexOf("node scripts/migrate-product-catalog.js");
  const restartIndex = source.indexOf("pm2 start");
  assert.ok(installIndex >= 0 && installIndex < smokeIndex);
  assert.ok(smokeIndex < migrateIndex);
  assert.ok(migrateIndex < restartIndex);
});

test("deployment source installs, smokes, validates, checks approved preflight, then restarts PM2", async () => {
  const source = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");
  const installIndex = source.indexOf("npm ci");
  const productSmokeIndex = source.indexOf("node scripts/product-catalog-sqlite-smoke.js");
  const salesSmokeIndex = source.indexOf("node scripts/sales-facts-sqlite-smoke.js");
  const schemaIndex = source.indexOf("node scripts/validate-sales-facts-schema.js");
  const preflightIndex = source.lastIndexOf("validate_sales_facts_preflight_artifact");
  const restartIndex = source.indexOf("pm2 start");
  assert.ok(installIndex >= 0 && installIndex < productSmokeIndex);
  assert.ok(productSmokeIndex < salesSmokeIndex);
  assert.ok(salesSmokeIndex < schemaIndex);
  assert.ok(schemaIndex < preflightIndex);
  assert.ok(preflightIndex < restartIndex);
  assert.match(source, /SALES_FACTS_PREFLIGHT_ARTIFACT/);
  assert.match(source, /SALES_FACTS_PREFLIGHT_ARTIFACT_SHA256/);
});

test("deployment builds native dependencies in the isolated release directory before replacing live node_modules", async () => {
  const source = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");
  const stagedInstallIndex = source.indexOf('npm ci --prefix "$TMP_DIR"');
  const extractLiveIndex = source.indexOf('tar -xzf "$ARCHIVE" -C "$APP_DIR"');
  const swapIndex = source.indexOf('mv "$TMP_DIR/node_modules" "$APP_DIR/node_modules"');
  const restartIndex = source.indexOf("pm2 start");

  assert.ok(stagedInstallIndex >= 0, "native dependencies must be installed in the isolated release directory");
  assert.ok(extractLiveIndex >= 0 && stagedInstallIndex < extractLiveIndex);
  assert.ok(swapIndex >= 0 && extractLiveIndex < swapIndex);
  assert.ok(swapIndex < restartIndex);
  assert.doesNotMatch(source, /\ncd "\$APP_DIR"\n[\s\S]*?\nnpm ci\n/);
});

test("deployment can explicitly skip only the sales facts business preflight", async () => {
  const source = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");
  const skipIndex = source.indexOf("SKIP_SALES_FACTS_PREFLIGHT");
  const artifactIndex = source.indexOf("SALES_FACTS_PREFLIGHT_ARTIFACT");
  const schemaIndex = source.indexOf("node scripts/validate-sales-facts-schema.js");
  const restartIndex = source.indexOf("pm2 start");
  assert.ok(skipIndex >= 0);
  assert.ok(artifactIndex > skipIndex);
  assert.ok(schemaIndex >= 0 && schemaIndex < restartIndex);
  assert.ok(restartIndex > skipIndex);
  assert.match(source, /只能设置为 0 或 1/);
});
