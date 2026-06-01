---
name: sillyhub-docker-deploy
description: 用于把当前 SillyHub / multi-agent-platform 项目部署到本机 Docker Compose，并配置局域网访问。适合用户说"部署到 docker"、"局域网内可以访问"、"重启 Docker 部署"、"添加 workspace 指向本项目"、"修复 Docker Compose 启动/健康检查/端口/前后端代理问题"。
---

# SillyHub Docker 部署

## 目标

把当前仓库用 `deploy/docker-compose.yml` 启动为完整服务栈：

- frontend: Next.js
- backend: FastAPI
- postgres
- redis
- Claude Code CLI in the backend container
- SillySpec CLI in the backend container

默认优先保留用户已有本机进程。如果 `3000` 或 `8000` 已被占用，改用 `3001` / `8001`，不要直接杀进程。

## 前置检查

1. 确认工作目录是仓库根目录。
2. 查看 Docker 和 Compose：
   ```bash
   docker --version
   docker compose version
   ```
3. 查看端口占用：
   ```bash
   lsof -nP -iTCP:3000 -sTCP:LISTEN || true
   lsof -nP -iTCP:8000 -sTCP:LISTEN || true
   lsof -nP -iTCP:3001 -sTCP:LISTEN || true
   lsof -nP -iTCP:8001 -sTCP:LISTEN || true
   ```
4. 查看现有容器：
   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
   docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
   ```

## 配置 deploy/.env

如果 `deploy/.env` 不存在，先从模板复制并生成密钥：

```bash
cp deploy/.env.example deploy/.env
python3 - <<'PY'
import secrets
print("SECRET_KEY=" + secrets.token_urlsafe(32))
print("SILLYSPEC_MASTER_KEY=" + secrets.token_urlsafe(32))
PY
```

本机部署建议设置：

```env
BACKEND_PORT=8001
FRONTEND_PORT=3001
POSTGRES_PORT=5433
REDIS_PORT=6380
HOST_PROJECTS_DIR=/Users/qinyi/SillyHub
HOST_PATH_PREFIX=/Users/qinyi/SillyHub
INTERNAL_API_BASE_URL=http://backend:8000
```

局域网访问时先取本机 IP：

```bash
iface=$(route -n get default | awk '/interface:/{print $2}')
ipconfig getifaddr "$iface"
```

然后设置：

```env
NEXT_PUBLIC_API_BASE_URL=http://<LAN_IP>:8001
CORS_ALLOWED_ORIGINS=["http://localhost:3001","http://<LAN_IP>:3001"]
```

注意：

- `NEXT_PUBLIC_API_BASE_URL` 是前端构建变量，改了以后必须重建前端镜像。
- `INTERNAL_API_BASE_URL` 给 Next 服务端 rewrite 使用，必须指向容器网络里的 `backend:8000`。
- 不要把真实 token、API key、密码写入 skill 文档或提交日志。

## 代码侧部署兼容性

后端镜像必须内置 agent 运行依赖。检查 `backend/Dockerfile`：

- 使用 Node runtime stage 安装：
  ```bash
  npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} sillyspec@${SILLYSPEC_VERSION}
  ```
- runtime stage 复制 `node`、`npm`、`npx`、`claude`、`sillyspec` 和 `/usr/local/lib/node_modules`。
- runtime apt 依赖包含 `git`，agent worktree 和 CLI 调用会用到。
- `HOME=/app`，并确保 `/app/.claude`、`/app/.cache`、`/app/.config`、`/tmp/.npm` 对 `app` 用户可写。

检查 `deploy/docker-compose.yml`：

```yaml
backend:
  build:
    args:
      CLAUDE_CODE_VERSION: ${CLAUDE_CODE_VERSION:-2.1.158}
      SILLYSPEC_VERSION: ${SILLYSPEC_VERSION:-3.12.0}
  env_file:
    - .env
  environment:
    HOME: /app
    NPM_CONFIG_CACHE: /tmp/.npm
```

后端容器应通过 `backend/docker-entrypoint.sh` 在启动时生成 `/app/.claude/settings.json`，不要把真实 `ANTHROPIC_AUTH_TOKEN` 写进已跟踪的 `.claude/settings.json`。本地真实值只放在 gitignored 的 `deploy/.env`。
Claude Code 相关变量要通过 `env_file: .env` 注入 backend 容器，避免宿主机 shell 里已有的 `ANTHROPIC_*` 变量覆盖 Docker 配置。
`/app/.claude` 应挂载到 `claude-data` volume，以保留官方 plugin marketplace 和已安装插件缓存。

推荐的 Docker 内 Claude Code 配置：

```env
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
API_TIMEOUT_MS=3000000
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.1
ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.1
CLAUDE_CODE_MODEL=opus[1m]
CLAUDE_PLUGIN_FRONTEND_DESIGN_ENABLED=true
CLAUDE_PLUGIN_PLAYWRIGHT_ENABLED=true
CLAUDE_SYNC_OFFICIAL_PLUGINS_ON_START=true
CLAUDE_SKIP_DANGEROUS_MODE_PERMISSION_PROMPT=true
```

如果前端容器里 `/api/*` 代理到 `localhost:8000` 报 `ECONNREFUSED`，检查并修正：

- `frontend/next.config.mjs` 的 rewrite 使用：
  ```js
  process.env.INTERNAL_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000"
  ```
- `frontend/Dockerfile` 在 builder/runtime 阶段接收并设置 `INTERNAL_API_BASE_URL`。
- `deploy/docker-compose.yml` 的 frontend build args 和 environment 包含：
  ```yaml
  INTERNAL_API_BASE_URL: ${INTERNAL_API_BASE_URL:-http://backend:8000}
  ```

如果 Alembic 在空库迁移时因重复建表失败，例如 `DuplicateTableError: relation "releases" already exists`，检查补缺表迁移，重复创建的 `op.create_table` / `op.create_index` 应使用 `if_not_exists=True`。

## 启动

优先使用 Docker Desktop 自带 builder，避免旧的 `proxy-builder` 卡住：

```bash
BUILDX_BUILDER=desktop-linux docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build -d
```

如果只重建前端或后端：

```bash
BUILDX_BUILDER=desktop-linux docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build -d frontend
BUILDX_BUILDER=desktop-linux docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build -d backend
```

## Docker Desktop 卡在 Created 的修复

症状：

- `docker run` 或 `docker start` 卡住。
- 容器一直是 `Created`。
- Docker 日志停在 `grpcfuseClient.Approve(...)`。

先用最小探针确认：

```bash
docker run --rm --network none --name sillyhub-start-probe redis:7-alpine redis-server --version
```

如果也卡住，在 macOS Docker Desktop 上可通过 backend socket 关闭 VirtioFS/grpcfuse，再重启 Docker：

```bash
curl --unix-socket "$HOME/Library/Containers/com.docker.docker/Data/backend.sock" \
  -H 'Content-Type: application/json' \
  -X POST \
  --data '{"cli":{"useGrpcfuse":{"value":false}},"desktop":{"useVirtualizationFrameworkVirtioFS":{"value":false}}}' \
  http://localhost/app/settings

docker desktop restart
```

重启后重新跑最小探针。探针通过后再启动 Compose。

## 验证

本机验证：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
curl -fsS http://localhost:8001/api/health
curl -fsS http://localhost:3001/api/health
curl -fsSI http://localhost:3001
```

局域网验证：

```bash
curl -fsS http://<LAN_IP>:8001/api/health
curl -fsS http://<LAN_IP>:3001/api/health
curl -fsSI http://<LAN_IP>:3001
```

所有服务应为 healthy：

- `multi-agent-platform-backend-1`
- `multi-agent-platform-frontend-1`
- `multi-agent-platform-postgres-1`
- `multi-agent-platform-redis-1`

验证后端容器内 agent CLI：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'node --version && npm --version && git --version && claude --version && sillyspec --version'
```

验证 Docker 内 Claude Code settings，输出时必须遮蔽 token：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend python - <<'PY'
import json
from pathlib import Path
settings = json.loads(Path('/app/.claude/settings.json').read_text())
if settings.get('env', {}).get('ANTHROPIC_AUTH_TOKEN'):
    settings['env']['ANTHROPIC_AUTH_TOKEN'] = '<set>'
print(json.dumps(settings, indent=2, ensure_ascii=False))
PY
```

还要确认 Claude Code 所需 token 是已注入状态，但不要打印真实值：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'test -n "$ANTHROPIC_AUTH_TOKEN" && echo ANTHROPIC_AUTH_TOKEN=set || echo ANTHROPIC_AUTH_TOKEN=missing'
```

macOS 防火墙检查：

```bash
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate || true
```

## 登录和 workspace

默认管理员账号来自 `deploy/.env`：

```env
PLATFORM_BOOTSTRAP_ADMIN_EMAIL=...
PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=...
```

创建指向本项目的 workspace：

```bash
TOKEN=$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"email":"admin@sillyhub.local","password":"admin123"}' \
  http://localhost:8001/api/auth/login | jq -r '.access_token')

curl -fsS -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"root_path":"/Users/qinyi/SillyHub"}' \
  http://localhost:8001/api/workspaces/scan | jq .

curl -fsS -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"SillyHub","slug":"sillyhub","root_path":"/Users/qinyi/SillyHub","type":"app","role":"workspace","tech_stack":["FastAPI","Next.js","PostgreSQL","Redis","Docker Compose"],"build_command":"docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build -d","test_command":"make test"}' \
  http://localhost:8001/api/workspaces | jq .
```

创建前先 `GET /api/workspaces`，如果已有相同 `root_path` 或 `slug`，不要重复创建。

## 常用维护命令

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
docker compose --env-file deploy/.env -f deploy/docker-compose.yml restart backend frontend
```

涉及数据卷删除或 `down -v` 时必须先确认用户接受数据清空风险。
