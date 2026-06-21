---
author: qinyi
created_at: 2026-06-22T00:50:00
plan_level: light
---

# 计划 — 登录支持邮箱/账号 + 平台选择

依据：design.md / requirements.md（FR-1~6）/ decisions.md（D-001~D-005@V1）

## Wave 分组（模块依赖：auth → admin → frontend）

### Wave 1 — 后端模型 + 迁移（auth 基础）
- [x] task-01: User 加 username 字段（`auth/model.py`）[FR-1, D-003@V1]
  - 完成标准：`User.username: str`（String 100），ruff/mypy 通过
- [x] task-02: alembic 迁移（加列 NULL → 回填 `lower(email@前)` 去重加序号 → UNIQUE INDEX `ux_users_username`）[FR-1, D-003@V1]
  - 完成标准：upgrade 后所有 users 有唯一非空 username；downgrade 可回退

### Wave 2 — 后端登录 + admin + bootstrap（依赖 Wave 1 字段）
- [x] task-03: `LoginRequest.email`→`account` + `AuthService.login` 双查 + `_lookup_active_user_by_username`（含 `@` 查 email / 不含查 username，均 `.lower().strip()`）[FR-2, D-002@V1]
  - 完成标准：邮箱与账号均能登录；失败防枚举统一报错
- [x] task-04: admin `UserCreateRequest`/`UserRead` 加 username + `create_user` 生成（可选，留空自动 email 前缀 + 去重）[FR-3, D-001@V1]
- [x] task-05: `bootstrap_admin` 补 username=email 前缀（避免 NOT NULL 失败）[FR-4, D-005@V1]

### Wave 3 — 前端（依赖 Wave 2 API）
- [x] task-06: 登录页输入框 label「邮箱/账号」+ 放宽校验（去 `type:email`）+ antd `Segmented` 平台选择（默认 SillyHub，localStorage 持久）+ 按选择跳转（ppm→`/ppm/projects`、sillyhub→`/workspaces`）+ `auth.ts` `login(account)` [FR-5, FR-6, D-004@V1]
  - 完成标准：两平台选择均能正确跳转；记住我缓存键改 account

### Wave 4 — 测试
- [x] task-07: 后端 login 双查测试（email/username/不存在/密码错）+ 迁移前缀去重测试 + 前端平台跳转测试 [FR-1,2,5,6]

## 验收（对照 requirements.md FR-1~6 + GWT）
- FR-1：旧用户迁移后 username 全局唯一、无 NULL
- FR-2：邮箱与账号均能登录
- FR-3：admin 创建用户 username 可填或自动生成
- FR-4：bootstrap 管理员有 username
- FR-5：登录页 Segmented 平台选择 + localStorage 持久
- FR-6：按选择跳转正确（ppm/sillyhub）
- 全部测试通过
