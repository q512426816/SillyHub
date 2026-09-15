---
author: qinyi
created_at: 2026-09-15T09:20:00
scale: large
risk_level: unit-sufficient
prototype: prototype-subagent-three-pane.html
---

# 设计文档（Design）— 会话子代理三分栏展示

> 决策追踪：本设计覆盖 D-001@V1（需求确认清单）、D-002@V1（默认视图行为补全）、D-003@V1（方案 A 右栏单槽位复用文件预览三栏），三者均 status=confirmed、无冲突。
> 生命周期契约：无/N/A——纯前端视图态变更，不产生/不消费任何会话生命周期事件（design §3 非目标已列）。

## 1. 背景

用户反馈（原话）三条：
1. 子代理内容展示应做成三分栏——和工作区文件预览一个样：点击子代理把内容展开到最右侧栏；若此时打开了文件预览，则文件覆盖最右栏（**按最后触发的覆盖**）。
2. 子代理里展示的内容不完整——子代理应和主会话展示的内容、格式都一样，只是不支持继续对话。
3. 中间会话栏里子代理不需要展示细节，只展示**是否运行中 + 运行时间**。

现状三个结构性成因（调研结论）：
- 默认「对话」视图把子代理容器段整体过滤（`turn-timeline.tsx:1183-1188` 只留 text/file），子代理产出完全不可见——"内容不完整"主因。
- 「进度」视图中 `SubagentBlockView`（`turn-segment-views.tsx:590-760`）是内嵌窄卡，完成即折叠，无独立展示空间。
- 2026-09-09-sessions-file-browser-three-pane 已落地三分栏（左列表/中会话/右文件预览，`sessions-portal.tsx:646-1006`），右栏机制（条件挂载 + `usePanelWidth`/`PanelResizer` + localStorage 记忆）可直接复用。

## 2. 设计目标

- FR-01 右栏单槽位：文件预览与子代理详情共享最右栏，**后触发者覆盖**（点文件 → 子代理面板关闭；点子代理 → 文件预览关闭）。
- FR-02 中栏子代理精简卡片：状态点（运行中脉冲/成功/失败/停止）+ 🤖 + 名称 + 类型标签 + （后台任务）状态徽标 + 运行时长；点击 → 右栏打开该子代理完整时间线。对话/进度两视图一致。
- FR-03 右栏子代理面板：内容与格式和主会话一致——完整 children 段时间线（文本/思考/工具/文件/stderr，SegmentView 递归渲染，等同进度视图语义），**无输入框**（不支持继续对话）；实时随 SSE 更新。
- FR-04 对话视图不再整体过滤子代理：过滤条件放宽为 text/file/子代理容器段（tool 带 children 或 subagent_stub）。
- FR-05 右栏宽度复用文件预览同一 `usePanelWidth` 状态与记忆键（单槽位语义一致）；把手 side=right 同文件预览。

## 3. 非目标

- 子代理不支持继续对话（无输入区，本次不开放）。
- 不动后端/daemon/schema/API（子代理日志本就走主会话 SSE/logs 端点，无独立端点需求）；无需 `pnpm gen:types`。
- dialog 弹窗/悬浮宿主不加右栏（无三栏空间）：SessionPanel 无新 props 时行为零变化（内联展开回退）。
- 不改动 `session-log-assembler` 装配逻辑（归属路由/stub 合并不动）。
- 移动端窄屏不做右栏（沿用 overflow-hidden + 用户拖窄/关闭）。

## 4. 拆分判断

单变更收口：三栏槽位互斥、中栏卡片、右栏面板是一个交互闭环。规模 large（新增 1 面板壳 + context 文件，改 portal/session-panel-page/turn-timeline/turn-segment-views 共 ≈6 文件），走 plan 拆 Wave。

## 5. 总体方案

### 5.A 状态归属与互斥（sessions-portal.tsx）

- 保留 `filePreview {workspaceId, path}` 状态不动；**新增** `subagentView { segmentId } | null`（段 id 是会话内稳定 key）。
- 互斥写入点仅两处，天然"最后触发覆盖"：
  - 文件树 `onSelectFile`（sessions-portal.tsx:659-663）：落 `filePreview` 前/同时 `setSubagentView(null)`。
  - 新回调 `handleOpenSubagent(segmentId)`：`setFilePreview(null); setSubagentView({ segmentId })`。
- 会话切换清零：`selectedSessionId` 变化（含清空）时 `setSubagentView(null)`（段 id 属旧会话，无跨会话语义）。
- 右栏渲染分工（**以 §5.B 为准**，此处修正初稿表述）：portal 右列（sessions-portal.tsx:980-1006）**仍只渲染文件预览**；子代理面板渲染在 SessionPanel 内部（§5.B）——因为它需要 `displayTurns` 活数据。单槽位互斥不靠"同一列二选一渲染"，而靠 portal 双向清零：点文件 → `setSubagentView(null)`（SessionPanel 收 openSubagentId=null 自动卸载面板）；点子代理 → `setFilePreview(null)`（portal 文件预览列卸载）。效果上等价于同一槽位，实现上两处各管各的渲染。

### 5.B SessionPanel 新契约（session-panel-page / index）

- 新增可选 props（仅门户 page 装配传入）：
  - `openSubagentId: string | null` —— 右栏应展示哪个子代理段；
  - `onOpenSubagent: (segmentId: string) => void` —— 中栏卡片点击上抛（门户落槽位）；
  - `onSubagentPanelClose: () => void` —— 右栏 ✕ 上抛（门户清槽位）。
- 未传时（dialog 等旧消费方）：组件内部 `openSubagentId` 视为 null，全部行为与现状一致（零回归）。
- **右栏面板渲染归属 session-panel-page**：子代理段数据在 `displayTurns`（turnState）内，portal 拿不到活数据；面板随 SessionPanel 内部渲染，根节点在 `openSubagentId != null` 时为 flex 行：`[原面板内容 flex-1 min-w-0] [PanelResizer side=right] [子代理列 width=panelWidth]`。宽度用 session-panel-page **自己的 `usePanelWidth`**，与文件预览共用同一 localStorage 键 `sillyhub.sessions.filePreviewWidth`（读同键初始化；两实例在互不重叠的生命周期内各自记忆，单槽位语义下不构成实际分歧）。

### 5.C 中栏紧凑卡片（turn-segment-views.tsx）

- 新增轻量 context（新文件 `subagent-panel-context.ts`）：`{ openSubagent(id: string): void; activeId: string | null }`，由 session-panel-page 面板根提供（值含当前 `openSubagentId`）。
- `SubagentBlockView` 消费 context：
  - **有 context**（page 模式）：渲染紧凑卡片（复用现有块头全部元素：状态点/🤖/名称/类型/徽标/时长，运行中 seg-sweep），**不渲染内联 children**；点击头部 → `openSubagent(segment.id)`；**再次点击已激活卡片 = 关闭面板**（toggle 语义，`segment.id === activeId` 时上抛 close）；`aria-expanded` 语义移除（不再是折叠器），加 `data-segment-id` 锚点。
  - **无 context**（dialog/旧消费方）：现状内联展开逻辑原样保留（原 return 分支不动）。
- `SegmentView` 签名不变（context 穿透零改动，递归 children 也自动生效）。
- 时长/状态推导复用现有 task-13 逻辑（taskElapsedMs 服务端权威 + 本地走秒），零新造。

### 5.D 对话视图过滤放宽（turn-timeline.tsx:1183-1188）

- `textSegments` 过滤条件由 `text || file` 放宽为 `text || file || 子代理容器段`（tool 且 children.length>0，或 subagent_stub）。子代理容器段在对话视图渲染为 5.C 紧凑卡片。
- 「进度」视图时间线不变（容器段本就走 SegmentView → 紧凑卡片）。

### 5.E 右栏子代理面板（新文件 `subagent-detail-panel.tsx`，壳风格对齐 portal-file-panels.tsx）

- 头部：✕ 关闭 + 🤖 + 名称 + 类型标签 + 状态徽标 + 运行时长（复用 SubagentBlockView 头部派生逻辑，抽公共纯函数 `subagentHeaderOf(segment)`）。
- 正文：从 `displayTurns` 按 id 实时解析段（`findSegmentById`），`segment.children.map(SegmentView)` 全量渲染（含思考/工具展开区/文件卡/stderr），面板内独立滚动；SSE 更新即刷新（活引用，非快照）。
- 嵌套子代理（depth>1）：面板内仍渲染为紧凑卡片，点击 → `openSubagent(嵌套段id)`（右栏切到嵌套子代理，与"单槽位"语义自洽）；不提供返回栈，再点外层需回中栏重点（MVP 简化，见 §8）。
- 段 id 失效（会话重装配后不存在）→ 面板自动关闭（effect 检测 → `onSubagentPanelClose`）。
- 无输入框、无发送能力（FR-03 底线）。

### 5.F 子代理目录联动（subagent-catalog.tsx / handleJumpToSubagent）

- 头部子代理目录点击（`handleJumpToSubagent`）：page 模式改为直接 `onOpenSubagent(segmentId)` 打开右栏（不再切进度视图+滚动定位——中栏已无内联细节可定位）；旧双 rAF 定位逻辑保留为无右栏能力的回退（dialog）。
- 目录行高亮当前 activeId。

## 6. 数据流

```
SSE/logs → session-log-assembler（不动）→ turnState.turns（displayTurns）
   │
   ├─ 中栏：TurnTimeline → SegmentView → SubagentBlockView（紧凑卡片）
   │      点击 ──context.openSubagent(id)──┐
   ├─ 头部目录 onJumpTo ───────────────────┤
   │                                        ▼
   │   session-panel-page onOpenSubagent 上抛 → portal handleOpenSubagent
   │     （清 filePreview，落 subagentView） │（清 subagentView，落 filePreview）
   │   文件树 onSelectFile ─────────────────┘
   │                                        ▼
   │   portal 回传 openSubagentId ──→ SessionPanel 根 flex 行
   │     [中栏 flex-1][把手][SubagentDetailPanel width=previewWidth]
   │                                        │
   └─ 面板内 findSegmentById(displayTurns, openSubagentId) 活解析 → SegmentView 递归
```

## 7. 状态机

- 右栏槽位：`null | file | subagent`，单槽位，写入即覆盖（§5.A）。
- 面板生命周期：open（段存在）→ 实时刷新 → close（✕ / 段失效 / 会话切换 / 被文件预览覆盖）。
- 子代理运行态：复用现有推导（running/ok/deny/stopped + task 元数据），无新状态。

## 8. 风险与取舍

| 风险/取舍 | 说明 | 缓解 |
|---|---|---|
| 中栏不再内联子代理细节 | 进度视图也只见卡片，详情必须右栏 | 与用户需求一致；dialog 模式回退内联 |
| 嵌套子代理无返回栈 | 右栏切到 depth≥2 后回外层要回中栏 | MVP 接受；后续可加面包屑（退役判据：用户反馈迷路） |
| 面板随 SessionPanel 内部渲染 | 与文件预览右栏代码位置不同（数据归属决定） | 视觉/交互对齐 portal-file-panels；宽度记忆共享 |
| 对话视图新增子代理卡片 | 对话流中混入非对话元素 | 卡片样式弱化为 indigo 细边条，与文本气泡区分 |
| handleJumpToSubagent 行为变更 | 目录点击从"定位展开"变"开右栏" | page 模式语义更直接；旧逻辑留作回退 |

## 9. 文件变更清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `NEW:frontend/src/components/daemon/subagent-panel-context.ts` | 新增 | SubagentPanelContext（openSubagent/activeId） |
| `NEW:frontend/src/components/daemon/subagent-detail-panel.tsx` | 新增 | 右栏子代理详情面板壳（头部/正文递归/嵌套切换/失效关闭） |
| `frontend/src/components/sessions/sessions-portal.tsx` | 修改 | subagentView 槽位状态 + 双向互斥清零（点文件清 subagentView/点子代理清 filePreview）+ SessionPanel 新 props 装配 |
| `frontend/src/components/daemon/session-panel/index.tsx` | 修改 | SessionPanelProps 增 3 个可选 props 透传 |
| `frontend/src/components/daemon/session-panel/session-panel-page.tsx` | 修改 | context 提供 + 根 flex 行 + PanelResizer/宽度 + 面板渲染 + handleJumpToSubagent 改造 |
| `frontend/src/components/daemon/turn-segment-views.tsx` | 修改 | SubagentBlockView 紧凑卡片模式（消费 context）+ 头部派生纯函数抽取 |
| `frontend/src/components/daemon/turn-timeline.tsx` | 修改 | 对话视图过滤放宽（纳入子代理容器段） |
| `frontend/src/components/sessions/subagent-catalog.tsx` | 修改 | 目录行 activeId 高亮（现 props 仅 turns/onJumpTo，补 activeId 可选） |
| `frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx` | 修改 | 目录高亮断言用例 + 既有用例回归 |
| `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx` | 修改 | 紧凑卡片新用例 + 旧回退回归 |
| `frontend/src/components/daemon/__tests__/turn-timeline*.test.tsx` | 修改 | 过滤放宽用例 |
| `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | 修改 | 槽位互斥（双向清零）/会话切换清零用例 |
| `NEW:frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx` | 新增 | 面板渲染/关闭/失效自动关/嵌套切换用例 |

## 10. 测试策略

- 单测（vitest）：
  - turn-segment-views：有 context 时紧凑卡片渲染（无内联 children）+ 点击回调传 segmentId；无 context 时旧内联行为回归。
  - turn-timeline：对话视图过滤放宽——子代理容器段出现、其余段仍过滤。
  - sessions-portal：filePreview/subagentView 互斥覆盖（点子代理清文件、点文件清子代理）、会话切换清 subagentView（互斥由 portal 双向清零实现，非同列二选一渲染，见 §5.A）。
  - subagent-detail-panel：头部渲染/✕ 回调/段失效自动关闭/嵌套卡片点击切换。
- 回归：既有 subagent-async-derive、turn-segment-views、session-panel-dialog、sessions-portal 装配测试须绿。

## 11. 自审（Self-Review）

- [x] 需求点全覆盖：三分栏/最后触发覆盖 → §5.A；内容与主会话一致且无输入框 → §5.E（FR-03）；中栏只显状态+时长 → §5.C（FR-02）；对话视图可见 → §5.D（FR-04）。逐条对用户原话过一遍，无遗漏。
- [x] 决策一致：D-001@V1/D-002@V1/D-003@V1 三条 confirmed 决策全部覆盖，无违反；方案 A 与 D-003@V1 相符（B/C 未混入设计）。
- [x] 非目标与边界：dialog 零回归（§5.B 可选 props 回退）、不动装配器/后端、嵌套无返回栈列为风险（§8）。
- [x] 复用核实：`usePanelWidth`/`PanelResizer`（panel-resizer.tsx）、`findSegmentById`（session-panel-page 已有）、SegmentView 递归、task-13 时长推导——均 grep 确认存在，无编造 API。
- [x] 风险表每条有缓解措施（§8）；测试策略覆盖 5.C/5.D/5.E/5.A 四个改动面 + 回归。
- ⚠️ 自审存疑：面板渲染归属（session-panel-page 内部而非 portal）是为拿活数据做的取舍，与文件预览右栏代码不同位，execute 时若发现 SessionPanel 根节点 flex 改造有高度链风险，备选方案是把面板提为 portal 右栏 + 由 SessionPanel 经 context 供数据（§8 风险表已列）。

## 12. Design Grill 交叉审查结果（step 7）| ID | 层级 | 交叉点 | 结论 | 处理 |
|---|---|---|---|---|
| X-001 | consistency | §5.A 右栏渲染 vs §5.B 面板归属 | **conflict（初稿）** | 已修正 §5.A：portal 右列只渲染文件预览；单槽位互斥改由 portal 双向清零实现（点文件清 subagentView / 点子代理清 filePreview），两处各管各的渲染，效果等价单槽位 |
| X-002 | consistency | §5.E 宽度"复用 previewWidth 状态" vs portal/session-panel-page 是两棵组件树 | **conflict（初稿）** | 已修正 §5.B：session-panel-page 用自有 `usePanelWidth` 读同一 localStorage 键初始化，单槽位互不重叠生命周期下无实际分歧 |
| X-003 | completeness | 重复点击已激活卡片的语义未定义 | gap | 已补 §5.C：toggle 语义（再点 = 关闭） |
| X-004 | completeness | FR-01"会话切换清零"的写入点 | immediately_answered | §5.A 已列（selectedSessionId 变化即清）；plan 任务 T-01 落实 |

Question Distribution：immediately_answered 1 / needs_thinking 0 / unresolved 0。
Unresolved Blockers：无 P0/P1。审查通过，可进 plan。

## 13. 用户验收返工（verify 后、archive 前）

### 13.1 右栏面板「任务指令」块（返工 #1）

用户反馈：看不到子代理的初始化提示词。根因：提示词在派发 tool_call JSON 的
`args.prompt` 里（children 只含子代理侧日志），面板正文只渲染 children。修复：

- 装配器新导出纯函数 `dispatchPromptOfRaw(raw)`（session-log-assembler.ts）：解析
  tool_call JSON 取 args.prompt 全文，解析失败/缺失返回 null。
- SubagentDetailPanel 正文首块渲染「📋 任务指令（初始化提示词）」：whitespace-pre-wrap
  全文 + select-text；无 prompt（仅 description）/stub 段不渲染。
- 派生归属 FR-03（「内容与主会话一致」的补全——主会话工具卡可展开看 raw，面板以
  更直读的指令块对齐语义）。

### 13.2 父归属优先跨轮路由（返工 #2：子代理结束仍显示运行中）

根因（DB 实证，agent_run_logs run_id≠派发 run_id 的 [TASK_NOTIFICATION]/子代理行）：
后台子代理终态信号常经后续 run 落库（daemon 任务注册表丢失时 writeTaskLine 回退
currentRunId）。前端实时（turn-state upsertTurn 按 run_id 分轮）与历史
（logsToTurns 按 run_id 分组）两路都把跨 run 行归到后续轮——装配器轮内
findToolById 找不到派发段 → 终态信号丢弃 → 派发段永久「运行中」+后续轮冒出永久
running 幽灵 stub。修复（父归属优先，找不到父段回退原路径零回归）：

- 实时：upsertTurn 对带 parent_tool_use_id 的 log 先全轮 DFS（findSegmentById）找
  父段，命中即路由到父段所在轮（不 healToRunning、不新建轮——后台通知到达时派发
  轮可能已完成，不翻回 running）。
- 历史：logsToTurns 分组后 regroupSubagentLogsByParent——逐行登记 tool_call 的
  tool_use_id→最终组，带 parent 的行改挂父组（嵌套子代理天然跟随），原组逐键重置
  防残留（返工中实测修过的 bug：移走行未清原组致双份渲染）。
- 测试：新增 turn-state-subagent-routing.test.ts（4 用例：跨轮路由收敛/终态轮不
  翻回/无 parent 回退/孤儿 stub 兜底）+ runtime-session-helpers.test.tsx 跨 run
  重挂 describe（3 用例）+ detail-panel 指令块 2 用例。
