export const fbaAddressProfiles = {
  tandanbo: {
    key: "tandanbo",
    label: "坦蛋伯发货地址",
    shipperName: "Xiamen tandanbo wangluokeji youxiangongsi",
    companyName: "Xiamen tandanbo wangluokeji youxiangongsi",
    addressLine1: "Room 623-40, No. 89, Anling 2nd Road",
    addressLine2: "",
    city: "Xiamen",
    stateOrProvinceCode: "Fujian",
    postalCode: "361006",
    countryCode: "CN",
    phoneNumber: "8615759601196",
  },
  xiamentanjia: {
    key: "xiamentanjia",
    label: "厦门探嘉发货地址",
    shipperName: "Xiamen Tanjia wangluo keji youxian gongsi",
    companyName: "Xiamen Tanjia wangluo keji youxian gongsi",
    addressLine1: "No.1 Taiwen street",
    addressLine2: "Room 239-9, Huli",
    city: "Xiamen",
    stateOrProvinceCode: "Fujian",
    postalCode: "361006",
    countryCode: "CN",
    phoneNumber: "+86 13235037039",
  },
};

export function getFbaAddressProfile(shopName = "") {
  const value = String(shopName).toLowerCase();
  if (value.startsWith("xiamentanjia")) return fbaAddressProfiles.xiamentanjia;
  return fbaAddressProfiles.tandanbo;
}
