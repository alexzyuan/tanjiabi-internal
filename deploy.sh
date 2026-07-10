#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tanjia-bi}"
APP_NAME="${PM2_APP_NAME:-tanjia-bi}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
ARCHIVE="${1:-$APP_DIR/tanjia-bi-deploy.tar.gz}"
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

[ -d "$APP_DIR" ] || fail "目录不存在：$APP_DIR"
[ -f "$ARCHIVE" ] || fail "找不到部署包：$ARCHIVE"

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
rm -rf "$TMP_DIR"

log "解压新版到线上目录"
tar -xzf "$ARCHIVE" -C "$APP_DIR"

cd "$APP_DIR"

log "检查 Node 版本"
node -e 'const version = process.versions.node.split(".").map(Number); const ok = (version[0] === 22 && version[1] >= 19) || (version[0] > 22 && version[0] < 25); if (!ok) { console.error(`Node ${process.versions.node} 不满足 package.json engines: >=22.19.0 <25`); process.exit(1); }'

log "检查 Node 语法"
node --check server.js
node --check app.js

log "安装依赖"
npm ci

log "重启 PM2 应用：$APP_NAME"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME"
fi
pm2 save

health_check
cleanup_old_releases

log "部署完成。当前保留最近 $KEEP_RELEASES 个备份。"
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort
