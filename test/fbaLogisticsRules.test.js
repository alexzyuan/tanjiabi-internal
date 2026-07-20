import assert from "node:assert/strict";
import test from "node:test";
import {
  fbaLogisticsChannelNamesForCountry as frontendChannelNamesForCountry,
  fbaLogisticsChannelsForCountry as frontendChannelsForCountry,
} from "../assets/js/fba-logistics-rules.js";
import {
  fbaLogisticsChannelNamesForCountry as backendChannelNamesForCountry,
  fbaLogisticsChannelsForCountry as backendChannelsForCountry,
} from "../src/services/fbaLogisticsRules.js";
import { freightRateOptions } from "../src/services/freightRateService.js";

const expectedChannelsByCountry = {
  美国: [
    "OA直送（包税）",
    "准时达卡派(包税)",
    "美国空派带电包税(卡派)",
    "美森闪送卡派（包税）",
  ],
  加拿大: ["加拿大卡派（包税）", "加东闪送（包税）"],
  澳洲: ["澳洲卡派（包税）"],
  德国: ["欧盟递延卡派(不包税)"],
  英国: ["欧盟递延卡派(不包税)"],
};

test("FBA logistics channel selectors stay country-scoped on frontend and backend", () => {
  for (const [country, expectedNames] of Object.entries(expectedChannelsByCountry)) {
    assert.deepEqual(frontendChannelNamesForCountry(country), expectedNames);
    assert.deepEqual(backendChannelNamesForCountry(country), expectedNames);
    assert.deepEqual(
      freightRateOptions.channelNamesByCountry[country],
      expectedNames,
      `${country} 运费看板渠道选项必须沿用共享物流规则`,
    );
  }
});

test("FBA freight order channel codes stay aligned with Jiufang choices", () => {
  assert.deepEqual(frontendChannelsForCountry("美国").map((channel) => channel.code), ["SEA-OA-03", "SEA-MS-31", "AIR-US-03", "SEA-SS-01"]);
  assert.deepEqual(backendChannelsForCountry("加拿大").map((channel) => channel.code), ["SEA-CA-02", "SEA-CA-42"]);
  assert.deepEqual(backendChannelsForCountry("澳洲").map((channel) => channel.code), ["SEA-AU-01"]);
});

test("freight rate warehouse selectors keep fixed North America and Australia options", () => {
  assert.deepEqual(freightRateOptions.warehouseCodesByCountry.美国, ["MIT", "GEU", "POC", "TCY", "ONT", "GYR"]);
  assert.deepEqual(freightRateOptions.warehouseCodesByCountry.加拿大, ["YYZ", "YUX", "YOW", "YYC", "YVR", "YEG", "YHM"]);
  assert.deepEqual(freightRateOptions.warehouseCodesByCountry.澳洲, ["BWU", "XAU", "XBW"]);
  assert.equal(Object.hasOwn(freightRateOptions.warehouseCodesByCountry, "德国"), false);
  assert.equal(Object.hasOwn(freightRateOptions.warehouseCodesByCountry, "英国"), false);
});
