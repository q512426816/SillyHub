---
author: qinyi
created_at: 2026-08-23 12:20:00
---

# 提案书（Proposal）— 工具上报 Agent 日志会话化（agent-activity-sessions）

## 动机

上一变更（2026-08-23-platform-agent-log-ingest）打通了「sillyspec CLI 主动上报本地 agent 日志 → 平台落库 → 会话页展示」，但展示形态是「挂在会话尾部的 workspace 级面板」：按工作区一把抓，与具体会话无关联；用户在平台外（本机终端）跑的 sillyspec 上报，在平台上没有任何会话承载，看不见也管不了。用户诉求：**平台要能管理全部的工具和 agent 信息**——上报的日志应该成为平台会话体系的一等公民。

## 关键问题

1. **关联错位**：平台会话中 agent 调 sillyspec 时，上报日志应归到**那个会话**名下并在其对话内容中展示；现在按 workspace 一把抓展示在任意会话尾部。
2. **无承载**：本机直跑 sillyspec（无平台会话）的上报没有会话承载——平台上看不到这类 agent 活动。
3. **不可继续**：即使看到了，也没有入口基于这些活动继续工作（发消息/派发）。

## 变更范围（跨三仓，用户四点拍板）

- **sillyspec CLI 仓**：上报协议增上下文字段——`hub_session_id`（daemon 注入的 env `SILLYHUB_SESSION_ID`，平台会话关联键）、`change_key` / `quick_id`（聚合区分键，run 上下文可得）；协议文档更新 + 测试。
- **sillyhub-daemon 仓**：spawn agent 进程时注入 `SILLYHUB_SESSION_ID=<agent_sessions.id>`（`buildSpawnEnv` 单点，先例 `MCP_SESSION_ID`）。
- **本仓 backend**：`platform_agent_logs` 增会话关联列；`agent_sessions` 增 `origin` 类型列；无关联上报按 **(workspace, harness, change_key|quick_id)** find-or-create「本地 Agent 会话」（origin=tool_report）；该类会话可继续——inject 检测到未激活 tool_report 会话自动**懒激活**（绑机器/建 lease/转 active）后走既有派发链路；新增日志内容读取端点（daemon `host_fs.read_file`）。
- **本仓 frontend**：会话列表新类型徽标（🧾 本地 Agent + harness + 变更名标题）；tool_report 会话详情把日志条目渲染为**会话内容**（🧾 头像气泡流）+ 继续输入框；普通会话尾部保留**仅关联本会话**的折叠日志条目；**移除** workspace 级流内条目挂载。

## 非目标（Non-Goals）

- **不把日志内容入库**：库只存元信息；内容按需经 daemon 读本地文件（allowed_roots 约束内，超出给友好提示）。
- **不做底层 CLI 会话的真 resume**（把平台会话直接恢复到 agent 本地会话现场）：provider 限 claude/codex 且需 SDK key+cwd 匹配机器，列二期增强；本期「继续」= 在该会话里正常派发新 run，历史日志条目保留在对话流中。
- **不改上报的鉴权/best-effort 语义**（shpsync_ token、失败静默降级）。
- **不做 TTL/清理**（沿用上一变更口径）。

## 风险

- `host_fs.read_file` 受 daemon `allowed_roots` 白名单约束，`~/.zcode`、`~/.codex` 等家目录日志大概率不在白名单内——内容查看能力覆盖面受限，设计上以友好错误呈现并留配置指引（R-04）。
- 自动会话数量：聚合键含 change/quick，长期变更多则历史会话多——与会话列表同量级，可接受；无 ctx 时回落 ws+harness 单桶防刷屏。
- inject 自动激活复用既有派发链路，需防御 tool_report 会话无可用机器（离线）时的报错闭环（中文提示）。
