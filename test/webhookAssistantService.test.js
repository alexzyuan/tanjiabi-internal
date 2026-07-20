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

test("webhook assistant creates tasks from built-in targets without storing webhook secrets", async () => {
  await withService(async (dir) => {
    const service = createWebhookAssistantService({
      dataDir: dir,
      webhookTargets: {
        default: { label: "企业总群", webhook: "https://oapi.dingtalk.com/robot/send?access_token=default-token", secret: "default-secret" },
        "fba-sta": { label: "FBA刷仓", webhook: "https://oapi.dingtalk.com/robot/send?access_token=fba-token", secret: "fba-secret" },
      },
      now: () => new Date("2026-07-20T01:00:00.000Z"),
    });
    const created = await service.createWebhookTask({
      name: "FBA刷仓提醒",
      targetKey: "fba-sta",
      message: "请检查 FBA 刷仓任务",
      atAll: false,
      scheduleMode: "daily",
      sendTime: "09:30",
      enabled: true,
    });
    const listed = await service.listWebhookTasks();

    assert.equal(created.task.name, "FBA刷仓提醒");
    assert.equal(created.task.targetKey, "fba-sta");
    assert.equal(created.task.message, "请检查 FBA 刷仓任务");
    assert.equal(created.task.atAll, false);
    assert.equal(listed.targets.length, 2);
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].targetLabel, "FBA刷仓");
    assert.equal(JSON.stringify(listed).includes("fba-secret"), false);
    assert.equal(JSON.stringify(listed).includes("fba-token"), false);
    assert.equal(listed.tasks[0].nextRunAt, "2026-07-20T09:30:00+08:00");
  });
});

test("webhook assistant sends message content through the selected built-in target and supports at all", async () => {
  await withService(async (dir) => {
    const sent = [];
    let currentTime = new Date("2026-07-20T09:55:00.000+08:00");
    const service = createWebhookAssistantService({
      dataDir: dir,
      webhookTargets: {
        default: { label: "企业总群", webhook: "https://oapi.dingtalk.com/robot/send?access_token=default-token", secret: "default-secret" },
        "fba-sta": { label: "FBA刷仓", webhook: "https://oapi.dingtalk.com/robot/send?access_token=fba-token", secret: "fba-secret" },
      },
      fetchImpl: async (url, options) => {
        sent.push({ url: String(url), body: JSON.parse(options.body) });
        return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
      },
      now: () => currentTime,
    });
    await service.createWebhookTask({
      name: "FBA刷仓提醒",
      targetKey: "fba-sta",
      message: "请检查 FBA 刷仓任务",
      atAll: true,
      scheduleMode: "daily",
      sendTime: "10:00",
      enabled: true,
    });

    currentTime = new Date("2026-07-20T10:05:00.000+08:00");
    const result = await service.runDueWebhookTasks();
    const listed = await service.listWebhookTasks();

    assert.equal(result.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(new URL(sent[0].url).searchParams.get("access_token"), "fba-token");
    assert.equal(sent[0].body.text.content, "请检查 FBA 刷仓任务");
    assert.equal(sent[0].body.at.isAtAll, true);
    assert.equal(listed.tasks[0].enabled, true);
    assert.equal(listed.tasks[0].lastStatus, "发送成功");
  });
});

test("webhook assistant calculates weekly and monthly schedules in Beijing time", async () => {
  await withService(async (dir) => {
    const service = createWebhookAssistantService({
      dataDir: dir,
      webhookTargets: {
        default: { label: "企业总群", webhook: "https://oapi.dingtalk.com/robot/send?access_token=default-token" },
      },
      now: () => new Date("2026-07-20T01:00:00.000Z"),
    });
    const weekly = await service.createWebhookTask({
      name: "每周任务",
      targetKey: "default",
      message: "每周任务内容",
      scheduleMode: "weekly",
      weekday: 3,
      sendTime: "09:00",
    });
    const monthly = await service.createWebhookTask({
      name: "每月任务",
      targetKey: "default",
      message: "每月任务内容",
      scheduleMode: "monthly",
      monthDay: 25,
      sendTime: "09:00",
    });

    assert.equal(weekly.task.nextRunAt, "2026-07-22T09:00:00+08:00");
    assert.equal(monthly.task.nextRunAt, "2026-07-25T09:00:00+08:00");
  });
});

test("webhook assistant exposes configured built-in targets without accepting raw webhook payload fields", async () => {
  await withService(async (dir) => {
    const service = createWebhookAssistantService({
      dataDir: dir,
      webhookTargets: {
        default: { label: "企业总群", webhook: "https://oapi.dingtalk.com/robot/send?access_token=default-token", secret: "default-secret" },
        "fba-sta": { label: "FBA刷仓", webhook: "https://oapi.dingtalk.com/robot/send?access_token=fba-token", secret: "fba-secret" },
      },
      now: () => new Date("2026-07-20T01:00:00.000Z"),
    });

    await service.createWebhookTask({
      name: "企业总群日报",
      targetKey: "default",
      webhook: "https://example.invalid/should-not-store",
      secret: "should-not-store",
      message: "企业总群日报内容",
      atAll: true,
      scheduleMode: "daily",
      sendTime: "09:00",
    });
    const listed = await service.listWebhookTasks();
    const serialized = JSON.stringify(listed);

    assert.deepEqual(listed.targets.map((target) => target.key), ["default", "fba-sta"]);
    assert.equal(listed.tasks[0].targetLabel, "企业总群");
    assert.equal(listed.tasks[0].message, "企业总群日报内容");
    assert.equal(listed.tasks[0].atAll, true);
    assert.equal(serialized.includes("should-not-store"), false);
    assert.equal(serialized.includes("default-secret"), false);
    assert.equal(serialized.includes("default-token"), false);
  });
});
