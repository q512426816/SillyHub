---
id: task-12
title: 端到端验证 + 双向迁移测试
priority: P0
estimated_hours: 3
depends_on: [task-09, task-10, task-11]
blocks: [task-13]
allowed_paths:
  - .sillyspec/changes/2026-06-16-admin-org-role-center/verify/e2e.sh
  - .sillyspec/changes/2026-06-16-admin-org-role-center/verify/migration.sql
author: WhaleFall
created_at: 2026-06-16T15:40:00
---

# task-12: 端到端验证 + 双向迁移测试

执行 8 项关键路径端到端验证 + Alembic upgrade/downgrade 双向测试 + 空库/含数据双重迁移测试。本任务不写代码，是验证性任务，但允许在 `verify/` 子目录下沉淀测试脚本。

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `.sillyspec/changes/2026-06-16-admin-org-role-center/verify/e2e.sh` | 新增 | 端到端验证脚本：8 项关键路径用 curl 串联验证 |
| 2 | `.sillyspec/changes/2026-06-16-admin-org-role-center/verify/migration.sql` | 新增 | 双向迁移测试 SQL 校验脚本（含表结构 + 数据完整性检查） |

## 实现要求

### R-01: 端到端 8 项关键路径

通过 shell 脚本（curl）+ 手动 UI 操作结合，验证以下 8 项。每项均给出「操作 + 期望」对照。

#### E2E-01: 自保护 - 不能删除自己

```bash
TOKEN=$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"email":"admin@sillyhub.local","password":"admin123"}' \
  http://127.0.0.1:8000/api/auth/login | jq -r '.access_token')

ADMIN_ID=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/auth/me | jq -r '.id')

# 尝试删除自己
RESP=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/admin/users/$ADMIN_ID)

# 期望: 403
[ "$RESP" = "403" ] && echo "E2E-01 PASS" || echo "E2E-01 FAIL: got $RESP"
```

#### E2E-02: 最后管理员保护

```bash
# admin 是唯一 is_platform_admin=true 用户
RESP=$(curl -s -w "\n%{http_code}" -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"is_platform_admin": false}' \
  http://127.0.0.1:8000/api/admin/users/$ADMIN_ID)

BODY=$(echo "$RESP" | head -n1)
CODE=$(echo "$RESP" | tail -n1)
[ "$CODE" = "403" ] && echo "$BODY" | jq -e '.code == "USER_LAST_ADMIN_PROTECTED"' \
  && echo "E2E-02 PASS" || echo "E2E-02 FAIL"
```

#### E2E-03: 角色占用拒绝删除

```bash
# 创建自定义角色
ROLE=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"test_viewer","name":"Test Viewer","permission_keys":["user:read"]}' \
  http://127.0.0.1:8000/api/admin/roles)
ROLE_ID=$(echo "$ROLE" | jq -r '.id')

# 创建用户并绑定该角色
USER=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"viewer@test.local\",\"password\":\"pwd12345\",\"role_ids\":[\"$ROLE_ID\"]}" \
  http://127.0.0.1:8000/api/admin/users)

# 尝试删除被占用的角色
RESP=$(curl -s -w "\n%{http_code}" -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/admin/roles/$ROLE_ID)
CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | head -n1)
[ "$CODE" = "409" ] && echo "$BODY" | jq -e '.code == "ROLE_IN_USE" and .details.user_count == 1' \
  && echo "E2E-03 PASS" || echo "E2E-03 FAIL"
```

#### E2E-04: 组织占用拒绝删除

```bash
# 创建父组织 HQ + 子组织 Engineering + 用户绑定 Engineering
HQ=$(curl -fsS -X POST ... -d '{"name":"HQ","code":"hq"}' .../api/admin/organizations)
HQ_ID=$(echo "$HQ" | jq -r '.id')
ENG=$(curl -fsS -X POST ... -d "{\"name\":\"Engineering\",\"code\":\"eng\",\"parent_id\":\"$HQ_ID\"}" ...)
ENG_ID=$(echo "$ENG" | jq -r '.id')

# 删除 HQ（有子组织）→ 409 ORGANIZATION_HAS_CHILDREN
# 删除 Engineering（有关联用户）→ 409 ORGANIZATION_IN_USE
```

#### E2E-05: 登录权限控制 + sessions 撤销

```bash
# 创建用户 bob
BOB=$(curl -fsS -X POST ... -d '{"email":"bob@test.local","password":"bob12345"}' .../api/admin/users)
BOB_ID=$(echo "$BOB" | jq -r '.id')

# bob 登录拿到 token + session
BOB_TOKEN=$(curl -fsS -X POST ... -d '{"email":"bob@test.local","password":"bob12345"}' .../api/auth/login | jq -r '.access_token')

# 管理员禁用 bob 登录
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/admin/users/$BOB_ID/disable-login > /dev/null

# bob 旧 token 立即失效
RESP=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $BOB_TOKEN" \
  http://127.0.0.1:8000/api/auth/me)
[ "$RESP" = "401" ] && echo "E2E-05a PASS (session revoked)" || echo "E2E-05a FAIL"

# bob 用账号密码再次登录 → 401 AUTH_USER_LOGIN_DISABLED
RESP=$(curl -s -w "\n%{http_code}" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"bob@test.local","password":"bob12345"}' \
  http://127.0.0.1:8000/api/auth/login)
CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | head -n1)
[ "$CODE" = "401" ] && echo "$BODY" | jq -e '.code == "AUTH_USER_LOGIN_DISABLED"' \
  && echo "E2E-05b PASS" || echo "E2E-05b FAIL"
```

#### E2E-06: 会话撤销

```bash
# 列出 bob sessions（启用登录后重新登录产生 session）
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/admin/users/$BOB_ID/enable-login > /dev/null

# bob 重新登录
curl -fsS -X POST ... -d '{"email":"bob@test.local","password":"bob12345"}' .../api/auth/login > /dev/null

SESSIONS=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/admin/users/$BOB_ID/sessions)
SESSION_ID=$(echo "$SESSIONS" | jq -r '.[0].id')

# 单条撤销
curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/admin/users/$BOB_ID/sessions/$SESSION_ID > /dev/null

# 验证 session 已撤销
SESSIONS2=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/admin/users/$BOB_ID/sessions)
echo "$SESSIONS2" | jq -e '.[0].revoked_at != null' && echo "E2E-06 PASS" || echo "E2E-06 FAIL"
```

#### E2E-07: 审计覆盖

```bash
# 执行一系列写操作（创建角色 / 创建组织 / 创建用户 / 禁用登录）
# 然后查 audit_logs
AUDIT=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/api/audit?entity_type=role&entity_type=organization&entity_type=user&limit=50")

# 期望: 包含 role.created / organization.created / user.created / user.login_disabled 等 action
echo "$AUDIT" | jq -e '.[] | select(.action | test("role|organization|user"))' > /dev/null \
  && echo "E2E-07 PASS" || echo "E2E-07 FAIL"
```

#### E2E-08: 旧端点兼容

```bash
# 旧 settings 端点 GET /api/users 仍可用
RESP=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/users)
CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | head -n1)
[ "$CODE" = "200" ] && echo "$BODY" | jq -e '.items and .total' \
  && echo "E2E-08 PASS" || echo "E2E-08 FAIL"
```

### R-02: 双向迁移测试

```bash
# 1. 空库迁移
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
  psql -U sillyhub -d sillyhub -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend \
  alembic upgrade head
# 期望: 0 错误，所有表创建

# 2. 含数据迁移
# 先 seed 一些数据（通过现有 bootstrap + 创建几个用户/组织）
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend \
  python -c "
import asyncio
from app.core.db import async_session_factory
from app.modules.auth.seed import seed_platform_admin_role
async def main():
    async with async_session_factory() as s:
        await seed_platform_admin_role(s)
asyncio.run(main())
"

# 3. downgrade 测试
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend \
  alembic downgrade -1
# 期望: organizations / user_organizations / user_roles 三表删除，roles.is_active / updated_at / users.login_enabled 字段移除，其它数据保留

# 4. 重新 upgrade 恢复
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend \
  alembic upgrade head
# 期望: 字段恢复，但 downgrade 时被移除的字段值已丢失（is_active=true / login_enabled=true 默认值）

# 5. 数据完整性检查（migration.sql）
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
  psql -U sillyhub -d sillyhub -f /tmp/migration.sql
# 校验:
# - organizations 表存在
# - user_organizations 表存在
# - user_roles 表存在
# - roles.is_active 字段存在且默认 true
# - roles.updated_at 字段存在
# - users.login_enabled 字段存在且默认 true
# - platform_admin 角色存在且 is_system=true
# - role_permissions 含 platform_admin 对应的所有 32 项 Permission
```

### R-03: 校验脚本（migration.sql）

```sql
-- migration.sql - 校验 alembic upgrade head 后的状态
\echo '=== Tables ==='
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('organizations','user_organizations','user_roles');
-- 期望: 3 行

\echo '=== Columns ==='
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='roles' AND column_name IN ('is_active','updated_at');
-- 期望: 2 行

SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' AND column_name='login_enabled';
-- 期望: 1 行

\echo '=== platform_admin role ==='
SELECT key, is_system, is_active FROM roles WHERE key='platform_admin';
-- 期望: platform_admin | t | t

\echo '=== platform_admin permissions count ==='
SELECT count(*) FROM role_permissions rp JOIN roles r ON rp.role_id=r.id WHERE r.key='platform_admin';
-- 期望: 32（task-02 扩展后 Permission 总数）

\echo '=== Data integrity ==='
SELECT count(*) as users_count FROM users;
SELECT count(*) as orgs_count FROM organizations;
SELECT count(*) as user_orgs_count FROM user_organizations;
SELECT count(*) as user_roles_count FROM user_roles;
-- 期望: 所有 count >= 0（无错误，无意外数据丢失）
```

## 接口定义

### e2e.sh 脚本

- 输入：环境变量 `API_BASE`（默认 `http://127.0.0.1:8000`）+ `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- 输出：每项 E2E-XX PASS/FAIL + 总结 `PASS: N/8`
- 退出码：全部 PASS → 0；任意 FAIL → 1

### migration.sql 脚本

- 输入：psql 执行
- 输出：每个 `\echo` 段下显示查询结果，便于人工/脚本检查

## 边界处理

1. **API base URL 可配置**：脚本顶部 `API_BASE="${API_BASE:-http://127.0.0.1:8000}"`，可在不同环境（本机 / Docker / CI）复用
2. **管理员凭据可配置**：`ADMIN_EMAIL` / `ADMIN_PASSWORD` 从环境变量读取，不硬编码
3. **数据隔离**：测试创建的角色 / 组织 / 用户使用 `test_*` 前缀（test_viewer / test_org / bob@test.local），便于事后清理
4. **失败时不中止**：每个 E2E-XX 独立执行，单个失败不影响后续验证；最终汇总打印
5. **audit 日志查询参数**：`/api/audit?entity_type=X` 可能支持多值（query 数组），需要确认后端 schema；如不支持多值则多次查询取并集
6. **downgrade 数据丢失预期**：alembic downgrade -1 后重新 upgrade，字段值会回到默认（is_active=true / login_enabled=true），不视为失败；仅校验「字段存在 + 数据完整性（无意外行丢失）」
7. **postgres exec 路径**：`docker compose exec -T postgres psql -U sillyhub -d sillyhub`，用户名/数据库名与 deploy/.env 一致
8. **后端 exec 路径**：`docker compose exec -T backend alembic upgrade head`，需确保容器内 alembic.ini 配置正确
9. **migration.sql 文件挂载**：通过 `psql -f` 执行，需 `docker cp` 到 postgres 容器或挂载 verify/ 目录

## 非目标

- 不实现性能测试（响应时间 / 并发）
- 不实现安全渗透测试（OWASP Top 10 全量扫描）
- 不写自动化 CI 流水线（手动脚本即可，task-13 部署后执行）
- 不实现跨浏览器测试（Chrome 单浏览器即可）
- 不实现 i18n 多语言测试
- 不实现负载测试

## 参考

- `requirements.md` §功能需求 FR-01 ~ FR-16（每项 E2E 对应多个 FR）
- `proposal.md` §成功标准（8 项端到端验证）
- `plan.md` §全局验收标准（双向迁移 + 8 项关键路径）
- task-04 / task-05 / task-06 后端端点签名（curl 调用参考）
- task-01 Alembic 迁移文件（downgrade 测试对象）
- `sillyhub-docker-deploy` skill（容器内 exec 命令模式）

## TDD 步骤

1. **写脚本**：在 `.sillyspec/changes/2026-06-16-admin-org-role-center/verify/` 下创建 `e2e.sh` + `migration.sql`
2. **本地预跑**：在 task-09/10/11 已部署的环境中（task-13 完成）执行 `bash verify/e2e.sh`
3. **失败排查**：每个 FAIL 项回到对应 task 修复，重跑
4. **跑通**：8 项全部 PASS
5. **执行迁移测试**：`docker cp verify/migration.sql postgres:/tmp/` 后执行 `\i /tmp/migration.sql`
6. **执行 downgrade 测试**：按 R-02 步骤 1-4 完整跑一遍
7. **数据完整性检查**：跑 migration.sql，确认所有 count 符合预期
8. **记录结果**：在 task-12 文件下方追加「实际执行结果」段，含每项 PASS 时间戳

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | E2E-01 自保护 - 删除自己 | 403 + `code=USER_SELF_DELETE_FORBIDDEN` |
| AC-02 | E2E-02 最后管理员保护 | 403 + `code=USER_LAST_ADMIN_PROTECTED` |
| AC-03 | E2E-03 角色占用拒绝 | 409 + `code=ROLE_IN_USE` + `details.user_count >= 1` |
| AC-04 | E2E-04 组织占用拒绝 | 409 + `code=ORGANIZATION_HAS_CHILDREN` 或 `ORGANIZATION_IN_USE` + 含 children_count/member_count |
| AC-05 | E2E-05 登录权限控制 + sessions 撤销 | 禁用后旧 token 立即失效（401）+ 用密码登录返回 401 + `code=AUTH_USER_LOGIN_DISABLED` |
| AC-06 | E2E-06 会话单条撤销 | revoke 后 sessions 列表中该条 `revoked_at != null` |
| AC-07 | E2E-07 审计覆盖 | `/api/audit` 含 role.created / organization.created / user.created / user.login_disabled 等记录 |
| AC-08 | E2E-08 旧端点兼容 | GET `/api/users` 返回 200 + `{items, total}` 结构 |
| AC-09 | 空库 alembic upgrade head | 0 错误，所有表创建 |
| AC-10 | 含数据环境 alembic upgrade head | 现有数据完整保留，新字段 backfill 默认值（is_active=true / login_enabled=true） |
| AC-11 | alembic downgrade -1 | 新表删除 + 新字段移除，其它数据保留 |
| AC-12 | alembic upgrade head 后再 downgrade -1 再 upgrade head | 0 错误，字段恢复（值丢失为默认值，不视为失败） |
| AC-13 | migration.sql 校验 | 所有 `\echo` 段输出符合预期（3 张表 / 2 个 roles 字段 / 1 个 users 字段 / platform_admin 行 / 32 项 role_permissions） |
| AC-14 | e2e.sh 退出码 | 全部 PASS → 0；任意 FAIL → 1 |
| AC-15 | 8 项 E2E 全部 PASS | `PASS: 8/8` |
