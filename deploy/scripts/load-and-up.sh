#!/usr/bin/env bash
# 服务器端：导入 images.tar.gz → 用导入镜像启动服务（不现场构建）→ 清理释放磁盘。
# 在服务器 deploy/ 目录（与 docker-compose.yml、.env、images.tar.gz 同级）执行。
#
# 用法：bash load-and-up.sh [images.tar.gz]
#
# 回滚：本脚本默认删除 tar + 清 dangling 以释放磁盘（服务器仅 40G）。
#   若需保留 tar 备份：注释掉「删除 tar」步骤；回滚时重新 load 旧 tar 即可。
#   也可在本地 git 回退后重新走 build-and-save.sh。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
TAR="${1:-images.tar.gz}"
[ -f "$TAR" ] || { echo "找不到 $TAR，先 scp 上传到 $(pwd)/"; exit 1; }

echo "==> [1/4] docker load"
gunzip -c "$TAR" | docker load

echo "==> [2/4] docker compose up -d（用 load 进来的 :latest，不构建）"
# compose 发现已存在 multi-agent-platform-{backend,frontend}:latest，直接用，不触发 build。
docker compose --env-file .env up -d

echo "==> [3/4] 清理 dangling 镜像（服务器磁盘紧张）"
docker image prune -f

echo "==> [4/4] 删除 tar 包释放空间"
rm -f "$TAR"

echo ""
echo "✅ 完成。状态：docker compose ps；日志：docker compose logs -f --tail=50"
