---
author: qinyi
created_at: 2026-10-16 11:02:17
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 会话用户 | 在会话面板与 agent 交互、回答提问/审批计划的平台用户（本变更唯一角色） |

## 功能需求

### FR-01: 决策 pill 入口与显隐
Given 会话面板处于真会话态（sessionId 非空）
When 当前会话存在任一决策信息（pending 提问/Plan 审批，或已答历史非空且已加载）
Then 输入条上方右侧渲染"待决策"悬浮 pill（与变更文件 pill 并排同一悬浮行），计数徽标 = 当前待决策数（pending 提问 + plan 审批 + plan_approval dialog 行之和），pending>0 时徽标呼吸动画
And 三类信息全空或历史未加载完成且 pending 为空时不渲染、不占位

### FR-02: 分组下拉列表
Given pill 已渲染
When 用户 hover（或触屏点击）pill
Then 弹出分组下拉：待决策（N）置顶——每项显示问题标题（resolvePendingTitle 同口径）、类型徽标（plan_approval/planPending → "Plan"，其余 → "提问"）、状态短语、时间（plan 用 requestedAt，dialog 显示 "—"）；已答历史（N）默认折叠、点击展开——每项显示标题、状态徽标（answered → "已答"，cancelled/孤儿 pending → "未回答"）、回答摘要（取不到显示状态短语）、created_at 短时间
And 历史数据经 fetchSessionDialogHistory 获取，仅在下拉或详情弹窗打开时 15s 轮询，关闭即停
And 历史中 status=pending 但 request_id 不在 pendingRequests 的孤儿行归入历史组显示"未回答"

### FR-03: pending 项点击定位还原
Given 下拉打开且待决策组非空
When 用户点击一条 pending dialog 项
Then 下拉收起，时间线滚动到顶，对应 sticky 提问卡高亮闪烁（约 1.2s）；若该卡处于最小化状态则先还原再高亮
When 用户点击 planPending 项
Then 下拉收起，滚动定位到输入区上方 Plan 审批卡并高亮

### FR-04: 历史只读详情弹窗
Given 下拉打开且历史组已展开
When 用户点击一条历史项
Then 打开只读详情弹窗：问题文本 + 选项列表（label + description，当时选中的项标 ✓"你的选择"）+ 元信息行（提问时间 created_at / 回答时间 answered_at）
And answer payload 按 dialog_kind 分支解析，提取失败降级显示原始 JSON 首行摘要，不阻塞列表

### FR-05: 兼容与挂载改造
Given 既有调用点（dialog 模式/其它潜在消费方）
When session-change-files-hover 未传新可选 prop embedded、TurnTimeline 未传 focusDialogRequest
Then 两组件行为与改造前完全一致（可选 prop 默认值兜底）
And 决策 pill 仅在 session-panel-page 的 page 渲染分支挂载，dialog 模式不挂载

## 非功能需求
- 兼容性：纯前端增量，零后端/API/schema 改动；不改变既有 SSE 恢复链与审批交互
- 主题合规：brand-* 语义类 + shadow token + bg-card/border 变量类（FRONTEND_PAGE_STYLE §0.5），antd 经 ConfigProvider token 不手写色值
- 平台兼容：Windows/Linux/macOS（纯浏览器端组件，无平台特定代码）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | 类型范围：AskUser+Plan 含历史（同源持久化）；普通审批不收集 |
| D-002@v2 | FR-03 | pending 点击定位还原 sticky 卡（@v1 普通审批跳转部分由 D-005 取代） |
| D-003@v1 | FR-02 | 历史统一 fetchSessionDialogHistory，不过滤 dialog_kind |
| D-004@v1 | FR-01, FR-02, FR-03, FR-04 | 前端自包含实现，数据三类零新增 |
| D-005@v1 | （rejected） | 不聚合普通审批——非目标，无 FR 覆盖；剩余风险见 design R-01 退役判据 |
| D-006@v1 | （rejected） | 不加后端端点——非目标，无 FR 覆盖 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「三类全空（pending 空 + 历史空/未加载）不渲染入口（FR-01）」；同文件「pending 渲染入口：徽标 = 待决策数且呼吸；悬停历史经 fetchSessionDialogHistory 拉取」；同文件「无 pending 但有已答历史时仍渲染入口，徽标 0 不呼吸（FR-01）」
FR-02: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「hover 弹下拉：待决策置顶（提问/Plan 徽标），已答历史默认折叠（FR-02）」；同文件「历史组展开显示回答摘要；再点收起」；splitDecisions（纯函数）组 4 用例（pending/plan 派生、answered/cancelled、孤儿 pending 归历史、历史未加载）
FR-03: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点 pending dialog 项：上抛 onFocusPending(requestId)；点 plan 项上抛 'plan' 哨兵（FR-03）」
FR-04: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点历史项收起下拉并开只读详情弹窗：问题/选项/当时选择 ✓/时间（FR-04）」
FR-05: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx 全组（embedded 缺省行为不变回归，33 用例含 turn-timeline 四套）；frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx 全组（focusDialogRequest 缺省零行为回归）
