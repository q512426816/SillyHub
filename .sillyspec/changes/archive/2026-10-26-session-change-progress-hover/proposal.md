---
author: qinyi
created_at: 2026-10-26T13:52:00
---
# 提案书（Proposal）— 2026-10-26-session-change-progress-hover

## 动机

会话页面悬浮变更面板目前每项只有变更名 + 轻量/全量徽标 + 单个阶段标签，无任何进度细节——用户看不到阶段内完成占比、execute 任务进度、阶段耗时、轻量变更批准态与收口子步进度。数据面调研确认：全量细度数据已上行平台（六表 stages/steps 明细），仅缺后端投影提取；轻量细度（flow status）全链路缺失，需 daemon 补采集上行。

## 变更范围

三条线一闭环（方案 A：后端投影扩展）：
1. backend 投影：ChangeSummary 加 stage_progress/task_progress/thin_flow 三个 optional 计算字段（零 migration），enrich_summaries 提取 + Task 表批量聚合 + 耗时计算。
2. daemon 轻量上行：采集器补跑 flow status --json（progress 同拍三态矩阵），heartbeat sillyspec_status 加 thin_flows 键（条目含 workspace_id），backend 消费行锁事务归一落 change.stages JSON（不刷 updated_at）。
3. frontend 渲染：下拉项内嵌进度行（全量 5 阶段圈/轻量 ①②③ 相位行）+ 入口旁单个总进度圈（最新进行中一个）+ 计数徽标双色（active>0 蓝）。

## 不在范围内（Non-Goals）

- 轻量相位级耗时（CLI flow-state 无相位时间戳，另立变更）。
- sillyspec CLI 任何改动（六表协议/flow 命令零改动）。
- 大弹窗（文件树预览）内进度展示。
- 已归档项进度渲染。
- 变更中心列表页（/changes）进度改造。
- SSE/WebSocket 实时推送与轮询频率调整。

## 成功标准

- FR-01~FR-08 全部达成（详见 requirements.md，含 Given/When/Then 场景）：全量下拉项 5 阶段圈（占比/打勾/耗时/异常态）+ execute 任务 n/m；轻量 ①②③ 相位行（批准态/任务/子步/总时长/升厚/分流标注）；入口单个总进度圈（updated_at 显式重排选取）；计数徽标双态；heartbeat thin_flows 全链路落库；全链路 fail-open 降级。
- 三端聚焦测试全绿（backend 投影/heartbeat 消费、daemon 采集器、前端组件），既有测试零回归；双 gen:types 同变更内提交。

## 影响面

- backend：change 模块（schema/service 投影）、daemon 模块（heartbeat 载荷与消费）、platform_sync 只读消费零改动。
- sillyhub-daemon：sillyspec-manager 采集器、hub-client 载荷。
- frontend：会话悬浮框组件族（新增 2 组件 + 改 1）、api-types 再生成。
- sillyspec CLI：零改动（红线保持：thin 不落数据库，走 daemon 旁路上行）。

## 验收要点

- 8 条 FR（见 requirements.md），关键口径：execute 圈=Task 表 n/m（非 Wave 步骤数）、轻量相位归一四枚举、入口总圈轻量相位加权、异常态异色圈+状态字、全链路 fail-open 降级。
- 测试：backend 投影/heartbeat 消费单测、daemon 采集器三态单测、前端组件双分支+降级单测；三端既有测试零回归。
