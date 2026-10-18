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

echo "==> [0/5] 部署并流校验（2026-10-16 互覆事故后新增）"
# 事故背景：多会话共享同一生产，另一会话从分叉分支打包部署，静默回退 main 上已修复的
# /data/logs 预建（页面日志再次不可见）。闸门：非 main 分支打包需显式放行 + 打印留痕。
DEPLOY_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DEPLOY_COMMIT="$(git rev-parse --short HEAD)"
echo "    打包源: 分支 $DEPLOY_BRANCH @ $DEPLOY_COMMIT"
if [ "$DEPLOY_BRANCH" != "main" ]; then
  echo "    ⚠️  当前分支不是 main——镜像将对生产形成覆盖部署，非 main 版本会回退主线已有修复："
  echo "        2026-10-16 实证：分叉分支部署覆盖 main 的 /data/logs 修复，页面日志再次不可见。"
  echo "        建议：切 main 并同步主线后重新打包；确需分支部署设 ALLOW_NON_MAIN_DEPLOY=1 显式放行。"
  [ "${ALLOW_NON_MAIN_DEPLOY:-}" = "1" ] || exit 1
  echo "    （已设 ALLOW_NON_MAIN_DEPLOY=1——显式放行非 main 部署，留痕。）"
fi
DIRTY_APP="$(git status --porcelain -- backend frontend sillyhub-daemon deploy | head -5)"
if [ -n "$DIRTY_APP" ]; then
  echo "    ⚠️  应用目录存在未提交改动——镜像=工作区快照，将带上未合入代码："
  printf '%s\n' "$DIRTY_APP" | sed 's/^/        /'
  echo "        建议先提交/合流；确需带改动打包设 ALLOW_DIRTY_DEPLOY=1 显式放行。"
  [ "${ALLOW_DIRTY_DEPLOY:-}" = "1" ] || exit 1
fi

echo "==> [1/5] 检查 Docker 运行"
docker info >/dev/null

echo "==> [2/5] 检查 daemon bundle 产物（backend 镜像依赖）"
for f in sillyhub-daemon/build/bundle/sillyhub-daemon.js sillyhub-daemon/build/bundle/mcp-server.js; do
  [ -f "$f" ] || { echo "    缺失 $f，先执行: cd sillyhub-daemon && pnpm bundle"; exit 1; }
done
echo "    bundle OK"

echo "==> [2.5/5] alembic 迁移单头预检（2026-10-11 生产实证：多头部署 crash-loop 宕机）"
# 双闸之二（闸一为 backend/tests/test_migration_single_head.py 随 CI 跑）：打镜像前
# 本地 fail-fast——多头直接退出，省掉「传 300M 镜像上服务器才发现起不来」的往返。
ALEMBIC_HEADS="$(cd backend && python -m alembic heads 2>&1)" || {
  echo "    ❌ alembic 命令失败（本地 Python 环境缺依赖？cd backend && uv sync 修复后重试）:"
  echo "       $ALEMBIC_HEADS"
  exit 1
}
# 2026-10-12-ci-guard-diagnosability：grep -c 计 0 时退出码 1，set -e 下赋值即死
# （零条 head 形态在打印引导前静默退出）——容忍之，让 0 走下方 [-ne 1] 分支给全量引导。
ALEMBIC_HEAD_COUNT="$(printf '%s\n' "$ALEMBIC_HEADS" | grep -c '(head)' || true)"
if [ "$ALEMBIC_HEAD_COUNT" -ne 1 ]; then
  echo "    ❌ alembic 迁移多头（并行变更各自加迁移未合流）——部署后 backend upgrade head 会 crash-loop："
  printf '%s\n' "$ALEMBIC_HEADS" | sed 's/^/       /'
  echo "    解法：cd backend && python -m alembic merge heads -m \"merge parallel heads ...\" 后提交再打包"
  exit 1
fi
echo "    单头 OK: $(printf '%s\n' "$ALEMBIC_HEADS" | grep '(head)' | head -1)"

echo "==> [3/5] 准备 build-arg"
# COMMIT_SHA 焙进镜像（health 端点回显版本）；export 到环境后 compose 读 ${COMMIT_SHA:-} 覆盖 .env 空值。
export COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD)}"
export NEXT_PUBLIC_COMMIT_SHA="$COMMIT_SHA"
# 2026-10-08-backend-skills-follow-cli：每次打包传新时间戳爆破 npm 层缓存，
# 强制真拉 sillyspec latest（空 SILLYSPEC_VERSION 时）；镜像技能随同包走，自动同版。
export SILLYSPEC_REFRESH="$(date +%Y%m%d%H%M%S)"
echo "    SILLYSPEC_REFRESH=$SILLYSPEC_REFRESH（强制 npm 层重拉 latest）"
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
# 2026-10-08-backend-image-slim-no-claude：容器内已无 sillyspec 可执行，版本回显改读
# 构建期焙入的 /app/sillyspec-package.json（node-tools 阶段 npm 实际装到的版本）。
# 注意必须经 sh -c 间接传路径——Git Bash/MSYS 会把裸 /app/... 参数改写成 Windows 路径。
echo "    镜像内 sillyspec 版本: $(docker run --rm --entrypoint sh multi-agent-platform-backend:latest -c 'grep -m1 -o "\"version\"[: ]*\"[^\"]*\"" /app/sillyspec-package.json | cut -d"\"" -f4' 2>/dev/null || echo 查询失败)"
echo ""
echo "    镜像 COMMIT_SHA=$COMMIT_SHA（health 端点将回显此值；运行时不再空覆盖）"
echo ""
echo "✅ 完成。下一步部署到腾讯云生产机（活跃目录是双层 /opt/sillyhub/deploy/deploy/）："
echo "   scp -i ~/.ssh/tencent_deploy $OUT deploy/scripts/load-and-up.sh ubuntu@124.222.127.242:/opt/sillyhub/deploy/deploy/"
echo "   # 传完确认脚本 LF 干净（CRLF 会 bad interpreter）："
echo "   ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 \"grep -c \\\$'\\r' /opt/sillyhub/deploy/deploy/load-and-up.sh\""
echo "   ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cd /opt/sillyhub/deploy/deploy && bash load-and-up.sh'"
