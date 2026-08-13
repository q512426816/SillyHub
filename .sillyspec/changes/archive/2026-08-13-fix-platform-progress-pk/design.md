---
author: qinyi
created_at: 2026-08-13 15:45:00
scale: large
tier: independent
risk_level: unit-sufficient
---

# 设计文档（Design）— platform_change_progress 主键缺陷修复（id 主键替代 change_name）

> change: `2026-08-13-fix-platform-progress-pk`
> 模块：`backend/app/modules/platform_sync`
> 决策台账：见 `decisions.md`（D-001@v1 ~ D-005@v1）

## 1. 背景

`platform_change_progress` 表（进度同步收件箱）当前以 **`change_name` 单主键**（全局唯一）存储进度镜像。2026-08-11 `change-progress-projection` 引入 workspace 隔离时，design §8.2 本想用复合主键 `(workspace_id, change_name)`，但 **SQL 主键列不允许 NULL**，而 `workspace_id` 需可空（`shk_live_` 全局密钥过渡期上行 None 行），故决策 A 退化为：**`change_name` 单主键 + `(workspace_id, change_name)` 复合唯一约束**。migration 注释明确「复合唯一用唯一约束而非复合 PK……复合 PK 在 PG/SQLite 均不允许 PK 列 NULL，会阻塞老行」，且「ORM 层仍按复合 PK 表达目标态语义」——**但实际 model.py 的 `change_name` 仍是 `primary_key=True`（单主键），偏离目标态**，留下两个缺陷（2026-08-13 实测触发）：

- **跨 workspace 重名冲突**：workspace A 与 B 若有同名变更（`change_key` 通常含日期+描述全局唯一，但 `quick-uuid8` 或跨项目复用可能重复），B 上行进度 → `_find_row(B, name)` 查不到 → INSERT 撞 `change_name` 主键（A 已占名）→ IntegrityError → 回退再查仍无 → **500**。第二工作区无法同步进度。
- **NULL 历史行挡道**：`shk_live_` 全局上行产生的 `workspace_id=NULL` 行占用 `change_name` 主键，后续换 `shpsync_` 后带 workspace 的同名行**插不进去**（2026-08-13 演示用 `UPDATE` 改绑 NULL 行绕过）。

## 2. 设计目标

- **G1**：跨 workspace 同名变更的进度镜像**可共存**（各占一行），消除第二工作区 500。
- **G2**：`workspace_id=NULL` 历史行与带 workspace 的行**共存**，不再挡道。
- **G3**：**零业务影响**——端点路径 / body 六表 JSON / 响应 schema 全部不变，仅存储层结构调整。
- **G4**：**现有数据保留**——10 行（8 NULL + 2 workspace）迁移回填 `id`，不丢进度。

## 3. 非目标

- **NG-01**：不改 platform_sync 端点 / 契约（`POST /api/changes/{name}/progress` 路径、`serializeForSync` 六表 body、`X-SillySpec-*` 头、409 冲突响应均不变）。
- **NG-02**：不处理 NULL 行语义收敛（`shk_live_` 过渡期保留；正常用 `shpsync_` 后每个 workspace 各占一行，NULL 行仅过渡存在）。
- **NG-03**：不做进度快照清理 / 归档（progress 行生命周期管理属另一主题）。
- **NG-04**：不改 change 模块投影逻辑（`_project_current_stage` 已按 `(workspace_id, change_name)` 复合键批量 IN join，本就正确）。

## 4. 拆分判断

单一 change。所有改动围绕「platform_change_progress 表主键重构」这一内聚主题，跨 model/migration/service/测试但无独立可交付模块、无权限视图、无跨页面流转，不满足拆分阈值。

## 5. 总体方案

**加独立 `id` UUID 主键 + `change_name` 去主键 + 保留 `(workspace_id, change_name)` 复合唯一约束**（方案 A，用户确认）。

- PG 唯一约束对 `NULL` 值不参与唯一性 → 跨 workspace 同名（`(A, foo)` vs `(B, foo)`）各占一行不冲突；`NULL` 行与 workspace 行（`(NULL, foo)` vs `(A, foo)`）共存。
- 每行一个独立 `id` 保证主键唯一性（替代 change_name 全局唯一）。

数据流（不变，仅存储层加 id）：producer=daemon/sillyspec 上行进度（`shpsync_` token 派生 workspace_id）→ `PlatformSyncService.upsert_progress(workspace_id, name, body)` → 存 `id` + `workspace_id` + `change_name` + `latest_progress`；consumer=change 模块 `_project_current_stage` 按 `(workspace_id, change_name)` 批量 IN join 读 `latest_progress` → 投影 `current_stage` + `_map` 算 `pending_review`。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/platform_sync/model.py` | `PlatformChangeProgressORM` 加 `id: uuid.UUID` 主键（`Column(Uuid, primary_key=True, default=uuid.uuid4)`，**default 必须**——change/tests 6 处构造不带 id，default 免除全部改动）；`change_name` 去 `primary_key=True` 降普通列（保留 `UniqueConstraint("workspace_id", "change_name")`） |
| 新增 | `backend/migrations/versions/<new>_platform_change_progress_id_pk.py` | migration：**用 `batch_alter_table`（alembic SQLite 不支持直接 drop PK，需 copy-and-move 重建；precedent `20260811104500_agent_profile_llm_provider.py`）**：add `id` 列（nullable→Python 回填 uuid4→NOT NULL）+ drop `change_name` PK + `id` 设主键；保留复合唯一约束。dialect 无关（PG + SQLite 测试库） |
| 修改 | `backend/app/modules/platform_sync/service.py` | `upsert_progress` INSERT 分支加 `id=uuid.uuid4()`（当前漏 id 会 NOT NULL 报错）；`_find_row` 复合键不变；IntegrityError 回退逻辑不变（撞复合唯一而非 PK） |
| 修改 | `backend/app/modules/platform_sync/__init__.py` | docstring「change_name 全局唯一 PK」→「id 主键 + (workspace_id, change_name) 复合唯一」 |
| 修改 | `backend/app/modules/platform_sync/tests/test_router.py` 或新增测试 | 跨 workspace 同名 upsert 各占一行、NULL 行 + workspace 行共存、同 workspace 并发冲突回退、migration 后旧数据 id 回填 |
| 修改 | `.sillyspec/docs/backend/modules/platform_sync.md` | 更新主键描述（id 主键 + 复合唯一），变更索引加本 change |

## 7. 接口定义

**无 API 变更。** 端点路径、请求/响应 schema、`serializeForSync` 六表 body 全部不变。仅 service 内部 `upsert_progress` INSERT 增加 `id` 字段（ORM 层，非 API）。

## 7.5 生命周期契约表

**不涉及生命周期契约。** 本变更只调整 `platform_change_progress` 表的存储层主键结构（DTO/ORM 层），不新增/修改 session / lease / agent_run / daemon / lifecycle / state_transition / claim / heartbeat 任何事件；`upsert_progress` / `_project_current_stage` 读写路径语义不变。进度上行与投影消费的运行时行为零变化。

## 8. 数据模型

- **`platform_change_progress` 表**：
  - `id`：UUID 主键（**新增**，`default=uuid.uuid4`，每行唯一；default 免除现有/测试构造点补 id）
  - `workspace_id`：`uuid.UUID | None`（可空，FK workspaces CASCADE）
  - `change_name`：String（**去主键**，普通列）
  - `latest_progress`：JSON
  - `last_pushed_at` / `last_pusher`：String
  - `updated_at`：timezone-aware DateTime
  - 唯一约束：`(workspace_id, change_name)`（保留；PG 对 NULL 不参与唯一性 → NULL 行可多个、与 workspace 行共存）
- **关键语义变化**：`change_name` 从「全表唯一」→「同 workspace 内唯一」（复合约束），跨 workspace 同名合法。
- **迁移**：现有 10 行（8 NULL + 2 workspace）回填 `id`（uuid4）保留，不丢数据。本项目未上线（CLAUDE.md 规则 11），但 progress 有真实进度镜像，保留更合理。

## 9. 兼容策略（brownfield）

- **端点 / 客户端**：POST/GET 路径、body、headers 不变；旧 daemon/sillyspec 客户端无感。
- **现有数据**：10 行迁移回填 id 保留；`_find_row` 按 `(workspace_id, change_name)` 复合键读写不变。
- **NULL 过渡行**：保留；修复后与 workspace 行共存（不再挡道，2026-08-13 演示的 `UPDATE` 改绑不再需要）。
- **migration**：`batch_alter_table`（alembic SQLite 不支持直接 `drop_constraint` PK / `create_primary_key`——前者 raise、后者静默跳过，需 copy-and-move 重建），PG 生产与 SQLite 测试库对齐（precedent `20260811104500_agent_profile_llm_provider.py`）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | migration 改主键（drop change_name PK + add id + 回填）跨库兼容 | P1 | `batch_alter_table`（SQLite 不支持 PK drop/create，需 copy-and-move 重建，precedent `20260811104500_agent_profile_llm_provider.py`）+ `op.get_bind` 回填 uuid4；SQLite 测试库 + PG 生产双验 |
| R-02 | service INSERT 漏 id → NOT NULL 报错 | P2 | upsert INSERT 加 `id=uuid.uuid4()`；测试覆盖 upsert 全路径 |
| R-03 | 同 workspace 并发双发冲突回退（IntegrityError 撞复合唯一） | P2 | 既有回退逻辑不变（catch IntegrityError → rollback → 重查 UPDATE）；补测试 |
| R-04 | 跨 workspace 同名 upsert 行为 | P2 | 新增测试：两 workspace 同名各占一行，互不覆盖 |
| R-05 | 既有测试受影响（model 主键变化） | P2 | platform_sync 全量 pytest + change 模块回归；conftest create_all 用 model 建表需匹配新主键 |

## 11. 决策追踪

| 决策 | 被覆盖处 | 状态 |
|---|---|---|
| D-001@v1 加 id UUID 主键 + change_name 去主键 + 保留复合唯一 | §5、§8、§6 文件清单 | accepted（用户确认方案 A） |
| D-002@v1 保留 `(workspace_id, change_name)` 复合唯一 | §8 | accepted |
| D-003@v1 现有 NULL 历史行保留 + migration 回填 id | §8、§9 | accepted（用户确认） |
| D-004@v1 无 gen:types（端点 schema 不变） | §7、§6 | accepted |
| D-005@v1 service INSERT 加 id，回退逻辑不变 | §6 | accepted |

无未解决决策。

## 12. 自审

逐项核验：

- **章节齐全**：背景/目标/非目标/拆分/总体方案/文件清单/接口/生命周期/数据模型/兼容/风险/决策/自审——全 ✓。
- **根因坐实**：model.py `change_name` 单主键（实测 `primary_key=True`）+ migration 注释「ORM 层按复合 PK 表达目标态语义」但实际未实现——偏差确凿（§1）✓。
- **方案可行性**：PG 唯一约束对 NULL 不参与唯一性（跨 workspace 同名 / NULL 行共存）——数据库语义正确 ✓。
- **migration 可执行**：dialect 无关 + 回填 id + drop PK + create PK，PG/SQLite 对齐 ✓。
- **零 API 变更**：端点/schema/body 不变，仅 ORM 层加 id，无 gen:types（D-004）✓。
- **brownfield**：现有数据保留回填、旧客户端无感、NULL 行共存 ✓。
- **风险**：R-01~R-05 覆盖 migration/INSERT/并发/重名/回归 ✓。
- ⚠️ **自审存疑（Design Grill 已吸收）**：migration 改主键在 SQLite **不能用 `op.drop_constraint`/`op.create_primary_key`（alembic SQLite 不支持 PK drop，create_primary_key 静默跳过）**——必须 `batch_alter_table`（copy-and-move 重建，precedent `20260811104500_agent_profile_llm_provider.py`）；`id` 加 `default=uuid.uuid4` 免除 change/tests 6 处 `PlatformChangeProgressORM(...)` 构造补 id（Gap 1/2 已修入 §6/§8）。decisions.md 在 §8 生成规范文件补齐（Gap 3）。
- **测试覆盖**：跨 workspace 重名 / NULL 共存 / 并发回退 / 迁移回填 均有对应测试任务 ✓。

自审通过，进入 Design Grill 续审。
