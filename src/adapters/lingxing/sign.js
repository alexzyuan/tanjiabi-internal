import { createLingxingSign } from "../../utils/lingxingSign.js";

export function createSignedParams({ params = {}, config = {}, accessToken = "", timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const commonParams = {
    access_token: accessToken || config.accessToken || "",
    app_key: config.appKey || "",
    timestamp,
  };
  const signedParams = { ...params, ...commonParams };
  const sign = createLingxingSign(signedParams, config.appKey);
  return {
    commonParams,
    signedParams,
    queryParams: { ...commonParams, sign },
  };
}
