---
plan_level: full
author: qinyi
created_at: 2026-07-31 22:50:00
---

# 实现计划（Plan）：自定义技能 per-user 独立 + 权限放宽

## 来源
brainstorm change `2026-07-31-custom-skill-per-user` 的 design.md（方案 A：复用 `created_by` 作归属键）。决策 D-001~D-007 已 resolved，无未决 P0/P1。

## 范围
- backend：`skills`(model/router/service/schema) + `agent`(skills_bundle_service) + `daemon`(router manifest/bundle 端点) + alembic 迁移
- frontend：`menu-permissions` + `settings/skills/page` + `lib/custom-skills`
- 模块链：daemon → agent.skills_bundle_service → skills.model；frontend → backend API
- daemon 侧零改动（D-004）

## Wave 划分（依赖顺序）

- **Wave 1**（基础，无依赖）：数据模型 + 迁移
- **Wave 2**（依赖 W1 model）：后端 CRUD 权限 + 查询隔离
- **Wave 3**（依赖 W1 model）：daemon per-user 同步
- **Wave 4**（依赖 W2/W3 后端）：前端
- **Wave 5**（贯穿，依赖各 Wave）：测试

## Tasks

### Wave 1 — 数据模型 + 迁移
- [x] task-01: CustomSkill model 改归属键（created_by NOT NULL+CASCADE + name 联合唯一）
- [x] task-02: Alembic 迁移（清空→删列级 unique→NOT NULL→联合唯一 + downgrade 声明）

### Wave 2 — 后端 CRUD 权限 + 查询隔离
- [x] task-03: skills/router 权限 SETTINGS_ADMIN → 任意登录用户
- [x] task-04: skills/service list/get/update/delete/_get_by_name 加 user_id 过滤/归属校验
- [x] task-05: skills/schema CustomSkillRead.created_by 收窄 + 前端 null 引用排查

### Wave 3 — daemon per-user 同步
- [x] task-06: skills_bundle_service build_manifest/build_bundle 加 user_id + _collect_custom_skills where
- [x] task-07: daemon/router manifest/bundle 端点去 del user 透传 user.id

### Wave 4 — 前端
- [x] task-08: menu-permissions 技能管理菜单放开（所有登录用户可见）
- [x] task-09: settings/skills/page 按钮权限 is_platform_admin → 登录即可
- [x] task-10: lib/custom-skills.ts CustomSkillRead.created_by 类型收窄

### Wave 5 — 测试
- [x] task-11: 后端测试 — per-user 隔离 + 跨用户同名 + 越权 404
- [x] task-12: 后端测试 — 权限放宽 + manifest 按 user 过滤
- [x] task-13: 前端测试 — 按钮权限 + per-user 列表

## Task 卡片

### task-01: CustomSkill model 改归属键
- 描述：`created_by` nullable+SET NULL → NOT NULL+ON DELETE CASCADE；`name` 列级 `unique=True` → `(created_by, name)` 联合唯一（UniqueConstraint）；更新 docstring 废弃 D-010/原 D-002。
- 文件：backend/app/modules/skills/model.py
- 覆盖：D-001, D-002@v2, D-007, FR-01, FR-02
- 验收：mypy 过；model 字段/约束改完
- allowed_paths: backend/app/modules/skills/model.py

### task-02: Alembic 迁移
- 描述：`DELETE FROM custom_skills`（清空，D-005）→ drop `name` 列级 unique 约束（**Grill gap#1：列级约束按实际约束名处理**）→ ALTER `created_by` NOT NULL（**Grill gap#2：必须先清空，有 NULL 行 ALTER 失败**）→ add `UNIQUE(created_by, name)`；downgrade 声明（**Grill gap#4：DELETE 不可逆，downgrade 返回空表/raise**）；revision id 唯一 + down_revision 接当前 head（R5：execute 前 `alembic heads` 确认单 head）。
- 文件：backend/migrations/versions/<rev>_custom_skill_per_user.py
- 覆盖：D-005, D-002@v2, R2, FR-08
- 验收：`alembic upgrade head` 成功（空表）；`alembic heads` 单 head；`alembic downgrade -1` 不报错（返回空表）
- allowed_paths: backend/migrations/versions/  （项目 alembic.ini script_location=migrations，非 alembic/versions）
- 依赖：task-01

### task-03: skills/router 权限放宽
- 描述：所有 custom-skills 端点依赖从 `SettingsAdminUser`(SETTINGS_ADMIN) → 任意登录用户（复用 `get_current_user` / `CurrentUser`，auth_deps.py:56 现成）；create 透传 `user.id`（router.py:96 已传，保持）；update/delete 调 service 带 user.id。
- 文件：backend/app/modules/skills/router.py
- 覆盖：D-003, FR-03
- 验收：非管理员登录用户能调 list/create；router 测试过
- allowed_paths: backend/app/modules/skills/router.py
- 依赖：task-01

### task-04: skills/service 查询隔离 + 越权校验
- 描述：`list_(user_id)` 加 `where created_by==user_id`；`get(skill_id, user_id)` 取后校验归属，不符 raise `SkillNotFound`(404)；`update/delete(skill_id, user_id)` 先校验归属；`_get_by_name(name, user_id)` 加 `where created_by==user_id`（per-user 查重）。
- 文件：backend/app/modules/skills/service.py
- 覆盖：D-001, FR-04, FR-05
- 验收：list 只返自己的；越权 get/update/delete → 404；_get_by_name per-user 查重
- allowed_paths: backend/app/modules/skills/service.py
- 依赖：task-01, task-03

### task-05: skills/schema 类型收窄 + 前端排查
- 描述：`CustomSkillRead.created_by` 类型 `uuid.UUID | None` → `uuid.UUID`（per-user 必有）；**Grill gap#5：grep 前端 `lib/custom-skills.ts` 及测试 mock，确认无 `created_by: null` 默认会炸**，发现问题交 task-10 修（task-05 只改后端 schema）。
- 文件：backend/app/modules/skills/schema.py
- 覆盖：FR-04, gap#5
- 验收：schema 类型收窄
- allowed_paths: backend/app/modules/skills/schema.py
- 依赖：task-01

### task-06: skills_bundle_service 加 user_id 过滤
- 描述：`build_skills_manifest/build_skills_bundle` 加 `user_id: uuid.UUID | None = None` 参数，透传到 `_collect_custom_skills`；`_collect_custom_skills(session, user_id)` 加 `where CustomSkill.created_by == user_id`；sillyspec-* 文件系统扫描不变（D-006）。
- 文件：backend/app/modules/agent/skills_bundle_service.py
- 覆盖：D-004, D-006, FR-06
- 验收：build_manifest 传 user_id 只返该用户的自定义 + 系统；不传 user_id 兼容（空自定义）
- allowed_paths: backend/app/modules/agent/skills_bundle_service.py
- 依赖：task-01

### task-07: daemon/router manifest/bundle 透传 user.id
- 描述：`get_skills_manifest`/`get_skills_bundle` 端点去掉 `del user`（router.py:2397/2416），把 `user.id` 透传给 `build_skills_manifest/build_skills_bundle`。
- 文件：backend/app/modules/daemon/router.py
- 覆盖：D-004, FR-06
- 验收：daemon 拉 manifest = 系统 + 该 user 自定义；端点测试过
- allowed_paths: backend/app/modules/daemon/router.py
- 依赖：task-06

### task-08: 前端菜单放开
- 描述：`menu-permissions.ts` 技能管理菜单（:204）放开 `settings:admin` 门槛 → 所有登录用户可见。
- 文件：frontend/src/lib/menu-permissions.ts
- 覆盖：D-003, FR-07
- 验收：非管理员看到技能管理菜单
- allowed_paths: frontend/src/lib/menu-permissions.ts

### task-09: 前端 skills page 按钮权限
- 描述：`settings/skills/page.tsx` 新增/编辑/删除按钮判断从 `is_platform_admin` → 登录用户即可（移除 is_platform_admin 门槛，或改成始终显示 CRUD）；自定义技能区只显示自己的（后端已过滤）；系统技能区不变。
- 文件：frontend/src/app/(dashboard)/settings/skills/page.tsx
- 覆盖：D-003, FR-07
- 验收：登录用户（非管理员）见新增/编辑/删除按钮；typecheck 过
- allowed_paths: frontend/src/app/(dashboard)/settings/skills/page.tsx
- 依赖：task-08

### task-10: 前端类型收窄
- 描述：`lib/custom-skills.ts` `CustomSkillRead.created_by` TS 类型 `string | null` → `string`（对齐后端 task-05 收窄）；同时处理 task-05 排查发现的 null 默认。
- 文件：frontend/src/lib/custom-skills.ts
- 覆盖：gap#5, FR-04
- 验收：typecheck 过；无 null 默认炸点
- allowed_paths: frontend/src/lib/custom-skills.ts
- 依赖：task-05

### task-11: 后端测试 — per-user 隔离 + 跨用户同名 + 越权
- 描述：新增测试：① A 的技能 B 看不到（list/get 隔离）② **Grill gap#3：A 建 name=x，B 也能建 name=x（不报 409，per-user 联合唯一核心保证）** ③ 越权 update/delete 别人的 → 404。
- 文件：backend/app/modules/skills/tests/
- 覆盖：FR-02, FR-04, FR-05, gap#3
- 验收：3 类测试全过
- allowed_paths: backend/app/modules/skills/tests/
- 依赖：task-04

### task-12: 后端测试 — 权限放宽 + manifest 按 user
- 描述：① 非管理员登录用户能 CRUD 自己的（权限放宽）② manifest 端点按 user 过滤（test_skills_bundle：user A 的自定义进 manifest，B 的不进）。
- 文件：backend/app/modules/skills/tests/, backend/app/modules/daemon/tests/test_skills_bundle.py
- 覆盖：FR-03, FR-06
- 验收：权限 + manifest 过滤测试过
- allowed_paths: backend/app/modules/skills/tests/, backend/app/modules/daemon/tests/test_skills_bundle.py
- 依赖：task-03, task-07

### task-13: 前端测试 — 按钮权限 + per-user 列表
- 描述：page.test.tsx：① 登录用户（非管理员）见新增/编辑/删除按钮 ② 自定义技能列表只显示自己的（mock 后端返当前用户的）。
- 文件：frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx
- 覆盖：FR-07
- 验收：前端测试过
- allowed_paths: frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx
- 依赖：task-09

## 覆盖矩阵

| FR / D / gap | Task |
|---|---|
| FR-01 per-user 归属 | task-01 |
| FR-02 name 联合唯一 | task-01, task-02, task-11 |
| FR-03 权限放宽 | task-03, task-12 |
| FR-04 查询隔离 | task-04, task-05, task-10, task-11 |
| FR-05 越权 404 | task-04, task-11 |
| FR-06 daemon 按 user | task-06, task-07, task-12 |
| FR-07 前端放开 | task-08, task-09, task-10, task-13 |
| FR-08 数据清空 | task-02 |
| D-001 复用 created_by | task-01, task-04 |
| D-004 daemon 透传 | task-06, task-07 |
| D-005 清空重置 | task-02 |
| Grill gap#1 列级迁移 | task-02 |
| Grill gap#2 清空才能 NOT NULL | task-02 |
| Grill gap#3 跨用户同名测试 | task-11 |
| Grill gap#4 downgrade 不可逆 | task-02 |
| Grill gap#5 类型收窄排查 | task-05, task-10 |

## 验收（execute 完成后）
- 非管理员登录用户能在技能管理页 CRUD 自己的技能。
- 用户 A 的自定义技能对 B 完全不可见（列表/详情/AI 同步隔离）。
- A 建 name=x，B 也能建 name=x（不报 409）。
- 越权改/删别人技能 → 404。
- 每个用户 daemon 只加载系统 + 自己的。
- 系统 sillyspec-* 全局只读共享不变。
- 现有全局数据清空。
- 三端测试全绿 + mypy/typecheck 过。
