---
author: qinyi
created_at: 2026-07-02 23:49:00
change: 2026-07-02-decouple-scan-from-change-flow
---

# Design: scan 从变更流程彻底移除

## 1. 背景

变更中心（Changes）当前流程是 6 段：`scan → brainstorm → plan → execute → verify → archive`，其中 `scan` 是每个新建变更的强制第一步（`StageEnum.SCAN → BRAINSTORM` 是 `TRANSITIONS` 唯一入口，`service.py:654-655` 将 draft 强制视为 scan）。

scan 的本质是执行 `sillyspec run scan`，为**整个项目**生成架构文档（`.sillyspec/docs/`），属于 workspace 级的一次性初始化动作，与单个变更的改动意图无关。它与「工作区详情页的扫描按钮」是同一件事。

实证问题（workspace `myaaa`）：
- 该 workspace 已有 1335 份 scan-docs、`last_scanned_at=2026-07-02 14:48`
- 在此之后 15:07 新建的变更，仍被强制从 scan 起步 → 纯冗余
- scan 段无审核面板（投影只在 brainstorm/plan/verify/archive 完成后出现），新建变更后页面无引导、唯一操作是藏在中部的小按钮去重跑全项目扫描 → 用户体验断裂

历史脉络：`2026-06-04-fix-agent-driven-change-center-flow` 的 `complete_stage` 映射表里变更阶段尚无 scan；scan 是 `202606190900_unify_workflow_stages`「统一 workspace 流程与变更流程用同一套 6 阶段枚举」时被塞到最前的副作用。流程文档 `flows/change-lifecycle.md` / `flows/sillyspec-workflow.md` 仍保留 `DRAFT → {SCAN, BRAINSTORM}`（scan 可选）的原始设计意图，说明实现已偏离文档。

`2026-07-01-changes-align-sillyspec` 已把 stage 收敛 6 个含 scan（已 merge main，commit 1adbcb39），但其重心是「删 HumanGate / 删 propose / 4 面板改投影」，未专门讨论 scan 作为变更入口的合理性。本次变更是其补全。

## 2. 设计目标

- 变更流程从 6 段收敛为 5 段：`brainstorm → plan → execute → verify → archive`
- 新建变更直接从「需求分析（brainstorm）」起步，不再强制或可选地经过 scan
- scan 回归单一职责：workspace 初始化动作（工作区详情页扫描按钮，本变更不动）
- 未扫描 workspace 不允许直接新建变更（避免 brainstorm 缺项目地图），引导先扫描

## 3. 非目标

- **不改 sillyspec CLI**：scan 是 sillyspec 工具的固有 stage，平台层屏蔽即可，CLI 内部 stage 不动
- **不改 agent 模块的 workspace 扫描**：`run_type="scan"` / `agent_type="scan"`（context_builder / router / service）是 workspace 级扫描，与变更流程的 `StageEnum.SCAN` 解耦，本次完全不碰
- **不改工作区详情页扫描按钮 / scan-docs 模块**：workspace 扫描入口与产物保持原样
- **不要求历史兼容**：项目未正式上线（CLAUDE.md 规则 10），存量卡在 scan 的变更允许重置
- **不重定位 scan 到 workspace 枚举**：方案 C（过度设计）已排除，scan 在 agent 模块已解耦，无需新枚举

## 4. 拆分判断

单一功能变更，不拆分、不批量。1 个核心功能（scan 从变更流程解耦）、单一用户角色、任务数 < 10、无重复模式。复杂度中等（触及 StageEnum 核心状态机但范围聚焦），单 Wave 推进即可。

## 5. 总体方案（方案 A：彻底删 SCAN）

变更流程的状态机收敛为 5 段，`StageEnum.SCAN` 从变更枚举移除。新建变更默认 `current_stage=brainstorm`。scan 作为 workspace 初始化动作由 workspace 模块 + agent 模块（run_type=scan）独立承载，不进变更 StageEnum。

```
变更流程（改后，5 段）：
  (新建) ──system──► BRAINSTORM ──agent──► PLAN ──agent──► EXECUTE ──agent──► VERIFY ──agent──► ARCHIVE ──system──► ARCHIVED

  审核面板投影（不变，仍由 stage 完成事件驱动）：
    brainstorm completed → PROPOSAL_REVIEW
    plan completed       → PLAN_REVIEW
    verify completed     → HUMAN_TEST
    archive 进行中        → ARCHIVE_CONFIRM
```

### Phase 1 — 后端状态机（核心）

- `model.py` `StageEnum`：删除 `SCAN = "scan"`；`spec_stages()` 收敛为 5 个；`STAGE_ORDER`（dispatch.py:32）同步去 scan，`assert` 校验对齐
- `model.py` `TRANSITIONS`：删除 `StageEnum.SCAN: {BRAINSTORM: ["agent"]}`；`BRAINSTORM` 成为流程入口（新建直入，无需 draft→scan 中转）
- `service.py:654-655`：`if not current or current == "draft": current = "scan"` → `current = "brainstorm"`
- `parser.py:589`：stage 推断 `return "scan"` → `return "brainstorm"`
- `dispatch.py`：`STAGE_AGENT_CONFIG` 删除 `StageEnum.SCAN` 项

### Phase 2 — 删除 scan stage 派发资源

- 删除 `backend/app/modules/change/prompts/scan.md`（scan stage prompt 不再需要）
- 确认 `_resolve_db_path` / projection 等无 scan 残留依赖（projection 本就不投影 scan，无需改）

### Phase 3 — 前端

- `changes/[cid]/page.tsx`：`WORKFLOW_STAGES` 去 `"scan"`（5 段）；`WORKFLOW_STAGE_LABELS` / `WORKFLOW_STAGE_COLORS` 去 scan 项；步骤条从「需求分析」起
- `changes/page.tsx`：阶段筛选项去 scan（`STAGE_FILTER_OPTIONS` 等）

### Phase 4 — 未扫描 workspace 门禁

- 新建变更 API（change create/注册）增加检查：若 `workspace.last_scanned_at IS NULL` 或该 workspace 无 scan_docs → 返回 409 + 引导「请先扫描工作区」
- 复用 workspace-config-flow 既有的扫描入口（工作区详情页扫描按钮），不重复实现扫描

### Phase 5 — 数据迁移

- 新增 alembic migration：存量 `changes.current_stage = 'scan'` → `'brainstorm'`
- `down_revision` 接当前真实 head（避免多 head，见 migration-chain-fragmentation-pattern 教训）
- `changes.current_stage` 列的 DB 级 default（当前 `'draft'`）保持或调为 NULL，由应用层设 brainstorm

### Phase 6 — 测试更新

- `test_dispatch.py` / `test_gate_transitions.py` / `test_complete_stage.py`：`current_stage="scan"` 断言、`TRANSITIONS[SCAN]`、`get_config_for_stage("scan")` 等改 brainstorm
- **区分**：`runtime/test_router.py` 的 `stages["scan"]`、`agent/test_execution_context*.py` 的 `run_type="scan"` 属 **workspace 级扫描**，不动
- `test_projection.py` 的 `current_stage TEXT DEFAULT 'scan'`（测试用 sqlite schema）改 brainstorm

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/change/model.py` | StageEnum 删 SCAN；spec_stages() 收敛 5；TRANSITIONS 删 SCAN→BRAINSTORM |
| 修改 | `backend/app/modules/change/service.py` | :654-655 draft→brainstorm；create 路径加未扫描 workspace 门禁（Phase 4） |
| 修改 | `backend/app/modules/change/dispatch.py` | STAGE_ORDER 去 scan；STAGE_AGENT_CONFIG 删 SCAN 项；assert 对齐 |
| 修改 | `backend/app/modules/change/parser.py` | :589 stage 推断 scan→brainstorm |
| 删除 | `backend/app/modules/change/prompts/scan.md` | scan stage prompt 不再需要 |
| 新增 | `backend/migrations/versions/202607022300_remove_scan_from_change_flow.py` | 存量 current_stage scan→brainstorm |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | WORKFLOW_STAGES 去 scan（5 段）+ labels/colors |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | 阶段筛选项去 scan |
| 修改 | `backend/app/modules/change/tests/test_dispatch.py` | scan 断言改 brainstorm |
| 修改 | `backend/app/modules/change/tests/test_gate_transitions.py` | TRANSITIONS[SCAN] 用例改 brainstorm 入口 |
| 修改 | `backend/app/modules/change/tests/test_complete_stage.py` | _resolve_stage_completion("scan") 用例调整 |
| 修改 | `backend/app/modules/change/tests/test_projection.py` | 测试 schema default scan→brainstorm |

## 7. 接口定义（状态机）

```python
# model.py — 改后
class StageEnum(enum.StrEnum):
    """变更流程阶段：5 段（scan 已移除，回归 workspace 初始化）。"""
    BRAINSTORM = "brainstorm"
    PLAN = "plan"
    EXECUTE = "execute"
    VERIFY = "verify"
    ARCHIVE = "archive"

    @classmethod
    def spec_stages(cls) -> list[StageEnum]:
        return [cls.BRAINSTORM, cls.PLAN, cls.EXECUTE, cls.VERIFY, cls.ARCHIVE]

TRANSITIONS = {
    StageEnum.BRAINSTORM: {StageEnum.PLAN: ["agent"]},
    StageEnum.PLAN: {StageEnum.EXECUTE: ["agent"]},
    StageEnum.EXECUTE: {StageEnum.VERIFY: ["agent"]},
    StageEnum.VERIFY: {StageEnum.ARCHIVE: ["agent"]},
    StageEnum.ARCHIVE: {},
}
```

```python
# service.py:654 — 改后
if not current or current == "draft":
    current = "brainstorm"   # 原 "scan"
```

## 7.5 生命周期契约表（state transition）

| 触发 | from | to | 角色 | 备注 |
|---|---|---|---|---|
| 新建变更 | `(无 / draft)` | `brainstorm` | system | **改**：原 draft→scan，现 draft→brainstorm |
| 需求分析完成 + 审核 | `brainstorm` | `plan` | agent + proposal_review | 不变 |
| 规划完成 + 审核 | `plan` | `execute` | agent + plan_review | 不变 |
| 执行完成 | `execute` | `verify` | agent | 不变 |
| 验证完成 + 人工测试 | `verify` | `archive` | agent + human_test | 不变 |
| 归档确认 | `archive` | `(archived)` | system + archive_confirm | 不变 |
| 存量数据迁移 | `scan`（旧） | `brainstorm` | migration | 一次性 |

## 8. 数据迁移

```python
# 202607022300_remove_scan_from_change_flow.py
revision = "202607022300"
down_revision = "<当前真实 head>"   # execute 前用 alembic heads 确认

def upgrade():
    op.execute("UPDATE changes SET current_stage = 'brainstorm' WHERE current_stage = 'scan'")

def downgrade():
    pass   # 一次性语义迁移，不回滚
```

## 9. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| sillyspec.db 里变更 stage 仍含 scan（CLI 固有） | 高 | 低 | 平台层以 StageEnum 为准屏蔽 scan；projection 不投影 scan，无影响 |
| 存量变更卡 scan 迁移后丢失 scan 产物 | 低 | 低 | scan 产物在 workspace 级 scan_docs，不在变更 stage；迁移只改 current_stage |
| migration down_revision 撞 head | 中 | 高 | execute 前跑 `alembic heads` 确认单一 head；memory migration-chain 教训 |
| 未扫描 workspace 门禁误拦 | 中 | 中 | 仅当 last_scanned_at IS NULL 且无 scan_docs 时拦；已扫描 workspace 不受影响 |
| 前端步骤条 scan 残留 | 低 | 低 | 改后跑前端 vitest + 手动确认变更详情页 |

## 10. 决策记录

- **D-001@V1**：scan 从变更流程彻底移除（用户选定方案 A），StageEnum 收敛 5 段。理由：用户明确「彻底移除 + 最简彻底」，状态机最干净。
- **D-002@V1**：不重定位 scan 到 workspace 枚举（排除方案 C）。理由：scan 在 agent 模块已用 run_type=scan 解耦，新枚举属过度设计（YAGNI）。
- **D-003@V1**：保留 StageEnum 对齐的偏离（不再和 sillyspec CLI 的 6 stage 一一对应）。理由：平台层屏蔽 CLI 的 scan stage 不影响功能；变更流程语义清晰优先于枚举对齐。
- **D-004@V1**：新增未扫描 workspace 门禁（Phase 4）。理由：scan 移除后，未扫描 workspace 直接进 brainstorm 会缺项目地图；门禁仅拦「从未扫描」的 workspace，已扫描的不受影响，与用户诉求不矛盾。
- **D-005@V1**：存量 current_stage=scan 一律迁移到 brainstorm（规则 10 允许重置）。理由：项目未上线，不要求历史兼容。

## 11. 自审

- **是否引入新枚举？** 否，StageEnum 反而收敛（删 SCAN）。
- **是否破坏 workspace 扫描？** 否，agent 模块 run_type=scan 与 scan_docs 模块完全不碰（Phase 1-6 均未涉及）。
- **审核面板投影是否受影响？** 否，projection 本就不投影 scan，5 段流程的 brainstorm/plan/verify/archive 投影逻辑不变。
- **sillyspec.db 单一真相源原则是否破坏？** 否，平台 StageEnum 是平台层语义，sillyspec.db 仍记录 CLI 的 stage（含 scan），平台层屏蔽 scan 不改 db。
- **跨平台兼容？** 是，纯 Python/TS 逻辑改动，无 OS 相关代码。
