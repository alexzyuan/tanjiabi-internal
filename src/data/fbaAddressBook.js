import { readEnv } from "../config/index.js";
import { findLingxingShop } from "./lingxingShopMap.js";

function envText(key, fallback = "") {
  return String(readEnv(key, fallback) || "").trim();
}

export const fbaAddressProfiles = {
  tandanbo: {
    key: "tandanbo",
    label: "坦蛋伯发货地址",
    shipperName: "Xiamen tandanbo wangluokeji youxiangongsi",
    companyName: "Xiamen tandanbo wangluokeji youxiangongsi",
    contactName: "justin",
    companyNameCn: envText("FBA_TANDANBO_COMPANY_NAME_CN", "厦门坦蛋伯网络科技有限公司"),
    enterpriseCreditCode: envText("FBA_TANDANBO_ENTERPRISE_CREDIT_CODE", "91350206MADNM7UF44"),
    addressLine1: envText("FBA_TANDANBO_ADDRESS_LINE1", "厦门火炬高新区软件园三期诚毅北大街56号2302单元-3室之1D"),
    addressLine2: envText("FBA_TANDANBO_ADDRESS_LINE2"),
    addressLineEn1: envText("FBA_TANDANBO_ADDRESS_LINE1_EN", "Unit 2302-3-1D, No. 56 Chengyi North Street, Phase III Software Park, Xiamen Torch High-tech Zone"),
    addressLineEn2: envText("FBA_TANDANBO_ADDRESS_LINE2_EN"),
    city: envText("FBA_TANDANBO_CITY", "厦门市"),
    stateOrProvinceCode: envText("FBA_TANDANBO_STATE_PROVINCE", "福建省"),
    postalCode: envText("FBA_TANDANBO_POSTAL_CODE", "361006"),
    countryCode: "CN",
    phoneNumber: "8615759601196",
  },
  xiamentanjia: {
    key: "xiamentanjia",
    label: "厦门探嘉发货地址",
    shipperName: "Xiamen Tanjia wangluo keji youxian gongsi",
    companyName: "Xiamen Tanjia wangluo keji youxian gongsi",
    contactName: "justin",
    companyNameCn: envText("FBA_TANJIA_COMPANY_NAME_CN", "厦门探嘉网络科技有限公司"),
    enterpriseCreditCode: envText("FBA_TANJIA_ENTERPRISE_CREDIT_CODE", "91350206MAD64HGE0K"),
    addressLine1: envText("FBA_TANJIA_ADDRESS_LINE1", "厦门火炬高新区软件园三期诚毅北大街56号2302单元-3室之2D"),
    addressLine2: envText("FBA_TANJIA_ADDRESS_LINE2"),
    addressLineEn1: envText("FBA_TANJIA_ADDRESS_LINE1_EN", "Unit 2302-3-2D, No. 56 Chengyi North Street, Phase III Software Park, Xiamen Torch High-tech Zone"),
    addressLineEn2: envText("FBA_TANJIA_ADDRESS_LINE2_EN"),
    city: envText("FBA_TANJIA_CITY", "厦门市"),
    stateOrProvinceCode: envText("FBA_TANJIA_STATE_PROVINCE", "福建省"),
    postalCode: envText("FBA_TANJIA_POSTAL_CODE", "361006"),
    countryCode: "CN",
    phoneNumber: "+86 13235037039",
  },
};

export function getFbaAddressProfile(shopName = "") {
  const shop = findLingxingShop(shopName);
  const value = String(shop?.name || shopName).toLowerCase();
  if (value.startsWith("xiamentanjia")) return fbaAddressProfiles.xiamentanjia;
  if (value.startsWith("tandanbo")) return fbaAddressProfiles.tandanbo;
  return null;
}

export function requireFbaAddressProfile(shopName = "", { context = "FBA 物流" } = {}) {
  const profile = getFbaAddressProfile(shopName);
  if (profile) return profile;
  const identifier = String(shopName || "未知店铺").trim() || "未知店铺";
  throw new Error(`${context} 无法为店铺 ${identifier} 解析已审核的法定发件主体。`);
}
