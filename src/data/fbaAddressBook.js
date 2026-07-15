import { readEnv } from "../config/index.js";

function envText(key, fallback = "") {
  return String(readEnv(key, fallback) || "").trim();
}

export const fbaAddressProfiles = {
  tandanbo: {
    key: "tandanbo",
    label: "坦蛋伯发货地址",
    shipperName: "Xiamen tandanbo wangluokeji youxiangongsi",
    companyName: "Xiamen tandanbo wangluokeji youxiangongsi",
    companyNameCn: envText("FBA_TANDANBO_COMPANY_NAME_CN"),
    enterpriseCreditCode: envText("FBA_TANDANBO_ENTERPRISE_CREDIT_CODE"),
    addressLine1: envText("FBA_TANDANBO_ADDRESS_LINE1", "Room 623-40, No. 89, Anling 2nd Road"),
    addressLine2: envText("FBA_TANDANBO_ADDRESS_LINE2"),
    city: envText("FBA_TANDANBO_CITY", "Xiamen"),
    stateOrProvinceCode: envText("FBA_TANDANBO_STATE_PROVINCE", "Fujian"),
    postalCode: envText("FBA_TANDANBO_POSTAL_CODE", "361006"),
    countryCode: "CN",
    phoneNumber: "8615759601196",
  },
  xiamentanjia: {
    key: "xiamentanjia",
    label: "厦门探嘉发货地址",
    shipperName: "Xiamen Tanjia wangluo keji youxian gongsi",
    companyName: "Xiamen Tanjia wangluo keji youxian gongsi",
    companyNameCn: envText("FBA_TANJIA_COMPANY_NAME_CN"),
    enterpriseCreditCode: envText("FBA_TANJIA_ENTERPRISE_CREDIT_CODE"),
    addressLine1: envText("FBA_TANJIA_ADDRESS_LINE1", "No.1 Taiwen street"),
    addressLine2: envText("FBA_TANJIA_ADDRESS_LINE2", "Room 239-9, Huli"),
    city: envText("FBA_TANJIA_CITY", "Xiamen"),
    stateOrProvinceCode: envText("FBA_TANJIA_STATE_PROVINCE", "Fujian"),
    postalCode: envText("FBA_TANJIA_POSTAL_CODE", "361006"),
    countryCode: "CN",
    phoneNumber: "+86 13235037039",
  },
};

export function getFbaAddressProfile(shopName = "") {
  const value = String(shopName).toLowerCase();
  if (value.startsWith("xiamentanjia")) return fbaAddressProfiles.xiamentanjia;
  return fbaAddressProfiles.tandanbo;
}
