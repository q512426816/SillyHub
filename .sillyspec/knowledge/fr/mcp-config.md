## FR-mcp-config-001 工作区 MCP 配置页可编辑
变更：2026-08-26-workspace-mcp-edit
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户是工作区 Writer 且打开 `/workspaces/[id]/mcp` 页 编辑态 JSON 存在语法错误或结构不合法（顶层无 `mcpServers；When 点击「编辑」进入编辑态、修改 JSON、点击保存且校验通过 点击保存 尝试调 PUT 接口；Then 调 `PUT /api/workspaces/{id}/mcp-config` 成功，页面回到查看态并展示写后配置 前端 zod 校验拦截，中文报错并定位到 s
全文：.sillyspec/changes/archive/2026-08-26-workspace-mcp-edit/requirements.md#FR-01
最近确认：45e05dbbb

## FR-mcp-config-002 仅允许 stdio 类型
变更：2026-08-26-workspace-mcp-edit
状态：active
摘要：默认场景
依据决策：D-005@v2
场景正文：
- 场景：默认场景 — Given 请求体某 server 的 `type` 为 `sse`/`http` 或其它非 `stdio` 值 daemon 拉取的工作区配置含非 stdio serve；When 调 PUT `fetchMcpBundle` 解析；Then 后端 `HTTP_422_MCP_TYPE_NOT_STDIO`（中文报错）拒绝整个请求，文件不落盘 该 server 被跳过并记 warn，不抛错、不阻塞会话
全文：.sillyspec/changes/archive/2026-08-26-workspace-mcp-edit/requirements.md#FR-02
最近确认：45e05dbbb

## FR-mcp-config-003 密钥 `<set>` 占位符往返
变更：2026-08-26-workspace-mcp-edit
状态：active
摘要：默认场景
依据决策：D-003@v2
场景正文：
- 场景：默认场景 — Given 现有 `.mcp.json` 某 env 键为密钥类且 GET 已脱敏为 `<set>` PUT 请求中某 `<set>` 键在磁盘现有文件中找不到对应真值（s；When PUT 请求中该键值保持 `<set>` 调 PUT；Then 后端从磁盘现有文件同名 server 同名键还原真值写入，响应中该键仍显示 `<set>` 后端 `HTTP_422_MCP_SECRET_UNRESOLVAB
全文：.sillyspec/changes/archive/2026-08-26-workspace-mcp-edit/requirements.md#FR-03
最近确认：45e05dbbb

## FR-mcp-config-004 daemon 端到端注入
变更：2026-08-26-workspace-mcp-edit
状态：active
摘要：默认场景
依据决策：D-004@v1、D-006@v2、D-007@v2、D-008@v1
场景正文：
- 场景：默认场景 — Given 工作区会话（普通/主控，`execPayload.workspaceId` 存在） 某 workspace server 名不在平台白名单 三件套拉取失败（ba；When daemon `_startInteractiveSession` 创建会话 合并注入 创建会话 provider 取缓存 创建会话；Then 预取三件套（平台默认+白名单+工作区配置），provider 以 `mergeMcpConfigs([...whitelist, DAEMON_MCP_SERV
全文：.sillyspec/changes/archive/2026-08-26-workspace-mcp-edit/requirements.md#FR-04
最近确认：45e05dbbb

## FR-mcp-config-005 daemon API 向后兼容扩展
变更：2026-08-26-workspace-mcp-edit
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given daemon 调 `GET /api/daemon/mcp/config` 不带 `workspace_id` 带 `workspace_id` 且该工作区 `；When 响应 响应；Then 结构与现状完全一致（`{platform_default, whitelist}`） 追加 `workspace: {mcpServers: {...}}`（明
全文：.sillyspec/changes/archive/2026-08-26-workspace-mcp-edit/requirements.md#FR-05
最近确认：45e05dbbb
