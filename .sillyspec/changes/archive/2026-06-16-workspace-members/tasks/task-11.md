---
id: task-11
title: Docker compose 重建 backend + frontend；e2e 验证（admin 加成员 → 成员访问 ws 资源不再 403 → transfer ownership → 移除 → 最后 owner 保护）
priority: P0
estimated_hours: 1.5
depends_on: [task-10]
blocks: [task-12]
allowed_paths: []
---

# Task-11 — Docker compose 重建 + e2e 验收

## 1. 目标

在 Docker Compose 完整栈上对 workspace-members 全流程做端到端验收，验证 task-01..10 的代码改动确实进入镜像、容器、并对外服务：

- backend / frontend 镜像必须 `--build --force-recreate` 重建（**代码构建进镜像，无 bind-mount，不重建就是旧代码**）
- `docker compose ps` 4 个服务全部 healthy
- 用 `curl` 跑通 6 个端点的 happy path（list / search / add / update / delete / transfer-ownership）+ 关键负向断言（最后 owner 保护、role 白名单）
- 用浏览器跑 UI 验收：Members tab、Add Member 对话框、Set Owner、Remove、权限禁用
- 关键不变量：加 developer 后该用户调 `/api/workspaces/{id}` 不再 403（**修复 2026-06-16-daemon-api-key 暴露的连带归属问题**）

依据文档：

- `plan.md` 第 53 行 task-11 描述
- `plan.md` 第 56-66 行验收标准（特别是"加 developer 后访问 ws 资源不再 403"、"最后 owner 保护 400 cannot_remove_last_owner"、"role_key 白名单 400 invalid_role_key"）
- `requirements.md` FR-01..08（端点 GWT）+ NFR 兼容性（daemon 用 admin API key 访问 ws run 不再 403）
- `design.md` §5.1 6 个端点表 + §10 R-05 端到端测试覆盖（加 developer 后调 `/api/workspaces/{id}` 应可访问）
- `.claude/skills/sillyhub-docker-deploy/SKILL.md` 启动 / 验证 / 容器内 grep 章节

## 2. 修改文件

**无文件修改**。本任务是纯运维 + 手动 e2e 验收，只在 `deploy/` 之外（CLI 操作 + 浏览器）。

| 操作 | 对象 | 说明 |
|------|------|------|
| 重建镜像 | `multi-agent-platform-backend` 镜像 | compose `up --build` 触发，文件不动 |
| 重建容器 | `multi-agent-platform-backend-1` / `multi-agent-platform-frontend-1` | `--force-recreate` 强制丢弃旧容器 |
| 手动 curl | 6 个 members 端点 + 1 个 `/api/workspaces/{id}` 归属验证 | 仅读操作 + DB 写操作，不修改源码 |
| 浏览器 UI | `/workspaces/{id}/members` 页面 + Add 对话框 | 不修改源码 |

## 3. 实现要求

1. **必须用 `--env-file deploy/.env -f deploy/docker-compose.yml`** 双参数，不能依赖宿主 shell 的 `cd deploy/` 后 `docker compose up`（路径解析会出错）

2. **必须同时带 `--build` 和 `--force-recreate`**（skill 文档明确警告："镜像重建了但容器没重建，运行的仍是旧代码"）

3. **重建后必须做"容器内代码校验"**（skill 文档"验证"节）：
   - 后端容器内 `grep -c "transfer_ownership" app/modules/workspace/members_service.py` 应 ≥ 1
   - 后端容器内 `grep -c "WorkspaceMemberView" app/modules/workspace/schema.py` 应 ≥ 1
   - 计数为 0 说明仍是旧代码 → 回到第 2 步重做

4. **curl 用 `127.0.0.1` 而非 `localhost`**（skill 文档警告：Windows git-bash 下 `localhost` 会 `Empty reply from server`）

5. **登录 token 用 `jq -r '.access_token'`** 提取，admin 账号来自 `deploy/.env` 的 `PLATFORM_BOOTSTRAP_ADMIN_EMAIL=admin@sillyhub.local` / `PASSWORD=admin123`

6. **测试用户准备**：e2e 至少需要 2 个 user（admin + 1 个被邀请的普通用户）。若库里只有 admin，用 `POST /api/auth/register` 创建一个新用户 `member_e2e@test.local / Member123!@#`，并取该用户的 login token

7. **transfer-ownership 测试需要 2 个有 token 的会话**：admin（当前 owner）和 member_e2e（先被加为 developer）。transfer 后用 admin 的旧 token 调 list，admin 应显示为 developer，member_e2e 显示为 workspace_owner

8. **UI 验收必须浏览器手动跑**，不要用 curl 替代（验证前端 apiFetch / dialog 状态机 / 权限禁用 / "(you)" 标识）

9. **本任务数据可清空**（CLAUDE.md 规则 7），测试用 workspace 可用 admin 自带 ws，也可 `POST /api/workspaces` 新建一个 `e2e-members-ws`

10. **端口固定 8001 / 3001**（来自 `deploy/.env`），不接受 8000 / 3000 默认值（与本地进程冲突）

## 4. 接口定义

### 4.1 镜像 + 容器重建

```bash
# 先确保 deploy/.env 存在（已存在则跳过）
[ -f deploy/.env ] || cp deploy/.env.example deploy/.env

# 重建 backend + frontend 镜像并强制重建容器（保留 postgres / redis 不重启）
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d backend frontend
```

> 若 backend 改动较大或怀疑依赖缓存，加 `--no-cache`：`up --build --no-cache --force-recreate -d backend frontend`（构建慢但确定干净）

### 4.2 容器健康检查

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

期望：4 个服务全部 `Up` 或 `healthy`（postgres / redis 有 healthcheck；backend / frontend 是 `restart: unless-stopped` 无 healthcheck，看 `Up` 即可）

```bash
curl -fsS http://127.0.0.1:8001/api/health
curl -fsS http://127.0.0.1:3001/api/health
```

期望：均返回 `{"status":"ok",...}`，backend 还含 `"db":"ok","redis":"ok"`

### 4.3 容器内代码校验（确认新代码进镜像）

```bash
# members_service 应存在 transfer_ownership
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'grep -c "transfer_ownership" app/modules/workspace/members_service.py'
# schema 应存在 WorkspaceMemberView
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'grep -c "WorkspaceMemberView" app/modules/workspace/schema.py'
# members_router 应有 6 个端点（GET / GET /search POST / PATCH / DELETE / POST transfer-ownership）
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'grep -cE "@router\.(get|post|patch|delete)" app/modules/workspace/members_router.py'
```

期望：3 个计数分别 ≥ 1 / ≥ 1 / ≥ 6；任一为 0 即镜像没更新

### 4.4 准备 token + workspace_id + 普通用户

```bash
# admin token
ADMIN_TOKEN=$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"email":"admin@sillyhub.local","password":"admin123"}' \
  http://127.0.0.1:8001/api/auth/login | jq -r '.access_token')

# 创建/复用一个测试 ws
WS_ID=$(curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:8001/api/workspaces | jq -r '.items[0].id // .[0].id')

# 注册普通用户（幂等：若已存在则 login）
curl -fsS -H 'Content-Type: application/json' \
  -d '{"email":"member_e2e@test.local","password":"Member123!@#","display_name":"Member E2E"}' \
  http://127.0.0.1:8001/api/auth/register || true

# 普通用户 token
MEMBER_TOKEN=$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"email":"member_e2e@test.local","password":"Member123!@#"}' \
  http://127.0.0.1:8001/api/auth/login | jq -r '.access_token')

# 普通用户 user_id（登录响应通常含 user.id；若不含，用 /api/users/me 取）
MEMBER_USER_ID=$(curl -fsS -H "Authorization: Bearer $MEMBER_TOKEN" \
  http://127.0.0.1:8001/api/users/me | jq -r '.id')
```

### 4.5 端点 happy path（6 个端点）

> 注：以下顺序按"加成员 → 验证不再 403 → 改角色 → 移交所有权 → 移除 → 最后 owner 保护"业务流程，不按 URL 字母序

#### 4.5.1 GET `/api/workspaces/{WS_ID}/members`（list，admin 视角）

```bash
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members | jq .
```

期望：HTTP 200，`items` 至少含 1 行（admin 自己，`role_key: "workspace_owner"`，`is_current_user: true` 当 admin token 调用时）

#### 4.5.2 GET `/api/workspaces/{WS_ID}/members/search?q=member&limit=10`（search）

```bash
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:8001/api/workspaces/$WS_ID/members/search?q=member&limit=10" | jq .
```

期望：HTTP 200，`items` 含 `member_e2e@test.local`（active 用户，未加成员前出现在搜索结果）

#### 4.5.3 POST `/api/workspaces/{WS_ID}/members`（add）

```bash
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$MEMBER_USER_ID\",\"role_key\":\"developer\"}" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members | jq .
```

期望：HTTP 201，返回新增的 `WorkspaceMemberView`，`role_key: "developer"`

#### 4.5.4 关键不变量：新成员访问 ws 资源不再 403

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $MEMBER_TOKEN" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID
```

期望：HTTP **200**（修复 `2026-06-16-daemon-api-key` 暴露的归属 403 问题；design.md §10 R-05 端到端覆盖要求）

#### 4.5.5 PATCH `/api/workspaces/{WS_ID}/members/{MEMBER_USER_ID}`（update role）

```bash
curl -fsS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role_key":"viewer"}' \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members/$MEMBER_USER_ID | jq .
```

期望：HTTP 200，`role_key` 由 developer 改为 viewer

#### 4.5.6 POST `/api/workspaces/{WS_ID}/members/{MEMBER_USER_ID}/transfer-ownership`

> 前置：先把 member_e2e 改回 developer（4.5.5 改成了 viewer，transfer 前必须先升 developer，否则业务规则可能拒绝；视实现，安全起见先升 developer）

```bash
# 先升 developer
curl -fsS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role_key":"developer"}' \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members/$MEMBER_USER_ID > /dev/null

# 再 transfer
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members/$MEMBER_USER_ID/transfer-ownership | jq .
```

期望：HTTP 200，返回 `{new_owner: {...member_e2e...}, demoted: {...admin...}}`

#### 4.5.7 验证 transfer 后角色互换（用 ADMIN 旧 token list）

```bash
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members | jq '.items[] | {email, role_key}'
```

期望：admin 的 `role_key: "developer"`；member_e2e 的 `role_key: "workspace_owner"`

#### 4.5.8 DELETE `/api/workspaces/{WS_ID}/members/{MEMBER_USER_ID}`（用新 owner token）

> transfer 后 admin 已是 developer，无 `WORKSPACE_MEMBER_MANAGE` 权限，必须用新 owner（member_e2e）的 token 调 delete

```bash
# 把 admin 加回 developer（新 owner member_e2e 操作）
curl -fsS -X PATCH -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role_key":"developer"}' \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members/<ADMIN_USER_ID> > /dev/null

# member_e2e (当前 owner) 移除 admin (developer)
curl -fsS -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $MEMBER_TOKEN" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members/<ADMIN_USER_ID>
```

期望：HTTP **204**

#### 4.5.9 最后 owner 保护（移除最后一个 owner → 400）

```bash
# 现在只剩 member_e2e 是 owner；尝试移除 member_e2e 自己
# 用 admin 重新登（admin 已不在 ws，需先 admin 把自己加回来 — 或更简单：直接尝试用 member_e2e 自己移除自己）
curl -fsS -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $MEMBER_TOKEN" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members/$MEMBER_USER_ID
```

期望：HTTP **400**，错误 code = `cannot_remove_last_owner`

#### 4.5.10 负向断言：role_key 白名单（POST platform_admin）

```bash
# 先把 admin 加回来（用 member_e2e token）
curl -fsS -X POST -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"<ADMIN_USER_ID>\",\"role_key\":\"developer\"}" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members > /dev/null

# 再尝试加 platform_admin
curl -fsS -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$MEMBER_USER_ID\",\"role_key\":\"platform_admin\"}" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members
```

期望：HTTP **400**，错误 code = `invalid_role_key`

### 4.6 浏览器 UI 验收步骤

前置：浏览器登录 admin（`http://127.0.0.1:3001/login`，`admin@sillyhub.local / admin123`）

| 步骤 | 操作 | 期望 |
|------|------|------|
| UI-1 | 访问 `/workspaces/{WS_ID}` | 顶部 tab 栏：Overview / Components / Changes / Members；Overview 高亮 |
| UI-2 | 点击 Members tab | URL 变为 `/workspaces/{WS_ID}/members`；Members 高亮；显示成员表格，含 "+ Add Member" 按钮（admin 是 owner，按钮可点） |
| UI-3 | 表格当前用户行 | admin 自己行末尾显示 "(you)" 标识；role dropdown 选中 workspace_owner；Set Owner 和 Remove 按钮 disabled |
| UI-4 | 点 "+ Add Member" | 对话框打开，含搜索 input + 候选区 + 角色 dropdown（默认 developer）+ Cancel/Add 按钮；Add 在未选中候选时 disabled |
| UI-5 | 搜索框输入 "member" | debounce 300ms 后调 search；候选区显示 `member_e2e@test.local (Member E2E)`；点击选中后高亮；Add 按钮启用 |
| UI-6 | 选 developer + 点 Add | 对话框关闭；表格刷新；新行 `Member E2E (member_e2e@test.local)` role = developer 出现在表格 |
| UI-7 | 在 member_e2e 行 role dropdown 改成 viewer | onChange 触发 PATCH；刷新后 role 显示 viewer |
| UI-8 | 在 member_e2e 行点 "Set Owner" | confirm 后调 transfer-ownership；刷新后 admin 显示 developer "(you)"，member_e2e 显示 workspace_owner；admin 视角下 "+ Add Member" 按钮 disabled（admin 已是 developer，无 manage 权限） |
| UI-9 | 浏览器切换登录 member_e2e（隐身窗口 / 退出再登录） | member_e2e 视角下 Members tab：自己行有 "(you)"，role = workspace_owner，Set Owner / Remove disabled；admin 行可改 role / Set Owner / Remove |
| UI-10 | viewer 视角权限禁用（把 admin 降为 viewer 后用 admin token 访问） | Members tab 仍可见；表格只读，无 "+ Add Member"、无 role dropdown、无 Set Owner / Remove 按钮（task-09 决策：显示但禁用） |
| UI-11 | 错误条：故意触发失败（如添加已是成员的用户改为 platform_admin — UI 不暴露 platform_admin 选项，故用 curl 验证；或断网后点 Add） | 顶部红色错误条；对话框保持打开 |

### 4.7 收尾命令

```bash
# 查看实时日志（验证无 500 异常）
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f backend frontend

# 数据可清空场景：把测试数据回退（admin 加回 owner）
curl -fsS -X POST -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"<ADMIN_USER_ID>\",\"role_key\":\"workspace_owner\"}" \
  http://127.0.0.1:8001/api/workspaces/$WS_ID/members > /dev/null
```

## 5. 边界处理

1. **镜像没更新但容器重启了**（最常见的隐性失败）：必须加 `--force-recreate`；重建后用 4.3 节"容器内 grep"校验关键函数计数 ≥ 1，计数为 0 立即回 `--build --no-cache --force-recreate`。**禁止跳过校验直接进 4.4**。

2. **端口冲突（8000/3000 被本地进程占）**：本任务固定用 `deploy/.env` 的 `BACKEND_PORT=8001` / `FRONTEND_PORT=3001`；不接受默认值；若 8001/3001 也被占（极少见），先 `docker compose ... ps` 确认是不是本栈残留，残留则 `down` 再 `up`，外部进程则提示用户停掉。

3. **admin token 失效**（重启 backend 后旧 token 仍可用，但 SECRET_KEY 变了会失效）：所有 curl 失败先重试 login 重新取 `$ADMIN_TOKEN`；不要假设 token 跨重建保留。

4. **搜索无结果**：先确认目标用户 `status='active'`（注册默认是 active）；若用 disabled 用户测试，搜索会排除（FR-02 第 3 个 GWT）；建议在 4.4 创建的 `member_e2e@test.local` 保持 active。

5. **transfer-ownership 后 ADMIN_TOKEN 调写操作 403**：transfer 后 admin 从 owner 变 developer，失去 `WORKSPACE_MEMBER_MANAGE` 权限；后续 PATCH / DELETE 必须用 MEMBER_TOKEN（新 owner）；用错 token 返 403 是**预期行为**，不是 bug。

6. **add 端点对已是成员的用户**：返回 200 而非 201（FR-03 第 2 个 GWT 幂等更新）；测试 4.5.3 时若 member_e2e 已是成员会得到 200，断言应放宽到"200 或 201"。

7. **HTTP 状态码与 design 不一致**：design.md §7 错误表写 400 `cannot_remove_last_owner` / `invalid_role_key`，但实际后端可能返 422（Pydantic Literal）或 400（service 层 ValueError）；task-03 已规定 service 层抛业务异常 → 400，端点用 `Literal` 是请求体格式校验（422）。验收以**实际返回的 error code 字段**为准，HTTP 码 400/422 都接受，但 code 必须是 `cannot_remove_last_owner` / `invalid_role_key`。

8. **CORS 阻止浏览器调 API**：`deploy/.env` 的 `CORS_ALLOWED_ORIGINS=["http://localhost:3001","http://127.0.0.1:3001"]`；浏览器访问必须用 `http://127.0.0.1:3001`（与 .env 一致），用 `localhost:3001` 也在白名单内，但 git-bash curl 必须用 127.0.0.1。

9. **postgres / redis 不重建**：只 `up --build --force-recreate -d backend frontend`，不动 db；现有数据保留（CLAUDE.md 规则 7 允许清空但本任务不需要清）。

10. **测试 ws 是 admin 自带的还是新建**：4.4 取 `.items[0].id`（第一个 ws）；若 admin 还没 ws（新部署），先 `POST /api/workspaces` 建一个 `e2e-members-ws`，root_path 用本项目路径 `C:/Users/qinyi/IdeaProjects/multi-agent-platform`。

11. **HTTP_CODE 写文件 vs 直接打印**：4.5.4 / 4.5.8 / 4.5.9 / 4.5.10 用 `-o /dev/null -w "%{http_code}\n"` 只取状态码，避免长 JSON 干扰；其余用 `| jq .` 看完整响应。

## 6. 非目标

- **不做 CI/CD 集成**：本任务是本机手测，不写 GitHub Actions / GitLab CI yaml
- **不做 prod 部署**：不发布镜像到 registry，不配置 prod env，不做 TLS / 反向代理
- **不做多 workspace 批量验证**：单个 ws 跑通即可，不验证 100 个 ws 的成员隔离（YAGNI）
- **不做并发压测**：transfer-ownership 并发场景由 task-02 service 层单事务保证 + task-05 单测覆盖，e2e 不模拟并发
- **不做跨浏览器兼容**：Chrome / Edge 跑通即可，不验证 Firefox / Safari
- **不做移动端响应式 e2e**：task-08 AC-5 已覆盖 tab 栏不溢出；Members 表格移动端由 task-09 处理
- **不做 daemon API key 联动验证**：daemon 用 admin API key 访问 ws run 的 403 修复验证由 4.5.4（普通 user token 访问 `/api/workspaces/{id}` 不再 403）覆盖；不单独跑 daemon 流程
- **不修改任何源码**：本任务纯运维 + 手测；发现 bug → 回 task-01..09 修复后再回 task-11 重测

## 7. 参考

- **`.claude/skills/sillyhub-docker-deploy/SKILL.md`** "启动" / "验证" / "容器内 grep 校验" 段（task-11 核心方法论）
- **`deploy/docker-compose.yml`**：服务名 `backend` / `frontend` / `postgres` / `redis`；compose project name `multi-agent-platform`；backend 命令含 `alembic upgrade head && uvicorn`
- **`deploy/.env`**：`BACKEND_PORT=8001` / `FRONTEND_PORT=3001` / `PLATFORM_BOOTSTRAP_ADMIN_EMAIL=admin@sillyhub.local` / `PASSWORD=admin123`
- **`plan.md`** 第 53 行 task-11 描述 + 第 56-66 行验收标准
- **`requirements.md`** FR-01..08 + NFR 兼容性（"daemon 用 admin API key 访问 ws run 不再 403"）
- **`design.md`** §5.1 6 个端点表 + §10 R-05 端到端覆盖要求 + §7 错误响应表
- **`task-10`**（依赖）：backend pytest + frontend lint/build 必须先全过，否则镜像构建会失败
- **`task-12`**（阻塞）：本任务全过才能 git commit + push

## 8. TDD 步骤

本任务**本身就是 e2e 验收**，不写新代码 / 新测试。TDD 顺序等价为：

1. **Given** task-01..10 已完成，代码已 commit 到 working tree
2. **When** 重建镜像 + 容器（4.1）+ 健康检查（4.2）+ 容器内 grep（4.3）
3. **Then** 4.2 健康 + 4.3 grep 计数 ≥ 1/1/6 → 进入 4.4
4. **When** 准备 token + ws_id + member 用户（4.4）
5. **Then** `$ADMIN_TOKEN` / `$WS_ID` / `$MEMBER_TOKEN` / `$MEMBER_USER_ID` 全部非空 → 进入 4.5
6. **When** 顺序执行 4.5.1 → 4.5.10（10 个 curl）
7. **Then** 每步 HTTP 状态码符合期望（200/201/204/400）+ 关键不变量成立（4.5.4 = 200，4.5.7 角色互换，4.5.9 = 400 cannot_remove_last_owner，4.5.10 = 400 invalid_role_key）→ 进入 4.6
8. **When** 浏览器跑 UI-1 → UI-11（11 个手测步骤）
9. **Then** 每步视觉/交互符合期望（tab 高亮、对话框、"(you)" 标识、权限禁用、错误条）→ task-11 通过
10. 任一步失败 → 立即停止，回退到对应 task 修复后再回到本任务从 4.1 重做（不跳过镜像重建）

## 9. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | 4 服务全 healthy | `docker compose ... ps` 显示 postgres / redis / backend / frontend 全部 `Up` 或 `healthy`；`curl /api/health` 200 |
| AC-2 | 镜像新代码确认 | 容器内 grep：`transfer_ownership` ≥ 1、`WorkspaceMemberView` ≥ 1、members_router 端点装饰器 ≥ 6；任一为 0 即失败 |
| AC-3 | GET members 200 | 4.5.1 返回 200 + items 含 admin（role_key=workspace_owner） |
| AC-4 | GET search 200 | 4.5.2 返回 200 + items 含 member_e2e（active 用户，未被排除） |
| AC-5 | POST add 200/201 | 4.5.3 返回 200 或 201 + 新 WorkspaceMemberView（role_key=developer） |
| AC-6 | 关键不变量：新成员不再 403 | 4.5.4 member token 调 `/api/workspaces/{id}` 返回 **200**（修复归属问题） |
| AC-7 | PATCH update 200 | 4.5.5 返回 200 + role_key 由 developer 改为 viewer |
| AC-8 | transfer-ownership 200 + 角色互换 | 4.5.6 返回 200 + `{new_owner, demoted}`；4.5.7 list 显示 admin=developer、member=workspace_owner |
| AC-9 | DELETE 204 | 4.5.8 新 owner token 移除 developer 返回 204 |
| AC-10 | 最后 owner 保护 400 | 4.5.9 返回 400 + error code = `cannot_remove_last_owner` |
| AC-11 | role_key 白名单 400 | 4.5.10 返回 400 + error code = `invalid_role_key` |
| AC-12 | UI Members tab 渲染 | UI-1/UI-2：4 个 tab 渲染；Members tab 显示成员表格 + Add Member 按钮（admin 是 owner 时可点） |
| AC-13 | UI Add 对话框完整 | UI-4/UI-5/UI-6：搜索 debounce + 候选高亮 + Add 禁用逻辑 + 添加成功后表格刷新出现新行 |
| AC-14 | UI "(you)" 标识 + 自我保护 | UI-3：当前用户行显示 "(you)"，role dropdown 选中自己当前 role，Set Owner / Remove disabled |
| AC-15 | UI transfer 后权限切换 | UI-8：transfer 后 admin 变 developer，"+ Add Member" 按钮 disabled；UI-9 切到 member_e2e 视角，自己行 Set Owner / Remove disabled，admin 行可操作 |
| AC-16 | UI viewer 只读 | UI-10：viewer 视角 Members tab 无 "+ Add Member"、无 role dropdown、无 Set Owner / Remove（显示但禁用） |

## 10. 风险与回滚

- **风险 R-1**：镜像构建失败（task-01..09 留下 lint/type 错误）。**应对**：构建失败立即看 `docker compose ... logs backend`；回退到对应 task 修复；**禁止**用 `--no-cache` 反复重试掩盖错误。
- **风险 R-2**：容器内 grep 计数为 0（镜像未更新）。**应对**：严格按 skill 文档"务必带 `--force-recreate`"+"不要加 `BUILDX_BUILDER=desktop-linux`"；Windows 实测默认 builder 才能正确进镜像库。
- **风险 R-3**：4.5.4 关键不变量失败（新成员仍 403）。**应对**：检查 task-02 add_or_update_member 是否正确 commit `UserWorkspaceRole`；检查 RBAC seed 是否给 developer 角色挂了 `WORKSPACE_READ` 权限；回退 task-02 修复。
- **风险 R-4**：4.5.9 最后 owner 保护失败（返 200/204 而非 400）。**应对**：检查 task-02 remove_member 是否在事务内 SELECT COUNT(workspace_owner)；可能并发场景未覆盖；回退 task-02。
- **风险 R-5**：transfer 后 ADMIN_TOKEN 调写操作 403 被误判为 bug。**应对**：本任务是预期行为；4.5.8 已切换 MEMBER_TOKEN；reviewer 需理解 transfer 后权限模型。
- **风险 R-6**：浏览器 UI 与 curl 行为不一致（前端 apiFetch bug）。**应对**：开 DevTools Network 看实际请求；前端 bug 回退 task-06/09 修复。
- **回滚**：本任务无文件改动，回滚 = `docker compose ... down`（保留卷）或 `down -v`（清数据，需用户确认）；代码层面回滚由 task-01..09 各自的回滚步骤处理。
