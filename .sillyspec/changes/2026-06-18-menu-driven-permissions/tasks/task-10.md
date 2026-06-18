---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-10：Docker 重建 + 手工验证矩阵

## 修改文件

- [ ] 无文件修改（部署 + 验证）

## 实现要求

本任务不修改任何源代码或部署配置文件，只做镜像重建 + 手工验证。前置依赖 task-09（typecheck/lint/test 全绿）。

部署 skill：`.claude/skills/sillyhub-docker-deploy/SKILL.md`。Compose 文件：`deploy/docker-compose.yml`，其中 frontend service 名确认为 `frontend`（context: ../frontend，端口 `${FRONTEND_PORT:-3000}`→3000，本机 `.env` 通常配 `FRONTEND_PORT=3001` / `BACKEND_PORT=8001`）。

### 步骤 1：重建 frontend 镜像

代码是构建进镜像的（无源码 bind-mount），改了代码必须重建镜像 + 重建容器（务必带 `--build --force-recreate`，否则容器仍跑旧代码——这是本部署最常见的隐性失败）。

- 命令：
  ```bash
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d frontend
  ```

- ⚠️ 不要加 `BUILDX_BUILDER=desktop-linux`（Windows 实测该 builder 构建的镜像不进 compose 默认镜像库，部署看似成功但容器仍跑旧码）。

- 确认容器跑新代码（task-01 新增的 `MENU_PERMISSION_GROUPS` 常量必须出现在镜像内）：
  ```bash
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T frontend sh -lc 'grep -c "MENU_PERMISSION_GROUPS" /app/frontend/src/lib/menu-permissions.ts'
  ```
- 计数应 > 0，否则镜像未更新 → 回到步骤 1 带 `--build --force-recreate` 重做。

### 步骤 2：健康检查

⚠️ 宿主机验证用 `127.0.0.1`，不要用 `localhost`（Windows git-bash 下 `localhost` 解析会 `Empty reply from server`）。端口按 `deploy/.env` 中的 `BACKEND_PORT` / `FRONTEND_PORT`。

- `curl -fsS http://127.0.0.1:3001/api/health`（frontend 反代 backend）
- `curl -fsS http://127.0.0.1:8001/api/health`（backend 直连）
- 期望返回 `{"status":"ok","db":"ok","redis":"ok",...}`
- 备用：容器内自测
  ```bash
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc 'curl -fsS http://localhost:8000/api/health'
  ```

### 步骤 3：手工验证矩阵

测试用户准备：用 platform_admin 账号登录 → `/api/admin/users` 创建 5 个测试用户，各自绑定单一权限的自定义角色（或直接 patch user 的 permissions / is_platform_admin）。建议每个用例独立账号避免污染。

按 plan.md 全局验收标准 + 用户原始需求 §8 逐字对齐：

| # | 用户配置 | 期望菜单 | 验证方法 |
|---|---|---|---|
| 1 | permissions=["user:read"] | 仅「用户」菜单 | 登录 → 截图侧栏 |
| 2 | permissions=["organization:read"] | 仅「组织」菜单 | 同上 |
| 3 | permissions=["role:read"] | 仅「角色」菜单 | 同上 |
| 4 | permissions=["task:read"] | 看到「Agent 控制台」 | 同上 |
| 5 | permissions=["workspace:read"] | 不显示「系统管理」section 标题 | 同上（section 内菜单全不可见时整个 section 标题也隐藏） |
| 6 | is_platform_admin=true | 全部 19 菜单 | 同上 |

每个用例验证要点：
- 强制刷新浏览器（Ctrl+Shift+R）避免 JS 缓存
- 让测试账号重新登录（触发 `fetchMe` 重新填充 permissions），不要沿用旧 session
- 截图存档（可选，建议存在 `.sillyspec/changes/2026-06-18-menu-driven-permissions/screenshots/` 下）

### 步骤 4：后端 RBAC 不回归

本变更纯前端，后端 `/api/admin/*` 行为必须不变。

- 用 permissions=["user:read"] 的用户尝试访问 `/api/admin/organizations` → 应返回 403（user:read 不在 admin:* 前缀）
- 用 is_platform_admin=true 用户访问同接口 → 应返回 200
- curl 模板：
  ```bash
  TOKEN_USER_READ=$(curl -fsS -H 'Content-Type: application/json' \
    -d '{"email":"test-user-read@sillyhub.local","password":"<pwd>"}' \
    http://127.0.0.1:8001/api/auth/login | jq -r '.access_token')

  curl -sS -o /dev/null -w '%{http_code}\n' \
    -H "Authorization: Bearer $TOKEN_USER_READ" \
    http://127.0.0.1:8001/api/admin/organizations   # 期望 403

  TOKEN_ADMIN=$(curl -fsS -H 'Content-Type: application/json' \
    -d '{"email":"admin@sillyhub.local","password":"<pwd>"}' \
    http://127.0.0.1:8001/api/auth/login | jq -r '.access_token')

  curl -sS -o /dev/null -w '%{http_code}\n' \
    -H "Authorization: Bearer $TOKEN_ADMIN" \
    http://127.0.0.1:8001/api/admin/organizations    # 期望 200
  ```
- 若 401/403 出现反常行为（如 user:read 居然能 200 拿到数据）说明后端被改动 → 检查是否误改 backend 代码

### 步骤 5：Picker 验证

- 用 platform_admin 账号登录
- 创建新角色 → 打开 AdminRolePermissionPicker
- 确认 4 个 section（overview/management/admin/system）按序渲染，顺序固定为 overview → management → admin → system
- 确认每个 menu 显示：
  - 折叠按钮
  - 全选 checkbox（含 indeterminate 半选态）
  - menuLabel
  - 已选数量 (X/Y)
- 测试全选 checkbox 三态：
  - 0 选中 → 未选；勾选 → 数量更新到 Y/Y（全选）
  - 部分选中 → indeterminate；勾选 → 全选 Y/Y
  - 全部已选 → 勾选态；取消 → 数量归零（0/Y）
  - 切换某 menu 全选不影响其他 menu 的选中状态
- 测试折叠独立性：
  - 折叠 `users` menu → permission list 隐藏
  - 同时展开 `organizations` menu
  - 切换 `users` 折叠状态 → `organizations` 折叠状态不变
- 测试 Picker 接收 `permissions` prop 的回填：
  - 预设 role 带 `user:read` + `user:write` → 打开 picker 时 users menu 显示已选 (2/3)

## 接口定义

无（本任务纯部署 + 手工验证，不涉及代码接口）。

## 边界处理

1. **Docker build 失败** → 检查 frontend `package.json` 是否漏依赖（如 task-01/02 引入的新 import）、Next 版本兼容、TypeScript 编译错误。`docker compose ... logs frontend` 看构建日志。
2. **镜像更新但容器未重启** → 必须加 `--force-recreate`（默认只 `up` 不会重建已存在容器）。验证用 grep -c `MENU_PERMISSION_GROUPS`，计数为 0 说明仍是旧码。
3. **用户 session 缓存旧 permissions** → 让用户完全登出再登录，或重启 backend 触发 `fetchMe` 重新拉取。前端 localStorage / cookie 也要清。
4. **浏览器缓存旧 JS** → 强制刷新（Ctrl+Shift+R / Cmd+Shift+R），或 DevTools → Network → Disable cache。Next 生产构建的 chunk hash 变了通常能自动失效，但本地 dev 模式下偶有残留。
5. **测试用户不存在** → 用 platform_admin 账号通过 `/api/admin/users` 创建测试用户，再用 `/api/admin/roles` 创建自定义角色（permissions=["user:read"] 等），最后把用户绑定到该角色。本项目未正式上线，数据可清空，必要时直接 `docker compose down -v` 重建。
6. **Windows `localhost` 解析失败** → 全部用 `127.0.0.1`，不要用 `localhost`。
7. **端口冲突** → 若 3001/8001 被占用，按 `.env` 调整 `FRONTEND_PORT` / `BACKEND_PORT`，不要杀其他进程（保留用户已有进程优先）。
8. **Docker Desktop 卡在 Created** → 用最小探针 `docker run --rm --network none --name sillyhub-start-probe redis:7-alpine redis-server --version` 确认，再按 skill 的「Docker Desktop 卡在 Created 的修复」节处理。

## 非目标

- 不修改 `deploy/docker-compose.yml`
- 不重建 backend 镜像（本变更纯前端，重建 backend 是浪费且引入不必要风险）
- 不修改 PostgreSQL 数据（除创建测试用户/角色所必需的写入）
- 不做性能测试
- 不做局域网访问配置（本任务本机验证足够）
- 不写自动化测试（picker / helper 已在 task-03/04/07 单测覆盖；本任务是端到端手工验收）
- 不归档变更（archive 是后续步骤，不在 task-10 范围）

## TDD 步骤

本任务无单元测试产出（属 Wave 4 验证类），但按以下顺序执行：

1. 等 task-09 全绿后执行（前置：`pnpm typecheck && pnpm lint && pnpm test` 全部通过）
2. 重建 frontend 镜像（带 `--build --force-recreate`）
3. 跑健康检查（frontend + backend `/api/health` 返回 ok）
4. 容器内 grep 确认新代码进镜像（`MENU_PERMISSION_GROUPS` 计数 > 0）
5. 按矩阵逐个验证 6 个用例（截图存档）
6. 验证后端 RBAC 不回归（401/403 路径未回归）
7. 验证 picker 三级渲染（section / menu / permission）
8. 验证 picker 全选三态 + 折叠独立性
9. 验收通过 → 标记 task-10 完成，可进入 sillyspec-archive 流程

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| 镜像重建 | 容器跑新代码（grep `MENU_PERMISSION_GROUPS` 计数 > 0） |
| 健康检查 | `/api/health` 返回 ok（frontend + backend 双端） |
| 用例 1：user:read | 仅看到「用户」菜单，无其他菜单 |
| 用例 2：organization:read | 仅看到「组织」菜单 |
| 用例 3：role:read | 仅看到「角色」菜单 |
| 用例 4：task:read | 看到「Agent 控制台」 |
| 用例 5：workspace:read | 不显示「系统管理」section 标题 |
| 用例 6：is_platform_admin | 全部 19 菜单显示 |
| 后端 RBAC 不回归 | user:read → 403，is_platform_admin → 200 |
| Picker 三级渲染 | 4 个 section 按 overview/management/admin/system 顺序，section→menu→permission 全部正确 |
| Picker 全选三态 | 未选 / indeterminate / 全选 / 取消全选 四态切换正确 |
| Picker 折叠独立 | 切换某 menu 折叠不影响其他 menu |
| Picker 数量回填 | (X/Y) 数量随选中实时更新，初始 prop 回填正确 |
