# 接入指南（Getting Started）

本篇带你从零把第三方 MCP client 接到 SillyHub 对外 MCP 服务。完成后你就能在 client 里
直接调 8 个 tool。

## 前置：URL 与 token

接入需要两样东西：

| 项 | 值 | 说明 |
| --- | --- | --- |
| MCP URL | `https://<host>/mcp/` | **必须带尾斜杠**。缺尾斜杠会被 307 重定向，而多数 MCP client 的 POST 不跟随 307，会报 `Redirect response '307'` |
| McpToken | `shmcp_...` | workspace 级长期凭证，明文只在签发时返回一次 |

`<host>` 是部署 SillyHub 后端的地址（本地开发见 [security.md](security.md) 的隧道方案）。

### 拿一个 McpToken

McpToken 由 workspace owner/admin 通过**管理 API**（`/api`，平台用户身份，非 McpToken）
签发：

```http
POST /api/workspaces/{workspace_id}/mcp-tokens
Authorization: Bearer <平台用户 JWT>
Content-Type: application/json

{
  "name": "my-orchestrator",
  "scope": ["read", "dispatch", "converge"]
}
```

201 响应（**明文 token 只出现这一次，立即保存，之后无法找回**）：

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "token": "shmcp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "name": "my-orchestrator",
  "scope": ["read", "dispatch", "converge"],
  "created_at": "2026-08-06T14:00:00Z"
}
```

`scope` 决定这个 token 能调哪些 tool（对应关系见 [security.md](security.md)）。按需
最小授权：只看不派就只给 `read`。

## 三端配置示例

下面三端的 URL 与 Bearer token 写法可直接复制，把 `<host>` 和 `shmcp_...` 换成你的值。

### Claude Desktop

编辑 `claude_desktop_config.json`（Windows：
`%APPDATA%\Claude\claude_desktop_config.json`；macOS：
`~/Library/Application Support/Claude/claude_desktop_config.json`），在 `mcpServers`
里加：

```json
{
  "mcpServers": {
    "sillyhub": {
      "type": "http",
      "url": "https://<host>/mcp/",
      "headers": {
        "Authorization": "Bearer shmcp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
      }
    }
  }
}
```

保存后重启 Claude Desktop。

### Claude Code

在项目根（或 `~/.claude.json` 用户级）的 `.mcp.json` 里加：

```json
{
  "mcpServers": {
    "sillyhub": {
      "type": "http",
      "url": "https://<host>/mcp/",
      "headers": {
        "Authorization": "Bearer shmcp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
      }
    }
  }
}
```

或用 CLI 注册（把 URL 与 token 换好）：

```bash
claude mcp add --transport http sillyhub https://<host>/mcp/ \
  --header "Authorization: Bearer shmcp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

### Cursor

在 Cursor 的 MCP 配置（Settings → MCP，或项目 `.cursor/mcp.json`）里加：

```json
{
  "mcpServers": {
    "sillyhub": {
      "type": "http",
      "url": "https://<host>/mcp/",
      "headers": {
        "Authorization": "Bearer shmcp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
      }
    }
  }
}
```

## 验证连通

配好后，client 会做 MCP `initialize` 握手（协议版本 `2025-11-25`）。成功即可在
tools 列表看到 8 个 tool：

`list_agent_profiles` / `create_mission` / `dispatch_worker` / `list_workers` /
`get_worker_result` / `get_run_logs` / `converge_mission` / `report_progress`

如果连不上，按顺序排查：

1. URL 是否带尾斜杠（`/mcp/` 不是 `/mcp`）。
2. `Authorization` header 是否是 `Bearer shmcp_...`（注意 `Bearer ` 后有一个空格）。
3. token 是否被吊销 / 拼错——无 token、坏 token、已吊销 token 都会 401。
4. 本地开发时 `<host>` 是否走通了隧道（见 [security.md](security.md)）。

## 一个典型编排流程

```
list_agent_profiles            # 选 agent 档案，拿到能力摘要
create_mission                 # 建 mission，返回 mission_id + main_run_id
dispatch_worker                # 派 worker（可多次，拆子任务）
list_workers / get_run_logs    # 跟进状态与日志
get_worker_result              # 读 worker 结构化产出
converge_mission               # 收敛（合并分支，可重入解冲突）
```

每个 tool 的完整 input / output 字段见 [tools-reference.md](tools-reference.md)。想被动
收 worker 终态推送，用 [webhooks.md](webhooks.md)；想实时看 mission 进度，用
[sse.md](sse.md)。
