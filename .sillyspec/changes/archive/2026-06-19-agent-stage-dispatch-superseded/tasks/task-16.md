---
author: qinyi
created_at: 2026-06-01 20:15:00
---

---
id: task-16
title: 更新变更详情页展示 SillySpec 步骤进度
priority: P2
estimated_hours: 3
depends_on: [task-14, task-15]
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/components/sillyspec-step-progress.tsx
---

## 修改文件

- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` — 在现有 Agent Dispatch Status Panel 中增加 SillySpec step 进度展示
- `frontend/src/components/sillyspec-step-progress.tsx` — 新增组件：SillySpec 阶段步骤进度条

## 实现要求

根据 design.md Phase 6 "变更详情页展示"（line 367-372），在现有变更详情页的 Agent Dispatch Status Panel 中新增 SillySpec 步骤级进度展示。

### 当前状态分析

**现有代码**（`page.tsx` line 570-648）已实现：
- Agent 运行状态面板（`agentStatus`），通过 `getAgentStatus()` 获取 `DispatchResponse`
- 运行状态指示（running/completed/failed/ready）
- 手动触发按钮（`triggerDispatch`）
- transition 返回后展示 dispatch 反馈（`result.agent_dispatch`）

**缺少的部分**：
1. 当前 stage 名称 + 步骤序号/总数展示
2. 关联 AgentRun 状态的 step 级别可视化
3. "下一步"操作按钮（触发 dispatch）

### 数据来源

步骤进度数据来自两个源头：

| 数据 | 来源 | 类型 |
|------|------|------|
| 当前 stage | `change.current_stage` | `string \| null` |
| stage 步骤列表 | `change.stages?.steps` | `StepInfo[] \| undefined`（后端 task-09/10 sync 写入） |
| Agent 运行状态 | `agentStatus`（`DispatchResponse`） | `DispatchResponse` |
| transition dispatch 结果 | `TransitionResponse.agent_dispatch` | `AgentDispatchResult \| null` |

### change.stages.steps 结构

后端 `sync_stage_status()`（task-09）会将步骤信息写入 `Change.stages` JSON，预期结构：

```typescript
interface StageStepsInfo {
  /** 当前 stage 名称 */
  current_stage: string;
  /** 步骤列表 */
  steps: StepInfo[];
  /** 最后 dispatch 信息 */
  last_dispatch: LastDispatchInfo | null;
}

interface StepInfo {
  /** 步骤序号（1-based） */
  index: number;
  /** 步骤名称 */
  name: string;
  /** 步骤状态 */
  status: "pending" | "running" | "completed" | "failed";
  /** 关联的 AgentRun ID */
  agent_run_id?: string;
}

interface LastDispatchInfo {
  stage: string;
  user_id: string;
  at: string;
  config: {
    prompt_template: string;
    requires_worktree: boolean;
    read_only: boolean;
  };
}
```

> 注：如果后端 task-09 尚未实现此结构，前端应优雅降级——使用 `change.current_stage` + `agentStatus` 的有限信息渲染。

## 接口定义

### 1. SillySpecStepProgress 组件

```typescript
// frontend/src/components/sillyspec-step-progress.tsx

/** 单个步骤信息 */
interface StepInfo {
  index: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  agent_run_id?: string;
}

interface SillySpecStepProgressProps {
  /** 当前 stage 名称（如 "propose"、"plan"） */
  currentStage: string | null;
  /** stage 对应的步骤列表，来自 Change.stages.steps */
  steps: StepInfo[] | undefined;
  /** 是否有活跃的 AgentRun（来自 DispatchResponse.has_active_run） */
  hasActiveRun: boolean;
  /** Agent 配置是否启用（来自 DispatchResponse.config_enabled） */
  configEnabled: boolean;
  /** 最后一次 dispatch 的状态（来自 DispatchResponse.last_dispatch） */
  lastDispatchStatus?: "running" | "completed" | "failed" | null;
  /** 最后一次 dispatch 完成时间 */
  lastDispatchFinishedAt?: string | null;
  /** 最后一次 dispatch 输出摘要 */
  lastDispatchSummary?: string | null;
}
```

### 2. 组件渲染结构

```
SillySpecStepProgress
├── Stage Header
│   ├── stage 名称（WORKFLOW_STAGE_LABELS 映射）
│   ├── 步骤进度 "3/7 步骤完成"
│   └── 运行状态指示灯（同现有样式）
├── Step Bar（横向步骤条）
│   ├── 每个步骤：圆点 + 名称
│   │   ├── completed: 绿色圆点 + ✓
│   │   ├── running: 蓝色脉冲动画 + 步骤名
│   │   ├── failed: 红色圆点 + ✗
│   │   └── pending: 灰色圆点 + 序号
│   └── 步骤间连线（颜色跟随状态）
└── AgentRun 信息区（条件渲染）
    ├── 运行中: "Agent 运行中…"（同现有样式）
    ├── 上次成功: "上次执行成功 · 时间"
    ├── 上次失败: "上次执行失败 · 时间"
    └── 输出摘要（可折叠）
```

### 3. 页面集成方式

在 `page.tsx` 中，将现有的 Agent Dispatch Status Panel（line 570-648）替换为：

```tsx
{/* ── SillySpec Step Progress ─────────────────────────────── */}
<SillySpecStepProgress
  currentStage={change.current_stage}
  steps={(change.stages as Record<string, any>)?.steps as StepInfo[] | undefined}
  hasActiveRun={agentStatus?.has_active_run ?? false}
  configEnabled={agentStatus?.config_enabled ?? false}
  lastDispatchStatus={agentStatus?.last_dispatch?.status as "running" | "completed" | "failed" | null}
  lastDispatchFinishedAt={agentStatus?.last_dispatch?.finished_at}
  lastDispatchSummary={agentStatus?.last_dispatch?.output_summary}
/>
```

### 4. 现有 Agent Status Panel 处理

**方案：合并而非并列**

将现有的 Agent Dispatch Status Panel 与新 SillySpec Step Progress 合并为一个面板。原因：
- 两者展示同一事物的不同维度（Agent 状态 = 底层执行状态，Step 进度 = 业务层进度）
- 并列展示信息冗余且占用过多纵向空间

合并策略：
- **有 steps 数据时**：使用 `SillySpecStepProgress` 组件，内部包含 AgentRun 状态信息
- **无 steps 数据时**：回退到现有 Agent Status Panel（向后兼容 task-09 未完成的场景）
- **无 agent 配置时**（`config_enabled=false`）：显示"当前阶段未配置 Agent"（同现有逻辑）

### 5. "下一步"操作按钮

在组件底部保留现有的手动触发按钮逻辑（`handleDispatch`），但增加状态关联：
- 当有 pending 步骤且无活跃 run 时，按钮文案改为"执行下一步"
- 当所有步骤已完成时，隐藏按钮（stage 已完成，等待流转）
- 当无 steps 数据时，保持原有"触发 Agent 执行"文案

## 边界处理（7 条）

1. **agent_dispatch 为 null 时隐藏 agent 状态区域**：当 `agentStatus` 为 `null`（API 调用失败）时，不渲染 Agent 状态面板，仅展示基于 `change.stages` 的步骤进度（如果有的话）。组件中 `if (!configEnabled && !steps?.length) return null` 控制整体可见性。

2. **AgentRun 状态为 running 时禁用操作按钮**：当 `hasActiveRun=true` 时，"执行下一步"按钮显示为 disabled，文案改为"Agent 运行中…"，防止重复 dispatch。

3. **steps 列表为空或 undefined 时显示占位文案**：当 `change.stages?.steps` 不存在或为空数组时，不显示步骤条，回退到现有的 Agent 运行状态面板（向后兼容）。显示文案："等待步骤数据同步"。

4. **stage 未配置时不显示进度区域**：当 `configEnabled=false` 且无 steps 数据时，显示现有"当前阶段未配置 Agent"的占位文案，不显示步骤条。

5. **响应式布局**：步骤条在窄屏（<640px）时改为竖向列表布局，宽屏保持横向步骤条。使用 Tailwind `sm:` 断点切换。

6. **change.stages 类型不安全**：`change.stages` 是 `Record<string, any>`，访问 `.steps` 需要做类型守卫（`Array.isArray(steps)` 检查），避免运行时错误。如果 steps 结构不符合预期（如 `steps` 是 string），视为无数据。

7. **transition 返回后自动刷新 agent status**：现有逻辑在 `handleTransition` 中已实现（line 272-275）。step 进度信息来自 `change.stages`，需在 transition 成功后同时更新 change 数据（已通过 `setChange` 完成）。如果后端 sync 尚未将 steps 写入 stages，前端不会崩溃——只是看不到步骤条。

## 非目标

- **不修改后端 API**：不新增端点、不修改 schema、不修改 DispatchResponse 结构
- **不新增 API 端点**：使用现有 `getAgentStatus()` 和 `getChange()` 获取所有数据
- **不修改 SillySpec 核心逻辑**：仅展示后端已写入的数据
- **不实现自动刷新/Polling**：step 进度依赖用户手动刷新或操作触发。自动轮询是独立需求，不在本任务范围
- **不修改 workflow.ts 中的 TransitionResponse 类型**：task-15 已定义完整类型，本任务直接使用

## 参考

- design.md Phase 6 "变更详情页展示"（line 367-372）
- task-14 router 返回 TransitionResponse（`backend/app/modules/change/router.py` line 264-288）
- task-15 前端类型定义（`frontend/src/lib/workflow.ts` line 13-31 的 `AgentDispatchResult` + `TransitionResponse`）
- 现有 Agent Status Panel（`page.tsx` line 570-648）
- 现有 WORKFLOW_STAGE_LABELS 映射（`page.tsx` line 48-53）
- 现有 WORKFLOW_STAGE_COLORS 映射（`page.tsx` line 55-60）
- 现有 transition 返回处理（`page.tsx` line 243-286 `handleTransition`）
- 后端 DispatchResponse schema（`backend/app/modules/change/schema.py` line 177-185）
- 后端 stages JSON 结构（`backend/app/modules/change/model.py` line 163-166）

## TDD 步骤

TypeScript 编译 + 手动 UI 验证（本任务为纯前端 UI 任务，无自动化测试框架覆盖组件渲染）。

1. **创建组件文件**：新建 `frontend/src/components/sillyspec-step-progress.tsx`，定义接口和基础骨架
2. **TypeScript 编译检查**：运行 `npx tsc --noEmit`，确认类型正确
3. **集成到页面**：在 `page.tsx` 中导入并使用组件，替换部分 Agent Status Panel
4. **TypeScript 编译检查**：确认页面集成后编译通过
5. **手动验证**：启动 dev server，打开变更详情页，验证以下场景：
   - 有 steps 数据时显示步骤条
   - 无 steps 数据时回退到现有面板
   - Agent 运行中时按钮禁用
   - 窄屏时步骤条竖向排列

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | TypeScript 编译 | `npx tsc --noEmit` 在 `frontend/` 目录无错误 |
| AC-02 | 详情页展示 stage 进度 | 当 `change.stages.steps` 有数据时，显示当前 stage 名称 + 步骤进度（如 "3/7 步骤完成"） |
| AC-03 | 步骤状态可视化 | completed 步骤显示绿色 ✓，running 显示蓝色脉冲，failed 显示红色 ✗，pending 显示灰色序号 |
| AC-04 | AgentRun 状态展示 | Agent 运行中显示"Agent 运行中…"，已完成显示"上次执行成功 · 时间"，失败显示"上次执行失败 · 时间" |
| AC-05 | 操作按钮可用且有状态 | 有 pending 步骤 + 无活跃 run 时，按钮显示"执行下一步"且可点击；Agent 运行中时按钮禁用；所有步骤完成后隐藏按钮 |
| AC-06 | 无 steps 数据时向后兼容 | 当 `change.stages?.steps` 不存在时，回退到现有 Agent Status Panel，不显示步骤条，不报错 |
| AC-07 | 无 agent 配置时显示占位 | 当 `config_enabled=false` 时，显示"当前阶段未配置 Agent"，不显示步骤条和操作按钮 |
| AC-08 | 响应式布局 | 窄屏（<640px）步骤条变为竖向列表，宽屏保持横向 |
