---
author: qinyi
created_at: 2026-08-16 00:38:00
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在变更中心查看/跟踪变更进度的开发者 |
| 变更执行 agent | 通过 sillyspec CLI 跑阶段、上行进度的一方（本变更不触碰） |

## 功能需求

### FR-01: 列表页 step 级徽章
覆盖决策：D-002@v1, D-003@v1
Given 变更的 latest_progress.steps[] 非空
When 用户打开变更中心列表
Then 阶段徽章区显示 `step x/y`（全 stage 累计）+ 迷你进度条 + 当前步名；当前步状态映射：active→蓝脉动、waiting（wait_reason 非空）→黄+「等待用户决策」、全完成→绿

Given steps 缺失/空/结构异常
Then 徽章降级为现有 current_stage 展示（视觉与现状一致）

### FR-02: 详情页步骤时间线
覆盖决策：D-005@v1
Given 变更 steps[] 非空
When 用户打开变更详情
Then 显示按 stage 分组（STAGE_ORDER 序，quick/未知追加在后）的垂直时间线：每步名称/状态/output 摘要（截断 200 字）/完成时间（ISO 8601）/wait_reason；七值状态色映射（completed 绿/in-progress 蓝/pending 灰/waiting 黄/failed 红/blocked+stale 橙/未知灰）
And 旧 SillySpecStepProgress 组件被替换且引用清理

### FR-03: 智能轮询不乱跳
覆盖决策：D-001@v1, D-004@v1
Given 列表/详情页打开且存在非终态变更
When 到达轮询间隔（列表 30s / 详情 10s）
Then 自动 refetch；响应内容未变（structuralSharing 引用相等）→ 跳过重渲染，滚动/选中/展开态保留

Given 全部变更终态（status=="archived" || location=="archive"）
Then refetchInterval 返回 false 停轮

Given document.visibilityState !== "visible"
Then 暂停轮询（refetchIntervalInBackground 默认 false）

Given 纯 step 推进（steps 上行）
Then 列表默认排序（updated_at desc）不重排（steps 上行不写 changes.updated_at）

### FR-04: 后端读侧提取
覆盖决策：D-002@v1, D-003@v1
Given platform_change_progress.latest_progress 含 steps[]
When enrich_summaries / enrich_with_workspace_ids 执行
Then ChangeSummary.step_progress 填摘要（step_total/steps_completed/current_step_name/current_step_status/current_step_desc），ChangeRead 另填 steps 明细数组；completed_at 归一化 ISO 8601 UTC（strptime "%Y/%m/%d %H:%M:%S" 本地→UTC，失败保留原串）
And `_resolve_pending_change_keys` 三元组解包适配后行为不变（守护测试）

## 非功能需求
- 兼容性：新 API 字段全 optional，旧前端/旧 api-types 不受影响；无 migration；无 CLI 契约变更。
- 可回退：回退=前端不渲染新组件（后端字段闲置无害）。
- 可测试：终态定义、状态映射、归一化、解包适配均有单测；提取器对异常结构不抛。
- 性能：查询零新增（复用现有批量 IN SQL）；纯 DB 读零 FS；列表响应每行 +~200B；轮询有界。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-03 | 智能轮询+稳定渲染硬约束 |
| D-002@v1 | FR-01, FR-04 | 数据源=现有六表 steps[]，零上报改动 |
| D-003@v1 | FR-01, FR-04 | steps 缺失优雅降级 |
| D-004@v1 | FR-03 | react-query useQuery+refetchInterval 承载 |
| D-005@v1 | FR-02 | 详情组件替换统一数据源 |
