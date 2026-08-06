export const fbaLogisticsChannelsByCountry = {
  "美国": [
    { code: "SEA-OA-03", name: "OA直送（包税）" },
    { code: "SEA-MS-31", name: "准时达卡派(包税)" },
    { code: "AIR-US-03", name: "美国空派带电包税(卡派)" },
    { code: "SEA-SS-01", name: "美森闪送卡派（包税）" },
  ],
  "德国": [
    { code: "SEA-BL-22", name: "欧盟递延卡派(不包税)" },
  ],
  "英国": [
    { code: "SEA-BL-22", name: "欧盟递延卡派(不包税)" },
  ],
  "加拿大": [
    { code: "SEA-CA-02", name: "加拿大卡派（包税）" },
    { code: "SEA-CA-42", name: "加东闪送（包税）" },
  ],
  "澳洲": [
    { code: "SEA-AU-01", name: "澳洲卡派（包税）" },
  ],
};

export function normalizeFbaLogisticsCountry(country = "") {
  const text = String(country || "").trim();
  const upper = text.toUpperCase();
  if (["美国", "US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(upper) || text.includes("美国")) return "美国";
  if (["德国", "DE", "DEU", "GERMANY"].includes(upper) || text.includes("德国")) return "德国";
  if (["英国", "GB", "GBR", "UK", "UNITED KINGDOM"].includes(upper) || text.includes("英国")) return "英国";
  if (["加拿大", "CA", "CAN", "CANADA"].includes(upper) || text.includes("加拿大")) return "加拿大";
  if (["澳洲", "澳大利亚", "AU", "AUS", "AUSTRALIA"].includes(upper) || text.includes("澳洲") || text.includes("澳大利亚")) return "澳洲";
  return text;
}

export function fbaLogisticsChannelsForCountry(country = "") {
  return fbaLogisticsChannelsByCountry[normalizeFbaLogisticsCountry(country)] || [];
}

export function fbaLogisticsChannelNamesForCountry(country = "") {
  return fbaLogisticsChannelsForCountry(country).map((channel) => channel.name);
}

export function allFbaLogisticsChannelNames() {
  return [...new Set(Object.values(fbaLogisticsChannelsByCountry).flat().map((channel) => channel.name))];
}
