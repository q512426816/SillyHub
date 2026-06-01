---
author: qinyi
created_at: 2026-05-30T20:50:00
---

# Design — Tool Gateway 通用化

## 架构决策

### AD-1: Policy-Driven Dispatch
- **决策**：新建独立 `tool_policies` 表，AgentRun 通过 FK 关联
- **理由**：规范化存储、多 run 共享 policy、便于 CRUD 管理
- **Trade-off**：多一次 DB 查询（可接受，policy 不大且可缓存）

### AD-2: Handler + Policy 分层
- **决策**：ToolPolicyService.check() 集中校验，handler 专注执行
- **理由**：单一职责，新增 tool type 只需加 handler + policy 字段
- **Trade-off**：check 和 handler 需要协调参数（通过 policy 对象传递）

### AD-3: 审计双写
- **决策**：同时写 ToolOperationLog（详细操作日志）和 AuditLog（平台审计）
- **理由**：ToolOperationLog 保留工具级细节，AuditLog 接入平台审计链
- **Trade-off**：写放大 2x，但 append-only 日志写入开销可接受

### AD-4: run_tests 结构化封装
- **决策**：封装 shell 执行 pytest/go test，解析输出为结构化 JSON
- **理由**：Agent 需要知道 pass/fail/skip 数量和失败列表，纯文本输出不够
- **Trade-off**：依赖测试框架输出格式，新增框架需新增解析器

### AD-5: http_get 白名单域名
- **决策**：每个 ToolPolicy 配置 allowed_domains 列表
- **理由**：不同 workspace 可能需要访问不同的外部服务
- **Trade-off**：初始配置需要人工维护，但比全局白名单更灵活

## 文件变更清单

### 新增文件
| 文件 | 说明 |
|------|------|
| `app/modules/tool_gateway/tool_policy.py` | ToolPolicy 模型 + ToolPolicyService |
| `app/modules/tool_gateway/policy_schema.py` | Policy CRUD Pydantic schemas |
| `app/modules/tool_gateway/policy_router.py` | Policy CRUD API 端点 |
| `migrations/versions/xxx_add_tool_policies.py` | Alembic 迁移 |
| `tests/modules/tool_gateway/` | 测试目录 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `app/modules/tool_gateway/service.py` | 新增 run_tests/http_get handler，集成 policy check + 审计双写 |
| `app/modules/tool_gateway/schema.py` | tool_type 新增 run_tests/http_get |
| `app/modules/tool_gateway/model.py` | ToolOperationLog.tool_type 长度调整 |
| `app/modules/agent/model.py` | AgentRun 新增 tool_policy_id FK |
| `app/main.py` | 注册 policy_router |

## 数据模型

### 新增表: tool_policies

```sql
CREATE TABLE tool_policies (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    allowed_tools JSONB NOT NULL DEFAULT '["file_read","file_write","file_list","file_search","shell_exec","run_tests","http_get"]',
    blocked_commands JSONB DEFAULT '[]',
    allowed_paths JSONB DEFAULT '["."]',
    allowed_domains JSONB DEFAULT '[]',
    max_timeout INTEGER NOT NULL DEFAULT 30,
    max_output_size INTEGER NOT NULL DEFAULT 64000,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE(workspace_id, name)
);
CREATE INDEX ix_tool_policy_workspace ON tool_policies(workspace_id);
```

### 修改表: agent_runs

```sql
ALTER TABLE agent_runs ADD COLUMN tool_policy_id UUID REFERENCES tool_policies(id) ON DELETE SET NULL;
```

## API 设计

### 工具执行（已有，扩展）

```
POST /api/worktrees/{lease_id}/tools
  Request: { tool_type: "run_tests"|"http_get"|..., params: {...} }
  Response: ToolExecuteResponse (id, tool_type, result_code, redacted_output, timestamp)
```

### run_tests params

```json
{
  "runner": "pytest",           // pytest | go_test | cargo_test
  "args": ["-x", "--tb=short"],
  "path": "tests/",
  "timeout": 60
}
```

### http_get params

```json
{
  "url": "https://api.github.com/repos/...",
  "headers": {"Accept": "application/json"},
  "timeout": 10
}
```

### Policy CRUD（新增）

```
POST   /api/workspaces/{workspace_id}/tool-policies       → ToolPolicyRead
GET    /api/workspaces/{workspace_id}/tool-policies       → list[ToolPolicyRead]
GET    /api/workspaces/{workspace_id}/tool-policies/{id}  → ToolPolicyRead
PATCH  /api/workspaces/{workspace_id}/tool-policies/{id}  → ToolPolicyRead
DELETE /api/workspaces/{workspace_id}/tool-policies/{id}  → 204
```

## 兼容策略

- AgentRun.tool_policy_id 可为 NULL → 使用 default_policy()（运行时对象，不存 DB）
- 默认策略：允许所有 7 种 tool_type，保留全局安全限制
- 现有 API 不变更，只扩展 tool_type 枚举
- ToolOperationLog.tool_type 列宽从 30 调整到 50（兼容新 tool_type 名称）

## 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 测试框架输出格式变化 | 中 | 低 | 解析器容错，解析失败回退原始输出 |
| http_get SSRF | 低 | 高 | 严格域名白名单 + 禁止内网 IP |
| 审计双写性能 | 低 | 中 | append-only，异步刷写 |
| run_tests 长时间运行 | 中 | 中 | 超时限制 + 输出截断 |

## 自审

- ✅ 与现有 git_gateway 无耦合，保持独立
- ✅ 复用 validate_path、validate_shell_command、redact_output
- ✅ 遵循 feature-slice 约定 (model/schema/service/router)
- ✅ 新增 policy 子模块在 tool_gateway 内，不新建顶层模块
- ✅ 测试覆盖路径逃逸、命令黑名单、域名白名单、超时、审计双写
