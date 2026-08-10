# 统一店铺身份目录设计

## 背景

当前项目同时维护领星店铺缓存、`lingxingShopMap`、预算专用目录和前端 FBA 静态 fallback。不同入口因此可能展示不同的店铺集合，FBA 还会在目录请求失败时填充旧地址或默认店铺。未知店铺在部分后端路径会被当作 `tandanbo` 处理，错误可能进入报关和物流数据。

本次改造先收敛“店铺身份”这条共享边界，避免在各个页面继续增加局部映射。它不改变领星字段口径，也不扩展新的业务报表。

## 目标与非目标

目标：

1. 建立一个后端店铺目录服务，统一返回规范的 `sid`、`name`、`country`、`countryCode` 和 `displayName`。
2. 运行时店铺集合只来自领星 seller API 的成功响应或其缓存；静态 `lingxingShopMap` 只作为已审核的归属/法定主体边界，不能作为列表 fallback。
3. `/api/lingxing/shops`、`/api/fba/shops` 以及 FBA 运单、货代、STA/Jiufang 路径使用同一份目录，目录缺失、为空或失效时显式失败并记录诊断信息。
4. 删除前端 FBA 店铺和地址 fallback，不再默认选择 SID `11501`，未知店铺不得继续生成物流 payload。
5. 用测试覆盖缓存命中、缓存缺失、空响应、未知店铺和多入口集合一致性。

非目标：

- 本次不重写所有报表服务的 seller API 调用，不调整 CSS 或页面布局。
- 本次不把预算专用店铺目录改造成领星运行时目录；预算目录仍只服务预算域。
- 本次不自动为 `tanjia-eu-DE`、`tanjia-eu-UK` 增加法定发件主体。它们必须先完成线上店铺确认和主体审核。

## 领域规则

- 具体店铺以 `sid` 为稳定身份，`name` 为领星标识；展示名称由后端映射一次后供前端复用。
- 静态店铺映射可用于校验已知 SID、品牌归属和法定发件主体，但不能在运行时 seller 数据缺失时生成可选店铺。
- 未知店铺、无 SID 的店铺和无法解析法定主体的物流请求必须失败。不得把未知店铺默认为 `tandanbo`，也不得根据目的国家推断主体。
- 店铺目录为空是业务状态，不等同于“没有筛选条件”。前端应清空选择项并显示目录不可用状态。

## 数据流

```text
Lingxing seller API
        |
        v
  seller cache (source + updatedAt)
        |
        v
  SellerDirectoryService
      |       |
      v       v
 /api/lingxing/shops  /api/fba/shops
      |       |
      +-------+--> FBA freight / shipment / STA / Jiufang
```

目录服务负责：读取缓存、按需刷新、规范字段别名、去重并保留来源和更新时间；业务服务只消费目录结果，不再自行 seed 静态店铺或补默认 SID。

## 失败与可观测性

目录读取和刷新失败必须向调用方传播错误。错误日志至少包含 `source`、`cacheHit`、`sellerCount`、请求 endpoint（如有）和错误类型；不得包含 token、密码或完整 API 响应。空 seller 响应必须与请求失败区分，并在接口诊断字段中保留。

前端加载失败时显示可见错误并保持空选择，不调用静态或其他页面的 seller fallback。同步中心不能把失败转换成“成功但 sellers 为空”再触发 FBA fallback。

## 计划变更边界

后端：新增 `src/services/sellerDirectoryService.js`；调整 `syncService`、`routes/core.js`、`routes/fba.js`，以及 FBA catalog/candidate/freight/STA/Jiufang 调用点，使其依赖目录服务并进行严格身份校验。

前端：调整 `assets/js/features/fba-shops.js`、`fba-freight.js`、`fba-shipment-order.js`、`fba-task-form.js`、`sync-center.js` 和 `app.js` 接线，移除 FBA 静态店铺/地址 fallback 与默认 SID。

不触碰：生成式 `styles.css`、与店铺目录无关的报表字段 mapper、部署脚本和外部 API 凭据。

## 验收标准

1. 缓存或 API 返回规范 seller 集合时，两个店铺 API 和所有 FBA 选择器展示相同的店铺身份。
2. 缓存缺失、API 失败、API 空响应时，后端返回可诊断错误或明确不可用状态；前端没有静态店铺、旧地址和隐式默认 SID。
3. `tanjia-eu-DE` 与 `tanjia-eu-UK` 在未进入审核目录前不会出现在 FBA 物流选项中；出现未知 SID/name 的物流请求在 payload 生成前失败。
4. 现有测试保持通过，并新增目录服务、FBA fallback 删除和未知主体失败的回归测试。
