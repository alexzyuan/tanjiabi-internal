import assert from "node:assert/strict";
import test from "node:test";

import {
  getFbaShipmentVariances,
  normalizeFbaShipmentVarianceFilters,
} from "../src/services/fbaShipmentVarianceService.js";

const now = new Date("2026-08-03T12:00:00.000Z");

test("variance filters default to the latest 30 calendar days", () => {
  assert.deepEqual(normalizeFbaShipmentVarianceFilters({}, { now }), {
    startDate: "2026-07-05",
    endDate: "2026-08-03",
    sids: [],
    shipmentId: "",
    shipmentStatus: "RECEIVING,CLOSED",
    followupStatus: "",
    offset: 0,
    length: 100,
    forceRefresh: false,
  });
});

test("variance service aggregates SKU quantities and only starts the internal SLA for closed shortages", async () => {
  const candidateCalls = [];
  const result = await getFbaShipmentVariances({}, {
    now,
    getCandidates: async (filters) => {
      candidateCalls.push(filters);
      return {
        rows: [
          {
            sid: 1,
            shipmentId: "RECEIVING-1",
            shipmentStatus: "receiving",
            items: [{ shippedQuantity: 10, receivedQuantity: 7 }],
          },
          {
            sid: 2,
            shipmentId: "CLOSED-1",
            shipmentStatus: "CLOSED",
            closedAt: "2026-08-01T12:00:00.000Z",
            items: [
              { msku: "A", shippedQuantity: 10, receivedQuantity: 8 },
              { msku: "B", shippedQuantity: 5, receivedQuantity: 5 },
            ],
          },
          {
            sid: 3,
            shipmentId: "CLOSED-MATCHED",
            shipmentStatus: "CLOSED",
            closedAt: "2026-08-01T12:00:00.000Z",
            items: [{ shippedQuantity: 10, receivedQuantity: 10 }],
          },
          {
            sid: 4,
            shipmentId: "CLOSED-MISSING-TIME",
            shipmentStatus: "CLOSED",
            items: [{ shippedQuantity: 10, receivedQuantity: 8 }],
          },
        ],
      };
    },
    listFollowups: async () => new Map([["2:CLOSED-1", {
      sid: 2,
      shipmentId: "CLOSED-1",
      followedUp: true,
      followedUpAt: "2026-08-03T08:00:00.000Z",
      followedUpBy: "Alice",
    }]]),
  });

  assert.equal(candidateCalls.length, 1);
  assert.equal(candidateCalls[0].startDate, "2026-07-05");
  assert.equal(candidateCalls[0].endDate, "2026-08-03");
  assert.equal(result.rows[0].investigationStatus, "收货中");
  assert.equal(result.rows[0].sla.status, "not-applicable");
  assert.equal(result.rows[1].shippedQuantity, 15);
  assert.equal(result.rows[1].receivedQuantity, 13);
  assert.equal(result.rows[1].differenceQuantity, 2);
  assert.equal(result.rows[1].investigationStatus, "待调查");
  assert.equal(result.rows[1].sla.deadlineAt, "2026-08-08T12:00:00.000Z");
  assert.equal(result.rows[1].sla.display, "还剩 5 天 0 小时");
  assert.equal(result.rows[1].followup.followedUp, true);
  assert.equal(result.rows[2].investigationStatus, "收发一致");
  assert.equal(result.rows[2].sla.status, "not-applicable");
  assert.equal(result.rows[3].sla.status, "unavailable");
  assert.equal(result.rows[3].sla.display, "缺少关闭时间，无法计算内部 SLA");
  assert.deepEqual(result.summary, {
    receiving: 1,
    closedShortage: 2,
    dueWithinSevenDays: 1,
    overdue: 0,
  });
});

test("variance service filters followed-up and overdue investigation rows", async () => {
  const result = await getFbaShipmentVariances({ followupStatus: "overdue" }, {
    now,
    getCandidates: async () => ({
      rows: [
        {
          sid: 2,
          shipmentId: "OVERDUE-1",
          shipmentStatus: "CLOSED",
          closedAt: "2026-07-20T12:00:00.000Z",
          items: [{ shippedQuantity: 10, receivedQuantity: 8 }],
        },
        {
          sid: 3,
          shipmentId: "FOLLOWED-1",
          shipmentStatus: "CLOSED",
          closedAt: "2026-08-01T12:00:00.000Z",
          items: [{ shippedQuantity: 10, receivedQuantity: 8 }],
        },
      ],
    }),
    listFollowups: async () => new Map([["3:FOLLOWED-1", { followedUp: true }]]),
  });

  assert.deepEqual(result.rows.map((row) => row.shipmentId), ["OVERDUE-1"]);
  assert.equal(result.rows[0].sla.display, "已超时 7 天 0 小时");
});
