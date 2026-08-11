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
