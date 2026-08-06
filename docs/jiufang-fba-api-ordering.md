# Jiufang FBA API Ordering

BI 的 FBA 货件处理页支持把选中的 FBA 货件直接提交到九方通逊物流 API 下单。当前实现使用九方普通下单接口 `/v3/shipment?lang=zh_CN`，清提派 HD 接口暂不作为默认流程。

## Environment

真实凭据只允许放在服务器 `.env`：

- `JIUFANG_API_BASE_URL=https://cgi.jiufanglogistics.cn/api/`
- `JIUFANG_USERNAME`
- `JIUFANG_PASSWORD_MD5`
- `JIUFANG_TOKEN`
- `JIUFANG_DEFAULT_DEPARTURE_CODE`
- `JIUFANG_DEFAULT_SERVICE_CODE`

`JIUFANG_PASSWORD_MD5` 必须是九方要求的 32 位小写 MD5，不要保存原始密码。

## Workflow

1. 在 `FBA货件处理` 页面读取货件。
2. 在目标货件的 `操作` 栏点击 `九方`。
3. 弹窗会按货件目的国家显示常用九方渠道，选择渠道后点击 `预检`。
4. 预检无失败项后，弹窗内点击 `确认下单`。
5. 成功后 BI 会保存九方订单号，并在弹窗和货件行展示九方提交结果。

后端强制分成 dry-run 和 create 两步。`/api/fba/jiufang/orders/create` 必须收到 `confirmed: true` 才会调用九方真实下单接口。

## Common Channel Picker

前端只展示已确认的常用渠道，不在筛选栏加载九方全量渠道：

- 美国：`SEA-OA-03` OA直送专线(包税)、`SEA-MS-31` 准时达卡派(包税)、`AIR-US-03` 美国空派带电包税(卡派)。
- 德国/英国：`SEA-BL-22` 欧盟递延卡派(不包税)。
- 加拿大：`SEA-CA-02` 加拿大卡派(包税)、`SEA-CA-42` 加东闪送(包税)。
- 澳洲：`SEA-AU-01` 澳洲卡派(包税)。

## Data Requirements

每个货件必须具备：

- 九方渠道代码。
- Amazon 物流中心编码。
- Amazon 收件地址：地址、城市、州/省、邮编、国家。
- 发件人资料：公司、地址、城市、电话。
- 领星装箱明细：每箱重量、长宽高、箱内 SKU 和数量。
- SKU 申报资料：品牌、材质、用途、清关编码、是否带电、单位、申报单价。

领星货件分为两种装箱来源：`is_sta=1` 的 STA 货件使用 `inboundPlanId/staShipmentId/sid` 查询 STA 装箱接口；`is_sta=0` 的普通 FBA 货件使用 `shipment_id/sid` 查询普通 FBA 装箱接口。不能把普通 FBA 货件当成 STA 货件处理。

## Observability

关键路径日志使用：

- `[jiufang-fba-order]`
- `[jiufang-order-store]`
- `[fba-freight]`

日志允许出现 shipment ID、渠道代码、九方订单号、失败 endpoint 和错误描述。不得记录 token、密码哈希或未脱敏 payload。

## Troubleshooting

- 缺少 SKU 申报资料：补齐 ERP 产品管理里的品牌、材质、用途、清关编码、是否带电、单位、申报单价后重新预检。
- 缺少装箱明细、尺寸或重量：确认领星 FBA 装箱接口能返回该货件的 `box_list`，并在 ERP 完善箱数、箱规和箱内 SKU；普通 FBA 货件没有 STA 的 `inboundPlanId/staShipmentId` 是正常现象。
- 九方渠道为空：当前货件目的国家未配置常用渠道，先确认业务要使用的九方渠道代码再加入前端白名单。
- 已存在九方订单：BI 会跳过该货件，避免重复下单。
- 九方返回校验错误：以后端错误描述为准，先修正根因再重试，不要绕过 dry-run/create 流程。
- 请求超时：查看 `[jiufang-fba-order]` 和 adapter 错误日志，确认网络、token 和九方服务状态。
