---
author: WhaleFall
created_at: 2026-10-16 11:23:49
generated_by: sillyspec-design-init
scale: small  # 单上下文可吞吐（5 文件单模块顺序依赖，无 Wave 并行簇、无上下文分片、无多阶段治理）→ 轻量道 flow start 收编
---

# 设计文档（Design）— 2026-10-16-session-decision-pill

## 背景

会话面板已把变更文件单独拎出做了悬浮 pill 展示（2026-10-13-session-change-files-hover：胶囊入口 + hover 下拉 + 大弹窗）。但会话中"让用户决策的信息"（AskUser 提问、Plan 审批）散落在聊天流各处：pending 提问卡 sticky 常驻聊天流顶部（frontend/src/components/daemon/turn-timeline.tsx:1512-1522）、Plan 审批卡固定在输入区上方（frontend/src/components/daemon/session-panel/session-panel-page.tsx:5359-5369）、已答历史穿插在时间线对应 turn 内——用户缺少一个聚合视图快速看到"当前会话等过/正在等我做哪些决定"。

数据现状（调研结论，D-001/D-003）：
- AskUser 提问与 Plan 审批（ExitPlanMode dialog，dialog_kind='plan_approval'，sillyhub-daemon/src/interactive/session-manager/permission.ts:460-476）同表持久化于 session_dialog_requests（backend/app/modules/daemon/model.py:285），REST 齐备（frontend/src/lib/daemon/sessions.ts:163-190 fetchPendingDialogs / fetchSessionDialogHistory）；
- 普通工具审批（无 dialog_kind）在门户会话不会发生（创建固定 manual_approval=true + ask_user_only=true，frontend/src/components/daemon/session-panel/session-panel-page.tsx:3725-3726，除 AskUserQuestion 外全部自动放行），不纳入本期（D-005）。

## 设计目标

- 会话内新增"待决策"悬浮 pill（与变更文件 pill 并排），聚合当前会话所有等用户决策的信息与已答历史；
- pending 项点击可定位回聊天流对应卡片（sticky 提问卡 / Plan 审批卡，含还原被最小化的卡）；
- 历史项点击可只读查看决策详情（问题、选项、当时的选择、时间）；
- 纯前端实现，数据面零新增（不新增 API、不新增后端持久化、不为普通审批加收集逻辑）。

## 非目标

- 不在 pill 弹层内直接作答——作答仍走聊天流 sticky 卡 / Plan 审批卡现有交互（D-002）；
- 不聚合普通工具审批（门户会话不发生，D-005；未来权限模式变化再扩展）；
- 不新增后端端点/持久化（D-006 rejected）；
- 不改造 dialog 模式（runtimes 弹窗）挂载——对齐变更文件 pill 先例，仅 page 模式挂载。

## 拆分判断

单模块（frontend_app）前端组件级变更，无跨模块依赖，不拆分、不走批量模式。

## 总体方案

### 1. 组件与入口（仿 frontend/src/components/daemon/session-change-files-hover.tsx）

新组件 `SessionDecisionsHover`：
- **胶囊入口**：shadcn Button（variant=outline size=sm）+ MessageCircleQuestion 图标 + "待决策"文案 + 计数徽标（= pending 数，pending>0 时呼吸动画）；aria-label="悬浮查看会话待决策信息"。
- **hover/click 下拉**（antd Popover，trigger=['hover','click']，placement=topRight，受控 open state——与变更文件 pill 同款交互契约）：分组列表，max-h 60vh 滚动。
- **分组**（对齐变更文件 pill 的进行中/已归档心智）：
  - **待决策（N）置顶**：数据 = pendingRequests（AskUser + plan_approval dialog，SSE 实时态）+ planPending（Plan 机制 1，SSE 态）。每项：问题标题（复用 resolvePendingTitle 同口径提取，frontend/src/components/permissions/minimized-dialog-capsule.tsx:52-66）+ 类型徽标（dialog_kind='plan_approval' → "Plan"，其余 → "提问"；planPending → "Plan"）+ 状态短语（"等待你的回答" / "长驻等待，不会自动超时"）+ 时间（plan 用 requestedAt；dialog 的 SessionPermissionRequest 无时间字段，显示 "—"——frontend/src/lib/daemon/sessions.ts:22-60 探针核验）。
  - **已答历史（N）默认折叠可展开**：数据 = fetchSessionDialogHistory 中 status != 'pending' 的行 + status='pending' 但 request_id 不在 pendingRequests 的孤儿行（会话已终止的死卡，显示"未回答"，对齐 turn-timeline.tsx:1514-1515 ended 会话不回显 pending 卡的门控语义）。每项：标题 + 状态徽标（answered → 绿"已答"、cancelled/孤儿 → 红"未回答"）+ 回答摘要（answer 结构化提取首行，取不到显示状态短语）+ created_at 短时间。历史端点既有行为：不过滤 dialog_kind（AskUser 与 plan_approval 行同返）、固定取最近 _DIALOG_HISTORY_MAX 条（backend/app/modules/daemon/permission_service.py:850-880，超出上限的远古 Q&A 不返回——pill 沿用该上限，不另做分页）。
- **只读详情弹窗**（shadcn Dialog，max-w-2xl）：历史项点击打开——问题文本 + header + 选项列表（options label + description，当时选中的项标 ✓"你的选择"，选中判定按 answer payload 与 AskUserDialogCard 提交结构对齐）+ 元信息行（提问时间 created_at / 回答时间 answered_at）。

### 2. 数据流（三类零新增）

- **pending dialog**：props 注入父级 `pendingRequests: SessionPermissionRequest[]`（frontend/src/components/daemon/session-panel/session-panel-page.tsx:768 SSE 态 + :2677 fetchPendingDialogs 刷新恢复，链路已有）。
- **Plan pending（机制 1）**：props 注入父级 `planPending: { runId; summary; requestedAt } | null`（session-panel-page.tsx:772 SSE plan_mode_entered 态）。
- **历史**：组件内 useQuery 自取 `fetchSessionDialogHistory(sessionId)`，`refetchInterval` 仅在 popover 或详情弹窗打开时 15000ms（active 轮询，对齐 useSessionChanges 模式；关闭即停）。

### 3. pending 点击定位与还原

- 点击 pending dialog 项 → 回调链：pill → session-panel-page → TurnTimeline（新增可选 prop `focusDialogRequest: { requestId: string; nonce: number } | null`）：TurnTimeline effect 监听变化 → ①若该卡在 minimizedIds 中先还原（复用内部还原逻辑）；②滚动时间线容器到顶（sticky 卡常驻顶部）；③高亮闪烁（临时 class 1.2s，原型 .flash 同款）。planPending 项点击 → 滚动到输入区上方 Plan 审批卡 + 高亮（该卡恒可见，仅提示注意力）。

### 4. 挂载点改造（两 pill 并排）

session-panel-page.tsx:5386 悬浮锚点（`relative h-0 w-full`）内改为渲染定位行容器 `pointer-events-none absolute bottom-20 right-4 z-40 flex items-center justify-end gap-2 print:hidden`，行内两个 `pointer-events-auto` 子槽分别挂 SessionDecisionsHover 与 SessionChangeFilesHover。session-change-files-hover.tsx 新增可选 prop `embedded?: boolean`（默认 false）：true 时组件不渲染自带 absolute 外壳只渲染内容（向后兼容，dialog 模式/其它调用点零影响）。

### 5. 主题合规

brand-* 语义类 + shadow token + bg-card/border 变量类（.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md §0.5 多主题铁律）；antd Popover 经既有 ConfigProvider token，不手写色值；徽标语义色用 emerald（等待回答）/amber（未回答）既有先例阶。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/components/daemon/session-decisions-hover.tsx | 决策 pill 组件（胶囊 + 分组下拉 + 只读详情弹窗 + 分组纯函数导出）——已落地（brainstorm 时 NEW: 前缀，交付后按存在文件写仓根路径） |
| 新增 | frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx | 分组纯函数 + 组件渲染 vitest 用例——已落地（同上） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 挂载点改 flex 悬浮行并排两 pill；透传 pendingRequests/planPending/TurnTimeline focus prop |
| 修改 | frontend/src/components/daemon/session-change-files-hover.tsx | 新增可选 prop embedded（默认 false 行为不变） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 新增可选 prop focusDialogRequest（还原最小化 + 滚顶 + 高亮闪烁 effect） |

## 接口定义

组件 props（新增，均为前端内部契约，无网络接口改动）：

```ts
// session-decisions-hover.tsx
export interface SessionDecisionsHoverProps {
  sessionId: string;
  /** pending AskUser/plan_approval dialog（父级 SSE 态，权威源） */
  pendingRequests: SessionPermissionRequest[];
  /** Plan 审批卡态（机制 1，父级 SSE plan_mode_entered 态；null=无） */
  planPending: { runId: string; summary: PlanSummary; requestedAt: string | null } | null;
  /** pending 项点击（requestId=dialog 行；plan 固定 'plan' 哨兵值） */
  onFocusPending: (requestId: string) => void;
}

// turn-timeline.tsx（新增可选 prop）
focusDialogRequest?: { requestId: string; nonce: number } | null;

// session-change-files-hover.tsx（新增可选 prop）
embedded?: boolean;

// 分组纯函数（导出供测试）
export function splitDecisions(
  pendingRequests: SessionPermissionRequest[],
  planPending: SessionDecisionsHoverProps["planPending"],
  history: SessionDialogRead[],
): { pending: DecisionItem[]; history: DecisionItem[] };
```

本变更接口面：0 端点（无接口变更）。

## 生命周期契约表

本变更不涉及生命周期契约（不新增/修改 session/lease/agent_run 状态流转、事件协议与 claim/heartbeat 机制；仅消费既有 SSE 状态与 REST 只读查询）。

## 数据模型

无 schema 变更——只读消费 session_dialog_requests 既有表与 SessionDialogRead DTO。

## 兼容策略（brownfield 必填）

- session-change-files-hover `embedded` prop 默认 false：既有调用点（session-panel-page 挂载）随挂载点改造改传 true，其余潜在调用方行为不变；
- turn-timeline `focusDialogRequest` 默认 undefined：不传时零行为变化（effect 不激活）；
- pill 无决策信息（pendingRequests 空 + planPending null + 历史空/未加载）不渲染、不占位——对齐变更文件 pill FR-02 显隐契约；
- dialog 模式（runtimes 弹窗）不经 page 渲染分支，自然不挂载（先例同款）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | planPending（机制 1）为 SSE 内存态，刷新后丢失——pill 上 Plan pending 消失 | P2 | 现状一致（PlanApprovalCard 本身也是内存态）；dialog_kind='plan_approval' 行（机制 2）有持久化恢复兜底，两类覆盖不同会话类型 |
| R-02 | 历史行 answer payload 结构随 dialog_kind 差异（AskUser 选项 vs plan_approval） | P2 | 详情弹窗按 dialog_kind 分支渲染；提取失败降级显示原始 JSON 首行摘要，不阻塞列表 |
| R-03 | focusDialogRequest nonce 触发式 prop 与 TurnTimeline 内部 minimizedIds 状态时序错位（还原早于挂载） | P2 | effect 依赖 nonce 变化重试一次（rAF 延迟）；最小化卡已挂载（渲染 null 保 state），无真正卸载风险 |
| R-04 | 两 pill 并排后右下角与 MinimizedDialogCapsule（fixed bottom-4 right-4）视觉接近 | P2 | 层级分离：pill 行 bottom-20（输入条上方），胶囊 bottom-4（页面底缘），纵向错开不重叠 |
| R-05 | 原型为单文件 HTML 模拟页（同 2026-10-13 先例形态），非 React 真码 | P2 | 跳过真码原型依据：与三天前同家族先例（archive/2026-10-13-session-change-files-hover/prototype-session-change-files-hover.html）完全同构——组件结构/交互/样式类全部对照既有实现搬用，execute 阶段直接对照源码复用，不经"看图翻译"；用户已交互确认原型 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 §1 分组（AskUser+Plan 含历史）；普通审批不收集（R-01/D-005 关联） | 已确认 |
| D-002@v2 | 总体方案 §3（pending 点击定位还原 sticky 卡；Plan 卡高亮）——@v1 普通审批跳转部分由 D-005 取代 | 已确认 |
| D-003@v1 | 总体方案 §2（历史统一 fetchSessionDialogHistory，不过滤 dialog_kind） | 已确认 |
| D-004@v1 | 总体方案整体（前端自包含、数据零新增、文件变更清单） | 已确认 |
| D-005@v1 | 非目标（不聚合普通审批；R-01 退役判据关联） | rejected 落盘 |
| D-006@v1 | 非目标（不加后端端点） | rejected 落盘 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale——scale 留 Step 8 评估落值）
- [x] 引用所有当前版本 D-xxx@v1（D-001~D-006 全部出现在决策追踪表）
- [x] 生命周期关键词豁免短语已紧邻「生命周期契约表」标题声明
- [x] UI 原型：prototype-session-decision-pill.html 已落盘（单文件模拟页，分级依据与先例一致性见 R-05）
- [x] 无「⚠️ 自审存疑」项
