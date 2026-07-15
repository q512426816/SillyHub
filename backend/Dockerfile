# Multi-stage build for the FastAPI backend.
# Stage 1: install dependencies with uv into an isolated venv.
# Stage 2: copy the venv + source into a slim runtime.

ARG PYTHON_VERSION=3.12
ARG NODE_VERSION=20
ARG CLAUDE_CODE_VERSION=2.1.158
# 空 → npm install -g sillyspec 取最新；填值 → pin 到该版本（compose build arg 可覆盖）。
ARG SILLYSPEC_VERSION=""

FROM node:${NODE_VERSION}-slim AS node-tools

ARG CLAUDE_CODE_VERSION
ARG SILLYSPEC_VERSION

RUN npm install --registry=https://registry.npmmirror.com -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} sillyspec${SILLYSPEC_VERSION:+@$SILLYSPEC_VERSION} \
 && npm cache clean --force

FROM python:${PYTHON_VERSION}-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

# uv: single-binary, fast python package manager
RUN pip install --no-cache-dir --upgrade pip uv==0.4.18

WORKDIR /build

# pyproject.toml references README.md as the long_description, so both files
# must be present before `uv pip install -e .` runs.
COPY pyproject.toml README.md ./
# Lock-less install is acceptable for V1; once we add uv.lock, switch to `uv sync --frozen`.
RUN uv venv /opt/venv \
 && uv pip install --python /opt/venv/bin/python --no-cache -e . \
 && uv pip install --python /opt/venv/bin/python --no-cache alembic

COPY . .


FROM python:${PYTHON_VERSION}-slim AS runtime

ARG CLAUDE_CODE_VERSION
ARG SILLYSPEC_VERSION
# Git commit SHA injected at build time (build arg → ENV) so the health
# endpoint reports the exact image version without relying on a .git dir
# (the build context is backend/, which does not contain the repo .git).
# Empty default keeps the runtime `git rev-parse` fallback working locally.
ARG COMMIT_SHA=""

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/app \
    NPM_CONFIG_CACHE=/tmp/.npm \
    CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION} \
    SILLYSPEC_VERSION=${SILLYSPEC_VERSION} \
    COMMIT_SHA=${COMMIT_SHA:-} \
    PATH="/opt/venv/bin:${PATH}"

# Non-root runtime user
RUN groupadd --system app && useradd --system --gid app --home /app app

# Install minimal runtime dependencies plus git for agent worktrees.
# 2026-07-13（ql-20260713-001）：apt 换清华源——deb.debian.org 在国内网络下连不上
# （Connection refused），导致 base image digest 漂移后 rebuild 时整个 runtime stage
# 在 apt-get update 报废。与 pip（tsinghua）/npm（npmmirror）一致配国内源。
# trixie 用 DEB822 /etc/apt/sources.list.d/debian.sources，旧版用 sources.list，
# find 覆盖两种格式；找不到文件时 -exec 不执行，退出码仍为 0，无副作用。
RUN find /etc/apt -type f \( -name 'sources.list' -o -name '*.sources' \) \
      -exec sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' {} + \
 && apt-get update -o Acquire::Retries=3 \
 && apt-get install -y --no-install-recommends --fix-missing curl ca-certificates git libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=node-tools /usr/local/bin/node /usr/local/bin/node
COPY --from=node-tools /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -sf ../lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude \
 && ln -sf ../lib/node_modules/sillyspec/bin/sillyspec.js /usr/local/bin/sillyspec

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /build /app

# Daemon distribution files (pre-built on host, injected via the additional
# context "daemon"). Served by /daemon/install.sh and /daemon/latest/sillyhub-daemon.js.
COPY --from=daemon build/bundle/sillyhub-daemon.js /app/daemon-dist/sillyhub-daemon.js
# task-05/06（e2e 2026-07-12）：主 agent MCP server 子进程入口，必须与
# sillyhub-daemon.js 同目录分发，否则远程 daemon 装完后 mcp-server.js 缺失
# → node spawn 不存在的文件 → 主 agent MCP 永不启动 → team 链路断。
COPY --from=daemon build/bundle/mcp-server.js /app/daemon-dist/mcp-server.js
COPY --from=daemon scripts/install.sh /app/daemon-dist/install.sh
# task-04（DG-02）：Windows PowerShell 安装脚本，偏好 CRLF 换行（与 install.sh 的 LF 相反）。
COPY --from=daemon scripts/install.ps1 /app/daemon-dist/install.ps1

# 2026-07-07-daemon-skill-execution task-07：sillyspec skills 进镜像（server-local 模式
# 容器内 claude 自带 skills 调 /sillyspec-* 跑 stage 流程，不经 daemon skill-manager 同步）。
# compose additional_contexts "skills: ../.claude/skills" 直接指向 skills 目录本身。
# COPY 到 /app/sillyspec-skills/（非 volume 路径）而非 /app/.claude/skills/——后者被
# claude-data named volume 遮盖（volume 9h 前创建无 skills/，不会重拷镜像内容）。
# docker-entrypoint.sh 启动时软链 /app/.claude/skills → /app/sillyspec-skills 让 claude 找到；
# backend skills_bundle_dir config 默认 /app/sillyspec-skills 供 manifest/bundle 端点读。
COPY --from=skills . /app/sillyspec-skills/

# task-04（DG-02）：install.ps1 兜底转 CRLF——PowerShell 偏好 CRLF，与 install.sh 去 CR（LF）相反。
# 源文件已 CRLF 则幂等无副作用；被 git 在镜像构建前转成 LF 则此处修复回来。注意不并入上面的
# `sed 's/\r$//' install.sh`（那行明确只列 install.sh + entrypoint，bash 要 LF）。
RUN mkdir -p /app/.cache /app/.config /app/.claude /tmp/.npm /data/spec-workspaces \
 && chown -R app:app /app /tmp/.npm /data/spec-workspaces \
 && sed -i 's/\r$//' /app/docker-entrypoint.sh /app/daemon-dist/install.sh \
 && chmod +x /app/docker-entrypoint.sh \
 && sed -i 's/$/\r/' /app/daemon-dist/install.ps1 \
 && ln -sf /app/docker-entrypoint.sh /usr/local/bin/sillyhub-backend-entrypoint
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["sillyhub-backend-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
