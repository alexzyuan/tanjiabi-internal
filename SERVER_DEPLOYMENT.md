# 探嘉服务器部署清单

## 服务器信息

| 项目 | 内容 |
| --- | --- |
| 地域 | 华南1（深圳） |
| 公网 IP | `47.107.92.14` |
| 系统 | Ubuntu 22.04 64位 |
| 规格 | 2 vCPU / 2 GiB |
| 带宽 | 3 Mbps 固定带宽 |

## 1. 安全组端口

在阿里云控制台安全组里放行：

| 端口 | 用途 |
| --- | --- |
| 22 | SSH 登录服务器 |
| 80 | HTTP 网站访问 |
| 443 | HTTPS 网站访问 |
| 4173 | 探嘉临时预览端口，正式上线后可关闭 |

正式上线后建议只保留 `80`、`443`、`22`，通过 Nginx 转发到探嘉后端。

## 2. 领星白名单

把这个公网 IP 加到领星开放接口 IP 白名单：

```text
47.107.92.14
```

## 3. 首次登录服务器

在你自己的电脑终端执行：

```bash
ssh root@47.107.92.14
```

如果是密码登录，输入你在阿里云设置的 root 密码。

不要把 root 密码发到聊天里。

## 4. 初始化服务器

登录服务器后执行：

```bash
apt update
apt upgrade -y
apt install -y curl git nginx
```

安装 Node.js 22，并确认版本不低于 `22.19.0`：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
```

如果 `node -v` 低于 `v22.19.0`，请升级后再执行 `npm ci` 或部署；当前项目的 `package.json` 明确要求 Node.js `>=22.19.0 <25`。

安装 PM2：

```bash
npm install -g pm2
```

## 5. 上传探嘉项目

推荐先在服务器创建目录：

```bash
mkdir -p /opt/tanjia-bi
```

后续可以用 `scp`、Git 仓库、或阿里云控制台上传项目文件。

## 6. 配置环境变量

在服务器项目目录创建 `.env`，内容示例：

```text
PORT=4173
SYNC_INTERVAL_HOURS=12
DATA_PROVIDER=mock
LINGXING_BASE_URL=https://openapi.lingxing.com
LINGXING_APP_KEY=
LINGXING_APP_SECRET=
LINGXING_ACCESS_TOKEN=
LINGXING_REFRESH_TOKEN=
LINGXING_FBA_INVENTORY_ENDPOINT=/basicOpen/openapi/storage/fbaWarehouseDetail
```

正式接领星时：

```text
DATA_PROVIDER=lingxing
```

真实密钥只放服务器 `.env`，不要写进代码。

## 7. 启动探嘉

在项目目录执行：

```bash
npm ci
node server.js
```

确认没问题后，改用 PM2 后台运行：

```bash
pm2 start server.js --name tanjia-bi
pm2 save
pm2 startup
```

每次上传新版压缩包后，推荐使用项目自带的安全部署脚本：

```bash
cd /opt/tanjia-bi
bash deploy.sh
```

脚本会自动完成：

- 部署前备份当前版本到 `/opt/tanjia-bi/releases/时间戳`
- 解压新版 `tanjia-bi-deploy.tar.gz`
- 执行 `node --check` 检查前后端脚本语法
- 执行 `npm ci`
- 重启 PM2
- 访问 `/api/health` 做健康检查
- 默认只保留最近 3 个备份

如果新版上线后页面异常，可以立刻回退到上一个版本：

```bash
cd /opt/tanjia-bi
bash rollback.sh
```

查看可回退版本：

```bash
cd /opt/tanjia-bi
bash rollback.sh list
```

回退指定版本：

```bash
cd /opt/tanjia-bi
bash rollback.sh 20260511-010500
```

脚本不会覆盖或回退这些持久数据：

```text
.env
data-cache/
uploads/
node_modules/
```

所以领星密钥、登录账号、预算上传记录、缓存数据会保留在服务器上。

## 8. Nginx 转发

创建配置：

```bash
nano /etc/nginx/sites-available/tanjia-bi
```

填入：

```nginx
server {
    listen 80;
    server_name 47.107.92.14;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用：

```bash
ln -s /etc/nginx/sites-available/tanjia-bi /etc/nginx/sites-enabled/tanjia-bi
nginx -t
systemctl reload nginx
```

之后访问：

```text
http://47.107.92.14
```

## 9. 账号密码登录

服务器 `/opt/tanjia-bi/.env` 先保留一个初始管理员账号：

```text
AUTH_USERNAME=admin
AUTH_PASSWORD=请换成你自己的强密码
SESSION_SECRET=请换成一串随机长密码
```

填好后重启：

```bash
pm2 restart tanjia-bi --update-env
```

只要配置了 `AUTH_USERNAME` 和 `AUTH_PASSWORD`，系统就会自动启用登录保护。

登录后进入「后台管理」可以在图形界面新增、修改、禁用、删除账号，也可以给个别账号打开或关闭「后台权限」。未开启后台权限的账号可以登录看业务页面，但看不到后台管理入口，也不能访问后台账号管理接口。后台创建的账号会保存在服务器：

```text
/opt/tanjia-bi/data-cache/auth-users.json
```

密码会加密哈希保存，不会明文保存。后续上传新版代码时，不要删除 `data-cache` 目录。

## 10. 钉钉扫码登录

在钉钉开放平台创建应用后，把回调地址配置为：

```text
http://47.107.92.14/api/auth/dingtalk/callback
```

服务器 `/opt/tanjia-bi/.env` 增加：

```text
DINGTALK_CLIENT_ID=
DINGTALK_CLIENT_SECRET=
DINGTALK_REDIRECT_URI=http://47.107.92.14/api/auth/dingtalk/callback
SESSION_SECRET=请换成一串随机长密码
```

填好后重启：

```bash
pm2 restart tanjia-bi --update-env
```

如果要限制只有指定人员能进，可以增加任意一种白名单：

```text
AUTH_ALLOWED_MOBILES=手机号1,手机号2
AUTH_ALLOWED_UNION_IDS=钉钉unionId1,钉钉unionId2
AUTH_ALLOWED_OPEN_IDS=钉钉openId1,钉钉openId2
```

不配置白名单时，只要钉钉授权成功即可进入。

## 11. 推荐发布习惯

`deploy.sh` 会在重启后自动执行两层检查：

- `/api/health` 健康检查。
- `scripts/deploy-integrity.js verify-deployed` 完整性检查，逐项核对部署包 manifest 中的全部侧边栏板块、对应 `view-*` 页面容器、部署文件哈希和线上 `/app.js` 哈希。

需要人工排障时再看这些信息：

```bash
curl "http://127.0.0.1:4173/api/health"
APP_DIR=/opt/tanjia-bi DEPLOY_VERIFY_BASE_URL=http://127.0.0.1:4173 node scripts/deploy-integrity.js verify-deployed
pm2 status
pm2 logs tanjia-bi --lines 30
```

浏览器端如果仍然看到旧页面，先按：

```text
Command + Shift + R
```

强制刷新缓存。

## 12. 后续

- 购买或绑定域名。
- 做备案。
- 配置 HTTPS。
- 把 `DATA_PROVIDER` 切到 `lingxing`。
