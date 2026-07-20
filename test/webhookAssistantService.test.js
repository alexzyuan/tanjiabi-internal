import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWebhookAssistantService } from "../src/services/webhookAssistantService.js";

async function withService(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-webhook-assistant-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("webhook assistant stores tasks but lists only masked webhook and secret state", async () => {
  await withService(async (dir) => {
    const service = createWebhookAssistantService({ dataDir: dir });
    const created = await service.createWebhookTask({
      name: "FBA刷仓提醒",
      webhook: "https://oapi.dingtalk.com/robot/send?access_token=secret-token",
      secret: "SECsecret",
      message: "刷仓任务已命中",
      scheduleMode: "daily",
      sendTime: "09:30",
      enabled: true,
    });
    const listed = await service.listWebhookTasks();

    assert.equal(created.task.name, "FBA刷仓提醒");
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].secretConfigured, true);
    assert.equal(listed.tasks[0].webhook.includes("secret-token"), false);
    assert.equal(JSON.stringify(listed).includes("SECsecret"), false);
    assert.equal(listed.tasks[0].nextRunAt.includes("09:30"), true);
  });
});

test("webhook assistant sends due once tasks and disables them after success", async () => {
  await withService(async (dir) => {
    const sent = [];
    const service = createWebhookAssistantService({
      dataDir: dir,
      fetchImpl: async (url, options) => {
        sent.push({ url: String(url), body: JSON.parse(options.body) });
        return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
      },
      now: () => new Date("2026-07-20T10:05:00.000Z"),
    });
    await service.createWebhookTask({
      name: "一次性提醒",
      webhook: "https://oapi.dingtalk.com/robot/send?access_token=once-token",
      message: "一次性发送内容",
      scheduleMode: "once",
      runAt: "2026-07-20T10:00:00.000Z",
      enabled: true,
    });

    const result = await service.runDueWebhookTasks();
    const listed = await service.listWebhookTasks();

    assert.equal(result.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.text.content, "一次性发送内容");
    assert.equal(listed.tasks[0].enabled, false);
    assert.equal(listed.tasks[0].lastStatus, "发送成功");
  });
});
