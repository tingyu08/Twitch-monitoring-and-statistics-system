#!/bin/sh
# 在 VPS 上把一份 release（git archive 解開的 Dockerfile、backend/ 與 deploy/vps/）換上線。
#
# 平常由 GitHub Actions 經 deploy_entry.sh 呼叫；要手動重跑時：
#   sh ~/twitch-release/deploy/vps/deploy.sh
#
# VPS 上的配置（不在 repo 裡）：~/twitch/docker-compose.yml、.env、db.env 只存在 VPS，
# 這支只替換映像的建置來源 ~/twitch/src，絕不覆蓋它們。
#
# 流程：先建新映像（舊容器照跑）→ 換上新版 → 健康檢查（/api/health 會實際查資料庫）；
# 失敗就換回上一版映像與程式碼，並以非 0 結束讓 CI 變紅。
#
# 注意：沒有自動 migration；schema 變更仍要手動套用，回滾也不會倒回 schema。

set -eu

RELEASE=$(cd "$(dirname "$0")/../.." && pwd)
APP="$HOME/twitch"
SRC="$APP/src"
SERVICE=twitch-backend
IMAGE=twitch-backend
# 啟動時要初始化 EventSub 訂閱與快取預熱，比一般服務慢
HEALTH_SECONDS=${DEPLOY_HEALTH_SECONDS:-180}

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

healthy() {
    elapsed=0
    while [ "$elapsed" -lt "$HEALTH_SECONDS" ]; do
        if docker exec "$SERVICE" node -e \
            "fetch('http://127.0.0.1:8080/api/health', { signal: AbortSignal.timeout(5000) })
               .then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
            >/dev/null 2>&1; then
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    return 1
}

restore_src() {
    rm -rf "$SRC" && mv "$SRC.prev" "$SRC"
}

rollback() {
    log "新版健康檢查失敗，回滾到上一版"
    docker logs --tail 40 "$SERVICE" 2>&1 || true
    restore_src
    if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
        docker tag "$IMAGE:previous" "$IMAGE:latest"
        docker compose up -d --no-build --no-deps "$SERVICE"
        if healthy; then
            log "已回滾，上一版運作正常"
        else
            log "回滾後仍不健康，需要人工處理"
        fi
    else
        log "沒有上一版映像可回滾，需要人工處理"
    fi
    exit 1
}

main() {
    revision=$(cat "$RELEASE/REVISION" 2>/dev/null || echo "unknown")
    log "開始部署 $revision"

    install -D -m 755 "$RELEASE/deploy/vps/deploy_entry.sh" "$HOME/bin/twitch-deploy-entry"
    cd "$APP"

    rm -rf "$SRC.prev"
    mv "$SRC" "$SRC.prev"
    mkdir -p "$SRC"
    cp -a "$RELEASE/." "$SRC/"

    if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
        docker tag "$IMAGE:latest" "$IMAGE:previous"
    fi
    log "建置新映像（舊容器照常服務）"
    if ! docker compose build "$SERVICE"; then
        log "建置失敗，線上版本未變動"
        restore_src
        exit 1
    fi

    log "換上新版"
    docker compose up -d --no-build --no-deps "$SERVICE" || rollback

    healthy || rollback

    echo "$revision" > "$APP/REVISION"
    docker image prune -f >/dev/null
    log "部署完成：$revision"
}

main
