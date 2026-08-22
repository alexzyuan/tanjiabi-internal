import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pruneDeployReleases } from "../scripts/prune-deploy-releases.js";

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

test("deploy release retention uses directory time instead of mixed backup names", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "deploy-release-retention-"));
  const releasesDir = path.join(root, "releases");
  await mkdir(releasesDir);
  t.after(() => rm(root, { recursive: true, force: true }));

  const fixtures = [
    ["before-rollback-20260817-094109", "2026-08-17T01:41:09.000Z"],
    ["manual-visual-before-rollback-20260707-184950", "2026-08-20T13:38:24.000Z"],
    ["20260822-103501", "2026-08-22T02:35:01.000Z"],
    ["20260822-103654", "2026-08-22T02:36:54.000Z"],
  ];

  for (const [name, timestamp] of fixtures) {
    const releasePath = path.join(releasesDir, name);
    await mkdir(releasePath);
    const time = new Date(timestamp);
    await utimes(releasePath, time, time);
  }

  const protectedRelease = path.join(releasesDir, "20260822-103654");
  const result = await pruneDeployReleases({
    releasesDir,
    keepReleases: 3,
    protectedRelease,
  });

  assert.deepEqual(result.removed.map((item) => path.basename(item)), ["before-rollback-20260817-094109"]);
  assert.equal(await pathExists(path.join(releasesDir, "before-rollback-20260817-094109")), false);
  assert.equal(await pathExists(path.join(releasesDir, "manual-visual-before-rollback-20260707-184950")), true);
  assert.equal(await pathExists(path.join(releasesDir, "20260822-103501")), true);
  assert.equal(await pathExists(protectedRelease), true);
});

test("deploy release retention never removes the protected current backup during clock skew", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "deploy-release-protection-"));
  const releasesDir = path.join(root, "releases");
  await mkdir(releasesDir);
  t.after(() => rm(root, { recursive: true, force: true }));

  const fixtures = [
    ["current-deploy", "2026-08-22T01:00:00.000Z"],
    ["older-backup", "2026-08-22T02:00:00.000Z"],
    ["newest-backup", "2026-08-22T03:00:00.000Z"],
  ];
  for (const [name, timestamp] of fixtures) {
    const releasePath = path.join(releasesDir, name);
    await mkdir(releasePath);
    const time = new Date(timestamp);
    await utimes(releasePath, time, time);
  }

  const protectedRelease = path.join(releasesDir, "current-deploy");
  const result = await pruneDeployReleases({
    releasesDir,
    keepReleases: 2,
    protectedRelease,
  });

  assert.deepEqual(
    result.kept.map((item) => path.basename(item)).sort(),
    ["current-deploy", "newest-backup"],
  );
  assert.equal(await pathExists(protectedRelease), true);
  assert.equal(await pathExists(path.join(releasesDir, "older-backup")), false);
});
