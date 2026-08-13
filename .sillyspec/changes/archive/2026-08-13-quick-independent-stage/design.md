---
title: quick 类型变更为独立阶段
change_key: 2026-08-12-quick-independent-stage
status: draft
scale: large
tier: self
risk_level: unit-sufficient
created_at: 2026-08-12T21:35:00+08:00
author: WhaleFall
affected_modules:
  - backend/change
  - backend/change_writer
  - frontend/changes
---


# Design: quick 独立阶段全套适配

## 1. 背景与目标

### 1.1 问题

上一轮 quick 修复（ql-20260812-006）把新建变更统一设为 `current_stage=brainstorm`，但这对 quick 类型变更是错的：

- **SillySpec 的 quick 是独立辅助阶段**（`VALID_STAGES = [scan, brainstorm, plan, execute, verify, archive, quick, explore]`，`shared.js:7`），标签「⚡ 快速任务」，自己跑完三步（理解任务→实现并验证→暂存和更新记录）就结束，**不走** brainstorm→plan→execute→verify→archive 主线。
- 平台后端 `STAGE_AGENT_CONFIG`（`change/dispatch.py:81`）只配了主线 5 阶段，**无 quick 配置**。
- 平台前端详情页 `ChangeStageActions` 完全围绕主线设计（gate 审核面板 / 推进按钮依赖 `NEXT_STAGE` / 团队执行开关），`NEXT_STAGE` 映射（`changes/[cid]/page.tsx:46`）只有主线 5 阶段，**quick 变更会显示空白操作区**。
- 前端列表页 `STAGE_LABEL`（`changes/page.tsx:86`）无 quick 映射。

结果：quick 类型变更被错误塞进主线，名实不符，违背轻量快通道本意。

### 1.2 目标

让 quick 类型变更作为**独立阶段**接入平台，与主线 5 阶段平行，全套适配：

- 创建时 `change_type=quick` → `current_stage=quick`
- quick 派发 agent 跑 SillySpec quick 三步
- quick 跑完即完成（`current_stage` 保持 quick + 完成标记，**不归档**）
- 列表页/详情页正确显示与操作 quick 变更

### 1.3 非目标

- 不改主线 5 阶段（brainstorm/plan/execute/verify/archive）的任何逻辑
- 不改 quick 的分类器关键词（ql-20260812-006 已交付，本变更只接 stage）
- 不处理 explore 阶段（结构与 quick 类似，但本次不做）

## 2. 方案选型

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| **A. quick 完整独立阶段** | StageEnum+dispatch+创建分流+前端全套适配 | 对齐 SillySpec、语义清晰 | 详情页要加新分支 | ✅ 选定 |
| B. quick 复用 brainstorm 仅打标 | 创建仍 brainstorm，用 change_type 区分 | 改动小 | 名实不符，仍显示主线推进按钮 | ✗ |
| C. quick 不进阶段系统 | 不设 current_stage=quick，纯靠 run | 改动最小 | 列表看不出状态，与 SillySpec 脱节 | ✗ |

选 A（用户已通过 AskUserQuestion 确认「全套适配」）。

## 3. 核心决策

- **D-001：quick 无后继转换。** `TRANSITIONS` 不加 quick 边。quick 跑完即终态，不自动归档（区别于主线 verify→archive）。
- **D-002：quick 是 auxiliary 阶段。** `StageEnum.spec_stages()` 保持只返回主线 5 阶段（用于上下游 cascade/一致性判定）；新增 `spec_auxiliary_stages()` 返回 `[QUICK]`。`dispatch.py:46` 的 `spec_stages()==STAGE_ORDER` 断言不受影响（断言对象是 spec_stages，不含 quick）。
- **D-003：完成态用 agent run 判定，不加 DB 字段。** quick 的「已完成」由最近一条 agent run 状态（completed/failed）+ `change.stages.quick.status` 推导，不加新列、无 DB 迁移（`current_stage` 本就是字符串字段）。
- **D-004：详情页 quick 分支隔离主线 UI。** `current_stage==='quick'` 时，`ChangeStageActions` 渲染简化操作区（标题「快速修复」+ 触发智能体按钮 + 完成说明），不渲染主线专属的推进按钮 / gate 面板 / 团队开关。

## 4. 后端设计

### 4.1 `change/model.py` — StageEnum 扩展

```python
class StageEnum(enum.StrEnum):
    BRAINSTORM = "brainstorm"
    PLAN = "plan"
    EXECUTE = "execute"
    VERIFY = "verify"
    ARCHIVE = "archive"
    QUICK = "quick"  # 辅助阶段：快速任务，独立流程

    @classmethod
    def spec_stages(cls) -> list[StageEnum]:
        """主线 5 阶段（不含 auxiliary quick）。"""
        return [cls.BRAINSTORM, cls.PLAN, cls.EXECUTE, cls.VERIFY, cls.ARCHIVE]

    @classmethod
    def spec_auxiliary_stages(cls) -> list[StageEnum]:
        """辅助阶段（quick 等，独立流程，不进主线上下游判定）。"""
        return [cls.QUICK]
```

`TRANSITIONS` 不变（quick 无后继边）。

### 4.2 `change/dispatch.py` — STAGE_AGENT_CONFIG 加 quick

```python
StageEnum.QUICK.value: StageAgentConfig(
    enabled=True,
    prompt_template="quick.md",  # 已存在
    phase="Quick",
    requires_worktree=False,
    read_only=False,
    description="Quick fix: run SillySpec quick 3 steps (understand/implement/record).",
),
```

`STAGE_ORDER`（dispatch.py:38-44）是主线列表，不含 quick，断言 `spec_stages()==STAGE_ORDER` 保持成立（spec_stages 已排除 quick）。

派发入口：`transition_with_dispatch` 当前按 `target_stage` 分流。quick 变更不走 transition（无后继），而是通过现有的 `POST /changes/{id}/dispatch`（manual_dispatch，`router.py:851`）触发 quick agent。dispatch 内部按 `current_stage` 取 `STAGE_AGENT_CONFIG[quick]` 配置派发。

### 4.3 `change_writer/classifier.py` + `proxy.py` + `service.py` — 创建分流

`classify_change_type` 不变（已返回 quick）。改创建逻辑：

```python
# proxy.py / service.py 创建 Change 时
if change_type is None:
    change_type = classify_change_type(description)

# ql-20260812-007：quick 类型走独立阶段，其余走 brainstorm
initial_stage = "quick" if change_type == "quick" else "brainstorm"
change = Change(
    ...
    current_stage=initial_stage,
    stages={initial_stage: {"status": "pending", "at": now.isoformat()}},
)
```

## 5. 前端设计

### 5.1 `changes/page.tsx` — 列表页标签

```typescript
const STAGE_KIND: Record<string, StatusKind> = {
  draft: "neutral",
  quick: "warning",  // 新增
  brainstorm: "warning",
  plan: "info",
  execute: "info",
  verify: "success",
  archive: "neutral",
  blocked: "error",
  archived: "neutral",
};

const STAGE_LABEL: Record<string, string> = {
  draft: "草稿",
  quick: "快速任务",  // 新增
  brainstorm: "需求分析",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  archive: "归档",
  blocked: "阻塞",
  archived: "已归档",
};
```

「状态」列（page.tsx:239-247）：quick 变更 `current_stage==='quick'` 不等于 scan，会显示「进行中」——正确（quick 进行中）。跑完后由 D-003 完成态判定，后续可显示「已完成」。

### 5.2 `change-stage-actions.tsx` — 详情页 quick 分支

在组件顶部加 quick 早返回分支：

```tsx
// quick 独立阶段：简化操作区，隔离主线 UI
if (currentStage === "quick") {
  return (
    <section className="space-y-3 rounded-md border border-amber-500/40 bg-amber-50/40 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">⚡ 快速修复</span>
        <span className="text-xs text-muted-foreground">
          快速通道，不走完整流程
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        点击触发智能体执行快速修复（理解任务→实现→记录），跑完即完成，无需归档。
      </p>
      {/* 档案选择器（复用主线） */}
      <AgentProfileSelect ... />
      {/* 触发智能体 / 完成态 */}
      {hasActiveRun ? (
        <span className="text-[11px] text-muted-foreground">智能体执行中…</span>
      ) : configEnabled ? (
        <Button onClick={onDispatch} disabled={dispatching}>
          {dispatching ? "触发中…" : "🤖 触发快速修复"}
        </Button>
      ) : null}
    </section>
  );
}
// 主线分支（原有逻辑不变）
return (<div>...</div>);
```

关键：quick 分支**不渲染** gate 面板、推进按钮、团队开关。

### 5.3 `change-stage-header.tsx` — 步骤条

`WORKFLOW_STAGES`（主线 5 阶段）不含 quick，`ChangeStageHeader` 对 quick 变更 `indexOf<0` 返回 null 不渲染——**已兼容，无需改**。

### 5.4 `changes/[cid]/page.tsx` — 标题徽标

`STATUS_BADGE`（page.tsx:54）已有 `quick: { label: "快速修复" }`——quick 变更标题旁会显示「快速修复」徽标，**已兼容**。

## 6. 完成态判定（D-003）

quick 变更的「已完成」判定逻辑（前端）：

```
current_stage === 'quick'
  && !agentStatus.has_active_run
  && 最近一条 agent run status === 'completed'
  → 显示「✓ 已完成」
```

不加 DB 字段，纯前端从 `agentStatus`（`getAgentStatus` 返回）+ `change.stages.quick.status` 推导。

## 7. 兼容性

- **向后兼容**：现有 brainstorm/plan/execute/verify/archive 变更完全不受影响（主线逻辑零改动）。
- **存量 draft 数据**：ql-20260812-006 已把 draft 对齐到 brainstorm。本变更不影响。
- **无 DB 迁移**：`current_stage` 是 `String` 列（`model.py:149`），存 'quick' 无需 schema 改动。

## 8. 风险

| 风险 | 缓解 |
|------|------|
| `spec_stages()==STAGE_ORDER` 断言 | spec_stages 排除 quick，断言保持成立（D-002） |
| quick dispatch 复用 transition 还是 manual_dispatch | quick 无 transition 边，走 manual_dispatch（POST /dispatch），dispatch 按 current_stage 取配置 |
| 详情页 quick 分支遗漏主线 props | quick 早返回在组件顶部，主线 props 不消费 |
| 前端列表 quick 状态列显示 | quick 非 scan→显示「进行中」，符合预期 |

## 9. 文件变更清单（File Changes）

| 文件 | 改动 | 类型 |
|------|------|------|
| `backend/app/modules/change/model.py` | StageEnum 加 QUICK + spec_auxiliary_stages() | 改 |
| `backend/app/modules/change/dispatch.py` | STAGE_AGENT_CONFIG 加 quick 配置 | 改 |
| `backend/app/modules/change_writer/proxy.py` | 创建分流：quick→current_stage=quick | 改 |
| `backend/app/modules/change_writer/service.py` | 创建分流：quick→current_stage=quick | 改 |
| `backend/app/modules/change_writer/tests/test_classifier.py` | 加创建分流测试 | 改 |
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | STAGE_LABEL/STAGE_KIND 加 quick | 改 |
| `frontend/src/components/changes/detail/change-stage-actions.tsx` | 加 quick 简化操作区分支 | 改 |

共 7 文件，全部为改（无新增模块文件）。无 DB 迁移。

## 10. 自审（Self-Review）

- ✅ 对齐 SillySpec：quick 是 `VALID_STAGES` 的 auxiliary 阶段（`shared.js:7`），本设计尊重其独立性
- ✅ 向后兼容：主线 5 阶段逻辑零改动，spec_stages() 不变，TRANSITIONS 不变
- ✅ 无 DB 迁移：current_stage 字符串列，存 'quick' 无 schema 改动
- ✅ 断言安全：spec_stages()==STAGE_ORDER 断言保持成立（D-002 把 quick 放 auxiliary）
- ✅ 前端隔离：quick 早返回分支不消费主线 props，不渲染 gate/推进/团队
- ✅ 完成态无新字段：D-003 纯前端从 agentStatus 推导
- ⚠️ 待验证：dispatch 按 current_stage 取配置的路径（manual_dispatch）是否真的会用 STAGE_AGENT_CONFIG[quick]——plan 阶段需确认 dispatch.py 的 manual_dispatch 实现
- ⚠️ 待验证：quick agent run 完成后 change.stages.quick.status 的更新路径（谁来标 completed）——plan 阶段需确认

## 11. 验收标准

- [ ] 创建 quick 类型变更 → `current_stage=quick`（DB + API 返回）
- [ ] 列表页 quick 变更阶段列显示「快速任务」
- [ ] 详情页 quick 变更显示简化操作区（⚡快速修复 + 触发按钮，无主线推进/gate/团队）
- [ ] quick 变更可派发 agent（POST /dispatch 成功）
- [ ] 主线变更不受影响（brainstorm 变更仍走原流程）
- [ ] 后端单测：StageEnum.spec_auxiliary_stages / 创建分流
- [ ] 前端 tsc 通过
