import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deploy package requires explicit branch confirmation and writes source manifest", async () => {
  const source = await readFile(new URL("../scripts/package-deploy.js", import.meta.url), "utf8");

  assert.match(source, /const DEPLOY_MANIFEST = "\.deploy-manifest\.json"/);
  assert.match(source, /PRODUCTION_DEPLOY_BRANCH \|\| "codex\/yesterday-plus-webhook"/);
  assert.match(source, /DEPLOY_CONFIRM_BRANCH/);
  assert.match(source, /runGit\(\["status", "--porcelain"\]\)/);
  assert.match(source, /detached HEAD/);
  assert.match(source, /confirmedBranch: confirmedDeployBranch/);
  assert.match(source, /JSON\.stringify\(deployMetadata, null, 2\)/);
});

test("server deployment rejects packages without a confirmed production branch manifest", async () => {
  const source = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");

  assert.match(source, /PRODUCTION_DEPLOY_BRANCH="\$\{PRODUCTION_DEPLOY_BRANCH:-codex\/yesterday-plus-webhook\}"/);
  assert.match(source, /validate_deploy_manifest\(\)/);
  assert.match(source, /tar -xOzf "\$ARCHIVE" \.deploy-manifest\.json/);
  assert.match(source, /manifest_confirmed_branch.*manifest_branch/);
  assert.match(source, /ALLOW_NON_PRODUCTION_DEPLOY/);
  assert.match(source, /validate_deploy_manifest[\s\S]*if \[ "\$\{ALLOW_CSS_DEPLOY:-0\}" != "1" \]/);
});
