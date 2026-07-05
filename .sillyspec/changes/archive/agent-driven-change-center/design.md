---
author: WhaleFall
created_at: 2026-06-04 10:40:22
---

# Design

## 背景与目标

把变更中心从「人工点阶段按钮」改为「Agent 自动推进，人只确认文档/计划/测试结果」。核心机制：`current_stage`（Agent 在做什么）+ `human_gate`（人在等什么）二元组。

## 架构决策

### 决策 1：human_gate 独立于 current_stage

在 Change 模型新增 `human_gate` 字段，不把等待状态塞进 stage。
- **理由**：propose 阶段可能 Agent 正在生成文档（human_gate=none），也可能等人确认（human_gate=need_proposal_review）——一个维度无法表达两种状态。
- **Trade-off**：多一个字段需要维护一致性，但消除了 stage 语义歧义。

### 决策 2：移除 rework_required 和 accepted

用 human_gate 替代这两个「混合状态」：
- `rework_required` → `verify` + `human_gate=blocked`
- `accepted` → `verify` + `human_gate=need_archive_confirm`
- **理由**：减少 StageEnum 数量，让 stage 只代表 SillySpec 技能阶段。
- **Trade-off**：需要数据迁移，但 stage 语义更清晰。

### 决策 3：Review Gate 作为独立路由

3 个 review 接口独立为 `/changes/{id}/proposal-review`、`plan-review`、`human-test`，不通过通用 transition 接口。
- **理由**：review 有专有的 decision 枚举和 comment 逻辑，不适合塞进 `TransitionRequest`。
- **Trade-off**：路由数量增加，但每个 API 职责清晰，前端调用更直观。

### 决策 4：intake agent 复用 brainstorm dispatch

创建变更后自动 dispatch `brainstorm` stage 的 agent（已有 prompt 模板），不新增 intake stage。
- **理由**：intake 的本质就是 brainstorm（分析需求、判断明确度），已有完善的基础设施。
- **Trade-off**：brainstorm agent 完成后的自动路由逻辑需要新增（根据分析结果决定进入 propose 还是 need_requirement_input）。

### 决策 5：verify 自动修复用 stages JSON 追踪计数

在 `change.stages` JSON 中记录 `_auto_fix_count`，auto_dispatch_next_step 读取并判断是否超限。
- **理由**：不需要新增字段，stages JSON 本身就是扩展元数据的设计。
- **Trade-off**：不透明（需要知道 JSON key），但加字段更重。

## 文件变更清单

| 文件 | 变更 | 说明 |
|---|---|---|
| `backend/app/modules/change/model.py` | 改 | 移除 rework_required/accepted，新增 blocked；TRANSITIONS 更新；新增 HumanGate 枚举 |
| `backend/app/modules/change/schema.py` | 改 | ChangeRead/ChangeSummary 增加 human_gate 字段；新增 ReviewRequest/ReviewResponse DTO |
| `backend/app/modules/change/service.py` | 改 | transition() 增加 human_gate 联动；新增 proposal_review()/plan_review()/human_test() 方法 |
| `backend/app/modules/change/router.py` | 改 | 新增 3 个 review 路由；transition 路由适配 human_gate |
| `backend/app/modules/change/dispatch.py` | 改 | auto_dispatch_next_step() 增加 gate 检查；verify 自动修复计数；intake 路由逻辑 |
| `backend/app/modules/workflow/fsm.py` | 改 | ChangeFSM 废弃确认（已标记 deprecated） |
| `backend/app/modules/workflow/spec_guardian.py` | 改 | guard 规则适配新阶段名 |
| `backend/migrations/versions/xxx_add_human_gate.py` | 增 | ALTER TABLE + 数据迁移 |
| `frontend/src/lib/change.ts` | 改 | 类型增加 human_gate；新增 review API 调用 |
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 改 | 按 human_gate 渲染操作面板；移除技术阶段按钮 |
| `frontend/src/components/create-change-dialog.tsx` | 改 | 简化表单（只保留需求描述 + 模块可选） |

## 数据模型

### Change 表变更

```sql
ALTER TABLE "change" ADD COLUMN human_gate VARCHAR(50) DEFAULT 'none';

-- 旧数据迁移
UPDATE "change" SET current_stage = 'verify', human_gate = 'blocked' WHERE current_stage = 'rework_required';
UPDATE "change" SET current_stage = 'verify', human_gate = 'need_archive_confirm' WHERE current_stage = 'accepted';
UPDATE "change" SET human_gate = 'none' WHERE human_gate = 'none' OR human_gate IS NULL;
```

### StageEnum（更新后）

```python
class StageEnum(str, Enum):
    draft = "draft"
    scan = "scan"
    brainstorm = "brainstorm"
    propose = "propose"
    plan = "plan"
    execute = "execute"
    verify = "verify"
    quick = "quick"
    archive = "archive"
    archived = "archived"
    blocked = "blocked"  # 新增
```

### HumanGate 枚举（新增）

```python
class HumanGate(str, Enum):
    none = "none"
    need_requirement_input = "need_requirement_input"
    need_proposal_review = "need_proposal_review"
    need_plan_review = "need_plan_review"
    need_human_test = "need_human_test"
    need_archive_confirm = "need_archive_confirm"
    blocked = "blocked"
```

### 状态组合矩阵

| current_stage | human_gate | 含义 |
|---|---|---|
| draft | none | Agent 正在分析需求 |
| brainstorm | need_requirement_input | 等人补充需求 |
| propose | none | Agent 正在生成四件套 |
| propose | need_proposal_review | 等人确认四件套 |
| plan | none | Agent 正在生成计划 |
| plan | need_plan_review | 等人确认计划 |
| execute | none | Agent 正在执行 |
| verify | none | Agent 正在验证 |
| verify | need_human_test | 等人测试 |
| verify | blocked | 自动修复超限，需人工介入 |
| quick | none | Agent 正在快速修复 |
| archive | need_archive_confirm | 等人确认归档 |
| archived | none | 已归档 |

## API 设计

### 新增路由

```
POST /api/workspaces/{ws}/changes/{id}/proposal-review
  Body: { decision: "approve"|"revise"|"unclear", comment?: string }
  Response: { change, agent_dispatch? }

POST /api/workspaces/{ws}/changes/{id}/plan-review
  Body: { decision: "approve"|"replan"|"back_to_propose"|"back_to_brainstorm", comment?: string }
  Response: { change, agent_dispatch? }

POST /api/workspaces/{ws}/changes/{id}/human-test
  Body: { result: "pass"|"bug"|"doc_mismatch", comment?: string }
  Response: { change, agent_dispatch? }
```

### 修改路由

```
POST /api/workspaces/{ws}/changes/{id}/transition
  - 增加 human_gate 联动逻辑
  - transition 完成后根据目标 stage 自动设置 human_gate
```

## 兼容策略

- 旧数据通过迁移脚本映射到新状态组合
- `TransitionRequest` 的 `target_stage` 仍可用于 admin 强制推进
- 前端先读 `human_gate`，gate=none 时显示「Agent 正在执行」，否则显示 gate 对应的操作面板
- `WorkflowService.transition_change()` 保持兼容，检查新 stage 名

## 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| auto_dispatch_next_step 的 gate 检查逻辑遗漏 | 中 | 在 dispatch.py 中集中维护 gate→action 映射表，测试覆盖所有分支 |
| 前端从旧按钮切换到 gate 面板的迁移 | 中 | 保留 transition API 兼容，gate 面板是增量 UI |
| verify 自动修复的 stages JSON key 污染 | 低 | 使用 `_auto_fix_count` 前缀下划线约定，与其他 stage 数据隔离 |
| brainstorm agent 的路由判断逻辑 | 中 | intake 路由基于 sillyspec.db 的 progress 结果，有明确的数据源 |

## 自审

- 是否引入新表：否，只 ADD COLUMN
- 是否复用现有能力：是（dispatch、auto_chain、brainstorm prompt、transition）
- 是否覆盖全部需求点：FR-01 到 FR-14 全部覆盖
- 表名/字段名是否真实：Change、StageEnum、TRANSITIONS 均来自 model.py；human_gate 为新增
