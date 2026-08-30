---
author: qinyi
created_at: 2026-08-23 12:21:00
---

# 需求（Requirements）— 工具上报 Agent 日志会话化

> 需求源：用户 2026-08-23 对话拍板的四点决策 + 上一变更（2026-08-23-platform-agent-log-ingest）已落地的上报链路。

## 功能需求

- **FR-01（CLI 协议增上下文）**：`POST /api/agent-logs` body 增 body 级可选 `hub_session_id`（来源 env `SILLYHUB_SESSION_ID`，平台会话关联）与 **entry 级**可选 `change_key` / `quick_id`（互斥 quick 优先，随 entry 持久化——检出/更新该 entry 的 run 上下文，存量 entry 保留原 ctx；D-009）。CLI 上报块移至 change/quick 解析后取值；协议文档同步更新。
- **FR-02（daemon env 注入）**：daemon 派生 agent 进程时注入 `SILLYHUB_SESSION_ID=<平台 agent_sessions.id>`（claim payload 的 `agentSessionId` → `buildSpawnEnv` 层），随既有 env 合并层下发（restore/resume 路径同样携带）。
- **FR-03（后端关联）**：上报带 `hub_session_id` 且该会话存在于 token 派生 workspace → 全部 entries 链接到该会话（`platform_agent_logs.agent_session_id`）；会话不存在/跨 workspace → 静默按无关联处理（best-effort 降级，不 4xx）。
- **FR-04（自动建会话）**：上报无 `hub_session_id` → 按 harness 分组，每组按 `(workspace_id, harness, coalesce(change_key, quick_id, ''))` find-or-create「本地 Agent 会话」：`agent_sessions.origin='tool_report'`、title 自动（如 `zcode · <change_key/quick_id>`，无 ctx 时 `zcode · 本地活动`）、owner=token 派生 user、status='pending'、`last_active_at` 每次上报刷新；entries 链接到该会话。
- **FR-05（可继续）**：tool_report 会话出现在 `GET /api/daemon/sessions` 列表（origin 字段下发，🧾 徽标区分）；用户在该会话发首条消息 → `inject_session` 检测 `origin='tool_report'` 且未激活（无 lease 绑定）→ **自动懒激活**（机器：沿用平台既有派发自选语义——用户自有在线机优先+共享借用，D-010；provider：harness 映射 claude-code→claude、codex→codex、其他→默认 claude；cwd：最新 entry.agent_cwd 或 workspace.root_path；建 interactive lease + status→active，turn_count 置 1）→ 走既有 inject 派发链路；此后与普通会话完全同构。
- **FR-06（内容查看）**：`GET /api/agent-logs/{id}/content`——读库定位机器（会话 runtime 绑定优先，无则 workspace→member 绑定），经 daemon `host_fs.read_file` 读日志文件内容（截断上限 256KB，从尾部取）；路径不在 daemon `allowed_roots` → 409 中文友好错误（含配置指引）；机器离线 → 503 既有语义。
- **FR-07（前端展示）**：①列表：origin=tool_report 条目显示 🧾「本地 Agent」徽标 + harness chip + 自动标题，其余字段沿用；②tool_report 会话详情：日志条目渲染为**会话内容主体**（🧾 头像 + 气泡流：harness 徽标/session 短码复制/大小/活跃/调用次数/最近命令/路径复制/「查看内容」），底部正常输入框（placeholder 提示首条消息将派发）；③普通会话：对话流尾部保留**仅关联本会话**的折叠日志条目（同形态，默认收起一行摘要）。
- **FR-08（移除旧挂载）**：移除 session-panel 的 workspace 级 `streamFooter` AgentLogCard 挂载与 `listAgentLogs(workspaceId)` 工作区查询语义（AgentLogCard 改造为 `sessionId` 驱动）；`TurnTimeline.streamFooter` 注入口保留（通用能力，本次改传会话关联版条目）。
- **FR-09（类型同步）**：后端 schema 变更后同 change 内 `pnpm gen:types`。

## 非功能需求

- **NFR-01**：关联/建会话/激活全程 best-effort——任何失败不阻断 CLI run（客户端）与上报落库（服务端 entries 仍入库，仅无会话归属）。
- **NFR-02**：自动会话聚合防刷屏——同 (ws, harness, ctx) 恒一会话；无 ctx 单桶。
- **NFR-03**：双主题（blue/ai-native）与中文文案；Windows 路径兼容。
- **NFR-04**：既有会话列表/详情零回归（origin 缺省 'chat' 全兼容）。

## 验收标准

- pytest：协议 v2 字段（含/缺省）、关联命中与降级、聚合 find-or-create 幂等（重推同会话不重复建）、跨 harness 分组、懒激活（成功路径 + 无在线机器报错闭环）、内容端点（allowed_roots 外 409 / 离线 503 / 截断）。
- daemon/CLI 各自仓测试绿；三仓 lint/typecheck 过。
- 端到端：本机直跑 `sillyspec status` → 平台列表出现 🧾 会话 → 打开见条目 → 发消息成功派发并收到回复；daemon 会话内跑 sillyspec → 该会话尾部出现关联条目。
