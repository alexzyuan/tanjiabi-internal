import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildLowInventoryFeeInspectionSummary,
  buildDingTalkContent,
  buildErpBuyerMessagesInspectionSummary,
  buildErpBuyerMessagesRequestParams,
  buildErpBuyerMessagesRequestParamsList,
  buildStoreInspectionMentionText,
  buildStoreInspectionMarkdown,
  recomputeInspectionOverall,
  lowInventoryFeeInspectionError,
  storeInspectionMentionUserIds,
} from "../src/services/storeInspectionService.js";

const execFile = promisify(execFileCallback);

const mentionConfig = {
  storeInspection: {
    dingtalkUsers: {
      "林芃": "2221374053956163143",
      "熊丹轩": "361967580828589914",
      "黄超": "22381010461296193",
    },
    storeOwners: {
      "xiamentanjia-us": "林芃",
      "tandanbo-us": "熊丹轩",
      "tandanbo-au": "黄超",
    },
  },
};

test("buildErpBuyerMessagesInspectionSummary reports only messages not seen in previous inspection", () => {
  const summary = buildErpBuyerMessagesInspectionSummary([
    {
      id: "m-2",
      seller_name: "JOI MEW-US",
      subject: "Replacement request",
      content: "The boat remote does not work.",
      buyer_name: "Robert",
      create_time: "2026-06-30 08:10:00",
    },
    {
      id: "m-1",
      seller_name: "JOI MEW-US",
      subject: "Old question",
      content: "Already reviewed yesterday.",
      buyer_name: "Carol",
      create_time: "2026-06-29 10:00:00",
    },
  ], [
    {
      messageId: "m-1",
      storeName: "JOI MEW-US",
      subject: "Old question",
      content: "Already reviewed yesterday.",
      from: "Carol",
      createdAt: "2026-06-29 10:00:00",
    },
  ]);

  assert.equal(summary.status, "risk");
  assert.equal(summary.count, 1);
  assert.equal(summary.total, 2);
  assert.match(summary.detail, /新增 1 封 ERP 售后邮件/);
  assert.equal(summary.rows[0].item, "Replacement request");
});

test("buildErpBuyerMessagesInspectionSummary maps Lingxing webmail fields", () => {
  const summary = buildErpBuyerMessagesInspectionSummary([
    {
      webmail_uuid: "118717434394704384",
      date: "2026-06-30 14:56:54",
      subject: "Product details inquiry from Amazon customer Cherri",
      from_name: "Cherri",
      from_address: "buyer@example.com",
      to_address: "joimew@163.com",
      has_attachment: 1,
    },
  ], []);

  assert.equal(summary.rows[0].messageId, "118717434394704384");
  assert.equal(summary.rows[0].createdAt, "2026-06-30 14:56:54");
  assert.equal(summary.rows[0].from, "Cherri");
  assert.equal(summary.rows[0].storeName, "joimew@163.com");
});

test("buildErpBuyerMessagesInspectionSummary keeps the full snapshot for large mailboxes", () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({
    webmail_uuid: `mail-${index}`,
    date: `2026-06-${String((index % 28) + 1).padStart(2, "0")} 08:00:00`,
    subject: `Customer mail ${index}`,
    from_name: `Buyer ${index}`,
    to_address: "joimew@163.com",
  }));
  const first = buildErpBuyerMessagesInspectionSummary(rows, []);
  const second = buildErpBuyerMessagesInspectionSummary(rows, first.snapshotRows);

  assert.equal(first.snapshotRows.length, 250);
  assert.equal(second.count, 0);
});

test("buildErpBuyerMessagesInspectionSummary can report recent Amazon buyer messages without history baseline", () => {
  const summary = buildErpBuyerMessagesInspectionSummary([
    {
      webmail_uuid: "buyer-1",
      date: "2026-06-30 14:56:54",
      subject: "Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
      from_name: "Cherri",
      from_address: "sz2y5ywh1qg1vhx+133a066e@marketplace.amazon.com",
      to_address: "joimew@163.com",
    },
    {
      webmail_uuid: "buyer-2",
      date: "2026-06-30 07:50:34",
      subject: "Product details inquiry from Amazon customer carol (Order: 113-0273723-9215468)",
      from_name: "carol",
      from_address: "th6wqr1vf6dr43f@marketplace.amazon.com",
      to_address: "joimew@163.com",
    },
    {
      webmail_uuid: "system-1",
      date: "2026-07-01 04:13:21",
      subject: "[Case ID 3356166973] *UPDATE* 其他账户问题",
      from_name: "merch.service05@amazon.com.au",
      from_address: "merch.service05@amazon.com.au",
      to_address: "joimew@163.com",
    },
    {
      webmail_uuid: "old-buyer",
      date: "2026-06-29 10:00:00",
      subject: "Inquiry from Amazon customer Beverly",
      from_name: "Beverly",
      from_address: "buyer@marketplace.amazon.com",
      to_address: "joimew@163.com",
    },
  ], [
    {
      messageId: "buyer-1",
      storeName: "joimew@163.com",
      subject: "Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
      from: "Cherri",
      createdAt: "2026-06-30 14:56:54",
      content: "old baseline",
    },
  ], {
    mode: "current",
    stationMessagesOnly: true,
    startDate: "2026-06-30",
  });

  assert.equal(summary.count, 2);
  assert.equal(summary.total, 2);
  assert.match(summary.detail, /近 2 天新增 2 封亚马逊站内信/);
  assert.deepEqual(summary.rows.map((row) => row.messageId), ["buyer-1", "buyer-2"]);
});

test("buildErpBuyerMessagesInspectionSummary excludes messages replied from NetEase sent mailbox", () => {
  const summary = buildErpBuyerMessagesInspectionSummary([
    {
      webmail_uuid: "buyer-1",
      date: "2026-06-30 14:56:54",
      subject: "Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
      from_name: "Cherri",
      from_address: "sz2y5ywh1qg1vhx+133a066e@marketplace.amazon.com",
      to_address: "joimew@163.com",
      _replyStatus: "replied",
      _replySentAt: "2026-06-30 15:10:00",
    },
    {
      webmail_uuid: "buyer-2",
      date: "2026-06-30 07:50:34",
      subject: "Product details inquiry from Amazon customer carol (Order: 113-0273723-9215468)",
      from_name: "carol",
      from_address: "th6wqr1vf6dr43f@marketplace.amazon.com",
      to_address: "joimew@163.com",
      _replyStatus: "pending",
    },
  ], [], {
    mode: "current",
    stationMessagesOnly: true,
    excludeReplied: true,
    startDate: "2026-06-30",
    recentDays: 2,
  });

  assert.equal(summary.count, 1);
  assert.equal(summary.total, 2);
  assert.equal(summary.repliedCount, 1);
  assert.match(summary.detail, /1 封已匹配网易已发送回复/);
  assert.deepEqual(summary.rows.map((row) => row.messageId), ["buyer-2"]);
});

test("buildErpBuyerMessagesRequestParams uses Lingxing Service mail list parameters", () => {
  const params = buildErpBuyerMessagesRequestParams({
    lingxing: {
      buyerMessageFlag: "receive",
      buyerMessageEmail: "jmcustomer@163.com",
    },
  }, {
    startDate: "2026-06-30",
    endDate: "2026-06-30",
  });

  assert.deepEqual(params, {
    flag: "receive",
    email: "jmcustomer@163.com",
    start_date: "2026-06-30",
    end_date: "2026-06-30",
  });
  assert.equal("sids" in params, false);
});

test("buildErpBuyerMessagesRequestParams defaults to received mail", () => {
  const params = buildErpBuyerMessagesRequestParams({ lingxing: { buyerMessageEmail: "service@example.com" } }, {
    startDate: "2026-06-29",
    endDate: "2026-06-30",
  });

  assert.equal(params.flag, "receive");
  assert.equal(params.email, "service@example.com");
});

test("buildErpBuyerMessagesRequestParamsList supports multiple ERP-bound mailboxes", () => {
  const paramsList = buildErpBuyerMessagesRequestParamsList({
    lingxing: {
      buyerMessageFlag: "receive",
      buyerMessageEmail: "fallback@example.com",
      buyerMessageEmails: ["store-us@example.com", "store-de@example.com", "store-us@example.com"],
    },
  }, {
    startDate: "2026-06-30",
    endDate: "2026-07-01",
  });

  assert.deepEqual(paramsList, [
    {
      flag: "receive",
      email: "store-us@example.com",
      start_date: "2026-06-30",
      end_date: "2026-07-01",
    },
    {
      flag: "receive",
      email: "store-de@example.com",
      start_date: "2026-06-30",
      end_date: "2026-07-01",
    },
    {
      flag: "receive",
      email: "fallback@example.com",
      start_date: "2026-06-30",
      end_date: "2026-07-01",
    },
  ]);
});

test("buildLowInventoryFeeInspectionSummary keeps only fee-eligible rows with store and MSKU", () => {
  const summary = buildLowInventoryFeeInspectionSummary({
    rows: [
      { storeName: "xiamentanjia-US", country: "美国", msku: "fee-eligible", amazonFeeEligible: true, feeAmount: 3.2 },
      { storeName: "xiamentanjia-US", country: "美国", msku: "early-warning", amazonFeeEligible: false },
      { storeName: "", country: "美国", msku: "missing-store", amazonFeeEligible: true },
      { storeName: "tandanbo-US", country: "美国", msku: "", amazonFeeEligible: true },
    ],
  });

  assert.deepEqual(summary, {
    key: "lowInventoryFee",
    label: "低库存费 MSKU",
    status: "risk",
    tone: "danger",
    count: 1,
    detail: "本周 1 个 MSKU 已进入低库存费区间。",
    rows: [{ storeName: "xiamentanjia-US", country: "美国", msku: "fee-eligible" }],
  });
});

test("lowInventoryFeeInspectionError returns the low inventory fee error contract", () => {
  assert.deepEqual(lowInventoryFeeInspectionError(new Error("dashboard unavailable")), {
    key: "lowInventoryFee",
    label: "低库存费 MSKU",
    status: "error",
    tone: "danger",
    count: 0,
    detail: "dashboard unavailable",
    rows: [],
  });
});

test("lowInventoryFeeInspectionError uses the fallback detail without an error object", () => {
  const summary = lowInventoryFeeInspectionError(undefined);

  assert.equal(summary.status, "error");
  assert.equal(summary.count, 0);
  assert.equal(summary.detail, "低库存费看板读取失败");
});

test("low inventory fee risks require action without notifying store owners", () => {
  const result = recomputeInspectionOverall({
    feedback: { status: "ok", count: 0, rows: [] },
    review: { status: "ok", count: 0, rows: [] },
    voiceOfBuyer: { status: "ok", count: 0, rows: [] },
    accountHealth: { status: "ok", count: 0, rows: [] },
    erpBuyerMessages: { status: "ok", count: 0, rows: [] },
    aftersalesMail: { status: "ok", count: 0, newCount: 0, rows: [] },
    lowInventoryFee: buildLowInventoryFeeInspectionSummary({
      rows: [{ storeName: "xiamentanjia-US", country: "美国", msku: "fee-eligible", amazonFeeEligible: true }],
    }),
  });

  assert.equal(result.overallLabel, "需处理");
  assert.equal(buildStoreInspectionMentionText(result, mentionConfig), "");
  assert.deepEqual(storeInspectionMentionUserIds(result, mentionConfig), []);
});

test("mock store inspection uses the deterministic low inventory fee dashboard", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "store-inspection-test-"));
  const serviceUrl = path.join(process.cwd(), "src/services/storeInspectionService.js");
  const script = [
    `import { runStoreInspection } from ${JSON.stringify(serviceUrl)};`,
    "const result = await runStoreInspection({ notify: false });",
    "console.log(JSON.stringify(result.lowInventoryFee));",
  ].join("\n");
  try {
    const { stdout } = await execFile(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: tempDir,
      env: { ...process.env, DATA_PROVIDER: "mock" },
    });
    const lowInventoryFee = JSON.parse(stdout);

    assert.equal(lowInventoryFee.status, "risk");
    assert.equal(lowInventoryFee.count, 1);
    assert.deepEqual(lowInventoryFee.rows, [{
      storeName: "xiamentanjia-US",
      country: "美国",
      msku: "JM-DGC-BLUE",
    }]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("buildStoreInspectionMarkdown reports fee-only stores without notifying their owners", () => {
  const result = {
    meta: {
      storeCount: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      updatedAt: "2026/7/1 08:30:00",
    },
    feedback: { rows: [], storeStats: [] },
    review: { rows: [], storeStats: [] },
    voiceOfBuyer: { rows: [], storeStats: [] },
    accountHealth: { rows: [], storeStats: [] },
    erpBuyerMessages: { rows: [] },
    aftersalesMail: { detail: "无待回复邮件。", newCount: 0, rows: [] },
    lowInventoryFee: {
      rows: [
        { storeName: "xiamentanjia-US", country: "美国", msku: "FEE-2" },
        { storeName: "xiamentanjia-US", country: "美国", msku: "FEE-1" },
        { storeName: "xiamentanjia-US", country: "美国", msku: "FEE-2" },
      ],
    },
  };

  const markdown = buildStoreInspectionMarkdown(result, [], mentionConfig);

  assert.match(markdown, /## xiamentanjia-US[\s\S]*- 本周低库存费 MSKU：FEE-2、FEE-1。/);
  assert.equal(buildStoreInspectionMentionText(result, mentionConfig), "");
  assert.deepEqual(storeInspectionMentionUserIds(result, mentionConfig), []);
});

test("buildStoreInspectionMarkdown names low inventory fee failures with their exact detail", () => {
  const markdown = buildStoreInspectionMarkdown({
    meta: {
      storeCount: 0,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      updatedAt: "2026/7/1 08:30:00",
    },
    feedback: { rows: [], storeStats: [] },
    review: { rows: [], storeStats: [] },
    voiceOfBuyer: { rows: [], storeStats: [] },
    accountHealth: { rows: [], storeStats: [] },
    erpBuyerMessages: { rows: [] },
    aftersalesMail: { detail: "无待回复邮件。", newCount: 0, rows: [] },
    lowInventoryFee: lowInventoryFeeInspectionError(new Error("低库存费看板请求超时")),
  }, [], mentionConfig);

  assert.match(markdown, /## 低库存费 MSKU 巡检失败/);
  assert.match(markdown, /低库存费 MSKU 看板读取失败：低库存费看板请求超时/);
});

test("buildStoreInspectionMarkdown keeps Amazon station messages inside store sections", () => {
  const markdown = buildStoreInspectionMarkdown({
    meta: {
      storeCount: 1,
      startDate: "2026-06-30",
      endDate: "2026-06-30",
      updatedAt: "2026/6/30 08:30:00",
      stores: [{ name: "xiamentanjia-US", country: "美国" }],
    },
    feedback: { rows: [], storeStats: [] },
    review: { rows: [], storeStats: [] },
    accountHealth: { rows: [], storeStats: [] },
    erpBuyerMessages: {
      detail: "近 2 天新增 1 封亚马逊站内信。",
      rows: [{ storeName: "xiamentanjia-US", type: "新邮件", item: "Replacement request", detail: "Robert · The boat remote does not work." }],
    },
    aftersalesMail: {
      detail: "新增 1 封，待回复 1 封，最近同步 2026/6/30 08:30:00。",
      rows: [{ type: "新邮件", item: "Boat will not turn on", detail: "Rob · Where is the on switch?" }],
    },
  }, [], mentionConfig);

  assert.doesNotMatch(markdown, /## ERP 售后邮件/);
  assert.match(markdown, /## xiamentanjia-US/);
  assert.match(markdown, /## xiamentanjia-US\n负责人：林芃/);
  assert.doesNotMatch(markdown, /@2221374053956163143/);
  assert.match(markdown, /新增 .*1.* 封亚马逊站内信/);
  assert.doesNotMatch(markdown, /Replacement request/);
  assert.doesNotMatch(markdown, /The boat remote does not work/);
  assert.match(markdown, /## 站外售后邮箱/);
  assert.match(markdown, /## 站外售后邮箱\n负责人：林芃/);
  assert.match(markdown, /Boat will not turn on/);
  assert.doesNotMatch(markdown, /Where is the on switch/);
});

test("buildStoreInspectionMarkdown rolls Amazon station messages into store sections", () => {
  const markdown = buildStoreInspectionMarkdown({
    meta: {
      storeCount: 1,
      startDate: "2026-06-30",
      endDate: "2026-07-01",
      updatedAt: "2026/7/1 08:30:00",
      stores: [{ name: "xiamentanjia-US", country: "美国" }],
    },
    feedback: { rows: [], storeStats: [] },
    review: { rows: [], storeStats: [] },
    accountHealth: { rows: [], storeStats: [] },
    erpBuyerMessages: {
      detail: "近 2 天新增 2 封亚马逊站内信。",
      rows: [
        { storeName: "xiamentanjia-US", item: "Product details inquiry from Amazon customer Cherri", detail: "Cherri · body" },
        { storeName: "xiamentanjia-US", item: "Product details inquiry from Amazon customer carol", detail: "carol · body" },
      ],
    },
    aftersalesMail: { detail: "无待回复邮件。", rows: [] },
  }, [], mentionConfig);

  assert.match(markdown, /## xiamentanjia-US/);
  assert.match(markdown, /## xiamentanjia-US\n负责人：林芃/);
  assert.doesNotMatch(markdown, /@2221374053956163143/);
  assert.match(markdown, /新增 .*2.* 封亚马逊站内信/);
  assert.doesNotMatch(markdown, /## ERP 售后邮件/);
  assert.doesNotMatch(markdown, /Cherri · body/);
});

test("buildStoreInspectionMarkdown places owner mentions under each affected store", () => {
  const markdown = buildStoreInspectionMarkdown({
    meta: {
      storeCount: 2,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      updatedAt: "2026/7/1 08:30:00",
      stores: [
        { name: "xiamentanjia-US", country: "美国" },
        { name: "tandanbo-US", country: "美国" },
      ],
    },
    feedback: { rows: [], storeStats: [] },
    review: { rows: [], storeStats: [] },
    accountHealth: { rows: [], storeStats: [] },
    erpBuyerMessages: {
      detail: "近 2 天新增 2 封亚马逊站内信。",
      rows: [
        { storeName: "xiamentanjia-US", item: "Product details inquiry from Amazon customer Cherri" },
        { storeName: "tandanbo-US", item: "Inquiry from Amazon customer Bob" },
      ],
    },
    aftersalesMail: { detail: "无待回复邮件。", newCount: 0, rows: [] },
  }, [], mentionConfig);

  assert.match(markdown, /## xiamentanjia-US\n负责人：林芃\n\n- feedback 和 review 无待处理。\n- 新增 .*1.* 封亚马逊站内信/);
  assert.match(markdown, /## tandanbo-US\n负责人：熊丹轩\n\n- feedback 和 review 无待处理。\n- 新增 .*1.* 封亚马逊站内信/);
  assert.doesNotMatch(markdown, /@2221374053956163143/);
  assert.doesNotMatch(markdown, /@361967580828589914/);
});

test("buildStoreInspectionMentionText renders real text mentions by affected store", () => {
  const result = {
    feedback: { rows: [] },
    review: { rows: [] },
    voiceOfBuyer: { rows: [] },
    accountHealth: { rows: [] },
    erpBuyerMessages: {
      rows: [
        { storeName: "xiamentanjia-US", item: "Product details inquiry from Amazon customer Cherri" },
        { storeName: "tandanbo-US", item: "Inquiry from Amazon customer Bob" },
      ],
    },
    aftersalesMail: { detail: "无待回复邮件。", newCount: 0, rows: [] },
  };

  const text = buildStoreInspectionMentionText(result, mentionConfig);

  assert.match(text, /店铺巡检负责人提醒/);
  assert.match(text, /xiamentanjia-US：林芃 @2221374053956163143/);
  assert.match(text, /tandanbo-US：熊丹轩 @361967580828589914/);
});

test("buildStoreInspectionMentionText skips stores with only existing account health issues", () => {
  const latest = {
    feedback: { rows: [] },
    review: { rows: [] },
    voiceOfBuyer: { rows: [] },
    accountHealth: {
      rows: [{ storeName: "tandanbo-US", policyCount: 2, content: "2 条合规问题待处理" }],
      storeStats: [{ storeName: "tandanbo-US", policyCount: 2 }],
    },
    erpBuyerMessages: { rows: [] },
    aftersalesMail: { detail: "无待回复邮件。", newCount: 0, rows: [] },
  };
  const previous = {
    accountHealth: {
      rows: [{ storeName: "tandanbo-US", policyCount: 2, content: "2 条合规问题待处理" }],
      storeStats: [{ storeName: "tandanbo-US", policyCount: 2 }],
    },
  };

  assert.equal(buildStoreInspectionMentionText(latest, mentionConfig, previous), "");
  assert.deepEqual(storeInspectionMentionUserIds(latest, mentionConfig, previous), []);
});

test("buildDingTalkContent groups Amazon station messages by store", () => {
  const text = buildDingTalkContent({
    feedback: { count: 0, rows: [] },
    review: { lowCount: 0, rows: [] },
    voiceOfBuyer: { count: 0, rows: [] },
    accountHealth: { count: 0, rows: [] },
    erpBuyerMessages: {
      count: 3,
      rows: [
        { storeName: "xiamentanjia-US", item: "Product details inquiry from Amazon customer Cherri" },
        { storeName: "xiamentanjia-US", item: "Product details inquiry from Amazon customer carol" },
        { storeName: "tandanbo-US", item: "Inquiry from Amazon customer Bob" },
      ],
    },
    aftersalesMail: { count: 0, newCount: 0, rows: [] },
    checks: [],
    meta: { updatedAt: "2026/7/1 08:30:00", startDate: "2026-07-01", endDate: "2026-07-01", storeCount: 2 },
    overallLabel: "需处理",
  });

  assert.match(text, /xiamentanjia-US：新增 2 封亚马逊站内信/);
  assert.match(text, /tandanbo-US：新增 1 封亚马逊站内信/);
  assert.doesNotMatch(text, /ERP 站内信：待处理/);
});

test("buildDingTalkContent only includes mail subjects in inspection reminders", () => {
  const text = buildDingTalkContent({
    feedback: { count: 0, rows: [] },
    review: { lowCount: 0, rows: [] },
    voiceOfBuyer: { count: 0, rows: [] },
    accountHealth: { count: 0, rows: [] },
    erpBuyerMessages: {
      count: 1,
      rows: [{ storeName: "JM-DE", item: "Replacement request", detail: "Robert · The boat remote does not work." }],
    },
    aftersalesMail: {
      count: 1,
      newCount: 1,
      rows: [{ type: "新邮件", item: "Boat will not turn on", detail: "Rob · Where is the on switch?" }],
    },
    checks: [],
    meta: { updatedAt: "2026/7/1 08:30:00", startDate: "2026-07-01", endDate: "2026-07-01", storeCount: 1 },
    overallLabel: "需处理",
  });

  assert.match(text, /JM-DE：新增 1 封亚马逊站内信/);
  assert.doesNotMatch(text, /Replacement request/);
  assert.match(text, /Boat will not turn on/);
  assert.doesNotMatch(text, /remote does not work/);
  assert.doesNotMatch(text, /Where is the on switch/);
});

test("storeInspectionMentionUserIds maps new store issues to DingTalk owners", () => {
  const ids = storeInspectionMentionUserIds({
    feedback: { rows: [{ storeName: "xiamentanjia-US" }] },
    review: { rows: [{ storeName: "xiamentanjia-CA" }] },
    voiceOfBuyer: { rows: [] },
    accountHealth: { rows: [] },
    erpBuyerMessages: { rows: [{ storeName: "tandanbo-AU" }] },
    aftersalesMail: { newCount: 0, rows: [] },
  }, {
    storeInspection: {
      dingtalkUsers: {
        "林芃": "2221374053956163143",
        "熊丹轩": "361967580828589914",
        "黄超": "22381010461296193",
      },
      storeOwners: {
        "xiamentanjia-us": "林芃",
        "xiamentanjia-ca": "熊丹轩",
        "tandanbo-au": "黄超",
      },
    },
  });

  assert.deepEqual(ids, [
    "2221374053956163143",
    "361967580828589914",
    "22381010461296193",
  ]);
});

test("storeInspectionMentionUserIds mentions Lin Peng for new offsite aftersales mail", () => {
  const ids = storeInspectionMentionUserIds({
    feedback: { rows: [] },
    review: { rows: [] },
    voiceOfBuyer: { rows: [] },
    accountHealth: { rows: [] },
    erpBuyerMessages: { rows: [] },
    aftersalesMail: { newCount: 1, rows: [{ type: "新邮件", item: "Boat will not turn on" }] },
  }, {
    storeInspection: {
      dingtalkUsers: {
        "林芃": "2221374053956163143",
      },
      storeOwners: {},
    },
  });

  assert.deepEqual(ids, ["2221374053956163143"]);
});

test("storeInspectionMentionUserIds does not mention anyone when there are no new store rows", () => {
  assert.deepEqual(storeInspectionMentionUserIds({
    feedback: { rows: [] },
    review: { rows: [] },
    voiceOfBuyer: { rows: [] },
    accountHealth: { rows: [] },
    erpBuyerMessages: { rows: [] },
    aftersalesMail: { newCount: 0, rows: [{ type: "待回复", item: "Old mail" }] },
  }), []);
});
