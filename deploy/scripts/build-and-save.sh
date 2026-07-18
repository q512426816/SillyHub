#!/usr/bin/env bash
# 本地构建 backend + frontend 镜像，打包成 images.tar.gz，供 scp 到服务器 docker load 部署。
# 解决：服务器仅 2 核，前端 next build 需 15-20min；本地(20核) build 后传镜像，服务器不再构建。
#
# 用法：
#   # 打包给生产服务器（前端浏览器 API 地址用生产值）：
#   PROD_API_URL=http://192.168.0.143:8001 ./deploy/scripts/build-and-save.sh
#
#   # 仅本地验证流程（API 地址用 deploy/.env 的本地开发值）：
#   ./deploy/scripts/build-and-save.sh
#
# 前置：sillyhub-daemon/build/bundle/ 已存在（cd sillyhub-daemon && pnpm bundle 产出）。
# 产物：deploy/images.tar.gz
# 兼容：Git Bash (Windows) / Linux / macOS（LF 换行，bash）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "==> [1/5] 检查 Docker 运行"
docker info >/dev/null

echo "==> [2/5] 检查 daemon bundle 产物（backend 镜像依赖）"
for f in sillyhub-daemon/build/bundle/sillyhub-daemon.js sillyhub-daemon/build/bundle/mcp-server.js; do
  [ -f "$f" ] || { echo "    缺失 $f，先执行: cd sillyhub-daemon && pnpm bundle"; exit 1; }
done
echo "    bundle OK"

echo "==> [3/5] 准备 build-arg"
# COMMIT_SHA 焙进镜像（health 端点回显版本）；export 到环境后 compose 读 ${COMMIT_SHA:-} 覆盖 .env 空值。
export COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD)}"
export NEXT_PUBLIC_COMMIT_SHA="$COMMIT_SHA"
# 生产打包用 PROD_API_URL 覆盖前端浏览器 API 地址（本地 .env 是 127.0.0.1 开发值，生产须替换）。
# 环境变量优先级 > .env，故 export 的值进 build-arg 生效。
if [ -n "${PROD_API_URL:-}" ]; then
  export NEXT_PUBLIC_API_BASE_URL="$PROD_API_URL"
  echo "    生产打包 → NEXT_PUBLIC_API_BASE_URL=$PROD_API_URL"
else
  echo "    ⚠ 未设 PROD_API_URL，用 deploy/.env 的本地开发值 NEXT_PUBLIC_API_BASE_URL"
  echo "      打包给生产请：PROD_API_URL=http://<生产地址> $0"
fi

echo "==> [4/5] docker compose build（backend + frontend）"
docker compose --env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/docker-compose.yml" build

echo "==> [5/5] docker save → images.tar.gz"
OUT="$DEPLOY_DIR/images.tar.gz"
# 用 compose 给镜像打的固定 tag（compose 文件 image: 字段）。
docker save multi-agent-platform-backend:latest multi-agent-platform-frontend:latest \
  | gzip > "$OUT"
echo "    产出: $OUT ($(du -h "$OUT" | cut -f1))"
echo ""
echo "✅ 完成。下一步部署到服务器："
echo "   scp $OUT root@47.113.145.252:/opt/sillyhub/deploy/"
echo "   scp $SCRIPT_DIR/load-and-up.sh root@47.113.145.252:/opt/sillyhub/deploy/"
echo "   ssh root@47.113.145.252 'cd /opt/sillyhub/deploy && bash load-and-up.sh'"
