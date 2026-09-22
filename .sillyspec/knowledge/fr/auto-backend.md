---
author: sillyspec-fr-index
created_at: 2026-09-22T17:00:51.578Z
---

# FR 索引 — auto-backend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-backend-001 ctx 打标会话身份锚定
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-001@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given 某 agent 会话内执行 `sillyspec run --change X`（或 quick） zcode 进程（env 无会话 id） own 命中文件被；When CLI 探测本地日志文件 锚定器运行 组装 detected；Then 仅「本 run 所属 agent 会话（锚定主会话）及其子代理（zcode parent_id 链，不比 directory）」的条目被写入 ctx=X，其余条
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-01
最近确认：353eb11b0

## FR-auto-backend-002 quick/change 双向互斥
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-006@v2
场景正文：
- 场景：默认场景 — Given quick 会话内的 run（quickId=quick-xxx） 普通变更 run（--change X）；When 更新 own 条目 更新 own 条目；Then entry 置 quick_id=quick-xxx 且 change_key=null entry 置 change_key=X 且 quick_id=nul
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-02
最近确认：353eb11b0

## FR-auto-backend-003 平台 ctx-owner 归属解析
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-006@v2
场景正文：
- 场景：默认场景 — Given 平台收到无 hub_session_id 的推送，条目 ctx=Q（quick_id 优先于 change_key） 平台 pi 会话已通过自身 run 登记变；When 解析 Q 的 owner 本地 zcode 推送 ctx=X 的条目 归属解析
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-03
最近确认：353eb11b0

## FR-auto-backend-004 hub 分支 own-only 语义
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given daemon 派发会话（SILLYHUB_SESSION_ID 注入）内执行 run；When CLI 推送；Then payload entries = 留底条目 ∩ own 集合（按 log_path）；hub 会话名下不再出现非本会话产物（旧 CLI 过渡期除外，见 NFR
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-04
最近确认：353eb11b0

## FR-auto-backend-005 存量清理与重建
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given 生产库存在错配时代数据；When 执行数据迁移（CLI 升级后一次性运维动作，不随 backend 发布自动前滚）；Then ① platform_agent_logs.agent_session_id 全置 NULL；② origin=tool_report 会话软删；③ chang
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-05
最近确认：353eb11b0

## FR-auto-backend-006 无关日志零出现
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-001@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 本地某会话从未执行 sillyspec run；When 其日志文件在 cwd 活跃窗口内被其它会话的 run 探测到；Then 该条目不出现在任何推送中，平台任何会话/变更/quicklog 视图不可见
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-06
最近确认：353eb11b0

## FR-auto-backend-007 协议文档更新
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-006@v2、D-007@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given 协议 docs/platform-agent-log-protocol.md；When 本变更发布；Then §1 推送范围改 own 条目、§3 补 per-harness 锚定规则与回退、会话化上下文改双向互斥与 ctx-owner 平台行为
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-07
最近确认：353eb11b0
