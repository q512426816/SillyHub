# Multi-stage build for the FastAPI backend.
# Stage 1: install dependencies with uv into an isolated venv.
# Stage 2: copy the venv + source into a slim runtime.

ARG PYTHON_VERSION=3.12
# 2026-10-08（thin 2026-10-08-backend-node22-for-sillyspec332）：20 → 22——sillyspec >=3.30
# 用 node:sqlite 内置模块（engines 硬要求 Node >=22.13），Node 20 下容器内任何
# sillyspec 命令直接 ERR_UNKNOWN_BUILTIN_MODULE 崩溃，与镜像内 3.32.0 技能包不配套。
ARG NODE_VERSION=22
ARG CLAUDE_CODE_VERSION=2.1.158
# 空 → npm install -g sillyspec 取最新；填值 → pin 到该版本（compose build arg 可覆盖）。
ARG SILLYSPEC_VERSION=""

FROM node:${NODE_VERSION}-slim AS node-tools

ARG CLAUDE_CODE_VERSION
ARG SILLYSPEC_VERSION
# 2026-10-08（thin 2026-10-08-backend-skills-follow-cli）：缓存爆破阀——SILLYSPEC_VERSION 留空
# （取 npm latest）时本层缓存会冻结在首次构建的版本上（容器 3.26.0 vs latest 3.32.0 实证）。
# 打包脚本（build-and-save.sh）每次传新时间戳强制重拉 latest；本地迭代不传则缓存照旧（快）。
ARG SILLYSPEC_REFRESH=""

RUN echo "npm layer refresh token: ${SILLYSPEC_REFRESH:-cached}" \
 && npm install --registry=https://registry.npmmirror.com -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} sillyspec${SILLYSPEC_VERSION:+@$SILLYSPEC_VERSION} \
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
# 2026-07-13（ql-20260713-001）：apt 换国内源——deb.debian.org 在国内网络下连不上
# （Connection refused），导致 base image digest 漂移后 rebuild 时整个 runtime stage
# 在 apt-get update 报废。与 pip（tsinghua）/npm（npmmirror）一致配国内源。
# 2026-07-17（ql-20260717-004）：mirrors.aliyun.com 的 trixie Packages 索引此刻缺失且
# CDN 多 IP Connection failed（apt-get update 拿不到索引），改回清华 tuna。
# 2026-10-08（thin 2026-10-08-backend-dockerfile-apt-mirror-sjtu）：tuna 对 trixie main
# Packages 大文件持续 500/502/EOF（InRelease/小文件正常，9.6MB 索引传输中断，重试无效），
# 实测各国内源 http 形态同慢（≈80KB/s）；https://mirror.sjtu.edu.cn 独快且稳
# （8MB/5s 复测），连协议一起换 https。apt 包集合与语义零变化，仅影响 build 阶段。
# trixie 用 DEB822 /etc/apt/sources.list.d/debian.sources，旧版用 sources.list，
# find 覆盖两种格式；找不到文件时 -exec 不执行，退出码仍为 0，无副作用。
RUN find /etc/apt -type f \( -name 'sources.list' -o -name '*.sources' \) \
      -exec sed -i -e 's|http://deb.debian.org|https://mirror.sjtu.edu.cn|g' \
                   -e 's|https://deb.debian.org|https://mirror.sjtu.edu.cn|g' {} + \
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
# 2026-09-04-provider-pi-onboarding task-06 / ql-20260906-003（审计 #10 分发链补口）：
# vendored pi 扩展树随镜像分发——/daemon/latest/vendor/{path} 路由按此目录服务，
# latest.json 的 vendorFiles 清单由此扫描。漏 COPY 则 install/自更新均拉不到
# → pi --extension 静默跳过（subagent 工具在真实部署不可用）。
COPY --from=daemon build/bundle/vendor /app/daemon-dist/vendor
COPY --from=daemon scripts/install.sh /app/daemon-dist/install.sh
# task-04（DG-02）：Windows PowerShell 安装脚本，偏好 CRLF 换行（与 install.sh 的 LF 相反）。
COPY --from=daemon scripts/install.ps1 /app/daemon-dist/install.ps1

# 2026-07-07-daemon-skill-execution task-07：sillyspec skills 进镜像（server-local 模式
# 容器内 claude 自带 skills 调 /sillyspec-* 跑 stage 流程，不经 daemon skill-manager 同步）。
# 2026-10-08（thin 2026-10-08-backend-skills-follow-cli）：技能源从仓库 .claude/skills 快照
# （additional_contexts "skills"，构建时固定、与容器 CLI 可能错位）改为已安装 sillyspec 包
# 自带 .claude/skills——同包同版 lockstep，CLI 随 SILLYSPEC_REFRESH 拉 latest 时技能自动同版，
# 平台侧永不错位。仓库技能目录仍服务本地工具面（ZCode/Claude CLI），由 sillyspec init 刷新。
# COPY 到 /app/sillyspec-skills/（非 volume 路径）而非 /app/.claude/skills/——后者被
# claude-data named volume 遮盖（volume 9h 前创建无 skills/，不会重拷镜像内容）。
# docker-entrypoint.sh 启动时软链 /app/.claude/skills → /app/sillyspec-skills 让 claude 找到；
# backend skills_bundle_dir config 默认 /app/sillyspec-skills 供 manifest/bundle 端点读。
COPY --from=node-tools /usr/local/lib/node_modules/sillyspec/.claude/skills /app/sillyspec-skills/

# task-04（DG-02）：install.ps1 兜底转 CRLF——PowerShell 偏好 CRLF，与 install.sh 去 CR（LF）相反。
# 源文件已 CRLF 则幂等无副作用；被 git 在镜像构建前转成 LF 则此处修复回来。注意不并入上面的
# `sed 's/\r$//' install.sh`（那行明确只列 install.sh + entrypoint，bash 要 LF）。
RUN mkdir -p /app/.cache /app/.config /app/.claude /tmp/.npm /data/spec-workspaces \
 && chown -R app:app /app /tmp/.npm /data/spec-workspaces \
 && sed -i 's/\r$//' /app/docker-entrypoint.sh /app/daemon-dist/install.sh \
 && chmod +x /app/docker-entrypoint.sh \
 && sed -i 's/$/\r/' /app/daemon-dist/install.ps1 \
 && ln -sf /app/docker-entrypoint.sh /usr/local/bin/sillyhub-backend-entrypoint

# ql-20260831-003: install.ps1 的 BOM 单一来源 = 源文件 sillyhub-daemon/scripts/install.ps1
# （自带恰好一个 UTF-8 BOM，供 WinPS5.1 直接执行时按 UTF-8 解码）。此处禁止再补 BOM——
# 历史（ql-20260824-005/006、ql-20260826-006）已三次横跳：Dockerfile printf 补 BOM 与源文件
# BOM 叠加成双 BOM，dist_router 的 utf-8-sig 只剥一个，残留 \ufeff 混进响应体首字符，
# 用户 `irm | iex` 首行注释被误当代码执行（"无法将 Windows 项识别为 cmdlet"）。
# 断言恰好一个 BOM：首 3 字节 = EF BB BF，第 4-6 字节 ≠ EF BB BF；违反则构建失败。
RUN test "$(head -c 3 /app/daemon-dist/install.ps1 | od -An -tx1 | tr -d ' \n')" = "efbbbf" \
 && test "$(tail -c +4 /app/daemon-dist/install.ps1 | head -c 3 | od -An -tx1 | tr -d ' \n')" != "efbbbf"
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["sillyhub-backend-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
