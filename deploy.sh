#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tanjia-bi}"
APP_NAME="${PM2_APP_NAME:-tanjia-bi}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
ARCHIVE="${1:-$APP_DIR/tanjia-bi-deploy.tar.gz}"
PRODUCTION_DEPLOY_BRANCH="${PRODUCTION_DEPLOY_BRANCH:-main}"
RELEASES_DIR="$APP_DIR/releases"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$RELEASES_DIR/$STAMP"
TMP_DIR="$APP_DIR/.deploy-tmp-$STAMP"

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

fail() {
  printf '\n部署失败：%s\n' "$*" >&2
  exit 1
}

read_port() {
  local port_value="${PORT:-4173}"
  if [ -f "$APP_DIR/.env" ]; then
    local env_port
    env_port="$(grep -E '^PORT=' "$APP_DIR/.env" | tail -n 1 | cut -d= -f2- || true)"
    if [ -n "$env_port" ]; then
      port_value="$env_port"
    fi
  fi
  printf '%s' "$port_value"
}

cleanup_old_releases() {
  mapfile -t releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort)
  local count="${#releases[@]}"
  if [ "$count" -le "$KEEP_RELEASES" ]; then
    return
  fi

  local remove_count=$((count - KEEP_RELEASES))
  for old_release in "${releases[@]:0:$remove_count}"; do
    log "删除旧备份：$old_release"
    rm -rf "$old_release"
  done
}

backup_sales_forecast_runtime_data() {
  local runtime_dir="$APP_DIR/data-cache"
  local backup_runtime_dir="$BACKUP_DIR/data-cache"
  if [ ! -d "$runtime_dir" ]; then
    return
  fi

  mkdir -p "$backup_runtime_dir"
  for runtime_file in sales-forecast-manual-daily.json sales-forecast-hidden-rows.json sales-forecast-dashboard-cache.json sales-forecast-listing-products.json; do
    if [ -f "$runtime_dir/$runtime_file" ]; then
      cp -a "$runtime_dir/$runtime_file" "$backup_runtime_dir/$runtime_file"
    fi
  done
}

health_check() {
  local port_value
  port_value="$(read_port)"
  local url="http://127.0.0.1:$port_value/api/health"

  for _ in 1 2 3 4 5; do
    if curl -fsS "$url" >/tmp/tanjia-bi-health.json; then
      log "健康检查通过：$url"
      cat /tmp/tanjia-bi-health.json
      printf '\n'
      return
    fi
    sleep 1
  done

  fail "健康检查未通过，请执行：pm2 logs $APP_NAME --lines 80"
}

deploy_integrity_check() {
  local port_value
  port_value="$(read_port)"
  local base_url="http://127.0.0.1:$port_value"

  log "检查线上部署完整性：$base_url"
  APP_DIR="$APP_DIR" DEPLOY_VERIFY_BASE_URL="$base_url" node scripts/deploy-integrity.js verify-deployed
}

validate_deploy_manifest() {
  local manifest_json
  if ! manifest_json="$(tar -xOzf "$ARCHIVE" .deploy-manifest.json 2>/dev/null)"; then
    fail "部署包缺少 .deploy-manifest.json，拒绝部署。请用新版 scripts/package-deploy.js 重新打包。"
  fi

  local metadata
  if ! metadata="$(printf '%s' "$manifest_json" | node -e 'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => { const manifest = JSON.parse(input); for (const key of ["app", "branch", "commit", "clean", "confirmedBranch"]) console.log(String(manifest[key] ?? "")); });')"; then
    fail "部署包 manifest 解析失败。"
  fi

  mapfile -t deploy_meta <<< "$metadata"
  local manifest_app="${deploy_meta[0]:-}"
  local manifest_branch="${deploy_meta[1]:-}"
  local manifest_commit="${deploy_meta[2]:-}"
  local manifest_clean="${deploy_meta[3]:-}"
  local manifest_confirmed_branch="${deploy_meta[4]:-}"

  [ "$manifest_app" = "tanjia-bi" ] || fail "部署包应用标识异常：$manifest_app"
  [ -n "$manifest_branch" ] || fail "部署包 manifest 缺少分支信息。"
  [ -n "$manifest_commit" ] || fail "部署包 manifest 缺少提交信息。"
  [ "$manifest_clean" = "true" ] || fail "部署包不是从干净工作区生成，拒绝部署。"
  [ "$manifest_confirmed_branch" = "$manifest_branch" ] || fail "部署包缺少分支二次确认：confirmedBranch=$manifest_confirmed_branch branch=$manifest_branch"

  if ! tar -xOzf "$ARCHIVE" .deploy-manifest.json 2>/dev/null | node -e 'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => { const manifest = JSON.parse(input); if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.includes("sales-facts-sqlite-v1")) process.exit(1); });'; then
    fail "部署包缺少 sales-facts-sqlite-v1 能力声明，拒绝部署。"
  fi

  if [ "$manifest_branch" != "$PRODUCTION_DEPLOY_BRANCH" ] && [ "${ALLOW_NON_PRODUCTION_DEPLOY:-0}" != "1" ]; then
    fail "部署包来自分支 $manifest_branch，当前允许的正式部署分支是 $PRODUCTION_DEPLOY_BRANCH。如确需临时部署其他分支，请显式设置 ALLOW_NON_PRODUCTION_DEPLOY=1。"
  fi

  log "部署包来源确认：branch=$manifest_branch commit=${manifest_commit:0:12}"
}

validate_sales_facts_preflight_artifact() {
  case "${SKIP_SALES_FACTS_PREFLIGHT:-0}" in
    1)
      log "按显式配置跳过销售事实业务预检：SKIP_SALES_FACTS_PREFLIGHT=1"
      return
      ;;
    0|"")
      ;;
    *)
      fail "SKIP_SALES_FACTS_PREFLIGHT 只能设置为 0 或 1。"
      ;;
  esac

  local artifact_path="${SALES_FACTS_PREFLIGHT_ARTIFACT:-}"
  local expected_hash="${SALES_FACTS_PREFLIGHT_ARTIFACT_SHA256:-}"
  [ -n "$artifact_path" ] || fail "缺少 SALES_FACTS_PREFLIGHT_ARTIFACT。部署不会自动调用领星预检，请提供已批准的只读报告。"
  [ -f "$artifact_path" ] || fail "销售事实预检 artifact 不存在：$artifact_path"
  [ -n "$expected_hash" ] || fail "缺少 SALES_FACTS_PREFLIGHT_ARTIFACT_SHA256。"

  local actual_hash
  actual_hash="$(node --input-type=module - "$artifact_path" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const file = process.argv[2];
process.stdout.write(createHash("sha256").update(readFileSync(file)).digest("hex"));
NODE
)"
  [ "$actual_hash" = "$expected_hash" ] || fail "销售事实预检 artifact hash 不匹配。"

  if ! node scripts/validate-sales-facts-preflight-artifact.js "$artifact_path" >/dev/null; then
    fail "销售事实预检 artifact 未通过已批准报告门禁。"
  fi
  log "销售事实预检 artifact 已验证：sha256=${actual_hash:0:12}"
}

[ -d "$APP_DIR" ] || fail "目录不存在：$APP_DIR"
[ -f "$ARCHIVE" ] || fail "找不到部署包：$ARCHIVE"

validate_deploy_manifest

if [ "${ALLOW_CSS_DEPLOY:-0}" != "1" ]; then
  if tar -tzf "$ARCHIVE" | grep -Eq '(^|/)(styles\.css|assets/css/)'; then
    fail "部署包包含 CSS。为避免误覆盖线上样式，默认拒绝部署；如确需部署样式，请设置 ALLOW_CSS_DEPLOY=1。"
  fi
fi

mkdir -p "$RELEASES_DIR"

log "备份当前版本到：$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
tar \
  --exclude='./releases' \
  --exclude='./node_modules' \
  --exclude='./data-cache' \
  --exclude='./uploads' \
  --exclude='./.env' \
  --exclude='./tanjia-bi-deploy.tar.gz' \
  --exclude='./.deploy-tmp-*' \
  -cf - -C "$APP_DIR" . | tar -xf - -C "$BACKUP_DIR"
backup_sales_forecast_runtime_data

log "预检查部署包"
mkdir -p "$TMP_DIR"
tar -xzf "$ARCHIVE" -C "$TMP_DIR"
[ -f "$TMP_DIR/server.js" ] || fail "部署包缺少 server.js"
[ -f "$TMP_DIR/app.js" ] || fail "部署包缺少 app.js"
[ -f "$TMP_DIR/package.json" ] || fail "部署包缺少 package.json"
[ -f "$TMP_DIR/scripts/sales-facts-sqlite-smoke.js" ] || fail "部署包缺少销售事实 SQLite smoke"
[ -f "$TMP_DIR/scripts/validate-sales-facts-schema.js" ] || fail "部署包缺少销售事实 schema 校验脚本"
[ -f "$TMP_DIR/scripts/validate-sales-facts-preflight-artifact.js" ] || fail "部署包缺少销售事实 preflight artifact 校验脚本"

log "在隔离目录安装依赖"
npm ci --prefix "$TMP_DIR"

log "检查新版 Node 语法"
node --check "$TMP_DIR/server.js"
node --check "$TMP_DIR/app.js"

log "解压新版到线上目录"
tar -xzf "$ARCHIVE" -C "$APP_DIR"

cd "$APP_DIR"

log "检查 Node 版本"
node -e 'const version = process.versions.node.split(".").map(Number); const ok = (version[0] === 22 && version[1] >= 19) || (version[0] > 22 && version[0] < 25); if (!ok) { console.error(`Node ${process.versions.node} 不满足 package.json engines: >=22.19.0 <25`); process.exit(1); }'

log "切换已验证的原生依赖"
PREVIOUS_NODE_MODULES="$TMP_DIR/previous-node_modules"
if [ -d "$APP_DIR/node_modules" ]; then
  mv "$APP_DIR/node_modules" "$PREVIOUS_NODE_MODULES"
fi
mv "$TMP_DIR/node_modules" "$APP_DIR/node_modules"
rm -rf "$PREVIOUS_NODE_MODULES"

log "检查 SQLite 原生模块和事务"
node scripts/product-catalog-sqlite-smoke.js

log "检查销售事实 SQLite 原生模块、事务和完整性"
node scripts/sales-facts-sqlite-smoke.js

log "校验销售事实 schema 和 quick_check"
node scripts/validate-sales-facts-schema.js

validate_sales_facts_preflight_artifact

log "迁移共享商品目录缓存"
node scripts/migrate-product-catalog.js

log "重启 PM2 应用：$APP_NAME"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME"
fi
pm2 save

health_check
deploy_integrity_check
cleanup_old_releases

log "部署完成。当前保留最近 $KEEP_RELEASES 个备份。"
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort
