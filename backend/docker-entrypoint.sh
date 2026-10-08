#!/bin/sh
set -eu

# 2026-10-08（thin 2026-10-08-backend-image-slim-no-claude）：容器内 claude 退役——
# .claude 目录初始化、skills 软链、settings.json 生成（ANTHROPIC_*/CLAUDE_* env 注入）、
# claude 插件市场同步全部删除（server-local 模式遗物；agent 执行在宿主 daemon，
# 其 claude/sillyspec 由 daemon install 自行管理）。容器只剩 python API + 静态分发。
mkdir -p /data/spec-workspaces
# ql-20260904-027（修正轮）：不做 chown -R /data/spec-workspaces——容器以 USER app
# 运行，chown 在任何挂载形态下都不可能成功：bind mount（本机与阿里云的实际形态）
# 属主恒 root 且 EPERM，纯耗时阻塞 alembic；named volume 场景的属主已由 Dockerfile
# 构建期 chown 覆盖（首次挂载继承镜像目录属主）。bind 场景的可写性由宿主目录权限
# 保证（Docker Desktop 宽松映射 / 阿里云 HOST_PATH_PREFIX=/tmp 1777）。

# Allow git operations on bind-mounted host directories
git config --global --add safe.directory '*' 2>/dev/null || true

exec "$@"
