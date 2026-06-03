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

   macOS / Linux：
   ```bash
   lsof -nP -iTCP:3000 -sTCP:LISTEN || true
   lsof -nP -iTCP:8000 -sTCP:LISTEN || true
   lsof -nP -iTCP:3001 -sTCP:LISTEN || true
   lsof -nP -iTCP:8001 -sTCP:LISTEN || true
   ```

   Windows（PowerShell；git-bash 下用 `powershell -Command "..."` 包裹）：
   ```powershell
   Get-NetTCPConnection -State Listen -LocalPort 3000,8000,3001,8001 -ErrorAction SilentlyContinue |
     Select-Object LocalAddress,LocalPort,OwningProcess
   ```
   或在 git-bash 里直接：`netstat -ano | grep -E ':(3000|8000|3001|8001)\s'`
4. 查看现有容器：
   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
   docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
   ```

## 配置 deploy/.env

如果 `deploy/.env` 不存在，先从模板复制并生成密钥：

```bash
cp deploy/.env.example deploy/.env   # Windows git-bash 同样可用 cp
python3 - <<'PY'
import secrets
print("SECRET_KEY=" + secrets.token_urlsafe(32))
print("SILLYSPEC_MASTER_KEY=" + secrets.token_urlsafe(32))
PY
```

> Windows 上若无 `python3`，用 `python`。

本机部署建议设置（路径按宿主机操作系统填写）：

```env
BACKEND_PORT=8001
FRONTEND_PORT=3001
POSTGRES_PORT=5433
REDIS_PORT=6380
# macOS / Linux 示例：
HOST_PROJECTS_DIR=/Users/qinyi/SillyHub
HOST_PATH_PREFIX=/Users/qinyi/SillyHub
# Windows 示例（用正斜杠，compose 可识别）：
# HOST_PROJECTS_DIR=C:/Users/qinyi/IdeaProjects
# HOST_PATH_PREFIX=C:/Users/qinyi/IdeaProjects
INTERNAL_API_BASE_URL=http://backend:8000
```

> 注意 compose 里 `HOST_PROJECTS_DIR` 挂载到 `/host-projects`、`HOST_PATH_PREFIX` 配 `CONTAINER_PATH_PREFIX=/host-projects` 做路径改写。Windows 下两者要指向同一宿主机目录，scanner 才能读到 `.sillyspec` 树。

局域网访问时先取本机 IP：

macOS：
```bash
iface=$(route -n get default | awk '/interface:/{print $2}')
ipconfig getifaddr "$iface"
```

Linux：
```bash
ip route get 1.1.1.1 | awk '{print $7; exit}'
```

Windows（PowerShell）：
```powershell
(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
  Select-Object -First 1).IPv4Address.IPAddress
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
      SILLYSPEC_VERSION: ${SILLYSPEC_VERSION:-3.14.1}
  env_file:
    - .env
  environment:
    HOME: /app
    NPM_CONFIG_CACHE: /tmp/.npm
```

> 版本号以 `deploy/docker-compose.yml` 实际 build args 为准，本文档中的数字仅为示例，可能滞后。

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

直接用 compose 默认 builder 构建并启动。**代码是构建进镜像的（无源码 bind-mount），改了代码必须重建镜像。**

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build -d
```

只重建前端或后端，并强制重建容器（确保用上新镜像）：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d backend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d frontend
```

> ⚠️ **不要在 Windows 上加 `BUILDX_BUILDER=desktop-linux`。** 实测（Docker 29 / Compose v5，Windows）该 builder 构建出的镜像不会进入 compose 默认使用的镜像库，容器会继续跑旧代码——`docker images` 时间戳不变、容器仍是旧 `Up`，部署看似成功实则无效。用默认 builder 即可；只有在确认默认 builder 卡死（见下一节）时才考虑切换。
>
> ⚠️ **务必带 `--force-recreate`**（或确认 compose 报告 `Recreated`）。若镜像重建了但容器没重建，运行的仍是旧代码。重建后用「验证」节的容器内代码校验确认改动确实生效。

## Docker Desktop 卡在 Created 的修复

症状：

- `docker run` 或 `docker start` 卡住。
- 容器一直是 `Created`。
- Docker 日志停在 `grpcfuseClient.Approve(...)`。

先用最小探针确认：

```bash
docker run --rm --network none --name sillyhub-start-probe redis:7-alpine redis-server --version
```

如果也卡住：

**macOS** — 通过 backend socket 关闭 VirtioFS/grpcfuse，再重启 Docker：

```bash
curl --unix-socket "$HOME/Library/Containers/com.docker.docker/Data/backend.sock" \
  -H 'Content-Type: application/json' \
  -X POST \
  --data '{"cli":{"useGrpcfuse":{"value":false}},"desktop":{"useVirtualizationFrameworkVirtioFS":{"value":false}}}' \
  http://localhost/app/settings

docker desktop restart
```

**Windows** — grpcfuse/VirtioFS 那套不适用。改为：在 Docker Desktop 设置里把文件共享后端切到 WSL2（Settings → General → Use WSL 2 based engine），或 Settings → Resources → File Sharing 调整；命令行可 `wsl --shutdown` 后从托盘重启 Docker Desktop。仍卡则 `docker context use desktop-linux` 切换 context（注意：这是切 context，不是上一节禁用的 `BUILDX_BUILDER` 环境变量）。

重启后重新跑最小探针。探针通过后再启动 Compose。

## 验证

本机验证：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
curl -fsS http://127.0.0.1:8001/api/health
curl -fsS http://127.0.0.1:3001/api/health
curl -fsSI http://127.0.0.1:3001
```

> ⚠️ **宿主机验证用 `127.0.0.1`，不要用 `localhost`。** 实测在 Windows git-bash 下，`curl http://localhost:PORT` 会返回 `curl: (52) Empty reply from server`，换成 `127.0.0.1` 立即正常——这是 `localhost` 解析问题，不代表服务异常。端口按 `.env` 里的 `BACKEND_PORT`/`FRONTEND_PORT` 替换（默认 stack 可能是 8000/3000）。
>
> 若宿主机 curl 始终为空，但需确认服务本身正常，从容器内自测最可靠：
> ```bash
> docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc 'curl -fsS http://localhost:8000/api/health'
> ```
> 返回 `{"status":"ok","db":"ok","redis":"ok",...}` 即服务健康。

**改了代码后，务必确认新代码进了容器**（镜像/容器没真正更新是这套部署最常见的隐性失败）。用容器内 grep 校验关键改动，例如：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'grep -c "<本次新增的函数/标识>" app/modules/<改动文件>.py'
```
计数为 0 说明容器仍是旧代码——回到「启动」节带 `--build --force-recreate` 重做。

局域网验证（端口替换为 `.env` 中的实际值）：

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

防火墙检查（局域网访问不通时）：

macOS：
```bash
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate || true
```

Windows（PowerShell；查看启用的 profile 并确认放行了对应端口）：
```powershell
Get-NetFirewallProfile | Select-Object Name,Enabled
# 如需放行（管理员 PowerShell）：
# New-NetFirewallRule -DisplayName "SillyHub 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
# New-NetFirewallRule -DisplayName "SillyHub 8001" -Direction Inbound -Protocol TCP -LocalPort 8001 -Action Allow
```

## 登录和 workspace

默认管理员账号来自 `deploy/.env`：

```env
PLATFORM_BOOTSTRAP_ADMIN_EMAIL=...
PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=...
```

创建指向本项目的 workspace（`root_path` 用宿主机真实路径；端口用 `.env` 实际值，宿主机访问用 `127.0.0.1`）：

```bash
TOKEN=$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"email":"admin@sillyhub.local","password":"admin123"}' \
  http://127.0.0.1:8001/api/auth/login | jq -r '.access_token')

# root_path 示例：macOS 用 /Users/qinyi/SillyHub；Windows 用 C:/Users/qinyi/IdeaProjects/multi-agent-platform
curl -fsS -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"root_path":"C:/Users/qinyi/IdeaProjects/multi-agent-platform"}' \
  http://127.0.0.1:8001/api/workspaces/scan | jq .

curl -fsS -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"SillyHub","slug":"sillyhub","root_path":"C:/Users/qinyi/IdeaProjects/multi-agent-platform","type":"app","role":"workspace","tech_stack":["FastAPI","Next.js","PostgreSQL","Redis","Docker Compose"],"build_command":"docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build -d","test_command":"make test"}' \
  http://127.0.0.1:8001/api/workspaces | jq .
```

> `root_path` 必须落在 compose 挂载进容器的目录下（`HOST_PROJECTS_DIR`→`/host-projects`），否则容器内 scanner 读不到。Windows 路径用正斜杠。

创建前先 `GET /api/workspaces`，如果已有相同 `root_path` 或 `slug`，不要重复创建。

## 常用维护命令

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
docker compose --env-file deploy/.env -f deploy/docker-compose.yml restart backend frontend
```

涉及数据卷删除或 `down -v` 时必须先确认用户接受数据清空风险。
