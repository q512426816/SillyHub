---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-25
title: Docker / 构建切换（deploy/docker-compose*.yml，daemon 镜像 Python→Node）
priority: P1
estimated_hours: 2
depends_on: [task-23]
blocks: []
allowed_paths:
  - deploy/
  - sillyhub-daemon/Dockerfile
---

# task-25

> Docker / 构建切换（deploy/docker-compose*.yml，daemon 镜像 Python→Node）
> P1 / 2h / depends_on [task-23] / blocks []

本任务为**条件任务**：design.md §6、tasks.md T-W5-05、proposal.md 动机 #2 均明确标注「**如涉及 daemon 镜像**」才执行。**第一步必须先做适用性判定**，再决定是「实施镜像切换」还是「记录为不适用」。

---

## 修改文件（依赖适用性判定）

### 适用性判定结果（2026-06-14 实测）

| 检查项 | 命令 | 结果 | 结论 |
|---|---|---|---|
| daemon 是否有 Dockerfile | `find . -iname "Dockerfile*"` | 仅 `frontend/Dockerfile`、`backend/Dockerfile`，**无 `sillyhub-daemon/Dockerfile`** | 无 daemon 镜像 |
| compose 是否有 daemon service | `grep daemon deploy/docker-compose*.yml` | services 仅 `postgres`/`redis`/`backend`/`frontend`，**无 daemon service** | 无 daemon 容器 |
| backend Dockerfile 是否打包 daemon | `grep daemon backend/Dockerfile` | **无引用**（backend 只装自己的 venv） | 无间接打包 |
| 全仓库 docker 文件是否引用 daemon | `grep -rni sillyhub[-_]daemon -- *.yml Dockerfile*` | 命中均在 `.sillyspec/docs/`（文档，非部署配置） | 无 |
| daemon 是否在 backend 容器内作为子进程启动 | `grep "python -m sillyhub_daemon" backend/` | **无** | 无 |

**最终结论：不适用（N/A）**。daemon 当前在本仓库**未被容器化**，无独立 Docker 镜像、无 compose service、backend 镜像也不打包 daemon。daemon 是 backend 通过子进程方式在宿主机本地启动的（见 `.sillyspec/.runtime/local.yaml` + `sillyhub-daemon/pyproject.toml`，本地 `python -m sillyhub_daemon`）。

因此本任务**不产生代码改动**，`allowed_paths` 实际为空（frontmatter 保留 `deploy/` 与 `sillyhub-daemon/Dockerfile` 仅为判定时读取），验收以「确认无 daemon 镜像需切换」为准。

### 若判定为「适用」时的预期改动清单（仅作参考，本次不执行）

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `sillyhub-daemon/Dockerfile`（当前不存在） | 新建/改写 | 基础镜像 `python:3.12-slim` → `node:20-alpine`（与 frontend 对齐） |
| `deploy/docker-compose.yml` | 修改 | 新增/改 `daemon` service 的 `build` / `command` |
| `deploy/docker-compose.dev.yml` | 修改（若 daemon 进 dev compose） | 通常 dev 不容器化 daemon，保持空 |
| `sillyhub-daemon/.dockerignore` | 新建 | 排除 `node_modules`、`tests`、`*.md` 等 |
| `.sillyspec/.runtime/local.yaml` | 修改（若部署命令引用镜像） | 本次检查未发现引用 |

---

## 实现要求

### R-01 适用性判定（本任务第一步，已完成）

依据 design.md §6「修改 `deploy/docker-compose*.yml`（**如涉及 daemon 镜像**）」与 tasks.md T-W5-05「**如涉及 daemon 镜像**」的条件约束，执行下列检查并据实判定：

1. `find . -iname "Dockerfile*" -o -iname "docker-compose*"` —— 是否存在 `sillyhub-daemon/Dockerfile`
2. `grep -niE "daemon" deploy/docker-compose*.yml` —— compose 是否定义 daemon service
3. `grep -niE "daemon|sillyhub_daemon" backend/Dockerfile backend/docker-entrypoint.sh` —— backend 镜像是否间接打包 daemon
4. `grep -rniE "sillyhub[-_]?daemon" --include="*.yml" --include="Dockerfile*" deploy/ sillyhub-daemon/` —— 全局引用扫描

四项均为「否」→ **判定为不适用**，记录到本节，跳过 R-02~R-05。

本次实测结果见上方「适用性判定结果」表，**判定为不适用**。

### R-02 镜像切换（仅在 R-01 判定为适用时执行，本次跳过）

- 基础镜像 `python:3.12-slim` → `node:20-alpine`（与 `frontend/Dockerfile` 的 `ARG NODE_VERSION=20` 对齐）
- 多阶段构建参考 `frontend/Dockerfile`：`deps` → `builder` → `runtime`
- runtime 阶段 `USER` 非 root（参考 frontend 的 `nextjs:nodejs` 1001:1001）

### R-03 安装步骤切换（仅适用时执行，本次跳过）

- `pip install --no-cache-dir uv` + `uv pip install -e .` → `corepack enable pnpm` + `pnpm install --frozen-lockfile` + `pnpm build`
- `package.json` / `pnpm-lock.yaml` 必须先 `COPY` 再 install（参考 frontend deps 阶段）
- 构建产物 `dist/` 由 `runtime` 阶段 `COPY --from=builder`

### R-04 启动命令切换（仅适用时执行，本次跳过）

- 容器 `CMD`：`["python", "-m", "sillyhub_daemon"]` → `["node", "dist/cli.js"]`
- compose `command:` 字段同步更新（若有 override）
- 端口：daemon 监听 `DAEMON_PORT`（默认 8001），compose `ports:` 映射

### R-05 镜像体积对比（仅适用时执行，本次跳过）

- 切换前：`docker images sillyhub-daemon:python --format "{{.Size}}"`
- 切换后：`docker images sillyhub-daemon:node --format "{{.Size}}"`
- 记录到本任务执行记录；预期体积不增（与 frontend 共用 `node:20-alpine` 基础层应减小）

### R-06（不适用路径）确认无残留

- 复跑 R-01 的 4 条 grep 命令，确认全仓库 docker 相关文件**无任何 `python`/`sillyhub_daemon` 残留引用指向 daemon**
- 确认 `deploy/.env`、`deploy/.env.example` 中无 `DAEMON_IMAGE` / `DAEMON_DOCKER_*` 变量

---

## 接口定义

### 路径 A：不适用（本次实际路径）—— 判定记录模板

本任务不产出代码，仅产出「不适用判定记录」。判定记录已固化在本文件「适用性判定结果」表中，模板如下（任何后续复查可直接复用）：

```
## task-25 适用性判定记录（模板）
- 判定日期：YYYY-MM-DD
- 判定人：qinyi
- 依据文档：design.md §6 / tasks.md T-W5-05（均带「如涉及 daemon 镜像」限定）
- 检查 1 daemon Dockerfile 存在性：[是/否] —— 命令与结果
- 检查 2 compose daemon service：[是/否] —— 命令与结果
- 检查 3 backend 镜像间接打包 daemon：[是/否] —— 命令与结果
- 检查 4 全局 docker 文件引用：[是/否] —— 命令与结果
- 最终结论：[适用 / 不适用]
- 若不适用：allowed_paths 实际为空，AC-01~AC-06 中 AC-02~AC-05 自动满足（无可改之物），AC-06 为关键验收
```

### 路径 B：适用时 —— Dockerfile 改动骨架（本次不执行，仅存档参考）

```dockerfile
# sillyhub-daemon/Dockerfile（适用时才创建）
ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine AS deps
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
      else pnpm install --no-frozen-lockfile; fi

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 daemon
COPY --from=builder --chown=daemon:nodejs /app/dist ./dist
COPY --from=builder --chown=daemon:nodejs /app/package.json ./
USER daemon
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8001/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/cli.js"]
```

### 路径 B：适用时 —— compose service 改动（本次不执行）

```yaml
# deploy/docker-compose.yml 新增（适用时）
  daemon:
    build:
      context: ../sillyhub-daemon
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_started
    env_file:
      - .env
    environment:
      DAEMON_PORT: ${DAEMON_PORT:-8001}
      HUB_API_BASE_URL: http://backend:8000
    ports:
      - "${DAEMON_PORT:-8001}:8001"
```

---

## 边界处理

1. **daemon 无 Docker 配置（本次实际情况）**：本任务判定为不适用，不创建任何文件，不改 compose，仅在本蓝图记录判定过程与命令；后续若仓库新增 daemon 容器化（例如独立 daemon 镜像 / K8s / 单独 compose service），应重新打开本任务或新立 change。

2. **镜像与 frontend 共用基础镜像冲突**：design.md 动机 #2 提到「与 frontend 共用基础镜像」。本次不涉及；若将来 daemon 容器化，应直接复用 `node:20-alpine`（与 `frontend/Dockerfile` 的 `ARG NODE_VERSION=20` 一致），**不要**引入第三种基础镜像（如 `node:20-slim` 或 `node:22`），否则违背「共用」目的。

3. **构建上下文路径**：compose `build.context` 当前 backend 用 `../backend`、frontend 用 `../frontend`（相对 `deploy/`）。若 daemon 容器化，应为 `../sillyhub-daemon`；`.dockerignore` 必须存在以排除 `node_modules`、`dist`、`tests`、`*.md`（参考 `backend/.dockerignore` 排除 `tests/`、`**/*.md`）。

4. **多阶段构建**：daemon Dockerfile 必须三阶段（deps / builder / runtime），runtime 阶段不携带 `node_modules` 中的 devDependencies（`pnpm install --prod` 或 `pnpm fetch` + `--filter`）；否则镜像体积反而增大，违背 R-05。

5. **`.dockerignore` 缺失风险**：daemon 目前无 `.dockerignore`（实测 `sillyhub-daemon/` 下无该文件）。若将来容器化，必须新建，排除 `node_modules/`、`dist/`、`tests/`、`coverage/`、`.env*`（保留 `.env.example`）、`*.log`，否则构建上下文会把 `node_modules` 打进发送给 daemon 的 build context，拖慢构建。

6. **Node 版本对齐 20**：`frontend/Dockerfile` 与 `backend/Dockerfile`（node-tools 阶段）均锁 `NODE_VERSION=20`。daemon 若容器化也必须用 20，避免 monorepo 内出现两个 Node 大版本（导致 `pnpm-lock.yaml` 兼容性、`dist/` 产物 ABI 差异等问题）。

7. **pnpm 在 Docker 的 corepack 配置**：`frontend/Dockerfile` 用 `RUN corepack enable pnpm`（无版本钉死）。daemon 应同样依赖 corepack 拉 `package.json` 的 `packageManager` 字段；若 daemon `package.json` 未设 `packageManager`，需补 `pnpm@9.x` 字段以保证镜像内 pnpm 版本可复现。

---

## 非目标

- **不做 backend 镜像改动**：backend Dockerfile 仍基于 `python:3.12-slim`（FastAPI 后端），本任务不动。backend 的 node-tools 阶段（装 claude-code / sillyspec）保持原状。
- **不做 K8s manifest**：仓库当前无 K8s 配置（无 `k8s/`、无 `*.yaml` deployment），不引入。
- **不做镜像签名**（cosign / notation）：当前 CI 未启用签名，不在本任务范围。
- **不做多架构 build**（`buildx --platform linux/amd64,linux/arm64`）：现有 `frontend/Dockerfile` / `backend/Dockerfile` 均未配置多架构，daemon 也不引入。
- **不做 CI/CD 流水线改动**（GitHub Actions / 构建镜像的 workflow）：本任务限定 `deploy/` 与 `sillyhub-daemon/Dockerfile`，不碰 `.github/workflows/`。
- **不重新评估 daemon 容器化决策**：daemon 是否应该容器化是另一个独立 change 的话题，本任务只判定「现状是否需要切换」。

---

## 参考

- **design.md §6**（`/Users/qinyi/SillyHub/.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/design.md`）
  - L21：「部署统一：当前 Docker 镜像需为 daemon 单独装 Python 运行时；Node 化后可与 frontend 共用基础镜像」——**前提是 daemon 已容器化**，本次实测未容器化。
  - L124：「修改 `deploy/docker-compose*.yml`（**如涉及 daemon 镜像**）」——条件限定。
  - L267 R-07：「W5 前 Python 版不进新镜像；W5 切换入口并删除 Python 源码」——本次 Python 版从未进过镜像，故无需切换。
- **tasks.md T-W5-05**（`/Users/qinyi/SillyHub/.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/tasks.md` L53）：「Docker/构建切换（**如涉及 daemon 镜像**）— `deploy/docker-compose*.yml`」
- **proposal.md 动机 #2**（`/Users/qinyi/SillyHub/.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/proposal.md` L21）：「部署镜像臃肿：Docker 镜像需为 daemon 单独安装 Python 运行时」——**该前提在当前仓库不成立**（daemon 未进镜像），故动机 #2 在 Docker 维度无对象可优化；Node 化的收益主要体现在「不再需要为本地运行 daemon 装 Python 环境」（属 task-24 删除 Python 源码的范畴）。
- **deploy/ 实际配置**：
  - `/Users/qinyi/SillyHub/deploy/docker-compose.yml`：services = postgres + redis + backend + frontend，**无 daemon**
  - `/Users/qinyi/SillyHub/deploy/docker-compose.dev.yml`：services = postgres + redis（dev 仅基础设施）
- **frontend Dockerfile**（`/Users/qinyi/SillyHub/frontend/Dockerfile`）：若将来 daemon 容器化，参考其三阶段 + `node:20-alpine` + `corepack enable pnpm` 模式。
- **backend Dockerfile**（`/Users/qinyi/SillyHub/backend/Dockerfile`）：node-tools 阶段装 claude-code / sillyspec，与 daemon 无关，本任务不动。
- **`.sillyspec/.runtime/local.yaml`：本次 grep 无 daemon 部署命令引用（daemon 走宿主机子进程，非容器）。

---

## TDD 步骤

### 路径 A（不适用，本次实际路径）

1. **复跑适用性判定 4 条 grep**（在执行阶段由实施者再跑一遍，确保判定可复现）：
   ```bash
   # 1. daemon Dockerfile 存在性
   find /Users/qinyi/SillyHub -iname "Dockerfile*" -not -path "*/node_modules/*" -not -path "*/.git/*"
   # 期望：仅 frontend/Dockerfile + backend/Dockerfile，无 sillyhub-daemon/Dockerfile

   # 2. compose daemon service
   grep -niE "daemon" /Users/qinyi/SillyHub/deploy/docker-compose*.yml
   # 期望：无输出（empty）

   # 3. backend 镜像是否打包 daemon
   grep -niE "daemon|sillyhub_daemon" /Users/qinyi/SillyHub/backend/Dockerfile /Users/qinyi/SillyHub/backend/docker-entrypoint.sh
   # 期望：无输出

   # 4. 全局 docker 文件引用
   grep -rniE "sillyhub[-_]?daemon" --include="*.yml" --include="Dockerfile*" --include=".dockerignore" /Users/qinyi/SillyHub/deploy/ /Users/qinyi/SillyHub/sillyhub-daemon/ 2>/dev/null
   # 期望：无输出（或仅在 .sillyspec/docs/ 下，非部署配置）
   ```
2. **记录判定**：将上述 4 条命令的实际输出填入「适用性判定记录」模板，结论 = 不适用。
3. **无需 docker build / docker run**：没有 Dockerfile 可构建。

### 路径 B（适用时，本次不走）

1. `cd sillyhub-daemon && docker build -t sillyhub-daemon:node .` —— 构建成功
2. `docker run --rm -e DAEMON_PORT=8001 -p 8001:8001 sillyhub-daemon:node` —— 容器启动，`curl http://127.0.0.1:8001/health` 返回 200
3. `docker run --rm sillyhub-daemon:node node -e "console.log(require('./package.json').version)"` —— 版本可读
4. `docker images sillyhub-daemon:node --format "{{.Size}}"` 与切换前 `:python` 对比，记录差值
5. `docker compose -f deploy/docker-compose.yml config` —— compose 语法校验通过

---

## 验收标准

| ID | 验收项 | 验证方法 | 通过标准 | 状态（本次） |
|---|---|---|---|---|
| AC-01 | 适用性判定明确且可复现 | 复跑「TDD 路径 A」4 条 grep，对照「适用性判定记录」 | 4 条命令输出与记录一致；结论为「适用」或「不适用」二选一，非空泛 | ✅ 已判定为「不适用」，4 条命令输出已固化在「适用性判定结果」表 |
| AC-02 | 若适用：daemon 镜像 Node 化（基础镜像 python→node:20-alpine） | 读 `sillyhub-daemon/Dockerfile` 的 `FROM` 行 | `FROM node:20-alpine`（与 frontend 一致） | ➖ 不适用（无 daemon Dockerfile） |
| AC-03 | docker build 成功（适用时） | `docker build -t sillyhub-daemon:node sillyhub-daemon/` | 退出码 0，镜像生成 | ➖ 不适用（无 Dockerfile 可 build） |
| AC-04 | 启动命令为 `node dist/cli.js`（适用时） | 读 Dockerfile `CMD` + compose `command` | `CMD ["node", "dist/cli.js"]` | ➖ 不适用（daemon 走宿主机 `pnpm dev` / `node dist/cli.js`，本任务不涉及容器 CMD） |
| AC-05 | 镜像体积不增或减小（适用时） | `docker images --format` 对比 :python vs :node | node ≤ python | ➖ 不适用（无 :python 镜像可对比） |
| AC-06 | 若不适用：确认全仓库 docker 配置无残留 Python/daemon 引用指向 daemon | 复跑 AC-01 第 4 条全局 grep | `deploy/` + `sillyhub-daemon/` 下 docker 文件**零命中** `sillyhub[-_]?daemon` 与 `python.*daemon` 组合 | ✅ 本次实测：deploy/ 与 sillyhub-daemon/ 下 docker 相关文件零 daemon 引用；backend Dockerfile 不打包 daemon |

**总判定**：AC-01 + AC-06 通过即视为本任务完成（不适用路径）。AC-02~AC-05 标记 ➖（不适用，自动豁免）。

---

## 执行记录（实施时填写）

| 字段 | 值 |
|---|---|
| 执行日期 | 2026-06-14（蓝图生成；代码执行待 task-23 完成后） |
| 执行人 | qinyi |
| 走哪条路径 | 路径 A（不适用） |
| AC-01 命令复跑结果 | （执行时填） |
| AC-06 grep 结果 | （执行时填） |
| 是否产生代码改动 | 否 |
| 是否产生新文件 | 否 |
| 备注 | 本任务为条件任务，判定不适用即合规；无需补建 daemon Dockerfile（容器化是独立决策，不在本 change 范围） |
