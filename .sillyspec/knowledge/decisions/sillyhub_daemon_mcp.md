# 决策知识 — sillyhub_daemon_mcp

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-004@v1 daemon 经扩展 API 拉取三件套（方案 A）
状态：implemented
变更：2026-08-26-workspace-mcp-edit
锚点：backend/app/modules/daemon/router.py:4027
最近确认：c81db1ea
理由：扩展 GET /api/daemon/mcp/config 支持 workspace_id，返回 platform_default + whitelist + workspace；daemon 会话创建时预取缓存，mergeMcpConfigs 合并注入。

## D-006@v2 内置 server 名并入白名单参数（调用形式修正）
状态：implemented
变更：2026-08-26-workspace-mcp-edit
锚点：sillyhub-daemon/src/cli.ts（provider merge 调用）
最近确认：c81db1ea
理由：会。既有 mergeMcpConfigs 只把 configs[0]（platform 位）自动入白名单，内置 server 在第 4 位不放行。修正调用：mergeMcpConfigs([...whitelist, DAEMON_MCP_SERVER_NAME, FILE_MCP_SERVER_NAME], platform, workspace, builtin)；同时把 rejected 剔除记 warn 接上（现状 cli.ts 未记）。优先级语义与 v1 相同：builtin > workspace > platform。
supersedes：D-006@v1

## D-007@v2 预取挂点定稿 daemon.ts _startInteractiveSession
状态：implemented
变更：2026-08-26-workspace-mcp-edit
锚点：sillyhub-daemon/src/daemon.ts（_startInteractiveSession）
最近确认：c81db1ea
理由：daemon.ts _startInteractiveSession（唯一持有 execPayload.workspaceId 的位置，lease/context.py:586-591 仅 tar 传输且 lease_meta.workspace_id 已写时携带）。缓存形态 Map<sessionId, McpBundle>；restore/reload 缓存缺失重取一次，失败回落空 bundle + warn。provider 保持同步签名消费缓存（v1 结论不变）。
supersedes：D-007@v1

## D-008@v1 工作区 MCP 注入覆盖范围：工作区下所有普通/主控会话，分身除外
状态：implemented
变更：2026-08-26-workspace-mcp-edit
锚点：sillyhub-daemon/src/cli.ts（isMainAgentSession 谓词）
最近确认：c81db1ea
理由：工作区下所有普通对话与主控（orchestrator）会话注入三件套合并结果；分身（mission_worker）维持既有受限注入（不推翻 2026-08-25-team-subsession-governance 治理决策，其放开另议）；quick-chat/legacy shared 无 workspaceId 只用平台默认+内置。
