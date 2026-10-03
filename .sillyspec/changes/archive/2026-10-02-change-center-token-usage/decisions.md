---
author: qinyi
created_at: 2026-10-02
---

# 决策记录（Decisions）

## D-001@v1: 需求范围 = 本地 CLI 会话的 token 用量纳入变更中心统计
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 「本地 agent 上报了 token 信息」指哪类链路——(A) 本地 CLI 会话（ZCode/CLI 直接本地跑，agent-logs 上报元信息，token 不落库、仅会话回放实时解析展示）；(B) 平台派发给本地 daemon 的 lease 执行（token 已落库 agent_runs，变更中心已统计）
- answer: A——本地 CLI 会话（用户 AskUserQuestion 确认）。这类会话已建 agent_sessions 行（origin=tool_report，title=「本地 · 变更名」）并经 change_session_links 绑定变更，但其 token 用量不落库（platform_agent_logs 无 token 列），变更中心用量聚合对它们恒为空。需求 = 让这类用量也进变更中心展示，口径与平台执行展示一致。
- normalized_requirement: 补齐本地 CLI 会话用量的落库链路（daemon 已具备日志解析能力：parse-zcode-model-io.ts / read-zcode-sqlite.ts，回放 RPC 已在用）+ 变更中心聚合纳入第二数据源；平台派发执行统计维持现状。
- 模块域: backend, frontend
- impacts: [方案选择, design, FR 定义]
- evidence: backend/app/modules/platform_sync/model.py:331-335（platform_agent_logs.agent_session_id FK）、platform_sync/service.py:2040-2080（tool_report 会话建行）+ :133-158（_bind_entry_ctx 绑定）、change/usage_service.py:130-151（锚点集合只聚 agent_runs）；用户回答轮次 1

## D-002@v1: 落库触发方式 = 方案 A 上报链路顺带解析（backend 拉）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 本地 CLI 会话用量解析落库由谁触发——A 上报链路顺带解析（backend 收到 agent-logs 上报后异步 RPC daemon 解析落库）/ B daemon 周期主动推送快照 / C 查询时实时解析不落库
- answer: 方案 A（用户 AskUserQuestion 确认）。CLI 每次 POST /api/agent-logs 上报后，backend 异步经现有 WS RPC 通道让 daemon 解析本次涉及 entry 的日志用量并落库。理由：触发高频自然（CLI 每条命令都上报）、复用回放已有的解析器与 RPC 通道、改动集中 backend；daemon 离线仅暂缓（下次上报全量解析幂等补齐）。否决 B（两端改动 + 持续解析开销与观看需求无关）与 C（列表页批量 RPC 爆炸、离线空数据，不可行）。
- normalized_requirement: 落库为 best-effort 异步（不阻塞上报响应、失败不抛）；解析口径全量幂等（每次覆盖写快照）；变更中心聚合服务扩第二数据源段（本地 CLI 用量）；存储形态（加列 vs 新表）与展示合并形态在 design 细化。
- 模块域: backend, frontend
- impacts: [design, FR 定义, task 拆分]
- evidence: 回放 RPC 先例 backend/app/modules/platform_sync/router.py:923（GET /agent-logs/{id}/messages 经 WS RPC daemon 解析）、daemon 解析器 sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts + read-zcode-sqlite.ts；用户回答轮次 1
- 故障面: 后台摄取任务可能因 daemon 离线/超时长期空转记日志（无失败放大，快照滞后）；上报高峰期重复解析受节流钳制但仍有 RPC 开销
- 退役判据: 若后续 daemon 原生周期推送用量（方案 B 复潮条件：多机环境下报频率不足、新鲜度成为实际痛点），本摄取链路可整体下线，落库快照消费端（聚合/展示）不变
