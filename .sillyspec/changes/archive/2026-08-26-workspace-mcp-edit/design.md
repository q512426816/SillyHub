---
author: WhaleFall
created_at: 2026-08-26 13:40:00
updated_at: 2026-08-26 13:40:00
scale: large
modules: [backend_workspace, backend_daemon_api, sillyhub_daemon_mcp, frontend_workspace_mcp]
---

# 设计文档（Design）— 工作区 MCP 配置编辑与端到端注入

## 1. 背景

工作区「MCP 配置」页（`/workspaces/[id]/mcp`）当前为只读展示 `specDir/.mcp.json`（变更 2026-07-07-skills-mcp-management-ui 的 D-006 决策）。用户需要在该页面直接编辑配置。

调研发现两处断链（本变更一并修复）：

1. 后端只有只读接口 `GET /api/workspaces/{id}/mcp-config`（`backend/app/modules/workspace/router.py:383`），无写接口。
2. daemon 侧消费链路未接线：`sillyhub-daemon/src/mcp-config.ts` 头注释宣称「平台默认 + workspace 级 `.mcp.json` 按白名单过滤合并」，但实际 `fetchPlatformMcpConfig`/`loadPlatformMcpConfigFromBackend` 在 daemon 源码中**无任何调用方**，`mergeMcpConfigs` 仅用于合并平台内置 server（sillyhub-daemon / sillyhub-file）。`specDir/.mcp.json` 的唯一消费者是查看 API——即使能编辑，agent 也用不上（注释与实现不一致，违反仓库规则 18）。

## 2. 设计目标

- 工作区 MCP 配置页支持编辑（JSON 文本编辑形态）并保存到 `specDir/.mcp.json`
- daemon 创建会话时拉取「平台默认 + 白名单 + 工作区配置」三件套，合并注入 agent，端到端生效
- 密钥（env 中 secret 类值）全程不回传明文：GET 脱敏 `<set>`，PUT 保留 `<set>` 即不改。注意：平台级 settings 页**只有 GET 脱敏、PUT 原样存储**（无还原逻辑，`<set>` 字面量会写库）；「服务端还原真值」是本变更新设的机制，语义强于平台级（Grill CC-01）
- 仅允许 stdio 类型 server（沿用旧变更 2026-07-07 D-017 防 SSRF 安全边界）

## 3. 非目标（Non-Goals）

- 不做结构化表单编辑（逐字段表单），采用 textarea JSON 编辑（与平台级页一致）
- 不在工作区页管理白名单（白名单仍由 admin 在 设置 → MCP 维护；工作区页仅提示）
- 不支持 http/sse 远程 MCP server（安全边界，见 D-005）
- 不做配置版本历史/回滚、不做并发编辑冲突合并（last-write-wins，登记 R-06）
- 不改动 mcp_gateway 模块（对外 `/mcp/` HTTP 端点与 `.mcp.json` 注入链是两套独立机制）
- 不改 Codex 引擎路径（Codex 不消费 mcpServers，维持现状）

## 4. 拆分判断

三段（后端写接口 / daemon 注入 / 前端编辑 UI）强耦合：只做编辑无实际价值（配了不生效），只接 daemon 无工作区差异化配置来源。单变更内按 Wave 分波实现，不拆多变更、不走批量模式（非「模板×数据」重复任务）。

## 5. 总体方案

### Wave 1 后端（写接口 + daemon 配置接口扩展）

1. `PUT /api/workspaces/{workspace_id}/mcp-config`：权限 WorkspaceWriter（与 mcp-tokens 签发一致，`require_permission(Permission.WORKSPACE_WRITE)` + workspace 成员校验，参照 `mcp_gateway/router.py:114` 同模式）；pydantic 请求模型校验（仅 stdio、command 非空、args 字符串数组、env 字符串字典、拒绝未知字段）；`<set>` 还原（见接口定义）；原子写文件；审计上下文注入 `session.info["audit_context"]`；错误用中文 AppError。
2. `GET /api/daemon/mcp/config` 扩展：新增可选 query 参数 `workspace_id`，响应追加 `workspace: {mcpServers: {...}}`（读该工作区 `specDir/.mcp.json`，**不脱敏**——daemon 需要真值才能注入）；不带参数时响应与现状完全一致（向后兼容，daemon 旧版本忽略新字段）。
3. 跑 `pnpm gen:types` 重生成前端类型并提交（仓库规则 21）。

### Wave 2 daemon（预取 + 合并注入）

4. `mcp-config.ts` 新增 `fetchMcpBundle(serverUrl, token, workspaceId, logger)`：拉三件套；失败回落（platform → 本地 `~/.sillyhub/daemon/mcp.json`，workspace → 空配置），**任何失败不阻塞会话创建**（内置 server 照常注入）。
5. 会话创建路径预取：挂点为 `daemon.ts` `_startInteractiveSession`（唯一持有 `execPayload.workspaceId` 的位置；cli.ts 装配处是一次性启动动作、拿不到 workspaceId，Grill CC-04）：按 workspaceId 异步预取三件套存**会话级缓存**（形态：`Map<sessionId, McpBundle>`，create/restore/reload 三路 provider 调用共享；restore/reload 时缓存缺失则重取一次，仍失败回落空 bundle + warn，不静默永久丢失——Grill CC-05）；`mainAgentMcpConfigProvider` 保持同步签名，消费缓存。**覆盖范围（D-008，用户确认）**：工作区下所有会话（普通对话 + 主控 orchestrator）注入三件套合并结果；**分身（mission_worker）分支维持 2026-08-25-team-subsession-governance 的受限注入不变**（不并入三件套，不推翻该变更治理决策）；quick-chat/legacy shared 无 workspaceId 回落空 workspace 配置。前置验证任务：确认工作区会话的 `execPayload.workspaceId` 下发覆盖率（lease/context.py:586-591 现仅 tar 传输 + lease_meta.workspace_id 已写时携带，本机 SPEC_TRANSPORT=tar 满足），发现某类工作区会话不带则 backend 补齐下发。
6. 合并注入：`mergeMcpConfigs([...whitelist, DAEMON_MCP_SERVER_NAME, FILE_MCP_SERVER_NAME], platformCfg, workspaceCfg, {mcpServers: {内置 daemon/file server}})`——**内置 server 名必须并入白名单参数**（既有函数只把 `configs[0]` 即 platform 位自动入白名单，内置在第 4 位不会被自动放行，照抄会把内置剔除、破坏既有注入链，Grill CC-02）；同名时后者覆盖前者（工作区覆盖平台默认，内置最高防被覆盖）；白名单外的 workspace server 被剔除，`rejected` 返回值记 warn 日志（现状 cli.ts 未记，本变更接上）。
7. 修正 `mcp-config.ts` 头注释与实现不一致（规则 18）：更新为真实链路描述。

### Wave 3 前端（编辑 UI）

8. 页面双态：查看态保持现有卡片；「编辑」进入编辑态（textarea JSON + zod 校验 + 保存/取消），交互与视觉对照原型 `prototype-workspace-mcp-edit.html`。
9. 数据层：`workspace-skills-view.ts` 新增 `updateWorkspaceMcpConfig` fetch + `useUpdateWorkspaceMcpConfig` mutation，成功后 invalidate `workspaceMcpConfig.detail(workspaceId)`。
10. 编辑说明提示：`<set>` 语义 + 白名单生效条件（文案见接口定义章节的错误/提示约定）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/workspace/router.py | 新增 PUT `/workspaces/{workspace_id}/mcp-config` 端点（鉴权 + 调 service + 返回脱敏视图）。数据流：producer=前端编辑器 JSON → PUT body（`McpConfigUpdateRequest`）→ service 写文件+还原 secret → consumer=HTTP 响应（写后脱敏视图，前端直接渲染） |
| 修改 | backend/app/modules/workspace/skills_view_service.py | 新增 `update_mcp_config(workspace_id, payload, actor)`：校验/`<set>` 还原/原子写/审计；**请求/响应 pydantic 模型就近放本文件**（与现有 `McpConfigViewResponse:46` 同处，workspace/schema.py 留给跨 service 复用模型，Grill CC-07）；GET `get_mcp_config` 不动。数据流：`<set>` 还原源=磁盘现有 `.mcp.json` 同名 server 同名 env key 真值 → 写入文件明文 → daemon 经 Wave1-2 接口读真值 |
| 修改 | backend/app/modules/daemon/router.py | `get_daemon_mcp_config`（约 :4027）新增可选 query `workspace_id`，响应追加 `workspace` 字段；**新增不脱敏 raw 读法**（`_read_mcp_config_raw`：SpecPathResolver 定位后直读 `.mcp.json` 明文，不复用脱敏的 `SkillsViewService.get_mcp_config`）。数据流：producer=`specDir/.mcp.json` 明文 → daemon token 鉴权接口 → consumer=daemon `fetchMcpBundle`（注入 env 真值） |
| 修改 | backend/app/modules/daemon/tests/test_mcp_config_endpoint.py | 补 workspace_id 分支用例（有/无文件/无参数回归） |
| 新增 | backend/app/modules/workspace/tests/test_mcp_config_write.py | 写接口测试：权限/校验/secret 还原/原子写/审计/中文报错 |
| 修改 | sillyhub-daemon/src/mcp-config.ts | 新增 `fetchMcpBundle`（含 workspace 配置预净化：非 stdio 的 server **跳过 + warn，不抛错**——防存量/手改 `.mcp.json` 含 sse/http 条目时 `assertMcpServerType` 在会话创建路径抛错阻塞，Grill CC-03）；头注释修正为真实链路；类型扩展 `McpBundle {platform, whitelist, workspace}` |
| 修改 | sillyhub-daemon/src/daemon.ts | `_startInteractiveSession` 处按 `execPayload.workspaceId` 预取三件套写入会话级缓存（Grill CC-04：唯一持有 workspaceId 的挂点）；无 workspaceId（quick-chat/legacy shared）不预取，provider 回落空 workspace 配置。数据流：producer=backend daemon API → `fetchMcpBundle` 解析+预净化 → `Map<sessionId,bundle>` 缓存 → consumer=cli.ts provider 合并 → driverOpts.mcpServers（既有链路，`session-manager.ts:1495` 透传不改） |
| 修改 | sillyhub-daemon/src/cli.ts | `mainAgentMcpConfigProvider` 消费缓存：`mergeMcpConfigs([...whitelist, 内置名×2], platform, workspace, builtin)`；`rejected` 记 warn |
| 修改 | sillyhub-daemon/tests/mcp-config.test.ts（或就近新增 bundle 用例文件） | fetchMcpBundle 成功/回落/白名单剔除测试 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx | 双态改造（查看/编辑），zod 校验，保存/取消；对照原型 |
| 修改 | frontend/src/lib/workspace-skills-view.ts | 新增 `updateWorkspaceMcpConfig` + `useUpdateWorkspaceMcpConfig`（invalidate `workspaceMcpConfig.detail`） |
| 新增/修改 | frontend/src/lib/__tests__/workspace-mcp-edit.test.ts（及页面就近测试） | 校验与双态交互测试 |
| 生成 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types` 重生成并同 commit 提交（规则 21） |

## 7. 接口定义

### 7.1 PUT /api/workspaces/{workspace_id}/mcp-config

- 权限：`require_permission(Permission.WORKSPACE_WRITE)` + workspace 成员
- 请求体（`McpConfigUpdateRequest`）：

```json
{
  "mcpServers": {
    "context7": { "type": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp"] },
    "mysql_local": { "type": "stdio", "command": "npx", "args": ["-y", "pkg"], "env": { "MYSQL_PASSWORD": "<set>" } }
  }
}
```

- 校验规则：`mcpServers` 为对象；每项 `type` 缺省或必须 `"stdio"`（否则 `HTTP_422_MCP_TYPE_NOT_STDIO`「仅支持 stdio 类型（本地命令）的 MCP 服务器」）；`command` 非空字符串；`args` 字符串数组；`env` 字符串字典；未知顶层键拒绝（pydantic `extra="forbid"`）
- `<set>` 还原：请求中 env 值为 `"<set>"` 的键，从磁盘现有 `.mcp.json` 同名 server 同名键取真值；现有文件无该 server/键 → 报 `HTTP_422_MCP_SECRET_UNRESOLVABLE`「密钥占位符无法还原：server X 的 env Y，请重新输入明文」（不把 `<set>` 字符串写盘）
- 成功 200：返回写后配置的脱敏视图（与 GET 同构），前端保存后直接渲染
- 写文件：`ensure_ascii=False`、`indent=2`、末尾换行；临时文件 + `os.replace` 原子替换（Windows/Linux 通用）
- 审计：写操作注入 `audit_context`（actor/workspace），由既有 ORM 钩子落 `audit_logs`

### 7.2 GET /api/daemon/mcp/config（扩展）

- 现有：daemon token 鉴权，返回 `{platform_default: {mcpServers}, whitelist: []}`
- 扩展：可选 query `workspace_id`（UUID）；提供时响应追加 `"workspace": {"mcpServers": {...}}`（读 `specDir/.mcp.json` 明文，不脱敏；文件缺失/解析失败返回空 `{}`，不报错）
- 兼容性：不传 `workspace_id` 响应结构不变；旧 daemon 忽略新字段

### 7.3 daemon：fetchMcpBundle

```ts
export interface McpBundle {
  platform: McpConfig;        // 平台默认（失败回落本地 ~/.sillyhub/daemon/mcp.json）
  whitelist: string[];
  workspace: McpConfig;       // 失败/缺省回落 {mcpServers: {}}；预净化：非 stdio server 跳过+warn
}
export async function fetchMcpBundle(
  serverUrl: string, token: string | null,
  workspaceId?: string,       // 可选：quick-chat/legacy shared 无 workspaceId → workspace 为空配置
  logger?: McpConfigLogger,
): Promise<McpBundle>
```

### 7.4 前端提示文案约定

- 编辑态说明：「env 密钥值显示为 `<set>` 表示已脱敏，保留 `<set>` 保存即表示不修改该密钥」
- 白名单提示：「server 名需在平台白名单（设置 → MCP）中才会对 agent 生效，未放行的会在注入时被剔除」
- 过滤层级提示（Grill CC-06）：除白名单外，agent 画像（profile）若配置了 MCP 子集（mcpRefs），最终生效集还与其相交——「最终是否生效取决于 agent 画像的 MCP 配置」

## 7.5 生命周期契约

不涉及生命周期契约（本变更不新增/修改 session、lease、agent_run 的事件与状态流转；配置预取发生在既有 create session 流程内部，无新事件、无状态机变化）。

## 8. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 原子写跨平台差异（Windows `os.replace` 语义） | P1 | 临时文件写同目录后 `os.replace`；pytest 覆盖 Windows 本地跑通 |
| R-02 | `<set>` 还原失败（server 改名/键改名后旧值找不到） | P1 | 显式报中文错误让用户重输明文（见 7.1），绝不把 `<set>` 写盘 |
| R-03 | daemon 拉取失败导致会话创建被阻塞 | P0 | fetchMcpBundle 全链路容错回落（platform→本地文件，workspace→空），仅记 warn；内置 server 注入不受影响 |
| R-04 | gen:types 引入无关 diff / node_modules 半坏假报错 | P2 | 按规则 21/36 流程：先 `pnpm exec tsc --version` 探健康 |
| R-05 | 白名单外 server 被静默剔除，用户以为生效 | P2 | 前端保存提示（7.4）+ daemon warn 日志（既有 rejected 机制） |
| R-06 | 并发保存 last-write-wins 覆盖 | P2 | 当前团队规模可接受；登记不解决（非目标） |
| R-07 | 旧版 daemon 配对新版 backend（或反之） | P2 | daemon API 响应只加字段不改字段；daemon 旧版忽略 workspace 字段自然回落 |
| R-08 | secret 明文出现在 daemon API 响应中；且扩展 workspace_id 后任一 daemon 凭据可读任意 workspace 明文 | P1 | 该接口 daemon token 鉴权（与 lease 同源凭据），非浏览器可达。scope 取舍（Grill CC-09）：当前为单一 daemon 部署形态，daemon 凭据本就有全量工作区访问权，不因本变更实质扩大攻击面；per-workspace daemon 凭据收敛登记为已知边界，不在本变更做 |

## 9. 决策追踪

见 `decisions.md`。当前版本决策与覆盖关系（v2 均为 Design Grill 修正版，supersedes 对应 v1）：

- D-001@v1（页面可编辑，推翻旧变更 D-006）→ §5 Wave 3 / FR-01
- D-002@v1（textarea JSON 编辑形态）→ §5.8 / FR-01
- D-003@v2（`<set>` 服务端还原本变更新设，非平台级先例）→ §7.1 / FR-03
- D-004@v1（daemon 经扩展 API 拉三件套，方案 A）→ §5.4-6 / FR-04
- D-005@v2（后端拒绝写入 + daemon 预净化跳过）→ §7.1/§7.3 / FR-02
- D-006@v2（注入优先级 builtin > workspace > platform；内置名并入白名单参数）→ §5.6 / FR-04
- D-007@v2（预取挂点 daemon.ts _startInteractiveSession + 会话级缓存）→ §5.5 / FR-04
- D-008@v1（覆盖范围：工作区普通/主控会话，分身除外）→ §5.5 / FR-04

未解决/遗留：分身（mission_worker）的工作区 MCP 注入受 2026-08-25-team-subsession-governance 治理约束，其放开另立变更评估（非本变更阻塞项）。

## 10. 自审（Self-Review）

- 章节齐全：背景/目标/非目标/拆分/方案/清单/接口/风险/决策/自审 ✅
- 生命周期关键词（session/daemon）命中 → 已写紧邻豁免短语（§7.5）✅
- 文件清单含对外字段变动（PUT body / daemon API 响应）→ 已按 producer→consumer 标注数据流 ✅
- 前端文件达到「建议生成」原型级别 → 原型 `prototype-workspace-mcp-edit.html` 已存在 ✅
- ~~自审存疑 1（schema.py 位置）~~：Grill CC-07 已定夺——就近 skills_view_service.py（与 McpConfigViewResponse 同处）
- ~~自审存疑 2（预取挂点）~~：Grill CC-04 已定夺——daemon.ts `_startInteractiveSession`（cli.ts 装配处拿不到 workspaceId）
- Design Grill（step 7）修正已并入：CC-01 `<set>` 还原语义定位、CC-02 内置 server 并入白名单参数、CC-03 预净化、CC-04 挂点/清单/可选 workspaceId、CC-05 缓存形态、CC-06 mcpRefs 提示、CC-07 模型放置、CC-09 R-08 取舍 ✅
- quick-chat/无 workspaceId 会话的边界 → D-008（用户确认后定稿）
