import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const serviceUrl = pathToFileURL(path.resolve("src/services/authUserService.js"));

async function withTempService(fn) {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-auth-user-service-"));
  process.chdir(dir);
  try {
    const service = await import(`${serviceUrl.href}?case=${Date.now()}-${Math.random()}`);
    await fn(service, dir);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test("createAuthUser stores hashed users and validatePasswordLogin returns a sanitized session user", async () => {
  await withTempService(async ({ createAuthUser, listAuthUsers, validatePasswordLogin, hasManagedAuthUsers }, dir) => {
    const created = await createAuthUser({
      username: "finance.user",
      displayName: "财务同事",
      password: "strong-password",
      role: "主账户",
    });
    const login = await validatePasswordLogin({}, "finance.user", "strong-password");
    const users = await listAuthUsers({ local: { username: "env-admin", password: "env-password" } });
    const rawStore = JSON.parse(await readFile(path.join(dir, "data-cache", "auth-users.json"), "utf8"));

    assert.equal(created.username, "finance.user");
    assert.equal(created.role, "主账号");
    assert.equal(created.adminAccess, false);
    assert.equal(login.loginType, "password");
    assert.equal(login.displayName, "财务同事");
    assert.equal(login.passwordHash, undefined);
    assert.equal(users[0].source, "env");
    assert.equal(users[1].username, "finance.user");
    assert.equal(rawStore.users[0].passwordHash.length, 128);
    assert.notEqual(rawStore.users[0].passwordHash, "strong-password");
    assert.equal(hasManagedAuthUsers(), true);
  });
});

test("auth user validation rejects invalid usernames, short passwords, duplicates, and disabled logins", async () => {
  await withTempService(async ({ createAuthUser, updateAuthUser, validatePasswordLogin, hasManagedAuthUsers }) => {
    await assert.rejects(
      () => createAuthUser({ username: "ab", password: "strong-password" }),
      /账号需为 3-40 位/,
    );
    await assert.rejects(
      () => createAuthUser({ username: "valid.user", password: "short" }),
      /密码至少需要 8 位/,
    );

    await createAuthUser({ username: "valid.user", password: "strong-password", role: "子账号" });
    await assert.rejects(
      () => createAuthUser({ username: "valid.user", password: "another-password" }),
      /账号已存在/,
    );

    await updateAuthUser("valid.user", { status: "disabled" });
    assert.equal(await validatePasswordLogin({}, "valid.user", "strong-password"), null);
    assert.equal(hasManagedAuthUsers(), false);
  });
});

test("updateAuthUser normalizes role permissions and deleteAuthUser removes managed users", async () => {
  await withTempService(async ({ createAuthUser, updateAuthUser, deleteAuthUser, listAuthUsers, validatePasswordLogin }) => {
    await createAuthUser({ username: "ops.user", password: "strong-password", role: "子账号" });
    const admin = await updateAuthUser("ops.user", {
      displayName: "运营管理员",
      role: "admin",
      password: "new-strong-password",
    });
    const loginWithOldPassword = await validatePasswordLogin({}, "ops.user", "strong-password");
    const loginWithNewPassword = await validatePasswordLogin({}, "ops.user", "new-strong-password");
    const deleted = await deleteAuthUser("ops.user");
    const users = await listAuthUsers({});

    assert.equal(admin.role, "系统管理员");
    assert.equal(admin.adminAccess, true);
    assert.equal(loginWithOldPassword, null);
    assert.equal(loginWithNewPassword.adminAccess, true);
    assert.equal(deleted.username, "ops.user");
    assert.deepEqual(users, []);
    await assert.rejects(() => deleteAuthUser("ops.user"), /账号不存在/);
  });
});

test("DingTalk auth users are persisted, role-gated for admin access, and disabled accounts are rejected", async () => {
  await withTempService(async ({
    resolveDingtalkLogin,
    listDingtalkAuthUsers,
    updateDingtalkAuthUser,
    deleteDingtalkAuthUser,
  }) => {
    const first = await resolveDingtalkLogin({
      nick: "钉钉同事",
      mobile: "13800000000",
      openId: "open-1",
      unionId: "union-1",
    }, {});
    const promoted = await updateDingtalkAuthUser("union-1", {
      role: "系统管理员",
      adminAccess: true,
      status: "active",
    });
    const disabled = await updateDingtalkAuthUser("union-1", { status: "disabled", role: "主账号", adminAccess: true });
    const rejectedLogin = await resolveDingtalkLogin({ unionId: "union-1", nick: "钉钉同事" }, {});
    const deleted = await deleteDingtalkAuthUser("union-1");
    const users = await listDingtalkAuthUsers();

    assert.equal(first.allowed, true);
    assert.equal(first.user.role, "子账号");
    assert.equal(promoted.role, "系统管理员");
    assert.equal(promoted.adminAccess, true);
    assert.equal(disabled.role, "主账号");
    assert.equal(disabled.adminAccess, false);
    assert.equal(rejectedLogin.allowed, false);
    assert.match(rejectedLogin.reason, /已被禁用/);
    assert.equal(deleted.id, "union-1");
    assert.deepEqual(users, []);
  });
});

test("a corrupt managed-user store fails loudly and is never overwritten", async () => {
  await withTempService(async ({ createAuthUser, hasManagedAuthUsers, listAuthUsers }, dir) => {
    const storePath = path.join(dir, "data-cache", "auth-users.json");
    const corruptContent = "{\"users\":[";
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, corruptContent, "utf8");

    const isStoreError = (error) => (
      error?.code === "AUTH_USER_STORE_INVALID"
      && String(error?.filePath || "").endsWith("/data-cache/auth-users.json")
    );
    await assert.rejects(() => listAuthUsers({}), isStoreError);
    await assert.rejects(
      () => createAuthUser({ username: "new.user", password: "strong-password" }),
      isStoreError,
    );
    assert.throws(() => hasManagedAuthUsers(), isStoreError);
    assert.equal(await readFile(storePath, "utf8"), corruptContent);
  });
});
