---
author: qinyi
created_at: 2026-07-31 22:23:32
scale: large
risk_level: contract-required
---

# 设计文档（Design）— 自定义技能改 per-user 独立 + 权限放宽

## 背景

当前自定义技能（`CustomSkill`）是**平台全局共享**：D-010 决策「无 workspace/user 维度，所有工作区/用户共享同一份」，`name` 全局唯一，`created_by` 仅作审计（nullable + SET NULL）。维护权限前后端不一致——后端 custom-skills 端点用 `SETTINGS_ADMIN` 鉴权，前端 `settings/skills/page.tsx` 却用 `is_platform_admin` 判断按钮显示，导致有 settings:admin 但非 platform_admin 的人后端允许、前端看不到按钮。

用户需求：自定义技能是**个人资产**——每人独立维护自己的、只看自己的、AI 只加载系统 + 自己的，且维护权限放宽到所有登录用户。

## 设计目标

1. 自定义技能改 **per-user 独立**：每人技能库互不可见（决策2：只看自己 + 系统）。
2. 维护权限**放宽到所有登录用户**：登录即可 CRUD 自己的技能（决策1）。
3. **AI/daemon 按用户同步**：每个用户的 AI 只加载系统 sillyspec-* + 自己创建的（决策3）。
4. 系统 sillyspec-* 技能**保持全局只读共享**不变（文件系统扫描，与 user 无关）。
5. 现有全局自定义技能数据**清空重置**（决策，项目未上线、开发数据可清）。

## 非目标（Non-Goals）

- 不做技能共享/转移/owner 变更（未来可能，当前 YAGNI；故选方案 A 复用 created_by 而非新加 owner_user_id）。
- 不改系统 sillyspec-* 技能的加载/同步逻辑（仍全局文件系统共享）。
- 不做 per-workspace 隔离（是 per-user，非 per-workspace）。
- 不做技能版本/历史/草稿/导入导出等高级管理。

## 拆分判断

单变更，不拆分、不批量。四个改动点（数据模型 / 后端权限+查询 / daemon 同步 / 前端）都为「per-user 隔离」同一目标服务，强耦合，作为一个变更交付。

## 决策记录（Decisions）

### D-001 归属键：复用 created_by（方案 A，用户确认）
复用 `CustomSkill.created_by` 作 per-user 归属键（NOT NULL + ON DELETE CASCADE），不新加 owner_user_id。理由：创建即归属，无需分两字段；最小改动；YAGNI（技能转移是未来可能，当前不需要）。方案 B（新加 owner_user_id，两字段重复）被否。

### D-002 name 唯一性：per-user 联合唯一（@v2）
`name` 从全局 UNIQUE 改为 `(created_by, name)` 联合唯一。废弃原 D-002（全局唯一）。理由：per-user 隔离，不同用户可建同名技能。

### D-003 维护权限：放宽到所有登录用户（用户决策1）
custom-skills 端点权限从 `SETTINGS_ADMIN` 放宽到任意登录用户。前端按钮判断从 `is_platform_admin` 改为登录即可（同时修前后端不一致 bug）。理由：技能是个人资产，登录用户即可管理自己的。

### D-004 daemon 同步：透传 user.id，daemon 侧零改动（用户决策3）
manifest/bundle 端点去 `del user`，透传 `user.id`；`_collect_custom_skills` 按 user_id 过滤。理由：Explore 确认 `get_current_principal` 返回 User（有 user.id），daemon API key 天然归属 user（`api_keys.user_id`），无需 daemon 侧改造。

### D-005 现有数据：清空重置（用户确认）
迁移清空 `custom_skills` 现有全局数据。理由：项目未上线（规则11），开发数据可清；per-user 语义下旧全局数据无归属，清空最简。

### D-006 系统 sillyspec-* 保持全局只读共享
系统技能走文件系统扫描（`_collect_skill_files`），全局共享，与 user 无关。理由：系统技能是平台统一提供的，所有用户共享同一份。

### D-007 废弃旧决策
废弃 D-010（平台级全局共享）→ 改 per-user。废弃原 D-002（name 全局唯一）→ 改联合唯一（D-002@v2）。

## 总体方案

**方案 A（用户确认）**：复用 `CustomSkill.created_by` 作归属键（创建即归属，无需另加 owner 字段）。daemon 侧零改动（Explore 子代理确认：daemon 带 API key 天然归属 user，`get_current_principal` 返回 User 对象已有 user.id）。

### Wave 1 — 数据模型 + 迁移
- `CustomSkill.created_by`：nullable + SET NULL → **NOT NULL + ON DELETE CASCADE**（强归属，用户注销级联删其技能）。
- `name` 唯一性：全局 UNIQUE → **`(created_by, name)` 联合唯一**（每用户内唯一，不同用户可同名）。
- Alembic 迁移：`DELETE FROM custom_skills`（清空现有数据）→ 删旧 `name` 全局唯一约束 → 加 `created_by NOT NULL` + `UNIQUE(created_by, name)`。
- 废弃决策：D-010（平台级共享）、D-002（name 全局唯一）。

### Wave 2 — 后端：CRUD 权限 + 查询隔离 + daemon 同步
- custom-skills router：所有端点依赖从 `SettingsAdminUser`(SETTINGS_ADMIN) → 任意登录用户（复用现有 `get_current_user`）。
- service：
  - `list_(user_id)`：`where created_by == user_id`。
  - `get(skill_id, user_id)`：取后校验 `created_by == user_id`，不符 → `SkillNotFound`（404，防越权 + 不泄露存在）。
  - `create(created_by=user.id)`：已有参数，router 透传。
  - `update(skill_id, user_id, ...)` / `delete(skill_id, user_id)`：先校验归属。
  - `_get_by_name(name, user_id)`：冲突检查加 `where created_by == user_id`（per-user 内查重）。
- daemon router（manifest/bundle 端点）：去掉 `del user`，透传 `user.id` 给 `build_skills_manifest/build_skills_bundle`。
- skills_bundle_service：`build_skills_manifest/build_skills_bundle` 加 `user_id` 参数；`_collect_custom_skills(session, user_id)` 加 `where CustomSkill.created_by == user_id`。

### Wave 3 — 前端
- `menu-permissions.ts`：技能管理菜单放开 `settings:admin` 门槛 → 所有登录用户可见。
- `settings/skills/page.tsx`：新增/编辑/删除按钮判断从 `is_platform_admin` → 登录用户即可；自定义技能区只显示自己的（后端已过滤）；系统技能区不变。
- `lib/custom-skills.ts`：`CustomSkillRead.created_by` 类型收窄 `uuid.UUID | None` → `uuid.UUID`（per-user 必有）。

## 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/skills/model.py | created_by NOT NULL+CASCADE；name 改 (created_by,name) 联合唯一；更新 docstring 废弃 D-010/D-002 |
| 新增 | backend/migrations/versions/<rev>_custom_skill_per_user.py | 迁移：清空表 + 删 name 全局唯一 + 加 created_by NOT NULL + 联合唯一（项目 alembic.ini script_location=migrations） |
| 修改 | backend/app/modules/skills/router.py | 端点权限 SETTINGS_ADMIN→登录用户；create 透传 user.id；update/delete 带归属校验 |
| 修改 | backend/app/modules/skills/service.py | list_/get/update/delete/_get_by_name 加 user_id 过滤/校验 |
| 修改 | backend/app/modules/skills/schema.py | CustomSkillRead.created_by 类型收窄为 uuid.UUID |
| 修改 | backend/app/modules/daemon/router.py | manifest/bundle 端点去 del user，透传 user.id |
| 修改 | backend/app/modules/agent/skills_bundle_service.py | build_skills_manifest/build_skills_bundle 加 user_id 参数；_collect_custom_skills 加 where created_by==user_id |
| 修改 | frontend/src/lib/menu-permissions.ts | 技能管理菜单权限放开（所有登录用户可见） |
| 修改 | frontend/src/app/(dashboard)/settings/skills/page.tsx | 按钮 is_platform_admin→登录即可 |
| 修改 | frontend/src/lib/custom-skills.ts | CustomSkillRead.created_by 类型收窄 |
| 修改 | backend/app/modules/skills/tests/ | 新增 per-user 隔离 + 越权 404 + 权限放宽测试 |
| 修改 | backend/app/modules/daemon/tests/test_skills_bundle.py | manifest 按 user 过滤测试 |
| 修改 | frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx | 按钮权限 + per-user 列表测试 |

## 接口定义

```python
# skills_bundle_service.py
async def build_skills_manifest(skills_dir=None, session=None, user_id: uuid.UUID | None = None) -> dict
async def build_skills_bundle(skills_dir=None, session=None, user_id: uuid.UUID | None = None) -> bytes
async def _collect_custom_skills(session, user_id: uuid.UUID | None) -> list  # 加 where created_by == user_id

# skills/service.py（加 user_id 参数）
async def list_(self, user_id: uuid.UUID) -> list[CustomSkill]
async def get(self, skill_id: uuid.UUID, user_id: uuid.UUID) -> CustomSkill  # 校验归属，不符 404
async def update(self, skill_id, user_id, *, name=None, description=None, content=None)
async def delete(self, skill_id, user_id)
async def _get_by_name(self, name: str, user_id: uuid.UUID) -> CustomSkill | None  # per-user 查重
```

custom-skills REST 端点签名不变（路径/方法不变），仅权限依赖 `SettingsAdminUser` → `CurrentUser`。

## 生命周期契约：不适用（N/A）

本次改动是 manifest/bundle 端点按 user 过滤自定义技能 + custom-skills CRUD 权限放宽，**不涉及 session / lease / agent_run / heartbeat / state transition 等生命周期状态流转事件**。daemon 同步语义从「全局」变「按 user」仅改变 manifest/bundle 内容范围，不改变 daemon 生命周期（注册/心跳/租约/claim 不变）。故不适用 lifecycle contract。

## 数据模型

`custom_skills` 表：
- `created_by`：`UUID` nullable（SET NULL）→ **NOT NULL**，外键 `users.id` ON DELETE **CASCADE**。
- 删约束：`UniqueConstraint(name)`（全局唯一）。
- 加约束：`UniqueConstraint(created_by, name)`（联合唯一）。
- 其余字段（id / name / description / content / created_at / updated_at）不变。

## 兼容策略（Brownfield）

- 现有 `custom_skills` 数据**清空**（迁移 DELETE）——开发环境，已确认可清。
- 系统 sillyspec-* 技能不受影响（文件系统，全局共享）。
- daemon 旧版本仍能拉 manifest（端点兼容，只是内容从「全局」变「该 user 的」）。
- `get_current_principal` 已返回 User（仅去掉 `del user`），无新认证逻辑。
- 前端旧会话：刷新后生效（菜单/按钮按新权限）。

## 风险登记（Risk）

- **R1 迁移清空数据**：现有自定义技能全部删除。已确认可清（开发环境）。风险低。
- **R2 联合唯一迁移顺序**：必须先 `DELETE` 清空再建联合唯一约束，否则历史 NULL/重复行阻塞建约束。迁移脚本顺序：删旧约束 → 清空 → 加 NOT NULL → 加联合唯一。
- **R3 daemon 同步语义变化**：现有 daemon 重启后拉到的技能变少（只剩系统 + 自己的）。这是预期行为（per-user），数据已清，无残留全局技能。风险低。
- **R4 权限放宽**：所有登录用户能建技能，可能产生大量个人技能。可接受（个人资产，name per-user 唯一约束兜底）。
- **R5 migration revision 撞车**：本项目多活跃变更，新 migration revision id 须唯一且 down_revision 接当前 head（memory: migration-chain-fragmentation-pattern）。execute 前先 `alembic heads` 确认单 head。

## 自审（Self-Review）

- [x] created_by NOT NULL 后，create 端点必透传 user.id（已设计 router 透传）。
- [x] update/delete 越权防护：service.get 校验 `created_by == user_id`，不符抛 404（不泄露存在）。
- [x] manifest **和** bundle 两个端点都透传 user.id（不止 manifest）。
- [x] 联合唯一迁移顺序：删旧 → 清空 → NOT NULL → 联合唯一。
- [x] `_get_by_name` 冲突检查加 user_id（per-user 查重，否则跨用户误报冲突）。
- [x] 系统技能区前端不受影响（系统 sillyspec-* 全局共享不变）。
- [x] daemon 侧零改动确认（API key 天然归属 user，get_current_principal 返回 User）。
- [x] 测试覆盖：per-user 隔离 / 越权 404 / daemon 按 user 过滤 / 权限放宽（登录用户可 CRUD）。
