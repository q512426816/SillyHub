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
RUN apt-get update -o Acquire::Retries=3 \
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
COPY --from=daemon scripts/install.sh /app/daemon-dist/install.sh

RUN mkdir -p /app/.cache /app/.config /app/.claude /tmp/.npm /data/spec-workspaces \
 && chown -R app:app /app /tmp/.npm /data/spec-workspaces \
 && sed -i 's/\r$//' /app/docker-entrypoint.sh /app/daemon-dist/install.sh \
 && chmod +x /app/docker-entrypoint.sh \
 && ln -sf /app/docker-entrypoint.sh /usr/local/bin/sillyhub-backend-entrypoint
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["sillyhub-backend-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
