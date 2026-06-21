---
author: qinyi
created_at: 2026-06-22T00:45:00
---

# Tasks（细节 plan 阶段展开）

| Task | 文件 | 覆盖 |
|---|---|---|
| T1 User 加 username 字段 | `backend/app/modules/auth/model.py` | FR-1 |
| T2 alembic 迁移（加列 + 回填去重 + 唯一索引） | `backend/alembic/versions/2026xxxx_add_user_username.py` | FR-1 |
| T3 LoginRequest `account` + login 双查 + `_lookup_active_user_by_username` | `auth/schema.py`、`auth/service.py` | FR-2 |
| T4 admin CRUD 补 username（UserCreateRequest/UserRead/create_user） | `admin/schema.py`、`admin/users_service.py` | FR-3 |
| T5 bootstrap_admin 补 username 生成 | `auth/service.py` | FR-4 |
| T6 登录页 Segmented 平台选择 + 跳转 + auth.ts | `frontend/.../login/page.tsx`、`frontend/src/lib/auth.ts` | FR-5,FR-6 |
| T7 测试（login 双查 + 迁移去重 + 平台跳转） | `backend tests`、`frontend tests` | FR-1,2,5,6 |

## 决策覆盖
D-001@V1→T4 | D-002@V1→T3 | D-003@V1→T1,T2 | D-004@V1→T6 | D-005@V1→T5
