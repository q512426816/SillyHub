---
author: qinyi
created_at: 2026-08-26 14:05:00
---
# 提案书（Proposal）

## 动机

工作区「MCP 配置」页（`/workspaces/[id]/mcp`）当前只读（旧变更 2026-07-07 D-006），用户无法在平台上为工作区配置 MCP 服务器；且调研发现 daemon 侧消费链路从未接线——即使手改文件配好，agent 也用不上。本变更让工作区 MCP 配置「可编辑 + 端到端生效」。

## 关键问题

1. **无编辑入口**：`.mcp.json` 唯一写法是直接改服务器文件（`C:\data\spec-workspaces\<id>\.mcp.json`），对平台用户不可用；页面明示「只读，无编辑按钮」。
2. **配置不生效（断链）**：daemon 的 `fetchPlatformMcpConfig`/`loadPlatformMcpConfigFromBackend` 无任何调用方，`mergeMcpConfigs` 只合并平台内置 server；`specDir/.mcp.json` 的唯一消费者是查看 API——配置与注入之间整条链路缺失（`mcp-config.ts` 头注释与实现不一致，违反仓库规则 18）。
3. **secret 安全语义缺失**：平台级 settings 页 PUT 是「原样存储」（`<set>` 占位符会字面量写库），工作区配置含密钥时若沿用该语义，脱敏占位符会破坏真实凭据。

## 变更范围

- 后端：新增 `PUT /api/workspaces/{id}/mcp-config`（校验/`<set>` 服务端还原/原子写/审计）；扩展 `GET /api/daemon/mcp/config` 支持 `workspace_id` 维度（新增不脱敏 raw 读法）
- daemon：`fetchMcpBundle` 拉三件套（含非 stdio 预净化）；`daemon.ts` `_startInteractiveSession` 预取 + 会话级缓存；provider 合并注入（内置名并入白名单参数）
- 前端：页面双态改造（查看/编辑 textarea JSON + zod 校验 + 保存提示）；mutation 与缓存失效；重生成 `api-types.ts`

## 不在范围内（Non-Goals）

- 不做结构化表单编辑（逐字段表单）
- 不在工作区页管理白名单（仍由 admin 在 设置 → MCP 维护）
- 不支持 http/sse 远程 MCP server（防 SSRF，安全边界不放松）
- 不做配置版本历史/回滚、并发编辑冲突合并（last-write-wins）
- 不改 mcp_gateway 对外 `/mcp/` HTTP 端点（与注入链是两套机制）
- 不改 Codex 引擎路径；分身（mission_worker）注入维持 2026-08-25-team-subsession-governance 治理不变

## 成功标准（可验证）

- 旧配置默认行为不变：不带 `workspace_id` 的 daemon API 响应结构不变；无 `.mcp.json` 的工作区会话注入结果与现状一致（内置 server 照常）
- 新功能可用：页面编辑保存 → `.mcp.json` 落盘（密钥不明文回显）→ 工作区新会话启动时配置的三件套合并结果注入 agent（可用日志/测试断言验证）
- secret 安全：GET/PUT 响应中密钥值恒为 `<set>`；`<set>` 绝不写盘；还原失败显式中文报错
- 回归：后端/daemon/前端既有测试全绿
