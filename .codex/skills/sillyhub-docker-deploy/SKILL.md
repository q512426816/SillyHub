---
name: sillyhub-docker-deploy
description: 用于把当前 SillyHub / multi-agent-platform 项目部署到本机 Docker Compose，并配置局域网访问。适合用户说"部署到 docker"、"局域网内可以访问"、"重启 Docker 部署"、"添加 workspace 指向本项目"、"修复 Docker Compose 启动/健康检查/端口/前后端代理问题"。
---

# SillyHub Docker 部署

## 目标

把当前仓库用 `deploy/docker-compose.yml` 启动为完整服务栈：

- frontend: Next.js
- backend: FastAPI（python API + 静态分发：技能 manifest/bundle、daemon bundle；agent 执行在宿主 daemon，容器内无 claude/node 二进制——2026-10-08 瘦身）
- postgres
- redis

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
print("SILLYSPEC_MASTER_KEY=v1:" + secrets.token_hex(32))  # crypto.py 要 hex，不是 base64（token_urlsafe 会致解密端点 500）
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

后端镜像职责 = python API + 静态分发（技能 manifest/bundle、daemon bundle）；agent 执行全在宿主 daemon（2026-10-08 起 claude/node 二进制已随 server-local 遗物清出镜像，见 thin 2026-10-08-backend-image-slim-no-claude）。检查 `backend/Dockerfile`：

- Node runtime stage 仅安装 SillySpec（npm 包，技能源；SILLYSPEC_VERSION 空 → 取最新 + SILLYSPEC_REFRESH 时间戳爆破缓存，填值 → pin）：
  ```bash
  npm install -g sillyspec${SILLYSPEC_VERSION:+@$SILLYSPEC_VERSION}
  ```
- 技能与版本件从 sillyspec 包 COPY：`/app/sillyspec-skills/`（manifest/bundle 端点读）+ `/app/sillyspec-package.json`（无 node 环境的版本回显锚点）；runtime 无 node/npm/claude/sillyspec 二进制。
- runtime apt 依赖包含 `git`（COMMIT_SHA 回退探测与 diff 收集 exec 它）。
- runtime stage 接收 `ARG COMMIT_SHA` 并 `ENV COMMIT_SHA=${COMMIT_SHA:-}`，让 `/api/health` 的 `commit_sha` 反映镜像版本（backend build context 是 `backend/`、不含仓库 `.git`，必须由 build arg 注入，否则恒为 `unknown`）。

检查 `deploy/docker-compose.yml` 的 backend.build：

```yaml
backend:
  build:
    context: ../backend
    # daemon 分发物（install.sh + sillyhub-daemon.js）由宿主机预构建后注入；
    # 部署前必须 cd sillyhub-daemon && pnpm bundle 产出 build/bundle/。
    additional_contexts:
      daemon: ../sillyhub-daemon
    args:
      SILLYSPEC_VERSION: ${SILLYSPEC_VERSION:-}   # 空 = 取最新
      SILLYSPEC_REFRESH: ${SILLYSPEC_REFRESH:-}   # 时间戳爆破 npm 层缓存（打包脚本自动导出）
      COMMIT_SHA: ${COMMIT_SHA:-}                 # 启动前 export，见「启动」节
  env_file:
    - .env
  environment:
    HOME: /app
```

> 版本号以 `deploy/docker-compose.yml` 实际 build args 为准，本文档中的数字仅为示例，可能滞后。
>
> **daemon 一键安装分发**：backend 通过 `additional_contexts: daemon` 把宿主机预构建的 `sillyhub-daemon/build/bundle/sillyhub-daemon.js` 与 `scripts/install.sh` 拷进镜像 `/app/daemon-dist/`，再由 3 个公开端点（无 `/api` 前缀）`GET /daemon/install.sh`、`GET /daemon/latest.json`、`GET /daemon/latest/sillyhub-daemon.js` 提供，使 `curl <SERVER>/daemon/install.sh | bash` 可用。daemon 代码改动后须重跑 `pnpm bundle` 再重建 backend。

2026-10-08 起：容器内无 claude、无 `.claude/settings.json` 生成、无 claude-data 卷挂载——`.env` 里的 `ANTHROPIC_*`/`CLAUDE_*` 行对容器为惰性变量（agent 凭据走宿主 daemon 自身配置，不经容器）。

（以下 Claude Code 容器配置已退役，2026-10-08 容器内无 claude，仅作历史参考；agent 模型配置走宿主 daemon 侧：）


```env
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
API_TIMEOUT_MS=3000000
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.2
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2
ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.2
CLAUDE_CODE_MODEL=opus
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

部署前两步准备（每次重建 backend 都要做，且必须在同一个 shell 里执行，让环境变量对 compose 生效）：

1. **构建 daemon bundle**（供 `/daemon/install.sh` 一键安装；首次或 daemon 代码改动后必跑）：
   ```bash
   pnpm -C sillyhub-daemon install --frozen-lockfile
   pnpm -C sillyhub-daemon run bundle        # 产出 build/bundle/sillyhub-daemon.js
   ```
2. **注入 git SHA**（让 `/api/health` 的 `commit_sha` 与前端版本标识反映当前 commit；不导出则 backend 恒为 `unknown`）：
   ```bash
   export COMMIT_SHA=$(git rev-parse --short=12 HEAD)
   export NEXT_PUBLIC_COMMIT_SHA="$COMMIT_SHA"
   ```

   > ⚠️ **本机（Windows）重新部署建议跳过此步，不要 `export COMMIT_SHA`。** 实测（Docker 29 / Compose v5，Windows，清华 Debian trixie 镜像）：一旦 `COMMIT_SHA` 非空，backend runtime stage 的 `apt-get` 层会因 `ARG` 变化 cache-miss 重跑，撞清华 trixie 镜像抖动 → 构建 `exit 100` 失败。不导出（默认空）则 apt 层缓存命中跳过，构建稳定，代价仅是 `commit_sha=unknown`。**本地迭代优先稳定，接受 `unknown`**；确需真实 SHA 时，改为绕开 apt 层（固定离线 trixie 镜像，或分步只 COPY 代码层重建），不要直接 `export COMMIT_SHA` 触发全量重建。

然后启动（同一 shell）：

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

验证后端容器基础工具与 sillyspec 版本件（2026-10-08 起容器内无 node/claude/sillyspec 二进制）：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'git --version && curl --version | head -1 && cat /app/sillyspec-package.json | grep -m1 version'
```

> `/app/sillyspec-package.json` 的 version 反映构建时装入的 sillyspec 版本（技能随同包走；`.env` 不设 `SILLYSPEC_VERSION` = 取最新；需固定则回填版本号并重建）。

验证 daemon 一键安装分发（`curl <SERVER>/daemon/install.sh | bash` 依赖的公开端点，无 `/api` 前缀）：

```bash
curl -fsS http://127.0.0.1:8001/api/health        # commit_sha 应为真实 git short SHA，非 unknown
curl -fsS http://127.0.0.1:8001/daemon/install.sh | head -n 3
curl -fsS http://127.0.0.1:8001/daemon/latest.json
curl -fsSI http://127.0.0.1:8001/daemon/latest/sillyhub-daemon.js
# install.sh 经 Windows core.autocrlf=true 易被搞成 CRLF，curl|bash 会报
# `set: pipefail: invalid option name`。bash -n 确认 LF 干净（Dockerfile 已
# 对 /app/daemon-dist/install.sh 做 sed 's/\r$//'，.gitattributes 强制 *.sh eol=lf）。
curl -fsS http://127.0.0.1:8001/daemon/install.sh | bash -n && echo SYNTAX_OK
```

- `latest.json` 应为 `{"version":"...","downloadUrl":"/daemon/latest/sillyhub-daemon.js"}`
- `sillyhub-daemon.js` 应返回 `200` + `application/javascript`
- `commit_sha` 为 `unknown` → 启动前未 `export COMMIT_SHA`（见「启动」节）。**注意：本机（Windows）按上文豁免故意不传，`unknown` 是稳定性权衡的预期结果，非缺陷。**
- 任一 `/daemon/*` 返回 `404` → daemon bundle 没构建进镜像，回「启动」节先 `pnpm bundle` 再 `--build --force-recreate` 重建 backend

（已退役，2026-10-08 起容器内无 claude、无 /app/.claude/settings.json——agent 凭据与模型配置在宿主 daemon 侧管理，本节验证不再适用。）

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
  -d '{"email":"admin@sillyhub.local","password":"<上面 .env 设的 PLATFORM_BOOTSTRAP_ADMIN_PASSWORD>"}' \
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
