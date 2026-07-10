# 站外售后邮箱设计

日期：2026-06-29

## 目标

在 ERP 中新增一级板块“售后”，并在其下新增“站外售后邮箱”页面，接入 `jmcustomer@163.com` 的 163 邮箱。系统需要读取站外售后邮件、支持 ERP 内回复、为每封邮件生成 Gemini AI 回复建议，并把新邮件或待回复邮件纳入现有每日巡检提醒。

## 信息架构

- 新增一级导航分组：`售后`
- 新增子页面：`站外售后邮箱`
- 面包屑：`首页 > 售后 > 站外售后邮箱`
- 页面不挂在现有 `产品 > 售后数据` 下，避免和领星售后数据看板混淆。

## 用户流程

1. 用户进入 `售后 > 站外售后邮箱`。
2. 页面显示邮箱连接状态、最近同步时间、新邮件数、待回复数和已回复数。
3. 用户点击“刷新邮箱”，ERP 通过 IMAP 拉取最近邮件并更新缓存。
4. 用户在列表中选择一封邮件，打开邮件详情。
5. 详情左侧显示邮件正文；右侧显示 Gemini AI 回复建议和回复编辑框。
6. 用户可以点击“使用建议”把 AI 草稿填入回复框，也可以完全手动输入。
7. 用户点击“发送回复”，ERP 通过 SMTP 发出邮件。
8. 发送成功后，系统记录回复人、发送时间、收件人、主题、正文摘要和关联邮件 UID，并将邮件标记为“已回复”。

## 邮箱接入

### 收信

使用 IMAP 直连 163 邮箱：

- host：`imap.163.com`
- port：`993`
- secure：`true`
- 认证：邮箱账号 + 163 邮箱授权码

收信服务只在服务端运行，不把授权码暴露给浏览器。

### 发信

使用 SMTP 发送回复：

- host：`smtp.163.com`
- port：`465`
- secure：`true`
- 认证：邮箱账号 + 163 邮箱授权码

本期只支持纯文本回复。主题默认使用 `Re: 原主题`，收件人默认使用原邮件发件人。

## 配置

新增环境变量：

```env
AFTERSALES_MAIL_ENABLED=true
AFTERSALES_MAIL_USER=jmcustomer@163.com
AFTERSALES_MAIL_PASSWORD=163邮箱授权码
AFTERSALES_MAIL_IMAP_HOST=imap.163.com
AFTERSALES_MAIL_IMAP_PORT=993
AFTERSALES_MAIL_SMTP_HOST=smtp.163.com
AFTERSALES_MAIL_SMTP_PORT=465
AFTERSALES_MAIL_LOOKBACK_DAYS=14
AFTERSALES_MAIL_MAX_MESSAGES=100
GEMINI_API_KEY=Google Gemini API Key
GEMINI_MODEL=gemini-3.5-flash
```

实际密钥只写入部署环境或本地 `.env`，不提交到代码库。

## 数据存储

使用现有 `data-cache` 风格保存本地状态：

- `data-cache/aftersales-mail-latest.json`：邮件摘要、同步状态和统计
- `data-cache/aftersales-mail-replies.json`：ERP 发出的回复记录
- `data-cache/aftersales-mail-ai-suggestions.json`：按邮件 UID 缓存的 AI 回复建议

邮件缓存字段：

- `uid`
- `messageId`
- `date`
- `from`
- `fromAddress`
- `subject`
- `snippet`
- `text`
- `seen`
- `isNew`
- `status`：`new`、`pending`、`replied`
- `lastSyncedAt`

回复记录字段：

- `id`
- `uid`
- `messageId`
- `to`
- `subject`
- `body`
- `bodySnippet`
- `operator`
- `sentAt`
- `smtpResult`

AI 建议字段：

- `uid`
- `messageId`
- `suggestion`
- `model`
- `generatedAt`
- `status`

## AI 回复建议

抛弃现有 MiMo 配置，新建 Gemini 文本生成封装。邮件详情右侧展示 AI 回复建议。

Gemini 调用使用 Google 官方当前推荐的 Interactions API：

- endpoint：`https://generativelanguage.googleapis.com/v1beta/interactions`
- header：`x-goog-api-key: GEMINI_API_KEY`
- model：默认 `gemini-3.5-flash`，允许通过 `GEMINI_MODEL` 覆盖
- input：纯文本售后上下文
- system instruction：限制为中文售后客服草稿，不自动承诺退款、补发或赔偿

服务端输入：

- 邮件主题
- 发件人
- 邮件正文
- 当前处理状态

服务端输出：

- 一段可编辑的中文售后回复草稿
- 简短处理判断，例如是否需要人工补充订单号、物流单号或产品信息

安全规则：

- AI 不自动发送邮件。
- AI 生成失败不阻塞手动回复。
- 如果未配置 `GEMINI_API_KEY`，页面显示“AI 暂不可用”，回复功能仍可用。
- 邮件正文发送给 Gemini 前限制长度，避免过长请求和不必要的数据暴露。

## API

新增接口：

- `GET /api/aftersales-mail/dashboard`
  - 返回邮件列表、统计、连接状态和最近同步时间。
- `POST /api/aftersales-mail/sync`
  - 手动刷新 IMAP 邮件。
- `GET /api/aftersales-mail/messages/:uid`
  - 返回单封邮件详情和已有回复记录。
- `POST /api/aftersales-mail/messages/:uid/ai-suggestion`
  - 生成或刷新 Gemini AI 回复建议。
- `POST /api/aftersales-mail/messages/:uid/reply`
  - 通过 SMTP 发送回复，并保存回复记录。
- `PATCH /api/aftersales-mail/messages/:uid/status`
  - 标记邮件为 `pending` 或 `replied`。

所有接口都走现有登录态。浏览器端不接触邮箱授权码或 Gemini key。

## 页面结构

页面使用现有原生 HTML/CSS/JS 和 Spectrum 语义 token：

- `module-hero`：标题、连接状态、刷新按钮
- `filters`：状态筛选、关键词搜索
- `metric-tile`：新邮件、待回复、已回复、最近同步
- `panel`：邮件列表
- `panel`：邮件详情和 AI 回复建议

详情区域采用两栏布局：

- 左侧：邮件元信息和正文
- 右侧：AI 回复建议、回复编辑框、发送按钮、发送状态

窄屏下两栏堆叠。

## 巡检提醒

在 `storeInspectionService` 中新增 `站外售后邮箱` 检查项。

检查规则：

- 有新邮件：计入待处理。
- 有状态为 `new` 或 `pending` 的邮件：计入待回复。
- IMAP 连接失败：巡检显示警告，不影响其他巡检项。
- 没有新邮件且没有待回复邮件：显示正常。

日报示例：

```text
站外售后邮箱：新增 3 封，待回复 2 封，最近同步 2026-06-29 09:00
```

钉钉推送沿用现有店铺巡检通知逻辑。巡检不会自动发送 AI 回复。

## 错误处理

- IMAP 未配置：页面显示“邮箱未配置”，列表为空。
- IMAP 登录失败：页面显示连接失败原因，并保留上次缓存。
- SMTP 发信失败：不标记已回复，保留编辑框内容并显示错误。
- Gemini 未配置或失败：显示 AI 不可用，允许手动回复。
- 邮件解析失败：保留基础字段，正文显示解析失败说明。

## 验收标准

- 新增一级 `售后` 分组和 `站外售后邮箱` 子页面。
- 可以读取 `jmcustomer@163.com` 最近邮件，并展示摘要和正文。
- 可以在 ERP 内回复邮件，回复成功后有本地记录。
- 每封邮件详情侧边显示 Gemini AI 回复建议，且不会自动发送。
- 每日巡检包含站外售后邮箱检查项。
- 未配置邮箱或 Gemini 时页面有明确状态，不影响 ERP 其他页面。
- `npm run check` 通过。
