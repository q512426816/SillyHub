---
author: qinyi
created_at: 2026-08-16 00:38:00
---
# 提案书（Proposal）

## 动机

变更中心目前只显示 change 级 `current_stage` 一行文本，变更执行过程（阶段内部走到哪一步）是黑盒。用户在平台上发起/跟踪变更时无法感知"现在做到哪了、卡在哪等什么"，只能去终端问 CLI。

## 关键问题

1. **数据早已上行但无人消费**：sillyspec CLI 进度上行六表 JSON 的 `steps[]` 含每步名称/状态/output 摘要/完成时间/等待原因，`platform_change_progress.latest_progress` 已落库——读侧只投影 `current_stage`，step 数据白白躺着。
2. **等待用户决策不可见**：CLI 的 wait 步（`wait_reason`）在平台完全无感知，用户不知道有变更在等自己拍板，协作链路断在展示层。
3. **刷新机制缺位**：变更中心页面不自动更新，需要手动刷新才能看到阶段推进，体验落后。

## 变更范围

- backend 读侧：`_project_current_stage` 批量投影扩展 + `_extract_step_progress` 提取器 + `ChangeSummary`/`ChangeRead` 新 optional 字段（`step_progress` 摘要 / `steps` 明细）。
- frontend：列表页 step 徽章组件（`ChangeStepBadge`）、详情页步骤时间线组件（`ChangeStepTimeline`，替换旧 `SillySpecStepProgress`）、两页数据获取改 react-query `useQuery`+`refetchInterval` 智能轮询（30s/10s、终态停轮、后台暂停、structuralSharing 不乱跳）。
- 测试：提取器单测（七值枚举/归一化/降级/解包回归守护）+ 前端组件与页面测试适配。

## 不在范围内（显式清单）

- 不改 sillyspec CLI / daemon 进度上报链路（数据已齐）
- 不做 SSE/WebSocket 推送（D-001@v1 选智能轮询）
- 不把 steps 展开成数据库表（无 SQL 查询需求）
- 不做跨变更聚合看板 / 历史步骤统计
- 不展示 batch_progress（execute 批量进度另一形态）

## 成功标准（可验证）

- 有 steps 数据的变更：列表页显示 `step x/y + 当前步名`，详情页显示完整时间线（含 output 摘要与等待原因）。
- 无 steps 数据的变更（旧变更/占位行）：视觉与现状完全一致（降级）。
- 刷新不乱跳：轮询期间滚动位置/选中态/展开态保留，纯 step 推进不引起列表行重排。
- 全部变更终态后列表停轮；页面后台暂停轮询。
- 既有测试全绿（backend pytest + frontend vitest），gen:types 重生成。
