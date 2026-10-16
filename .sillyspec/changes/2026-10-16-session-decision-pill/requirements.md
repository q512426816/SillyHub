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

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
