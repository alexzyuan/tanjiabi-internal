import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalDingtalkLoginRedirect } from "../src/services/dingtalkAuthService.js";

const loginConfig = {
  redirectUri: "https://tanjiabi.cc/api/auth/dingtalk/callback",
};

test("keeps DingTalk login on canonical auth host", () => {
  assert.equal(
    buildCanonicalDingtalkLoginRedirect(loginConfig, "tanjiabi.cc", "/api/auth/dingtalk/login?frame=1"),
    "",
  );
});

test("redirects IP DingTalk login to canonical auth host", () => {
  assert.equal(
    buildCanonicalDingtalkLoginRedirect(loginConfig, "47.107.92.14", "/api/auth/dingtalk/login?frame=1"),
    "https://tanjiabi.cc/api/auth/dingtalk/login?frame=1",
  );
});

test("redirects www DingTalk login to canonical auth host", () => {
  assert.equal(
    buildCanonicalDingtalkLoginRedirect(loginConfig, "www.tanjiabi.cc", "/api/auth/dingtalk/login"),
    "https://tanjiabi.cc/api/auth/dingtalk/login",
  );
});
