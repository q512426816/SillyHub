---
author: WhaleFall
created_at: 2026-06-25T13:25:00
---

# 模块影响分析 — 2026-06-24-username-login

> 依据：`git diff 75d38247..HEAD`（真实变更，跨 3 commit：`4d24bbf0` 主变更 + `61097c89` daemon mypy 修复 + `1a1d60a2` 测试债务）。
> 三重交叉验证：声明范围（proposal/design）= 任务范围（plan/tasks）≈ 真实变更（git diff），以 git diff 为准。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| auth | 接口变更 + 数据结构变更 | `backend/app/modules/auth/{model,schema,service}.py`、`backend/tests/modules/auth/{test_login_username,test_refresh_grace_window}.py` | `login()` 移除 email 分支纯 username 查询（D-001）；`UserRead.email` 改 Optional；`User.email` ORM 列 nullable（D-003） | false |
| admin | 接口变更 + 逻辑变更 | `backend/app/modules/admin/{schema,users_service,router}.py`、`backend/tests/modules/admin/{test_users_router,test_schema_username_login}.py`、`frontend/src/app/(dashboard)/admin/users/page.tsx`、`frontend/src/components/admin-user-drawer.tsx(+test)`、`frontend/src/lib/admin.ts(+test)` | `UserCreateRequest`(username 必填/email Optional)、`UserUpdateRequest`(增 username/email)、`UserRead`(email Optional)；users_service create/update 唯一校验；router 透传；前端 drawer 加登录名可编辑、列表显登录名列 | false |
| settings | 调用关系变更 | `backend/app/modules/settings/router.py` | create/update 端点透传 username/email（schema 经 re-export 自动同步，`settings/schema.py` 未改） | false |
| frontend_app | 逻辑变更 | `frontend/src/app/(auth)/login/page.tsx` | 登录页文案改「登录名」、默认回填 admin、移除 email 引导（D-001） | false |
| models (migration) | 数据结构变更 | `backend/migrations/versions/202608010900_users_email_nullable.py` | `users.email ALTER COLUMN DROP NOT NULL`，保留 `ux_users_email_active` 唯一索引（D-003，PG 多 NULL 放行） | false |
| daemon | 配置变更（附带） | `backend/app/modules/daemon/lease/context.py` | **附带修复**：lease 取 workspace_id 的 `first()[0]` → `.scalar()`，消除 mypy index 误报（运行时等价，非 username-login 功能改动，独立 commit `61097c89`） | true |
| ppm | 调用关系变更 | `frontend/src/components/{ppm-text,ppm-user-select}.tsx` | 用户显示名适配（email→username，各 ~2 行小改） | true |

## 决策覆盖（D-001~D-005）

| 决策 | 影响模块 | 验收 |
|---|---|---|
| D-001 纯登录名登录 | auth, frontend_app, admin | SC-3 ✅ |
| D-002 存量 username 沿用 | auth, admin | SC-4 ✅（admin2 登录实证） |
| D-003 非空 email 仍唯一 | auth, models(migration) | SC-5/6 ✅ |
| D-004 username 可编辑 | admin, settings | SC-2 ✅ |
| D-005 方案 A + 删 merge | models(migration) | SC-6 ✅ |

## 未匹配文件

| 文件 | 说明 |
|---|---|
| `.sillyspec/changes/2026-06-24-username-login/**`（proposal/design/plan/decisions/tasks/task-*/verify-result/module-impact） | 变更工作区文档，不计模块影响 |
| `backend/migrations/versions/202608010900_users_email_nullable.py` | Alembic 迁移脚本，归入 auth/models 数据结构变更（非独立模块） |

## needs_review 项说明

- **daemon**：`context.py` 的 `.scalar()` 修复是为通过 commit hook 的附带 mypy 修复（既有误报），与 username-login 功能无关，独立 commit。归档时 daemon 模块文档无需因 username-login 更新（该修复影响极小，运行时等价）。
- **ppm**：`ppm-text`/`ppm-user-select` 的改动是用户显示名 email→username 适配的小改，非 ppm 核心逻辑；建议归档时在 ppm 模块卡片备注「用户显示字段改用 username」。
