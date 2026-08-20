# 产品证书有效期台账设计

## 目标

将“产品 - 证书有效期”从静态占位页实现为可持久化的证书台账。用户可以查看、筛选、新增、编辑、删除证书记录，下载 Excel 模板并导入记录。页面的业务列固定为：国家、产品 SKU、证书类型、证书编号、签发日期、过期日期、状态。

## 范围与非目标

本期不接入领星，也不上传或托管证书附件，更不添加任何后台常驻任务。状态在每次读取时由过期日期计算，因此即使没有访问页面也不需要写入任务来刷新状态。

本期不提供临期推送、审批流或批量删除。状态不接受用户手工填写，Excel 中也不允许存在“状态”列作为导入数据来源。

## 领域模型与规则

每条记录使用下列字段：

| 字段 | 存储键 | 规则 |
| --- | --- | --- |
| 国家 | `country` | 必填，去首尾空格 |
| 产品 SKU | `productSku` | 必填，去首尾空格；显示时保留输入大小写 |
| 证书类型 | `certificateType` | 必填，去首尾空格 |
| 证书编号 | `certificateNumber` | 必填，去首尾空格 |
| 签发日期 | `issuedDate` | 可空；非空时必须为 `YYYY-MM-DD` 的实际日期 |
| 过期日期 | `expiryDate` | 必填；必须为 `YYYY-MM-DD` 的实际日期，且不得早于签发日期 |
| 状态 | `status` | 只读派生字段，不落库 |

持久化业务键为规范化后的 `country + productSku + certificateType + certificateNumber`；规范化仅用于比较（去首尾空格、SKU 和类型不区分大小写），不会改变页面显示值。单条保存和导入均按该键 upsert：已有记录被完整替换，新记录被新增。一个导入文件内出现重复业务键时，整批请求失败，避免文件内顺序隐式决定结果。

状态以服务器当前自然日计算，且按临近程度优先归类：过期日期早于今天为“已过期”；今天至未来 30 天（含）为“预警”；31 至 60 天（含）为“注意”；其余为“有效”。状态统计对应这四种状态；资料缺失不再作为该台账的状态或统计口径。

## 后端结构与数据流

`src/services/productCertificateService.js` 是唯一的领域入口，负责输入校验、日期与状态计算、业务键去重、原子写入、列表筛选、模板生成与导入工作簿解析。持久化数据为 `data-cache/product-certificates/product-certificates-v1.json`；服务采用同目录临时文件加 rename 的方式进行全量原子提交。任意校验、XLSX 解析或写入错误都必须让请求失败且保留旧文件。

`routes/product-certificates.js` 仅定义受会话保护的 HTTP 契约：

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/product-certificates` | 返回台账行、按状态统计和可用国家/类型筛选项 |
| POST | `/api/product-certificates` | 新增或更新一条 JSON 记录 |
| PUT | `/api/product-certificates/:id` | 更新指定记录；URL id 与业务键不作为信任边界 |
| DELETE | `/api/product-certificates/:id` | 删除指定记录 |
| GET | `/api/product-certificates/template` | 生成并下载固定表头 Excel 模板 |
| POST | `/api/product-certificates/import` | 接收 `.xlsx` 的 Base64 内容，整批校验并原子 upsert |

路由通过 `routes/index.js` 装配，`server.js` 只注入服务函数和现有通用响应工具，不加入业务规则。所有写接口都记录经过脱敏的条数、操作和失败原因；不记录工作簿原文、Base64 内容或证书文件。

导入只支持 `.xlsx`、首个工作表和第一行表头；表头必须恰好识别“国家、产品SKU、证书类型、证书编号、签发日期、过期日期”，空行跳过。无法识别的表头、空必填项、非法日期、签发晚于过期、重复业务键或单行校验失败都会返回明确行号并使整批不提交。模板包含固定表头和一行可替换的示例数据。

## 前端结构与交互

`index.html` 保留视图和语义化控件：国家、证书类型、状态、关键词筛选器；新增证书、导入表格和下载模板动作；带可访问标签的 `<dialog>` 表单；以及托管水平滚动的标准数据表。表头按用户确认的顺序展示，原“到期日期”替换为“过期日期”。

`assets/js/features/product-certificates.js` 拥有页面加载、筛选、统计渲染、列表渲染、表单与导入 dialog 的事件绑定、错误显示和请求提交。它复用已有的 `readFileAsBase64`、表格管理、按钮忙碌状态、状态消息和原生 dialog 模式。`app.js` 只导入并创建 feature，传入共享依赖，并在切换到 `certificates` 视图时调用加载函数；不接受任何证书特定渲染或事件逻辑。

表格使用稳定的 `data-table-key` 和列键，列宽、排序按钮和滚动行为交给 `data-table-manager.js` 与共享表格样式；不添加页面级业务列宽。状态同时以中文文本和共享状态徽标表现。导入对话框可由按钮打开，并能通过 Esc、取消或关闭按钮关闭；提交中禁用重复操作，API 返回的精确错误直接显示。

证书专有视觉规则只放在 `assets/css/pages/69-product-certificates.css`，使用已有语义 token、按钮、表单、modal 与表格基线。生成目标仍为 `styles.css`，只能用 `npm run build:css` 更新；不会手工编辑生成文件。

## 验证策略

服务测试先行覆盖：状态边界（过期、30 天、31 天、60 天、61 天）、单条输入校验、原子 upsert、坏导入不改变现有台账、重复业务键拒绝、模板列顺序和导入成功后的统计。路由测试覆盖所有端点均为 `session` 保护、模板响应头以及 JSON 委托。前端结构测试覆盖页面列、dialog、feature 所有权和 `app.js` 无证书业务实现；样式结构测试确保专属 CSS 位于分层页面源文件而非 `styles.css`。

完成实现后运行聚焦测试、完整 `npm test`、`npm run check`，并用本地浏览器在桌面视口验证：页面无控制台错误；键盘可打开和关闭两个 dialog；下载模板与导入请求正常；导入后新行、状态、统计与筛选结果一致；表格横向滚动保持在表格容器内。

## 文件边界

| 文件 | 责任 |
| --- | --- |
| `src/services/productCertificateService.js` | 证书领域规则、存储、XLSX 解析与模板 |
| `routes/product-certificates.js` | 会话路由和 HTTP 映射 |
| `routes/index.js` | 装配新路由 |
| `server.js` | 注入服务依赖 |
| `index.html` | 视图和 dialog 的语义结构 |
| `assets/js/features/product-certificates.js` | 页面状态、请求与事件 |
| `app.js` | 只负责 feature 装配与视图加载 |
| `assets/css/pages/69-product-certificates.css` | 证书页面专属样式 |
| `test/productCertificateService.test.js` | 领域与导入回归测试 |
| `test/productCertificateRoutes.test.js` | 路由测试 |
| `test/frontendStructure.test.js` | 前端模块边界断言 |
| `test/stylesStructure.test.js` | CSS 源文件所有权断言 |

不会修改产品目录、领星适配器、`src/utils/cacheStore.js`、销售事实或其他产品页面。
