import assert from "node:assert/strict";
import test from "node:test";
import { sendDingTalkMarkdown, sendDingTalkText } from "../src/services/dingtalkService.js";

test("sendDingTalkText includes configured atMobiles and mention text", async () => {
  const originalFetch = globalThis.fetch;
  process.env.DINGTALK_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=test";
  process.env.DINGTALK_SECRET = "";
  process.env.DINGTALK_AT_MOBILES = "13800138000";
  process.env.DINGTALK_AT_USER_IDS = "manager01";
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
  };
  try {
    const result = await sendDingTalkText("店铺巡检提醒");
    assert.equal(result.ok, true);
    assert.deepEqual(body.at.atMobiles, ["13800138000"]);
    assert.deepEqual(body.at.atUserIds, ["manager01"]);
    assert.match(body.text.content, /@13800138000/);
    assert.match(body.text.content, /@manager01/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DINGTALK_WEBHOOK;
    delete process.env.DINGTALK_SECRET;
    delete process.env.DINGTALK_AT_MOBILES;
    delete process.env.DINGTALK_AT_USER_IDS;
  }
});

test("sendDingTalkMarkdown can override mentions per call", async () => {
  const originalFetch = globalThis.fetch;
  process.env.DINGTALK_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=test";
  process.env.DINGTALK_SECRET = "";
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
  };
  try {
    const result = await sendDingTalkMarkdown({
      title: "店铺巡检",
      text: "新增亚马逊站内信",
      atMobiles: ["13900139000"],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(body.at.atMobiles, ["13900139000"]);
    assert.match(body.markdown.text, /@13900139000/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DINGTALK_WEBHOOK;
    delete process.env.DINGTALK_SECRET;
  }
});

test("sendDingTalkMarkdown can disable configured mentions for an inspection report", async () => {
  const originalFetch = globalThis.fetch;
  process.env.DINGTALK_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=test";
  process.env.DINGTALK_SECRET = "";
  process.env.DINGTALK_AT_MOBILES = "13800138000";
  process.env.DINGTALK_AT_USER_IDS = "manager01";
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
  };
  try {
    const result = await sendDingTalkMarkdown({
      title: "店铺巡检",
      text: "本周低库存费 MSKU：FEE-1。",
      inheritConfiguredMentions: false,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(body.at, { isAtAll: false, atMobiles: [], atUserIds: [] });
    assert.doesNotMatch(body.markdown.text, /@13800138000|@manager01/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DINGTALK_WEBHOOK;
    delete process.env.DINGTALK_SECRET;
    delete process.env.DINGTALK_AT_MOBILES;
    delete process.env.DINGTALK_AT_USER_IDS;
  }
});

test("sendDingTalkMarkdown does not append mentions already placed in markdown", async () => {
  const originalFetch = globalThis.fetch;
  process.env.DINGTALK_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=test";
  process.env.DINGTALK_SECRET = "";
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
  };
  try {
    const result = await sendDingTalkMarkdown({
      title: "店铺巡检",
      text: "## xiamentanjia-US\n负责人：林芃 @manager01\n- 新增 1 封亚马逊站内信。",
      atUserIds: ["manager01"],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(body.at.atUserIds, ["manager01"]);
    assert.equal((body.markdown.text.match(/@manager01/g) || []).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DINGTALK_WEBHOOK;
    delete process.env.DINGTALK_SECRET;
  }
});
