#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tanjia-bi}"
APP_NAME="${PM2_APP_NAME:-tanjia-bi}"
RELEASES_DIR="$APP_DIR/releases"
TARGET=""
RESTORE_INVENTORY_PROVISION_CACHE=0
STAMP="$(date +%Y%m%d-%H%M%S)"
CURRENT_BACKUP="$RELEASES_DIR/before-rollback-$STAMP"

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

fail() {
  printf '\n回退失败：%s\n' "$*" >&2
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

list_releases() {
  if [ ! -d "$RELEASES_DIR" ]; then
    printf '暂无备份目录：%s\n' "$RELEASES_DIR"
    return
  fi
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort
}

[ -d "$APP_DIR" ] || fail "目录不存在：$APP_DIR"

for argument in "$@"; do
  case "$argument" in
    list)
      [ -z "$TARGET" ] || fail "list 不能和回退目标同时使用。"
      TARGET="list"
      ;;
    --restore-inventory-provision-cache)
      RESTORE_INVENTORY_PROVISION_CACHE=1
      ;;
    *)
      [ -z "$TARGET" ] || fail "只能指定一个回退目标。"
      TARGET="$argument"
      ;;
  esac
done

if [ "$TARGET" = "list" ]; then
  list_releases
  exit 0
fi

[ -d "$RELEASES_DIR" ] || fail "暂无备份，无法回退。"

if [ -z "$TARGET" ]; then
  TARGET="$(list_releases | tail -n 1)"
else
  case "$TARGET" in
    /*) ;;
    *) TARGET="$RELEASES_DIR/$TARGET" ;;
  esac
fi

[ -n "$TARGET" ] || fail "没有找到可回退的备份。"
[ -d "$TARGET" ] || fail "备份不存在：$TARGET"
[ -f "$TARGET/server.js" ] || fail "备份不完整，缺少 server.js：$TARGET"

mkdir -p "$RELEASES_DIR"

log "回退目标：$TARGET"
log "先备份当前版本到：$CURRENT_BACKUP"
mkdir -p "$CURRENT_BACKUP"
tar \
  --exclude='./releases' \
  --exclude='./node_modules' \
  --exclude='./data-cache' \
  --exclude='./uploads' \
  --exclude='./.env' \
  --exclude='./tanjia-bi-deploy.tar.gz' \
  --exclude='./.deploy-tmp-*' \
  -cf - -C "$APP_DIR" . | tar -xf - -C "$CURRENT_BACKUP"

log "恢复备份文件"
tar -cf - -C "$TARGET" . | tar -xf - -C "$APP_DIR"

if [ "$RESTORE_INVENTORY_PROVISION_CACHE" = "1" ]; then
  snapshot_tool="$CURRENT_BACKUP/scripts/inventory-provision-deploy-snapshot.js"
  [ -f "$snapshot_tool" ] || fail "当前版本缺少库存计提保护快照工具，无法恢复库存缓存。"
  log "按显式参数恢复库存计提历史缓存和分类账原文件"
  node "$snapshot_tool" restore \
    --source-data-dir "$APP_DIR/data-cache" \
    --snapshot-data-dir "$TARGET/data-cache"
fi

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

log "回退完成。"
