---
author: WhaleFall
created_at: 2026-06-04 13:44:54
---

# Design: 修正 Agent 驱动变更中心流程闭环

## 核心架构决策

### AD-01: Gate 时机 — transition 时一律 none，complete_stage 后设 gate

**决策**：`resolve_human_gate()` 全返回 `HumanGate.NONE`。新增 `complete_stage()` 方法，由 Agent 完成回调或 sync 后统一设置 `human_gate`。

**理由**：当前 `transition()` 在进入 propose/plan/verify/archive 时立刻设 gate，导致 Agent 还没跑就显示"请确认"。

**改动**：
- `service.py`：`resolve_human_gate()` 返回 none
- `service.py`：新增 `complete_stage(workspace_id, change_id, stage, result, summary)`
- `dispatch.py`：`auto_dispatch_next_step` 在 `stage_completed` 时调用 `complete_stage`

### AD-02: rerun_stage 绕过 TRANSITIONS 自环限制

**决策**：不修改 TRANSITIONS 添加自环边。新增 `rerun_stage()` 方法，直接重置 `human_gate=none` 并 dispatch，不走 `transition()` 校验。

**理由**：自环边在 TRANSITIONS 里语义不明确（"允许 propose→propose" 不等于 "允许任意阶段自环"）。rerun 是"带意见重跑当前阶段"，不是"阶段流转"。

**改动**：
- `service.py`：新增 `rerun_stage(workspace_id, change_id, stage, comment, user_id)`
- `proposal_review("revise")` → 调用 `rerun_stage("propose")`
- `plan_review("replan")` → 调用 `rerun_stage("plan")`

### AD-03: TRANSITIONS 加 verify→propose 回退边

**决策**：在 TRANSITIONS 的 VERIFY 条目中加 `StageEnum.PROPOSE: ["reviewer"]`。

**理由**：`human_test("doc_mismatch")` 需要从 verify 回到 propose，这是合法的回退场景。

### AD-04: human_test pass 不 dispatch archive

**决策**：`human_test("pass")` 只设置 `current_stage=archive, human_gate=need_archive_confirm`，不 dispatch。

**理由**：设计要求归档前必须有人工确认步骤。

### AD-05: 新增 archive-confirm API

**决策**：新增 `POST /changes/{id}/archive-confirm`，只在 `archive+need_archive_confirm` 时允许调用。

**理由**：归档确认是一个独立的 gate，不能复用 human_test API。

## 文件变更清单

### 后端

| 文件 | 改动 |
|------|------|
| `backend/app/modules/change/model.py` | TRANSITIONS 加 verify→propose 边 |
| `backend/app/modules/change/service.py` | resolve_human_gate 返回 none；新增 complete_stage、rerun_stage、archive_confirm；修正 proposal_review/plan_review/human_test |
| `backend/app/modules/change/dispatch.py` | auto_dispatch_next_step 调用 complete_stage |
| `backend/app/modules/change/schema.py` | 新增 ArchiveConfirmRequest DTO |
| `backend/app/modules/change/router.py` | 新增 archive-confirm 路由 |

### 前端

| 文件 | 改动 |
|------|------|
| `frontend/src/lib/changes.ts` | 新增 archiveConfirm API 函数 |
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | Gate 面板加 comment textarea；修 archive-confirm 按钮；清理旧 UI |

### 测试

| 文件 | 改动 |
|------|------|
| `backend/app/modules/change/tests/test_review_apis.py` | 修正/新增 complete_stage、rerun_stage、archive-confirm 测试 |
| `backend/app/modules/change/tests/test_gate_transitions.py` | 验证 verify→propose 回退 |

## 数据模型

无新表/新列。`human_gate` 字段已在 agent-driven-change-center 变更中添加。

## API 设计

### POST /api/workspaces/{ws_id}/changes/{id}/archive-confirm

**请求体**：
```json
{
  "comment": "归档备注，可选"
}
```

**响应**：`ReviewResponse`（复用）

**前置条件**：`current_stage == "archive" && human_gate == "need_archive_confirm"`

## complete_stage 阶段映射

| stage | result | current_stage | human_gate | dispatch |
|-------|--------|---------------|------------|----------|
| brainstorm | clear | propose | none | propose Agent |
| brainstorm | ambiguous | brainstorm | need_requirement_input | — |
| propose | — | propose | need_proposal_review | — |
| plan | — | plan | need_plan_review | — |
| execute | — | verify | none | verify Agent |
| verify | passed | verify | need_human_test | — |
| verify | failed | quick | none | quick Agent（auto_fix_count < 3） |
| verify | failed（≥3次） | verify | blocked | — |
| quick | — | verify | none | verify Agent |
| archive | — | archived | none | — |

## 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| complete_stage 调用时机不对 | 中 | 高 | 在 auto_dispatch_next_step 和 sync 回调中都触发 |
| 旧数据 human_gate 值与新逻辑不一致 | 低 | 低 | migration 已将旧数据统一为 none |
| 前端旧缓存导致按钮状态不刷新 | 低 | 中 | Gate 面板每次加载都从 API 刷新 |

## 自审

- **是否引入新枚举？** 否，复用现有 HumanGate 和 StageEnum
- **是否改 API 签名？** 否，只改内部逻辑，新增 1 个 API（archive-confirm）
- **是否需要 migration？** 否，无新列
- **是否向后兼容？** 是，旧 API 签名不变
