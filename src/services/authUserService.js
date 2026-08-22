import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { readJson, writeJsonAtomic } from "../utils/jsonStore.js";

const scrypt = promisify(crypto.scrypt);
const dataDir = path.join(process.cwd(), "data-cache");
const userStorePath = path.join(dataDir, "auth-users.json");
const dingtalkUserStorePath = path.join(dataDir, "dingtalk-auth-users.json");
const keyLength = 64;
const usernamePattern = /^[a-zA-Z0-9_.@-]{3,40}$/;
const accessRoles = new Set(["子账号", "主账号", "系统管理员"]);

function nowIso() {
  return new Date().toISOString();
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeAccessRole(role) {
  const value = String(role || "").trim();
  if (accessRoles.has(value)) return value;
  if (["系统管理员", "管理员", "admin"].includes(value)) return "系统管理员";
  if (["财务", "主账户", "owner"].includes(value)) return "主账号";
  if (["子账", "子账户", "sub"].includes(value)) return "子账号";
  return "子账号";
}

function normalizeUser(raw) {
  const role = normalizeAccessRole(raw.role);
  const hasExplicitAdminAccess = Object.prototype.hasOwnProperty.call(raw, "adminAccess");
  return {
    username: String(raw.username || "").trim(),
    displayName: String(raw.displayName || raw.nick || raw.username || "").trim(),
    role,
    status: raw.status === "disabled" ? "disabled" : "active",
    adminAccess: hasExplicitAdminAccess
      ? raw.adminAccess === true && role === "系统管理员"
      : role === "系统管理员",
    passwordHash: String(raw.passwordHash || ""),
    salt: String(raw.salt || ""),
    algorithm: raw.algorithm || "scrypt",
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || raw.createdAt || nowIso(),
  };
}

function sanitizeUser(user, extra = {}) {
  return {
    username: user.username,
    displayName: user.displayName || user.username,
    nick: user.displayName || user.username,
    role: normalizeAccessRole(user.role),
    status: user.status || "active",
    adminAccess: Boolean(user.adminAccess),
    source: user.source || "managed",
    readonly: Boolean(user.readonly),
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || "",
    ...extra,
  };
}

function normalizeDingtalkId(value) {
  return String(value || "").trim();
}

function resolveDingtalkId(user) {
  return normalizeDingtalkId(user.unionId) || normalizeDingtalkId(user.openId) || normalizeDingtalkId(user.mobile);
}

function normalizeDingtalkUser(raw) {
  const id = normalizeDingtalkId(raw.id) || resolveDingtalkId(raw);
  const role = normalizeAccessRole(raw.role);
  const hasExplicitAdminAccess = Object.prototype.hasOwnProperty.call(raw, "adminAccess");
  const status = ["active", "disabled", "rejected", "pending"].includes(raw.status) ? raw.status : "pending";
  return {
    id,
    nick: String(raw.nick || raw.displayName || raw.name || "钉钉用户").trim(),
    displayName: String(raw.displayName || raw.nick || raw.name || "钉钉用户").trim(),
    avatarUrl: String(raw.avatarUrl || ""),
    mobile: normalizeDingtalkId(raw.mobile),
    openId: normalizeDingtalkId(raw.openId || raw.openid),
    unionId: normalizeDingtalkId(raw.unionId || raw.unionid),
    role,
    status,
    adminAccess: hasExplicitAdminAccess
      ? raw.adminAccess === true && role === "系统管理员"
      : role === "系统管理员",
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || raw.createdAt || nowIso(),
    lastLoginAt: raw.lastLoginAt || "",
    approvedAt: raw.approvedAt || "",
    source: "dingtalk",
  };
}

function sanitizeDingtalkUser(user, extra = {}) {
  return {
    id: user.id,
    username: user.id,
    nick: user.nick || user.displayName || "钉钉用户",
    displayName: user.displayName || user.nick || "钉钉用户",
    avatarUrl: user.avatarUrl || "",
    mobile: user.mobile || "",
    openId: user.openId || "",
    unionId: user.unionId || "",
    role: normalizeAccessRole(user.role),
    status: user.status || "pending",
    adminAccess: Boolean(user.adminAccess),
    source: "dingtalk",
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || "",
    lastLoginAt: user.lastLoginAt || "",
    approvedAt: user.approvedAt || "",
    ...extra,
  };
}

function invalidAuthUserStore(filePath, cause) {
  const error = new Error(`Auth user store is invalid: ${filePath}`);
  error.name = "AuthUserStoreError";
  error.code = "AUTH_USER_STORE_INVALID";
  error.filePath = filePath;
  error.cause = cause;
  return error;
}

function normalizeStoreUsers(parsed, { filePath, normalize, identityKey }) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.users)) {
    throw invalidAuthUserStore(filePath, new TypeError("Account store must contain a users array."));
  }
  if (parsed.users.some((user) => !user || typeof user !== "object" || Array.isArray(user))) {
    throw invalidAuthUserStore(filePath, new TypeError("Account store users must be objects."));
  }
  return parsed.users.map(normalize).filter((user) => user[identityKey]);
}

function parseUserFile(content, filePath = userStorePath) {
  try {
    return normalizeStoreUsers(JSON.parse(content), {
      filePath,
      normalize: normalizeUser,
      identityKey: "username",
    });
  } catch (error) {
    if (error?.code === "AUTH_USER_STORE_INVALID") throw error;
    throw invalidAuthUserStore(filePath, error);
  }
}

function parseDingtalkUserFile(content, filePath = dingtalkUserStorePath) {
  try {
    return normalizeStoreUsers(JSON.parse(content), {
      filePath,
      normalize: normalizeDingtalkUser,
      identityKey: "id",
    });
  } catch (error) {
    if (error?.code === "AUTH_USER_STORE_INVALID") throw error;
    throw invalidAuthUserStore(filePath, error);
  }
}

async function readManagedUsers() {
  try {
    const parsed = await readJson(userStorePath, { users: [] });
    return normalizeStoreUsers(parsed, {
      filePath: userStorePath,
      normalize: normalizeUser,
      identityKey: "username",
    });
  } catch (error) {
    if (error?.code === "AUTH_USER_STORE_INVALID") throw error;
    throw invalidAuthUserStore(userStorePath, error);
  }
}

async function readDingtalkUsers() {
  try {
    const parsed = await readJson(dingtalkUserStorePath, { users: [] });
    return normalizeStoreUsers(parsed, {
      filePath: dingtalkUserStorePath,
      normalize: normalizeDingtalkUser,
      identityKey: "id",
    });
  } catch (error) {
    if (error?.code === "AUTH_USER_STORE_INVALID") throw error;
    throw invalidAuthUserStore(dingtalkUserStorePath, error);
  }
}

function readManagedUsersSync() {
  if (!existsSync(userStorePath)) return [];
  return parseUserFile(readFileSync(userStorePath, "utf8"));
}

async function writeManagedUsers(users) {
  const sortedUsers = [...users].sort((a, b) => a.username.localeCompare(b.username));
  await writeJsonAtomic(userStorePath, { users: sortedUsers });
}

async function writeDingtalkUsers(users) {
  const sortedUsers = [...users].sort((a, b) => {
    const statusOrder = { pending: 0, active: 1, disabled: 2, rejected: 3 };
    const leftOrder = statusOrder[a.status] ?? 9;
    const rightOrder = statusOrder[b.status] ?? 9;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  await writeJsonAtomic(dingtalkUserStorePath, { users: sortedUsers });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scrypt(String(password || ""), salt, keyLength);
  return {
    algorithm: "scrypt",
    salt,
    passwordHash: derivedKey.toString("hex"),
  };
}

async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt || user.algorithm !== "scrypt") return false;
  const derivedKey = await scrypt(String(password || ""), user.salt, keyLength);
  return timingSafeEqualText(derivedKey.toString("hex"), user.passwordHash);
}

function validateUsername(username) {
  if (!usernamePattern.test(username)) {
    throw new Error("账号需为 3-40 位，只能包含字母、数字、下划线、点、@ 或横线。");
  }
}

export function hasManagedAuthUsers() {
  return readManagedUsersSync().some((user) => user.status !== "disabled");
}

export function validateAuthUserStoresSync() {
  if (existsSync(userStorePath)) parseUserFile(readFileSync(userStorePath, "utf8"), userStorePath);
  if (existsSync(dingtalkUserStorePath)) {
    parseDingtalkUserFile(readFileSync(dingtalkUserStorePath, "utf8"), dingtalkUserStorePath);
  }
}

export async function listAuthUsers(authConfig) {
  const users = (await readManagedUsers()).map((user) => sanitizeUser(user));
  if (authConfig?.local?.username && authConfig?.local?.password) {
    users.unshift({
      username: authConfig.local.username,
      displayName: authConfig.local.username,
      nick: authConfig.local.username,
      role: "系统管理员",
      status: "active",
      adminAccess: true,
      source: "env",
      readonly: true,
      createdAt: "",
      updatedAt: "",
    });
  }
  return users;
}

export async function validatePasswordLogin(authConfig, username, password) {
  const normalizedUsername = String(username || "").trim();
  const users = await readManagedUsers();
  const user = users.find((item) => item.username === normalizedUsername && item.status !== "disabled");
  if (user && await verifyPassword(password, user)) {
    return sanitizeUser(user, { loginType: "password" });
  }

  const envUsername = authConfig?.local?.username;
  const envPassword = authConfig?.local?.password;
  if (envUsername && envPassword && timingSafeEqualText(normalizedUsername, envUsername) && timingSafeEqualText(password, envPassword)) {
    return {
      username: envUsername,
      displayName: envUsername,
      nick: envUsername,
      role: "系统管理员",
      status: "active",
      adminAccess: true,
      source: "env",
      readonly: true,
      loginType: "password",
    };
  }

  return null;
}

export async function createAuthUser(payload) {
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "");
  validateUsername(username);
  if (password.length < 8) throw new Error("密码至少需要 8 位。");

  const users = await readManagedUsers();
  if (users.some((user) => user.username === username)) throw new Error("账号已存在。");

  const passwordFields = await hashPassword(password);
  const user = normalizeUser({
    username,
    displayName: String(payload.displayName || username).trim(),
    role: normalizeAccessRole(payload.role),
    status: payload.status === "disabled" ? "disabled" : "active",
    adminAccess: normalizeAccessRole(payload.role) === "系统管理员",
    ...passwordFields,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  users.push(user);
  await writeManagedUsers(users);
  return sanitizeUser(user);
}

export async function updateAuthUser(username, payload) {
  const targetUsername = String(username || "").trim();
  const users = await readManagedUsers();
  const index = users.findIndex((user) => user.username === targetUsername);
  if (index === -1) throw new Error("账号不存在。");

  const nextUser = {
    ...users[index],
    displayName: String(payload.displayName || users[index].displayName || targetUsername).trim(),
    role: normalizeAccessRole(payload.role || users[index].role),
    status: payload.status === "disabled" ? "disabled" : "active",
    adminAccess: normalizeAccessRole(payload.role || users[index].role) === "系统管理员",
    updatedAt: nowIso(),
  };
  const password = String(payload.password || "");
  if (password) {
    if (password.length < 8) throw new Error("新密码至少需要 8 位。");
    Object.assign(nextUser, await hashPassword(password));
  }

  users[index] = normalizeUser(nextUser);
  await writeManagedUsers(users);
  return sanitizeUser(users[index]);
}

export async function deleteAuthUser(username) {
  const targetUsername = String(username || "").trim();
  const users = await readManagedUsers();
  const nextUsers = users.filter((user) => user.username !== targetUsername);
  if (nextUsers.length === users.length) throw new Error("账号不存在。");
  await writeManagedUsers(nextUsers);
  return { username: targetUsername };
}

function findDingtalkUserIndex(users, dingtalkUserOrId) {
  const id = typeof dingtalkUserOrId === "string" ? normalizeDingtalkId(dingtalkUserOrId) : resolveDingtalkId(dingtalkUserOrId);
  const mobile = typeof dingtalkUserOrId === "string" ? "" : normalizeDingtalkId(dingtalkUserOrId.mobile);
  const openId = typeof dingtalkUserOrId === "string" ? "" : normalizeDingtalkId(dingtalkUserOrId.openId);
  const unionId = typeof dingtalkUserOrId === "string" ? "" : normalizeDingtalkId(dingtalkUserOrId.unionId);
  return users.findIndex((user) => (
    (id && user.id === id)
    || (unionId && user.unionId === unionId)
    || (openId && user.openId === openId)
    || (mobile && user.mobile === mobile)
  ));
}

function isDingtalkUserInEnvAllowList(user, authConfig) {
  const allowedMobiles = new Set(authConfig?.allowedMobiles || []);
  const allowedUnionIds = new Set(authConfig?.allowedUnionIds || []);
  const allowedOpenIds = new Set(authConfig?.allowedOpenIds || []);
  return (
    (user.mobile && allowedMobiles.has(String(user.mobile)))
    || (user.unionId && allowedUnionIds.has(String(user.unionId)))
    || (user.openId && allowedOpenIds.has(String(user.openId)))
  );
}

export async function listDingtalkAuthUsers() {
  return (await readDingtalkUsers()).map((user) => sanitizeDingtalkUser(user));
}

export async function resolveDingtalkLogin(dingtalkUser, authConfig) {
  const id = resolveDingtalkId(dingtalkUser);
  if (!id) {
    return {
      allowed: false,
      reason: "无法识别钉钉身份，请确认钉钉应用已开通 openId/unionId 权限。",
    };
  }

  const users = await readDingtalkUsers();
  const index = findDingtalkUserIndex(users, dingtalkUser);
  const isEnvAllowed = isDingtalkUserInEnvAllowList(dingtalkUser, authConfig);
  const now = nowIso();
  const profile = {
    id,
    nick: dingtalkUser.nick,
    displayName: dingtalkUser.nick,
    avatarUrl: dingtalkUser.avatarUrl,
    mobile: dingtalkUser.mobile,
    openId: dingtalkUser.openId,
    unionId: dingtalkUser.unionId,
    updatedAt: now,
  };

  if (index === -1) {
    const user = normalizeDingtalkUser({
      ...profile,
      status: "active",
      role: "子账号",
      adminAccess: false,
      createdAt: now,
      lastLoginAt: now,
      approvedAt: isEnvAllowed ? now : "",
    });
    users.push(user);
    await writeDingtalkUsers(users);
    return { allowed: true, user: sanitizeDingtalkUser(user, { loginType: "dingtalk" }) };
  }

  const current = normalizeDingtalkUser({
    ...users[index],
    ...profile,
    id: users[index].id || id,
  });

  if ((isEnvAllowed || current.status === "pending") && current.status !== "disabled") {
    current.status = "active";
    current.lastLoginAt = now;
    current.approvedAt = current.approvedAt || now;
  }

  if (current.status === "active") {
    current.lastLoginAt = now;
    users[index] = normalizeDingtalkUser(current);
    await writeDingtalkUsers(users);
    return { allowed: true, user: sanitizeDingtalkUser(users[index], { loginType: "dingtalk" }) };
  }

  users[index] = normalizeDingtalkUser(current);
  await writeDingtalkUsers(users);

  if (current.status === "disabled") {
    return { allowed: false, user: sanitizeDingtalkUser(current), reason: "你的钉钉账号已被禁用，请联系管理员。" };
  }
  if (current.status === "rejected") {
    return { allowed: false, user: sanitizeDingtalkUser(current), reason: "你的钉钉授权申请未通过，请联系管理员。" };
  }
  return { allowed: false, pending: true, user: sanitizeDingtalkUser(current), reason: "你的钉钉账号正在等待管理员审核。" };
}

export async function updateDingtalkAuthUser(id, payload) {
  const users = await readDingtalkUsers();
  const index = findDingtalkUserIndex(users, id);
  if (index === -1) throw new Error("钉钉用户不存在。");

  const nextStatus = ["active", "disabled", "rejected", "pending"].includes(payload.status)
    ? payload.status
    : users[index].status;
  const wasActive = users[index].status === "active";
  const hasAdminAccessChange = Object.prototype.hasOwnProperty.call(payload, "adminAccess");
  const nextUser = normalizeDingtalkUser({
    ...users[index],
    displayName: String(payload.displayName || users[index].displayName || users[index].nick).trim(),
    role: normalizeAccessRole(payload.role || users[index].role),
    status: nextStatus,
    adminAccess: hasAdminAccessChange
      ? payload.adminAccess === true && normalizeAccessRole(payload.role || users[index].role) === "系统管理员"
      : normalizeAccessRole(payload.role || users[index].role) === "系统管理员",
    updatedAt: nowIso(),
    approvedAt: nextStatus === "active" && !wasActive ? nowIso() : users[index].approvedAt,
  });

  users[index] = nextUser;
  await writeDingtalkUsers(users);
  return sanitizeDingtalkUser(nextUser);
}

export async function deleteDingtalkAuthUser(id) {
  const users = await readDingtalkUsers();
  const index = findDingtalkUserIndex(users, id);
  if (index === -1) throw new Error("钉钉用户不存在。");
  const [user] = users.splice(index, 1);
  await writeDingtalkUsers(users);
  return sanitizeDingtalkUser(user);
}
