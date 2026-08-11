---
author: qinyi
created_at: 2026-08-11 10:52:00
scale: large
risk_level: unit-sufficient
---

# 设计文档（Design）— 变更中心详情页布局重做（左主右辅）

> change: 2026-08-11-change-detail-layout-rework
> 原型：`.sillyspec/changes/2026-08-11-change-detail-layout-rework/prototype-change-detail-layout.html`
>
> risk_level 说明：本变更是纯前端展示层重构（page.tsx 编排 + 8 个展示组件 + 测试），
> 不触碰 daemon / backend / session lease / agent-run 状态机 / 跨进程链路。
> design/plan 文本命中 daemon/backend/session/lease/agent-run/state-transition 等词
> 是因为详情页「展示」这些概念（AgentRunPanel 读 SSE 日志、ChangeSessionSection 展示会话、
> gate 面板调 stage-review API），而非修改其运行时逻辑。单元测试（vitest 1386）+ tsc 严格类型
> + eslint 已充分覆盖，无需真实 daemon↔backend 集成证据。

## 1. 背景

变更中心详情页（`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`，约 1100 行）是多次需求叠加的产物，存在严重的信息架构问题，用户反馈「会话和智能体日志重叠」「审查记录和任务进度乱七八糟」「看不懂审查记录是干嘛的」。

经代码与后端数据流核实，问题可归为四类（确诊依据）：

1. **僵尸区块**：「审查记录」区块读 `GET /api/workspaces/{wid}/changes/{cid}/reviews`（workflow router → `WorkflowService.list_reviews` → `ChangeReview` 表）。全后端检索确认该表**已无任何写入路径**（仅 `model.py` 定义、`spec_guardian.py`/`workflow/service.py` 两处读），真实审核历史改写在 `change.stages.review_history`（JSON 数组，`change/service.py` 的 `proposal_review`/`plan_review`/`human_test`/`archive_confirm` 四个 gate 端点写入）。因此「审查记录」对任何新变更永远显示「暂无审查记录」。「审批状态」（`approval_status`）同为旧链路退役字段，新变更恒为 `not_required` 不显示（page.tsx 注释自述「退役只读」）。
2. **概念重叠**：「智能体执行日志」（`AgentRunPanel`，流程自动推进的 run 日志）与「会话」（`ChangeSessionSection`，用户主动发起的交互问答）视觉均为聊天/日志框且紧邻，用户无法区分。
3. **进度维度爆炸**：顶部阶段步骤条（5 大阶段）+ `SillySpecStepProgress`（当前阶段子步骤）+ `TeamProgress`（团队 worker）+ 次线「任务进度」（plan task）四处「进度」维度不同却并排出现。
4. **入口分散**：阶段推进横幅 / 运行验证门禁 / `SillySpecStepProgress` 内「触发智能体执行/执行下一步」/ gate 面板按钮 / Agent Provider 下拉等智能体触发入口散在 5+ 处；且 `page.tsx` 中 `handleExecute`（:302）与 `handleTransition`（:233）均定义了但 JSX 未调用，属死代码（Design Grill 复核确认两条均未被 onClick 引用）。

## 2. 设计目标

- **主线/次线分离**：页面打开时默认只呈现「流程走到哪、现在该干嘛」，把次要信息（文件/会话/历史/任务）收到侧栏。
- **救活审核历史**：用户能看到真实的每次审核留痕（时间/结果/意见），替换永远空的「审查记录」。
- **消除概念重叠**：「智能体执行日志」（自动流程）与「会话调试」（主动发起）在布局与定位上彻底分离。
- **收口进度与入口**：进度按「阶段→子步骤→任务」分层；智能体操作入口统一收敛到「当前阶段操作区」。
- **提升可维护性**：page.tsx 瘦身为编排层，各区块拆成独立组件并配测试。

## 3. 非目标

- **不换组件库**：本页沿用现有 `@/components/ui`（shadcn 风格）。切换到 antd（对齐 `/ppm/projects` 的 FRONTEND_PAGE_STYLE 体系）是另一个独立大工程，不在本变更范围，另起 change。
- **不改后端 / 不新增 API**：审核历史直接从前端已有的 `ChangeRead.stages.review_history` 读取渲染，不新增端点、不改 DTO、不动 `change_reviews` 表。
- **不删 `ChangeReview` 表 / 旧 `listReviews` 端点**：后端残留（含 `spec_guardian` G7 规则读取）是技术债，本变更仅让前端不再引用，后端清理另立。
- **不改智能体执行/派发/审核的业务逻辑**：仅重组展示与入口位置，不触碰 `transitionChange`/`advanceChangeStage`/`submitStageReview`/`triggerDispatch`/`runVerifyGate` 的语义。
- **不改 `ChangeFileTree`/`ChangeSessionSection`/`AgentRunPanel`/`SillySpecStepProgress`/`TeamProgress` 内部实现**：这些组件作为黑盒被复用（包一层），不动其内部。

## 4. 拆分判断

本变更为单一页面的展示层重构，虽涉及多组件但同属一个前端模块、一个主题（信息架构），不走批量模式；作为一个 change 整体走完整流程，避免把一个连贯的布局重做拆散导致中间态不可验收。

## 5. 总体方案

### 5.1 布局骨架

```
PageContainer
├── PageHeader（标题 + 阶段徽标 + Key/类型/位置/影响）
├── ChangeStageHeader（阶段步骤条：需求→规划→执行→验证→归档）
└── grid lg:grid-cols-[1fr_320px]（移动端 <lg 单列）
    ├── 主线（左 1fr）
    │   ├── ChangeStageActions  —— 当前阶段操作区（收口所有入口）
    │   └── ChangeAgentRunLog   —— 智能体执行日志（含子步骤进度/团队进度）
    └── 次线（右 320px，默认折叠省空间）
        ├── ChangeFilesCard          —— 变更文件（包 ChangeFileTree）
        ├── ChangeSessionsCard       —— 会话调试（包 ChangeSessionSection）
        ├── ChangeReviewHistoryCard  —— 审核历史（读 stages.review_history，新）
        └── ChangeTaskBoardCard      —— 任务看板摘要（包 taskBoard）
```

「审批状态」区块删除。

### 5.2 四个问题 → 落点映射

| 问题 | 处理 |
|---|---|
| ① 僵尸区块 | 「审批状态」删除；「审查记录」→ 新 `ChangeReviewHistoryCard`，前端从 `change.stages.review_history` 读取渲染（零后端改动） |
| ② 会话/日志重叠 | 主线只留「智能体执行日志」（自动流程）；「会话调试」移入次线侧栏（主动发起），视觉/定位分离 |
| ③ 进度爆炸 | 阶段条（宏观，顶部）→ 子步骤（并入日志头部）→ 任务完成度（次线看板卡）→ 团队进度（开团队时日志区按需展开），四处收口分层 |
| ④ 入口分散 | 推进/审核/触发/门禁/模型/团队全部收口进 `ChangeStageActions`；删除死代码 `handleExecute` |

### 5.3 移动端策略

`lg`（1024px）以下退化为单列：主线在上，次线卡片以可折叠手风琴（默认收起）堆叠在主线下方，节省纵向空间。

### 5.4 数据流

- 审核历史：`producer = backend change/service.py 四个 gate 端点（写 change.stages.review_history）→ GET /changes/{cid} 返回 ChangeRead.stages（JSON）→ consumer = ChangeReviewHistoryCard` 直接读 `change.stages.review_history`。**无新增中间序列化跳点**，字段已在现有响应体内，无需 `gen:types`。
- **review_history 元素存在两种形状**（Design Grill major 复核）：① gate 决策形状 `{decision, comment, user_id, submitted_at, from_stage, target_action}`（`proposal_review`/`plan_review`/`human_test`/`archive_confirm` 写入，service.py:1329/1388/1459/1720）；② **rerun 异构形状 `{action, stage, comment, at}`**（`rerun_stage` 写入，service.py:1623-1629，无 `decision`/`submitted_at`），且会被 proposal_revise / plan_replan / test_bug 等返工决策触达而混入同一数组。前端必须同时兼容两种形状（见 §7 `ReviewHistoryItem` 归一化 + §9 兜底）。
- 渲染规则：按时间（`submitted_at` 或 `at`）倒序；gate 形状按 `decision` 映射中文标签+颜色（approve/pass/confirm→绿，revise/replan/back_to_*→琥珀，unclear/bug/doc_mismatch→红）；rerun 形状显示为「↻ 重跑 {stage}」中性标签。
- 其余区块数据源不变（`getChange`/`getAgentStatus`/`getTaskBoard`/`listDaemonRuntimes` 等）。

## 6. 文件变更清单

> 本变更**不新增/修改任何对外字段、接口、DTO、响应体、事件 payload、配置键**，全部为前端展示层组件组织，故除 page.tsx 外各行说明列无需数据流标注；page.tsx 行的审核历史数据流已在 §5.4 交代。

新组件统一放 `frontend/src/components/changes/detail/`：

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 瘦身为编排层：仅保留数据加载、共享状态（provider/model/teamMode/stageWorkers 等）、布局网格与组件组合；删除「审批状态」区块、审查记录旧实现、死代码 `handleExecute`，把 gate/推进/verify/dispatch 等 handler 下沉到 `ChangeStageActions` |
| 新增 | `frontend/src/components/changes/detail/change-stage-header.tsx` | 阶段步骤条（含 lastActive 展示），抽自 page.tsx |
| 新增 | `frontend/src/components/changes/detail/change-stage-actions.tsx` | 当前阶段操作区：收口 gate 面板 / 推进横幅 / 运行验证门禁 / 触发智能体 / Agent Provider+Model / 团队开关+StageTeamConfig |
| 新增 | `frontend/src/components/changes/detail/change-agent-run-log.tsx` | 智能体执行日志：包 `AgentRunPanel` + gate 徽标 + 子步骤进度(`SillySpecStepProgress`) + 团队进度(`TeamProgress` 按需) |
| 新增 | `frontend/src/components/changes/detail/change-files-card.tsx` | 变更文件卡（包 `ChangeFileTree`，可折叠） |
| 新增 | `frontend/src/components/changes/detail/change-sessions-card.tsx` | 会话调试卡（包 `ChangeSessionSection`，可折叠） |
| 新增 | `frontend/src/components/changes/detail/change-review-history-card.tsx` | 审核历史卡：读 `change.stages.review_history` 渲染时间/结果/意见（新逻辑） |
| 新增 | `frontend/src/components/changes/detail/change-task-board-card.tsx` | 任务看板摘要卡（进度条+计数+链接，无任务时隐藏） |
| 新增 | `frontend/src/components/changes/detail/__tests__/change-review-history-card.test.tsx` | review_history 各 decision 映射/排序/空态测试 |
| 新增 | `frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx` | gate/推进/verify/dispatch/团队 各入口渲染与回调测试 |
| 新增 | `frontend/src/components/changes/detail/__tests__/change-stage-header.test.tsx` | 阶段步骤条渲染/当前阶段高亮测试 |
| 新增 | `frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx` | 日志面板+子步骤+gate 徽标组合渲染测试 |
| 新增 | `frontend/src/components/changes/detail/__tests__/change-task-board-card.test.tsx` | 进度条/计数/无任务隐藏测试 |
| 新增 | `frontend/src/components/changes/detail/__tests__/change-files-card.test.tsx` | 变更文件折叠卡渲染测试（轻量） |
| 新增 | `frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx` | 会话调试折叠卡渲染测试（轻量） |

复用不重建（黑盒引用，不改内部）：`AgentRunPanel`、`ChangeFileTree`、`ChangeSessionSection`、`SillySpecStepProgress`、`TeamProgress`、`StageTeamConfig`、`AgentProviderSelect`、`AgentModelInput`、`PageContainer`、`PageHeader`、`Badge`、`Button`。

## 7. 接口定义

前端组件 Props（TypeScript interface）：

```ts
// change-stage-header.tsx
export interface ChangeStageHeaderProps {
  currentStage: string | null;
  stages: Record<string, unknown> | null;   // change.stages
  updatedAt: string | null;                 // change.updated_at 兜底
}

// change-review-history-card.tsx
// review_history 两种形状（Design Grill 复核）：
//   ① gate 形状 {decision, comment, user_id, submitted_at, from_stage, target_action}
//   ② rerun 形状 {action, stage, comment, at}（rerun_stage 写入，无 decision/submitted_at）
// page.tsx 负责把原始元素归一化为下方 ReviewHistoryItem，组件只消费归一化结果。
export interface ReviewHistoryItem {
  kind: "gate" | "rerun";                    // 区分两种源形状
  label: string;                             // 已映射的中文标签（approve→"通过" / rerun→"重跑 执行" 等）
  tone: "success" | "warning" | "danger" | "neutral"; // 颜色语义
  comment: string | null;
  at: string | null;                         // 统一时间（gate=submitted_at，rerun=at；缺失→null 置底）
  fromStage: string | null;
}
export interface ChangeReviewHistoryCardProps {
  reviewHistory: ReviewHistoryItem[];        // page.tsx 从 change.stages.review_history 归一化后传入（已倒序）
}

// change-stage-actions.tsx（核心收口组件，handler 由 page.tsx 注入）
export interface ChangeStageActionsProps {
  change: ChangeRead;
  agentStatus: DispatchResponse | null;
  nextStage: string | null;
  verifyGate: VerifyGateResponse | null;
  gateComment: string;
  onGateCommentChange: (v: string) => void;
  // 入口回调（page.tsx 现有 handler 逻辑下沉后透传）
  onGateAction: (action: string) => void;
  onAdvance: () => void;
  onRunVerifyGate: () => void;
  onDispatch: () => void;
  transitioning: boolean;
  dispatching: boolean;
  advancing: boolean;
  // provider/model/team（team toggle 渲染条件 + role="switch" + aria-label="用团队执行"
  // 的 DOM 契约必须从现 page.tsx 原样保留，page-team-toggle 测试硬断言依赖，迁移时不得破坏）
  stageProvider: string | null;
  onStageProviderChange: (v: string | null) => void;
  stageModel: string | null;
  onStageModelChange: (v: string | null) => void;
  teamMode: boolean;
  onTeamModeChange: (v: boolean) => void;
  stageWorkers: StageWorkerPreset[];
  onStageWorkersChange: (w: StageWorkerPreset[]) => void;
}

// change-agent-run-log.tsx
export interface ChangeAgentRunLogProps {
  workspaceId: string;
  panelRunId: string | null;
  panelIsActive: boolean;
  agentStatus: DispatchResponse | null;
  gateStatus: GateStatusEvent | null;
  currentStage: string | null;
  steps: StepInfo[] | undefined;             // 现 SillySpecStepProgress 的 steps 派生逻辑上移此处
  teamMode: boolean;
  stageTeamMissionId: string | null;
  onDone: () => void;
  onGateStatusChanged: (g: GateStatusEvent | null) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onDispatch: () => void;
  dispatching: boolean;
}

// 次线卡片统一受控折叠形态（标题 + 可展开 body）
export interface CollapsibleCardProps { title: string; defaultOpen?: boolean; children: React.ReactNode; }
```

## 7.5 生命周期契约表

不涉及生命周期契约。本变更为纯前端展示层重组：不新建/修改 session、lease、agent_run、daemon 生命周期，不改变任何 state transition / claim / heartbeat / complete / end 语义；审核历史仅**读取**既有 `stages.review_history`（由后端 gate 端点写入，写入逻辑不在本变更改动范围）。故生命周期契约表：无。

## 8. 数据模型

无表结构/字段变更。审核历史复用既有 `change.stages.review_history` JSON 数组，不新增库表与列。

## 9. 兼容策略

- **纯前端重组**，不改任何 API/表结构/业务语义，未启用新功能时行为与现状一致（同一变更的可用操作集合不变，只是位置/归组变化）。
- **回退路径**：全部改动集中在前端单页与新组件目录，回退 = revert 本 change 的前端提交即可，无数据迁移、无后端依赖。
- **旧数据兼容**：`stages.review_history` 缺省/为空时 `ChangeReviewHistoryCard` 显示「暂无审核历史」；元素字段缺失或形状为 rerun 异构（`{action,stage,comment,at}`）时按 §7 归一化宽容兜底（时间缺失置底、未知 decision 显示原文）。旧变更（含历史 `ChangeReview` 表数据）前端不再展示该旧表——接受「历史旧链路审核记录不再出现在详情页」这一已知降级（见 R-03）。
- **不换组件库的适用依据**：FRONTEND_PAGE_STYLE.md 开篇自限定「以 /ppm/projects 为基准，针对**列表/管理页**」。本页是详情编排页、非 CRUD 列表页，故沿用本页现有 `@/components/ui` 不构成对该规范的违反；antd 全量切换是独立工程另立 change。
- **现有测试**：page.tsx 既有测试（`page-team-toggle.test.tsx` 为整页 render + 硬断言 team toggle，需随迁移重写指向 `ChangeStageActions`；`change-session-section.test.tsx` 测组件本身不受影响）随组件拆分迁移/更新，保证回归通过。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | page.tsx 大改导致现有测试（team-toggle / session-section 等）回归失败 | P1 | 逐组件迁移并在每组件落测试；改动后跑 frontend 相关 vitest 全量回归 |
| R-02 | `ChangeStageActions` 收口 5+ 入口，状态/回调接线复杂易漏 | P1 | 接口定义明确注入所有 handler；execute 期对照现 page.tsx 逐入口核对清单 |
| R-03 | 旧 `change_reviews` 表历史数据前端不再展示（旧链路审核留痕丢失可见性） | P2 | 设计层明确接受该降级；审核历史改读 review_history；如需旧表历史另立数据迁移 change |
| R-04 | `SillySpecStepProgress` 内嵌「触发智能体/执行下一步」按钮与 `ChangeStageActions` 入口职责重叠造成双入口；其按钮仅以 `onDispatch` 是否传入为开关、无独立 hide prop | P2 | 不改组件内部前提下，`ChangeAgentRunLog` 组合 `SillySpecStepProgress` 时**传 `onDispatch={undefined}`** 使其按钮不渲染，操作入口统一收敛到 `ChangeStageActions`（Design Grill 确认此为不改内部唯一可行接线） |
| R-05 | 次线默认折叠导致「会话调试」常用入口被藏，用户找不到 | P2 | 会话/文件等次线卡默认值：见 §7 `CollapsibleCardProps.defaultOpen`——execute 前列默认值表（初拟：变更文件 `defaultOpen=true`，会话/审核历史/任务看板 `defaultOpen=false`），验收时确认 |
| R-06 | team toggle 的 `role="switch"`/`aria-label="用团队执行"` DOM 契约迁入 `ChangeStageActions` 时被破坏，导致 `page-team-toggle.test` 硬断言失败 | P1 | Props 注释已点名保留契约；迁移时先重写该测试指向新组件再搬 DOM，保证断言对象一致 |

## 11. 决策追踪

- **D-001@v1**：布局形态=左主右辅右栏侧栏（非顶部 Tab）。覆盖 FR-01。来源：用户三选一确认。
- **D-002@v1**：会话定位=进次线侧栏，主线只留执行日志。覆盖 FR-02。来源：用户确认。
- **D-003@v1**：旧区块处理=「审批状态」删除、「审查记录」改读真实 `stages.review_history`（零后端改动）。覆盖 FR-03/FR-04。来源：用户确认。
- **D-004@v1**：实现深度=全量重写（7 组件 + 测试，page.tsx 瘦身）。覆盖 FR-05/FR-06。来源：用户确认。
- **D-005@v1**：不换组件库，沿用本页 `@/components/ui`。覆盖非目标。来源：FRONTEND_PAGE_STYLE 自限定「列表/管理页」、基准 `/ppm/projects` CRUD，本页为详情编排页故免责。

### Design Grill 复核（2026-08-11，tier=independent 独立子代理）
- **verdict：spec=pass / quality=pass，无阻断项**；两条 headline 诊断（change_reviews 零写入、review_history 真实写入）与 handleExecute/handleTransition 死代码均经独立源码核实成立。
- 3 个 major gap 已按推荐修入本文档（不升版 D，属设计细化非决策变更）：
  1. review_history **rerun 异构形状**补建模（§5.4/§7/§9）；
  2. R-04 双入口接线取舍明确为「传 `onDispatch=undefined`」（§10）；
  3. **handleTransition 死代码**补识别（§1 问题④）+ team toggle `aria-label` 契约纳入 Props（§7）并新增 R-06。
- 残留 minor：次线卡 defaultOpen 默认值表在 execute 前列定（R-05）；page-team-toggle 测试迁移成本（§9）。

无未解决 D；剩余风险见 §10。

## 12. 自审

- **章节齐全性**：背景/目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约(豁免)/数据模型/兼容策略/风险登记/决策追踪/自审 均已覆盖。✅
- **生命周期契约表**：§7.5 已明确豁免（纯前端重组，无 session/lease/agent_run/daemon/state transition 生命周期改动）。✅
- **文件变更清单**：含全部新增/修改文件，无对外字段变动故无漏标数据流；审核历史数据流在 §5.4 交代。✅
- **零后端改动声明一致性**：接口定义均为前端 Props，`ChangeRead.stages` 已含 review_history，无需 gen:types，与非目标一致。✅
- **依据可追溯**：四类问题均有后端/前端代码证据支撑（change_reviews 零写入、review_history 真实写入、handleExecute 未调用等）。✅
- **范围控制**：非目标明确排除组件库切换、后端清理、业务逻辑改动，防 scope creep。✅
- ⚠️ 自审存疑：R-01 回归范围依赖现有测试可迁移性，execute 期若发现 page.tsx 测试强耦合 JSX 结构，需评估是否补充适配（不影响本设计成立）。
