---
author: qinyi
created_at: 2026-08-13 17:40:00
change: 2026-08-13-fix-platform-progress-pk
risk_level: unit-sufficient
---

# 验证报告 — platform_change_progress 主键缺陷修复

> change: `2026-08-13-fix-platform-progress-pk`（commit 5d91204d 进 main）
> verify 执行者：QA 视角（主代理 + execute 独立 stage review QA 子代理）
> design frontmatter `risk_level: unit-sufficient`；§7.5 明确不涉及生命周期契约

## 结论

**PASS**

5 task 全部实现并 commit（5d91204d），测试全绿（platform_sync 32 passed / change 43 passed / ruff mypy 0），execute 独立 stage review 13 checklist 全 pass。设计缺陷（change_name 单主键 → 跨 workspace 重名冲突 + NULL 行挡道）已根治。

## 任务完成度（5/5 = 100%）

| task | 内容 | 状态 |
|---|---|---|
| task-01 | model 加 id UUID 主键（default=uuid.uuid4）+ change_name 去主键 + 保留复合唯一 | ✅ |
| task-02 | migration 20260813170000（batch_alter_table + op.get_bind 回填 uuid4 + drop PK dialect 分支 + 单 head） | ✅ |
| task-03 | service INSERT 加 id + IntegrityError 回退注释适配 | ✅ |
| task-04 | test_pk_semantics 4 用例（跨 workspace 同名 / NULL 共存 / migration 回填 / revision chain）+ 修 test_apply_catches | ✅ |
| task-05 | __init__ docstring + 模块文档更新 | ✅ |

## 探针报告（6 探针全通过）

1. **未实现标记**：变更文件无 TODO/FIXME/HACK（grep 空）
2. **关键词齐全**：design 核心概念（id 主键 / 复合唯一 / batch_alter_table / 回填）全实现
3. **测试覆盖**：test_pk_semantics 4 用例 + 修 test_apply_catches + platform_sync 32 passed + change 回归 43 passed
4. **决策闭环**：decisions D-001~005 全 accepted，无 P0/P1 unresolved，无 superseded 误引
5. **API 契约**：无端点变更（D-004 零 API 变更，无 gen:types）
6. **代码删除对账**：无意外删除（纯结构调整）

## 设计一致性（execute stage review 13 checklist 全 pass）

独立 QA 子代理（tier=independent）对照 design.md 核验：
- model.py id 主键 + change_name 去主键 + 复合唯一保留 ✓
- migration batch_alter_table + 回填顺序（batch recreate 前）+ dialect 分支 ✓
- service INSERT 加 id + 回退逻辑 ✓
- 测试覆盖 FR-01/02/04/05 ✓
- 模块文档同步 ✓

## 决策追踪矩阵

| 决策 | FR | task | evidence |
|---|---|---|---|
| D-001 加 id 主键 + change_name 去主键 + 复合唯一 | FR-01/02 | task-01/02 | model.py + migration |
| D-002 保留复合唯一 | FR-01 | task-01 | model.py UniqueConstraint |
| D-003 NULL 行保留 + 回填 id | FR-02/04 | task-02/04 | migration 回填 + test_pk_semantics |
| D-004 无 gen:types | FR-03 | —（非目标） | 端点 schema 不变 |
| D-005 service INSERT 加 id + 回退不变 | FR-05 | task-03/04 | service.py + test_apply_catches |

## 质量扫描

- platform_sync pytest：32 passed（含 test_pk_semantics 新增 + 修好的 test_apply_catches）
- change 模块回归（test_router + test_enrich_projection）：43 passed
- ruff check / format：全过
- mypy app/modules/platform_sync：0 issues（修了 test_pk_semantics 一处类型注解）
- 变更文件无 TODO/FIXME

## Runtime Evidence（集成/部署证据）

**N/A**。本变更 `risk_level: unit-sufficient`，design §7.5 明确「不涉及生命周期契约」——只调 `platform_change_progress` 存储层主键结构，不触碰 session/lease/agent_run/daemon 状态机；端点/body/schema 不变，旧客户端无感。migration 用 SQLite round-trip 测试（MigrationContext 驱动真实 upgrade）+ 生产库数据保留验证，单元级充分。

## 代码审查

5 task / 7 文件 / 505+ 23-。核心改动：model id 主键 + migration batch_alter_table + service INSERT id + 测试。代码风格（CONVENTIONS）+ 安全（无注入面）+ 错误处理（回退逻辑）全 OK。详见 execute stage review reviewerNotes。

## 实现偏差（3 处，合理，优于 design 假设）

1. **SQLite 复合唯一不丢**：design 称 batch recreate 后需重建复合唯一约束，实为 SQLite 反射为命名唯一 Index 随 batch copy 自动保留，无需重建。
2. **drop PK 仅 PG**：SQLite 旧 PK 无名（get_pk_constraint name=None），靠 create_primary_key 自动移除；PG 有名须先 drop。dialect 分支处理。
3. **downgrade NotImplementedError**：upgrade 后跨 workspace 同名合法共存，无法安全恢复单主键（对齐 precedent）。

## Gap / 风险

- **migration revision 调整**：原 20260813160000 与 platform-managed-file-sync（另一 change）的 `create_spec_file_manifest` migration 撞车（同为 20260813160000），改本 change migration 为 `20260813170000` 且 down_revision 指向前者，alembic 收敛单 head。⚠️ 若 platform-managed 的 migration 未 apply 时跑本 migration 会缺父（跨 change 耦合），但主仓已有该 migration 文件，实际无风险。
- **双 change 并行**：execute 期间 worktree apply 因 CLI partial 失败，代码经 git 对象恢复 + 手动 cp 落地 main（5 task 合并单 commit）。无代码损失（5 commit 对象核验完整）。
- **test_dispatch 预存债**：change 模块 `test_all_expected_stages_present`（STAGE_AGENT_CONFIG quick key）baseline 即 fail，非本变更回归（execute QA 已 ancestry 证明）。

## 技术债标注（CONCERNS）

无新增。migration downgrade 不可逆（NotImplementedError）为已知限制。

## 下一步

PASS → `sillyspec run archive --change 2026-08-13-fix-platform-progress-pk` 归档。
