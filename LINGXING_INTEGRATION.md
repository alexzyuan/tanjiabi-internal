# 领星 ERP 接入记录

## 已确认信息

| 项目 | 内容 |
| --- | --- |
| 接口文档地址 | `https://apidoc.lingxing.com` |
| 正式环境域名 | `https://openapi.lingxing.com` |
| 探嘉同步频率 | 每 12 小时一次 |
| 当前项目数据源 | `mock` |

## 当前发现

- `https://apidoc.lingxing.com` 是文档站点。
- `https://openapi.lingxing.com` 根路径可访问，返回 `[]`，说明正式环境域名存在，但真实接口需要具体路径。
- 已确认接入需要 AppId、AppSecret 和公网 IP 白名单。
- 业务接口公共参数为 `access_token`、`app_key`、`timestamp`、`sign`。
- `sign` 需要 URL encode，后端 `URLSearchParams` 会自动处理。

## 鉴权和签名

### 获取 access_token

| 项目 | 内容 |
| --- | --- |
| API | `/api/auth-server/oauth/access-token` |
| 方法 | `POST` |
| Content-Type | `multipart/form-data` |
| 参数 | `appId`、`appSecret` |
| 成功返回 | `access_token`、`refresh_token`、`expires_in` |

### 续约 access_token

| 项目 | 内容 |
| --- | --- |
| API | `/api/auth-server/oauth/refresh` |
| 方法 | `POST` |
| Content-Type | `multipart/form-data` |
| 参数 | `appId`、`refreshToken` |

### 业务接口签名

签名规则：

1. 所有业务请求入参，加上 `access_token`、`app_key`、`timestamp`。
2. 按 ASCII 排序。
3. 按 `key=value&key2=value2` 拼接，空字符串不参与，`null` 参与。
4. 先做 32 位 MD5，并转大写。
5. 再使用 AES/ECB/PKCS5PADDING 加密，AES 密钥为 AppId。
6. `sign` 作为 Query Params 传输。

注意：

- `timestamp` 生成的签名有效期约 2 分钟，不要缓存签名。
- POST 业务参数放 body，JSON 格式；公共参数放 Query Params。
- body 内嵌套集合参与签名时要转成 string。

## 第一批接口映射

| 模块 | API | 方法 | 用途 |
| --- | --- | --- | --- |
| 授权 | `/api/auth-server/oauth/access-token` | POST | 获取 access_token |
| 授权 | `/api/auth-server/oauth/refresh` | POST | 续约 access_token |
| 店铺 | `/erp/sc/data/seller/lists` | GET | 获取亚马逊店铺列表 |
| Listing | `/erp/sc/data/mws/listing` | POST | 获取 MSKU、ASIN、SKU、负责人、销量等 |
| 订单 | `/erp/sc/data/mws/orders` | POST | 获取订单、销售额、退款、订单商品 |
| 店铺利润统计 | `/bd/profit/statistics/open/seller/list` | POST | 获取销售额、销量、广告费、退款、毛利等 |
| 店铺利润报表 | `/bd/profit/report/open/report/seller/list` | POST | 获取结算视角利润报表 |

## 探嘉当前预留位置

| 文件 | 作用 |
| --- | --- |
| `.env.example` | 已预置 `LINGXING_BASE_URL=https://openapi.lingxing.com` |
| `src/config/index.js` | 已默认使用正式环境域名 |
| `src/adapters/lingxingAdapter.js` | 已实现 token、签名请求、店铺、Listing、订单、利润统计接口方法 |
| `src/utils/lingxingSign.js` | 已实现 MD5 + AES/ECB 签名 |
| `src/services/syncService.js` | 负责每 12 小时调用一次同步 |
| `src/services/lingxingDashboardMapper.js` | 把领星利润统计字段映射成探嘉销售看板数据 |
| `data-cache/sales-weekly-source/*.json` | 领星同步后生成的销售复盘基础数据缓存，按日期/店铺/币种分组，负责人筛选在重算层处理 |
| `data-cache/sales-weekly-dashboard.json` | 兼容旧版的默认销售看板快照缓存 |

## 当前字段映射

| 探嘉指标 | 领星字段 |
| --- | --- |
| 店铺 | `storeName` / `sid` |
| 站点 | `country` / `countryCode` |
| 销售额 | `totalSalesAmount` |
| 销量 | `totalSalesQuantity` |
| 广告花费 | `totalAdsCost` |
| 广告销售额 | `totalAdsSales` |
| ACOS | `totalAdsCost / totalAdsSales` |
| ACOAS | `totalAdsCost / totalSalesAmount` |
| ASOAS | `totalAdsSales / totalSalesAmount` |
| 退款金额 | `totalSalesRefunds` |
| 退款率 | `totalSalesRefunds / totalSalesAmount` 或 `refundsRate` |
| 毛利润 | `grossProfit` |
| 毛利率 | `grossProfit / totalSalesAmount` 或 `grossRate` |

## 后续接入步骤

1. 在云服务器配置 `.env`：`DATA_PROVIDER=lingxing`、`LINGXING_APP_KEY`、`LINGXING_APP_SECRET`。
2. 把云服务器公网 IP 添加到领星白名单。
3. 先跑店铺列表接口，确认签名和白名单正常。
4. 接 Listing、订单、利润统计接口。
5. 写入数据库或本地缓存。
6. 看板 API 从真实汇总数据读取。
