# 决策知识 — backend_daemon_api

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-004@v1 daemon 经扩展 API 拉取三件套（方案 A）
状态：implemented
变更：2026-08-26-workspace-mcp-edit
锚点：backend/app/modules/daemon/router.py:4027
最近确认：c81db1ea
理由：扩展 GET /api/daemon/mcp/config 支持 workspace_id，返回 platform_default + whitelist + workspace；daemon 会话创建时预取缓存，mergeMcpConfigs 合并注入。

## D-008@v1 工作区 MCP 注入覆盖范围：工作区下所有普通/主控会话，分身除外
状态：implemented
变更：2026-08-26-workspace-mcp-edit
锚点：sillyhub-daemon/src/cli.ts（isMainAgentSession 谓词）
最近确认：c81db1ea
理由：工作区下所有普通对话与主控（orchestrator）会话注入三件套合并结果；分身（mission_worker）维持既有受限注入（不推翻 2026-08-25-team-subsession-governance 治理决策，其放开另议）；quick-chat/legacy shared 无 workspaceId 只用平台默认+内置。
