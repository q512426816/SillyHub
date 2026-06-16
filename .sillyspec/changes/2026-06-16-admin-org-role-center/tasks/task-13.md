---
id: task-13
title: Docker 镜像重建 + 部署 + 健康检查
priority: P0
estimated_hours: 1
depends_on: [task-12]
blocks: []
allowed_paths:
  - deploy/docker-compose.yml
author: WhaleFall
created_at: 2026-06-16T15:40:00
---

# task-13: Docker 镜像重建 + 部署 + 健康检查

完成全栈代码（task-01 ~ task-11）后，重建 backend + frontend 镜像，部署到 Docker Compose 环境，验证新代码进入容器 + 服务健康 + 关键端点可达。

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `deploy/docker-compose.yml` | 无需修改 | 仅触发重建（`--build --force-recreate`）；如缺少 task-02 依赖的 Permission 字段相关环境变量才需调整 |

## 实现要求

### R-01: 重建 backend + frontend 镜像

```bash
# 重建并强制重建容器（确保新代码进入运行的容器）
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d backend frontend

# 仅重建后端（如前端无变更）
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d backend
```

**关键**：必须带 `--build --force-recreate`。`--build` 触发镜像重建，`--force-recreate` 强制重建容器（即使镜像未变也重建，确保用上新镜像）。不带 force-recreate 的话容器仍是旧代码。

### R-02: 健康检查

```bash
# 等服务起来（最多 30 秒）
for i in {1..30}; do
  HEALTH=$(curl -fsS http://127.0.0.1:8000/api/health 2>/dev/null) && break
  sleep 1
done
echo "Backend health: $HEALTH"
# 期望: {"status":"ok","db":"ok","redis":"ok",...}

curl -fsS http://127.0.0.1:3000/api/health
# 期望: 前端 health 端点 200
```

### R-03: 容器内新代码校验

```bash
# 后端: 确认 admin 模块目录存在 + 关键标识
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'ls -la app/modules/admin/'

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'grep -c "USER_SELF_DELETE_FORBIDDEN\|ROLE_IN_USE\|ORGANIZATION_HAS_CHILDREN" app/core/errors.py'
# 期望: > 0

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'grep -c "login_enabled" app/modules/auth/model.py'
# 期望: > 0

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend sh -lc \
  'grep -c "USER_LOGIN_MANAGE\|ORGANIZATION_WRITE\|ROLE_READ" app/modules/auth/permissions.py'
# 期望: > 0

# 前端: 确认 admin 页面 + lib/admin.ts
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T frontend sh -lc \
  'ls -la /app/.next/server/app/\(dashboard\)/admin/ 2>/dev/null || ls -la src/app/\(dashboard\)/admin/'

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T frontend sh -lc \
  'grep -c "listUsers\|createUser\|disableUserLogin" src/lib/admin.ts 2>/dev/null || \
   grep -c "listUsers\|createUser\|disableUserLogin" .next/server/chunks/*.js | head -1'
# 期望: > 0
```

### R-04: 数据库迁移执行

backend 容器启动后，alembic 应自动执行（通过 entrypoint）。如未自动执行，手动跑：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend alembic upgrade head

# 校验迁移状态
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend alembic current
# 期望: 显示 202606161200_create_admin_org_role (head)

# 校验表结构
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
  psql -U sillyhub -d sillyhub -c '\dt'
# 期望: 含 organizations / user_organizations / user_roles 三表
```

### R-05: bootstrap seed 验证

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs backend | grep -i 'platform_admin\|seed'
# 期望: 含 "platform_admin role seeded" 或类似日志

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
  psql -U sillyhub -d sillyhub -c \
  "SELECT key, is_system, is_active FROM roles WHERE key='platform_admin';"
# 期望: platform_admin | t | t

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
  psql -U sillyhub -d sillyhub -c \
  "SELECT count(*) FROM role_permissions rp JOIN roles r ON rp.role_id=r.id WHERE r.key='platform_admin';"
# 期望: 32（task-02 扩展后 Permission 总数）
```

### R-06: 关键端点可达性

```bash
TOKEN=$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"email":"admin@sillyhub.local","password":"admin123"}' \
  http://127.0.0.1:8000/api/auth/login | jq -r '.access_token')

# 各端点 200
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/admin/users | jq -e '.items and .total' > /dev/null && echo "users OK"
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/admin/organizations | jq -e 'isArray' > /dev/null && echo "orgs OK"
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/admin/roles | jq -e '.items and .total' > /dev/null && echo "roles OK"

# 兼容性: 旧端点
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/users | jq -e '.items and .total' > /dev/null && echo "legacy /api/users OK"
```

### R-07: 前端 UI 可达性

```bash
# 普通页面 SSR
curl -fsSI http://127.0.0.1:3000/ | head -1
# 期望: HTTP/1.1 200

# admin 页面 SSR（重定向到 login 或显示空骨架，看鉴权策略）
curl -fsSI http://127.0.0.1:3000/admin/users | head -1
# 期望: HTTP/1.1 200 或 307（重定向到 login）

# settings 页面（应不再含 UsersTab）
curl -fsS http://127.0.0.1:3000/settings | grep -c 'UsersTab\|用户管理'
# 期望: 0（已剥离）
```

## 接口定义

无新增端点。本任务仅部署 + 验证。

## 边界处理

1. **BUILDX_BUILDER 禁用**：Windows 上不要设置 `BUILDX_BUILDER=desktop-linux`，会导致镜像不进入 compose 默认镜像库（容器跑旧代码）
2. **`--force-recreate` 必须**：仅 `--build` 不够，必须 `--force-recreate` 才能重建容器
3. **健康检查 127.0.0.1**：Windows git-bash 下 `localhost` 解析有问题，用 `127.0.0.1`
4. **容器内代码校验**：必须 grep 关键标识，确认新代码进入容器（不只是镜像构建时间戳）
5. **postgres exec 路径**：用户名/数据库名与 deploy/.env 一致（默认 sillyhub/sillyhub）
6. **backend 启动等待**：alembic 迁移 + bootstrap seed 在 entrypoint 中执行，最多 30 秒；超过则查日志定位
7. **前端构建缓存**：`--build` 触发重建，但如 next.config / package.json 无变化可能用缓存层；如确认新代码未生效则 `--no-cache` 重建
8. **失败回滚**：若部署失败，先 `docker compose logs backend frontend` 看错误；如迁移失败回滚 alembic `downgrade -1` 再修复
9. **端口冲突**：如本机已占用 8000/3000，deploy/.env 中改 BACKEND_PORT=8001 / FRONTEND_PORT=3001
10. **管理员账号**：来自 deploy/.env 的 `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` / `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD`

## 非目标

- 不修改 `deploy/docker-compose.yml` 配置（除非有新环境变量需求）
- 不修改 `deploy/.env`（用户已配置）
- 不修改 `backend/Dockerfile` 或 `frontend/Dockerfile`（task-01 ~ task-11 未引入新依赖）
- 不部署到生产 / CI（仅本机 Docker Compose 验证）
- 不实现蓝绿 / 滚动发布（单实例重建即可）
- 不实现 Prometheus / Grafana 监控

## 参考

- `sillyhub-docker-deploy` skill（部署流程 + 验证命令 + 常见问题）
- `deploy/docker-compose.yml`（compose 配置）
- `deploy/.env.example`（环境变量模板）
- `backend/Dockerfile` + `backend/docker-entrypoint.sh`（容器入口）
- `frontend/Dockerfile`（Next.js 构建）
- task-12 e2e.sh + migration.sql（部署后执行）
- 现有 commit `8d0d4b84`（Windows spawn claude ENOENT 修复）作为本仓库部署惯例参考

## TDD 步骤

1. **预检**：确认 task-01 ~ task-12 全部完成 + `pytest app/modules/admin/` 全绿 + `pnpm build` 通过
2. **重建 backend**：`docker compose up --build --force-recreate -d backend`
3. **等待健康**：`curl http://127.0.0.1:8000/api/health` 30 秒内返回 ok
4. **重建 frontend**：`docker compose up --build --force-recreate -d frontend`
5. **等待健康**：`curl http://127.0.0.1:3000/api/health` 30 秒内返回 ok
6. **容器内代码校验**：执行 R-03 所有 grep 命令
7. **数据库迁移校验**：执行 R-04 alembic current + psql \dt
8. **bootstrap 校验**：执行 R-05 platform_admin seed 验证
9. **关键端点校验**：执行 R-06 curl 命令
10. **前端 UI 校验**：执行 R-7 三个 curl
11. **执行 task-12 e2e.sh**：8 项端到端验证全绿
12. **记录结果**：在 task-13 文件下方追加「实际部署时间戳 + 镜像 hash + 健康检查结果」

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `docker compose up --build --force-recreate -d backend frontend` | exit code 0，无构建错误 |
| AC-02 | `docker compose ps` | 4 个服务全部 Up + healthy |
| AC-03 | `curl http://127.0.0.1:8000/api/health` | 200 + `{"status":"ok","db":"ok","redis":"ok"}` |
| AC-04 | `curl http://127.0.0.1:3000/api/health` | 200 |
| AC-05 | `docker compose exec -T backend ls app/modules/admin/` | 含 __init__.py / router.py / model.py / schema.py / roles_service.py / organizations_service.py / users_service.py / tests/ |
| AC-06 | `docker compose exec -T backend grep -c "login_enabled" app/modules/auth/model.py` | > 0 |
| AC-07 | `docker compose exec -T backend grep -c "USER_LOGIN_MANAGE" app/modules/auth/permissions.py` | > 0 |
| AC-08 | `docker compose exec -T backend grep -c "RoleInUse\|OrganizationHasChildren" app/core/errors.py` | > 0 |
| AC-09 | `docker compose exec -T backend alembic current` | 显示 `202606161200_create_admin_org_role (head)` |
| AC-10 | `docker compose exec -T postgres psql -U sillyhub -d sillyhub -c '\dt'` | 含 organizations / user_organizations / user_roles |
| AC-11 | `SELECT key, is_system FROM roles WHERE key='platform_admin'` | 存在且 is_system=true |
| AC-12 | `SELECT count(*) FROM role_permissions WHERE role_id=platform_admin` | = 32（或 Permission 枚举长度） |
| AC-13 | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/admin/users` | 200 + `{items, total}` |
| AC-14 | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/admin/organizations` | 200 + 数组 |
| AC-15 | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/admin/roles` | 200 + `{items, total}` 含 platform_admin |
| AC-16 | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/users`（旧端点） | 200 + `{items, total}`（兼容性） |
| AC-17 | `curl -fsSI http://127.0.0.1:3000/admin/users` | 200 或 307（重定向） |
| AC-18 | `curl http://127.0.0.1:3000/settings` 不含 UsersTab | grep 'UsersTab\|用户管理' 返回 0 |
| AC-19 | 执行 task-12 e2e.sh | `PASS: 8/8`，exit code 0 |
| AC-20 | 镜像 hash 更新 | `docker images | grep sillyhub-backend` 时间戳是本次部署 |
| AC-21 | `docker compose logs backend` 无 ERROR | 日志中无 ImportError / CircularImportError / Alembic 错误 |
