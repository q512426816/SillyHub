---
author: WhaleFall
created_at: 2026-08-19 18:21:49
scale: large
status: draft
---

# 设计文档（Design）— 智能体会话流结构化重构（session-stream-ux）

## 1. 背景

/sessions 与 /runtimes 弹窗的智能体会话流存在三个用户体验问题（用户 2026-08-19 反馈）：

1. **看不到详细实时进度**：运行中轮次在「对话」视图只有一个呼吸点动画，不知道 agent 正在执行什么工具、跑了多久、有没有子代理在工作。
2. **回复是合并的一整条**：agent 一轮内实际是「文本→工具→文本→工具→文本」交替产出，当前实现把所有 assistant 文本 concat 成单条 markdown（`SessionTurnView.output`），中间穿插的工具调用位置丢失（D-001 确认「阶段」= 轮内执行分段）。
3. **看不到子代理进度**：子代理（Task tool spawn）的思考/工具/文本与主 agent 完全混流——尽管归属数据全链路已有。

**代码查证结论（2026-08-19）**：数据链路完整，无需后端改动——
- daemon：`session-manager.ts` 开启 `forwardSubagentText`，注入 `depth`，SDK 顶层带 `parent_tool_use_id`/`subagent_type`；
- backend：`run_sync/service.py:172-174` 落库三归属列 + session channel SSE 透传（含 `tool_kind`/`segment_id`/`stale`）；
- 前端断点：`lib/daemon.ts` 的 `SessionStreamEnvelope` 未声明归属字段（数据在流里，类型没接）；`applyLogToTurn`（两处副本：sessions page + interactive-session-panel）与 `logsToTurns` 丢弃归属；`SessionTurnView` 为 output 单串 + processItems 平铺模型。

**参考设计**：deepseek-harness（`E:\Deepseek\deepseek-harness`）调研结论——三层进度（轮级状态条 / 工具单行卡+扫动动画 / 思考折叠行流式跟随）、单一装配引擎（事件→结构化模型，多视图消费）、每节点独立订阅（渲染经济性）、会话头部子代理目录（运行中脉冲+计数+时长，点击定位）。本设计取其思路适配 SillyHub 现有架构（方案 C，D-002）。

## 2. 设计目标

- **FR-01 轮内结构化分段**：一轮回复按真实到达顺序渲染为有序段序列（文本段/思考段/工具段/stderr 段），文本不再粘连为一整条。
- **FR-02 实时进度可见**：运行中轮次显示轮级状态条（计时 + 工具计数 + 子代理计数 + 当前活动摘要），跨工具/子代理阶段不闪烁（turn 级信号，对齐 deepseek TurnStatus）；「对话」视图默认也可见状态条。
- **FR-03 子代理进度嵌套展示**：子代理的思考/工具/文本按 `parent_tool_use_id` 嵌套归属到对应 Task 工具段内，形成可折叠子代理块（头部状态点/名称/类型/时长 + 内部完整过程）；depth>1 继续嵌套。
- **FR-04 子代理目录**：会话头部子代理目录按钮（运行中脉冲点 + 计数）→ 下拉列表（状态/名称/类型/时长，如实显示，token 无数据不编造），点击展开并滚动定位到对应子代理块。
- **FR-05 共享装配器**：实时 SSE 与历史恢复两条路径、sessions 页与 runtimes 弹窗两处消费方统一走单一纯函数装配模块，消除现有两份 `applyLogToTurn` 副本。
- **FR-06 渲染经济性**：流式更新只重渲染当前段（段级 memo + 稳定 key），不触发其它段/轮重渲染。

## 3. 非目标（Non-Goals）

- 不改后端任何代码/接口/表结构（数据链路已查证完整）。
- 不做事件注册表/视图注册表/槽系统插件化架构（方案 B，被 D-002 否决）。
- 不迁移 `agent-log-viewer.tsx`（/agent 日志查看器已有行级子代理徽标，非会话流场景）。
- 不做子代理 token 级计量（数据不存在，目录行不显示 token，不编造）。
- 不改 Codex provider 行为（无归属字段 → 平铺为主 agent，与现状一致）。
- 不做跨轮 spec 流程阶段（brainstorm/plan/execute）标注（D-001 明确「阶段」为轮内分段）。

## 4. 拆分判断

单一前端领域（frontend_components + frontend_lib），三个 Phase 有依赖链（装配器 → 渲染 → 状态条/目录），不需要拆分为多个 change；无批量模式特征。不涉及后端/daemon。

## 5. 总体方案

### Phase 1 — 共享装配器（数据层）

新建 `session-log-assembler.ts` 纯函数模块。职责：

1. **输入归一**：SSE envelope（`SessionStreamEnvelope`）与历史日志（`AgentRunLogEntry`）归一为统一 `AssemblerLogInput`。
2. **分类**：复用现有 `classifySessionLog`（thinking/tool_use/tool_result/reply/stderr/override 分类规则不变，平移进装配器内部调用）。
3. **归属路由**：`parent_tool_use_id` 非空 → 路由到对应工具段（按 toolUseId 匹配）的 `children`；匹配不到 → 创建「子代理片段」兜底段（显示 subagentType 标注），后续匹配段到达时合并。
4. **分段装配**：`reply` 文本 → 新文本段（与上一段间有非文本段则开新段，否则续接当前段）；`thinking` → 思考段（连续合并）；`tool_use` → 工具段（段 id 与子代理路由 key 从 tool_call JSON 解析 tool_use_id）；`tool_result` → **归属桶内位置配对**——tool_result 行 SSE/DB 均不携带自身 tool_use_id（Grill X-02 查证），沿用现有「最后一个未配对 tool 项」位置配对规则，但配对范围限定同一归属桶（parent_tool_use_id 相同），以支撑主/子代理工具交错场景；`stderr` → stderr 段。
5. **override 撤回**：`segmentId` 已带 parent 前缀（`main:<msg_id>` / `<tool_use_id>:<seq>`，daemon 侧既有协议），按前缀定位目标段撤回（文本截断 / 思考项移除，规则平移自现有 `partialSegmentsRef` 逻辑）。
6. **去重**：`log_id` 去重贯穿（`seenLogIds` 平移）。
7. **输出**：`TurnSegment[]` 结构化模型 + 兼容字段（`output` = 文本段按序拼接，`processItems` = 平铺投影——过渡期保留，见 §9）。

### Phase 2 — 渲染组件（TurnTimeline v2）

`turn-timeline.tsx` 渲染层重构，消费 `segments`：

- **段组件**：`TextSegment`（气泡，流式光标）、`ThinkingRow`（折叠摘要流式跟随，参考 deepseek ReasoningRow）、`ToolRow`（单行摘要：图标+工具名+主参数+状态徽章+耗时；运行中 CSS 扫动动画；点击展开结果，参考 deepseek ToolRow）、`SubagentBlock`（嵌套容器：头部状态点/名称/类型/时长 + 内部段序列渲染，递归复用段组件）、`StderrRow`。
- **视图模式**：`conversation` = 文本段 + 轮级状态条（FR-02，对话视图也显示）+ 轻量 AskUser 记录；`all`（改名为「进度」）= 完整段时间线。两态切换保留。
- **渲染经济性**：每段组件 `React.memo` + 稳定段 id 作 key；流式 delta 只更新当前段组件的 props（段对象引用按段隔离，未变段保持引用稳定——装配器保证）。
- **现有特性保持**：AskUser 穿插（按 run_id + 时间戳合并排序）、whoLine、sender、errorDetail、孤儿 turn 紧凑标记、`TurnStatusBadge`。

### Phase 3 — 轮级状态条 + 子代理目录

- **TurnStatusBar**：运行中轮次头部显示（spinner + 计时 + 工具计数 + 子代理计数 + 当前活动）。数据从 segments 派生：工具数 = tool 段总数（含 children 递归）；子代理数 = 有子代理归属的 tool 段数；当前活动 = 最新的 running 态段（工具名+摘要 / 子代理名+最新动作），无 running 工具段时回退「正在输出文本/思考」（由最新 streaming 段派生）；**计时锚点 = turn 创建时刻**（Grill X-01 查证：backend 无 turn_started 事件，前端该 case 为死分支——live 轮 = 发送占位的本地时钟；attach/刷新恢复 = run 快照 `started_at`（listSessionRuns 已有该字段），缺则首条 log timestamp）；≥15s 才显示具体秒数前保持简洁。运行中子代理时长 = 服务端起始时间戳 + 客户端每秒 tick 补足（对齐 deepseek subagentTiming 模式）。**text 段 `streaming` 置位 = 收到带 segment_id 的 partial 追加；清除 = 该 segmentId 收到 override 或 turn 终态。**
- **SubagentCatalog**：会话头部按钮（运行中脉冲点 + 运行中数，无运行显示总数）→ 下拉列表（每行：状态点/名称=Task description/subagent_type/时长），点击 → 切进度视图 + 展开对应子代理块 + 滚动定位（`scrollIntoView` + 稳定段 id 锚点）。**挂载范围（Grill X-09）：TurnStatusBar 内置于 TurnTimeline v2（sessions 页与 runtimes 弹窗两消费方自动获得）；SubagentCatalog 仅 /sessions 页头部（弹窗空间受限不挂）。**

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/components/daemon/session-log-assembler.ts | 共享装配器纯函数模块（FR-05）：分类/归属路由/分段装配/override 撤回/log_id 去重；导出 `assembleLogToSegments`（SSE 增量）与 `logsToSegments`（历史批量） |
| 新增 | frontend/src/components/daemon/turn-segment-views.tsx | 段渲染组件（FR-01/FR-06）：TextSegment/ThinkingRow/ToolRow/SubagentBlock/StderrRow，段级 memo |
| 新增 | frontend/src/components/daemon/turn-status-bar.tsx | 轮级状态条（FR-02）：计时/计数/当前活动，segments 派生 |
| 新增 | frontend/src/components/sessions/subagent-catalog.tsx | 子代理目录（FR-04）：头部按钮 + 下拉 + 定位跳转 |
| 修改 | frontend/src/lib/daemon.ts | `SessionStreamEnvelope` 补声明 `parent_tool_use_id`/`subagent_type`/`depth`/`tool_kind`（可选可空）。数据流：producer=backend `run_sync/service.py:172-178`（session channel publish 已携带）→ 传输=SSE JSON（字段已在流中，本次仅补类型声明，无运行时序列化变化）→ consumer=session-log-assembler.ts 归一消费 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 渲染层 v2：`SessionTurnView` 增 `segments` 字段；`TurnDetailsList`/`ToolEventCard`/`SessionCollapsible` 替换为 turn-segment-views 段组件；viewMode 语义更新（all→进度）；**内置 TurnStatusBar**（两消费方自动获得，Grill X-09）；对外 props 兼容（segments 缺省回退旧渲染路径，见 §9） |
| 修改 | frontend/src/components/daemon/runtime-session-helpers.tsx | `logsToTurns` 内部改走装配器 `logsToSegments`（历史路径消费归属字段，`AgentRunLogEntry` 类型已有字段，无数据流变化） |
| 修改 | frontend/src/app/(dashboard)/sessions/page.tsx | `applyLogToTurn`（本文件内联副本）替换为装配器调用；挂 SubagentCatalog；partialSegmentsRef 逻辑移入装配器 |
| 修改 | frontend/src/components/daemon/interactive-session-panel.tsx | 同上替换（runtimes 弹窗消费方），装配器统一后此文件日志处理段收敛为装配器调用 + 少量胶水；状态条经 TurnTimeline 内置自动获得，不挂 SubagentCatalog |
| 修改 | frontend/src/components/daemon/session-log-sanitize.ts | `classifySessionLog` 等分类函数迁移为装配器内部依赖（导出保留，防外部引用断裂；本文件其余 sanitize 函数不动） |
| 新增 | frontend/src/components/daemon/__tests__/session-log-assembler.test.ts | 装配器单测：分段/归属嵌套/override 撤回（含跨段撤回，R-06）/去重/兜底合并/历史与实时一致性/归属桶位置配对 |
| 新增 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 段渲染单测：各段类型/折叠交互/扫动动画类名/视图两态/状态条派生 |
| 修改 | frontend/src/components/daemon/__tests__/*.test.tsx（受影响用例） | TurnTimeline 消费方测试同步更新（渲染断言适配段模型） |
| 修改 | frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | sessions 页测试适配（实测覆盖 SSE handler 注册 + attach 历史恢复，非 viewMode 断言——plan 审查 X 核正；按段模型适配受影响断言） |
| 修改 | frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx | 「全部」视图文案改「进度」的断言适配（16 处，Grill X-12） |

## 7. 接口定义

```ts
// ── session-log-assembler.ts ──────────────────────────────

/** 归一化日志输入（SSE envelope 与历史 log 统一形状）。 */
interface AssemblerLogInput {
  logId: string | null;
  channel: string | null;
  content: string | null;
  timestamp: string | null;
  /** partial 半截标识（daemon 协议，main:xxx / toolUseId:xxx 前缀）。 */
  segmentId?: string | null;
  /** override 撤回令箭行标记。 */
  stale?: boolean | null;
  /** 子代理归属三字段（主 agent / 旧数据 → null/undefined）。 */
  parentToolUseId?: string | null;
  subagentType?: string | null;
  depth?: number | null;
  toolKind?: string | null;
}

/** 结构化段模型（渲染与派生统计的唯一数据源）。 */
type TurnSegment =
  | { kind: "text"; id: string; text: string; streaming: boolean; startedAt: number | null }
  | { kind: "thinking"; id: string; text: string; streaming: boolean; ts: number | null }
  | {
      kind: "tool";
      id: string;                 // 解析自 tool_call JSON 的 tool_use_id（配对 key + 子代理路由 key）
      raw: string;                // [TOOL_USE] 原文（解析失败原样显示）
      result?: string;            // 归属桶内位置配对的 [TOOL_RESULT]
      status: "running" | "ok" | "deny";
      toolName: string | null;    // 解析自 raw；解析失败 null
      primary: string | null;     // 主参数摘要（命令/路径/描述）
      startedAt: number | null;
      endedAt: number | null;
      children: TurnSegment[];    // 子代理归属段（parent_tool_use_id === 本段 id）
      subagentType: string | null; // 有子代理归属时记录（目录展示）
    }
  | {
      /** 兜底段（Grill X-05）：子消息先于/无 tool_use 段到达时的临时容器；
       *  后续 tool 段到达且 id 匹配 → children 合并迁入该 tool 段后移除本段。 */
      kind: "subagent_stub";
      id: string;                 // parent_tool_use_id（此刻已知的唯一 key）
      subagentType: string | null;
      children: TurnSegment[];
    }
  | { kind: "stderr"; id: string; text: string; ts: number | null };

/** 装配产物（单 turn）：段序列 + 兼容投影 + 计时锚点（§5 Phase3）。 */
interface AssembledTurn {
  segments: TurnSegment[];
  /** 兼容投影（§9.4）：output = 文本段按序拼接；processItems = 平铺投影
   *  （tool.startedAt → ts；thinking/stderr.ts → ts，AskUser 穿插排序依赖）。 */
  output: string;
  processItems: SessionProcessItem[];
  /** 计时锚点：live = 本地发送占位时刻；attach = run.started_at；缺则首条 log timestamp。 */
  turnStartedAt: number | null;
  seenLogIds: Set<string>;
}

/** SSE 增量：单条 log 落到 turn（替代现有 applyLogToTurn）。 */
function applyLogToSegments(turn: AssembledTurn, input: AssemblerLogInput): AssembledTurn;

/** 历史批量：logs → 每轮段序列（run 分组 / prompt / realRunId 等 turn 级胶水
 *  仍由 logsToTurns 负责，本函数只产出 TurnSegment[]——Grill X-05 形状澄清）。 */
function logsToSegments(logs: AssemblerLogInput[]): TurnSegment[][];

// ── SessionTurnView 扩展（turn-timeline.tsx）───────────────
interface SessionTurnView {
  // ...现有字段全部保留（runId/turn/prompt/status/seenLogIds/tokens/
  //    errorDetail/realRunId/whoLine/sender/replyAt）
  segments?: TurnSegment[];       // 新增：结构化时间线（缺省走旧渲染回退）
  turnStartedAt?: number | null;  // 新增：状态条计时锚点（AssembledTurn 透传）
  output: string;                 // 保留：AssembledTurn 兼容投影，外围逻辑零改动
  processItems?: SessionProcessItem[]; // 保留：同上
}

// ── 派生统计（turn-status-bar.tsx / subagent-catalog.tsx 消费）──
interface TurnActivitySummary {
  toolCount: number;              // tool 段总数（含 children 递归）
  subagents: Array<{
    segmentId: string; name: string; subagentType: string | null;
    status: "running" | "done" | "deny";
    startedAt: number | null; endedAt: number | null;
    latestActivity: string | null; // 内部最新 running 段摘要
  }>;
  currentActivity: string | null; // 全 turn 最新 running 段摘要
}
function deriveTurnActivity(segments: TurnSegment[]): TurnActivitySummary;
```

## 7.5 生命周期契约表

本变更**不新增/不修改任何生命周期事件**（session/lease/agent_run 状态机、SSE 事件种类、daemon 协议均不变），只新增前端对既有 SSE 事件的消费方式。既有消费契约（装配器视角）如下：

| 事件 | 发起方 | 接收方（前端） | 必需字段 | 状态变化（前端 turn 模型） |
|---|---|---|---|---|
| turn_injected | backend session channel | SessionPanel（现状：前端 dispatch 落 default 分支不消费；本变更仍不直接消费，轮创建由 inject 响应/占位触发） | session_id, run_id（无 timestamp） | 无（参考事件，见下「计时锚点」注） |
| log | 同上 | 装配器 `applyLogToSegments` | run_id, log_id, channel, content, timestamp（可选：parent_tool_use_id/subagent_type/depth/tool_kind/segment_id/stale） | 段新增/更新/配对/撤回；log_id 去重 |
| tokens | 同上 | SessionPanel（现状逻辑不变） | run_id, input_tokens, output_tokens | token 累计 |
| turn_completed | 同上 | SessionPanel（现状逻辑不变） | run_id, status, exit_code, input/output_tokens | turn → completed/failed/killed；状态条移除；streaming 段清除 |
| session_ended | 同上 | SessionPanel（现状逻辑不变） | session_id | currentRun 清空；目录收起 |
| permission_request / resolved | 同上 | 现状逻辑不变 | request_id | 待答卡增删 |

> **计时锚点注（Grill X-01 查证）**：backend session channel 实际事件集为 log / tokens / turn_completed / turn_injected / session_created / session_ended / status_changed / permission_*，**不存在 turn_started**（前端现有 `case "turn_started"` 为死分支）。运行中轮的起始时刻取：live = 客户端发送占位本地时钟；attach/刷新 = run 快照 `started_at`（listSessionRuns 返回）；两者皆缺 = 首条 log timestamp。

注：上表为**消费契约**（既有后端行为，零改动），非新事件定义。生命周期契约：无新增。

## 8. 数据模型

无 DB schema 变更。前端内存模型变更见 §7（TurnSegment / AssembledTurn / TurnActivitySummary）。持久化面（agent_run_logs 表的归属三列 + tool_kind）已在 2026-06-28-daemon-subagent-transcript / 2026-07-05-agent-log-type-tags 落地，本变更纯消费。

## 9. 兼容策略（brownfield）

1. **旧日志无归属字段**（parent_tool_use_id undefined/null）：装配器按主 agent 平铺（depth 视 0），渲染与现状等价。
2. **Codex provider**：无归属字段 → 同上平铺；状态条/目录照常工作（子代理数 0）。
3. **segments 缺省回退**：`SessionTurnView.segments` 为 undefined 的 turn（孤儿 turn 构造路径、未来第三方构造）→ TurnTimeline 走旧渲染路径（output + processItems），不崩不空。
4. **过渡期双字段**：output/processItems 由 `AssembledTurn` 投影产出（投影映射：tool 段 startedAt → processItems.ts；thinking/stderr 段 ts → ts——AskUser 穿插排序依赖时间戳字段），外围消费方（重发 prompt、CtxUsageBar 统计、孤儿 turn 排序）零改动；稳定一个版本后再评估移除。**历史路径保留 logsToTurns 现有 seenText 内容级去重**（SSE 事件无 log_id 时的兜底）；log_id 去重仅用于 SSE 实时路径——两路去重语义不合并（Grill X-08）。
5. **子代理 tool_use 乱序**（子消息先于/无 tool_use 段）：兜底「子代理片段」段（subagentType 标注，平铺位置）；后续 tool_use 段到达且 id 匹配 → 合并迁入 children。
6. **未升级 daemon 的旧会话**：SSE 无归属字段 → 行为同 1。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | SSE 事件乱序/重连补拉导致段错乱 | P1 | log_id 去重贯穿装配器（平移 seenLogIds）；重连后历史预取覆盖语义与现状一致；单测覆盖重复/乱序用例 |
| R-02 | 子代理 tool_use 与子消息时序错位 | P1 | §9.5 兜底片段 + 到达后合并；单测覆盖先子后父/父缺失 |
| R-03 | 长会话大 turn 渲染性能 | P1 | 段级 memo + 稳定 id key；折叠内容按需渲染（默认折叠不挂载重内容）；流式 delta 只更新当前段 |
| R-04 | 两处消费方（sessions 页 + runtimes 弹窗）回归 | P0 | 共享 TurnTimeline + 装配器统一（正是本次目标）；单测 + 两页面既有测试适配；verify 阶段双入口人工核验清单 |
| R-05 | conversation 视图行为变化（新增状态条）引发用户感知回归 | P2 | 用户明确要求（FR-02），非回归；状态条仅运行中显示 |
| R-06 | override 撤回逻辑迁移引入回归（partial 段撤回是既有精细行为） | P1 | 撤回规则平移 + segmentId 前缀路由单测（`main:<msg_id>:<seq>` / `<tool_use_id>:<seq>` 两前缀三段格式 × 文本/思考两 variant）；**跨段撤回用例**（Grill X-06：同一 segment_id 的 partial 回复被工具段打断分裂多段后 override 到达 → 各分裂段一并撤回，段模型与现有单串截断语义不同） |
| R-07 | ToolRow 解析 raw JSON 失败（非 JSON 内容） | P2 | 沿用 parseToolRaw 容错：解析失败原样显示 raw |

## 11. 决策追踪

| 决策 | 状态 | 覆盖 |
|---|---|---|
| D-001@v1 「阶段」=轮内执行分段（非 SillySpec 流程阶段） | accepted | FR-01、§5 Phase2、§3 非目标末条 |
| D-002@v1 方案 C：共享装配器 + 结构化渲染（否决 A 保留副本债 / B 全量移植） | accepted | §5 全部、FR-05 |
| D-003@v1 设计与原型确认（prototype-session-stream.html 过目） | accepted | §5、§7 视觉基准 |

无未解决决策。

## 12. 自审（Self-Review）

- [x] 章节齐全：背景/目标/非目标/拆分判断/总体方案/文件变更清单（含字段数据流标注）/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审。
- [x] 生命周期关键词（session/agent_run）命中 → §7.5 已给消费契约表 + 明示「生命周期契约：无新增」。
- [x] 文件清单数据流：唯一对外字段变动是 `SessionStreamEnvelope` 补类型声明，producer→consumer 链路已标（backend 已推 → 类型声明 → 装配器消费），无 dormant 字段。
- [x] 每个风险有应对；P0 仅 R-04，应对即本次架构目标本身（收敛副本）。
- [x] 接口定义含方法签名与数据结构；TurnSegment 的 id 稳定性（tool id / segmentId / logId 派生）在 §7 注明。
- [x] 兼容策略覆盖旧数据/Codex/孤儿 turn/乱序四类 brownfield 场景。
- [x] YAGNI 核对：无后端改动、无插件系统、无 token 编造显示；TurnActivitySummary 字段均有 FR 消费方。
- [x] 与现有代码对齐：classifySessionLog/parseToolRaw/isToolResultDenied 分类与解析规则平移而非重造；AskUser/whoLine/孤儿 turn 既有特性列保持。
- ⚠️ 自审存疑 1（**已被 Grill X-01 定论并修正**）：backend 无 turn_started 事件，计时锚点已改为「turn 创建时刻（live 本地占位 / attach 用 run.started_at / 缺则首条 log timestamp）」，见 §7.5 注与 §5 Phase3。
- ⚠️ 自审存疑 2：`all` 视图改文案「进度」可能影响既有测试断言（按「全部」文案查询）——已列入 §6 测试适配项（interactive-session-panel.test.tsx 16 处 + sessions page.test.tsx）。

### Grill 修正记录（2026-08-19，独立审查子代理）

X-01 契约表 turn_started 事实错误 → §7.5 重写 + 计时锚点改锚；X-02 tool_result 无 id 配对 → §5.4 归属桶位置配对；X-05 接口缺兜底变体/AssembledTurn → §7 补齐 subagent_stub + AssembledTurn + logsToSegments 形状澄清；X-06 跨段撤回 → R-06 补用例 + segmentId 三段格式；X-08 投影 ts 映射 + seenText 去重保留 → §9.4；X-09 挂载范围 → §5 Phase3 + §6（TurnStatusBar 内置 TurnTimeline，SubagentCatalog 仅 sessions 页）；X-12 测试 glob → §6 补两测试文件。核心主张经源码核实成立（X-03 归属 id 同源 / X-04 零后端改动为真 / X-07 段引用稳定可达成）。
