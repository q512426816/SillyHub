---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# spec_workspace
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/spec_workspace/**

## 职责

管理 workspace 与 SillySpec 规范空间的关联（spec_root 目录、同步策略、验证、bootstrap 初始化）。是连接 workspace 模块与 SillySpec 文件系统的桥梁。

## 当前设计

```
router.py     ── HTTP 入口，挂载到 /workspaces/{workspace_id}/spec-workspace
service.py    ── SpecWorkspaceService，CRUD + import/sync
bootstrap.py  ── SpecBootstrapService，初始化 spec 目录（调用 agent）
validator.py  ── SpecValidator，验证 spec 目录结构、YAML schema、引用完整性
model.py      ── SpecWorkspace (SQLModel table)
schema.py     ── Pydantic DTOs（SpecWorkspaceCreate / Read / Update / SyncStatusUpdate）
tests/        ── test_bootstrap.py / test_validator.py
```

三种策略（strategy）：
- `platform-managed`：spec 仅存在于 spec_root（默认）
- `repo-mirrored`：spec_root 与 repo 内 `.sillyspec` 双向同步
- `repo-native`：repo 自身 `.sillyspec` 为 source of truth，spec_root 作为缓存

## 对外接口（表格）

| 方法 | 路径 | 说明 | 返回类型 |
|------|------|------|----------|
| GET | `/workspaces/{workspace_id}/spec-workspace` | 获取 spec workspace 信息 | `SpecWorkspaceRead` |
| POST | `/workspaces/{workspace_id}/spec-workspace/import` | 从 repo 导入 spec | `SpecWorkspaceRead` |
| POST | `/workspaces/{workspace_id}/spec-workspace/sync` | 触发双向同步 | `SpecWorkspaceRead` |
| PATCH | `/workspaces/{workspace_id}/spec-workspace` | 更新 spec workspace 配置 | `SpecWorkspaceRead` |
| POST | `/workspaces/{workspace_id}/spec-workspace/bootstrap` | 执行 bootstrap 初始化 | `dict` |
| GET | `/workspaces/{workspace_id}/spec-conflicts` | 列出 spec 冲突 | `SpecConflictListResponse` |
| POST | `/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve` | 解决冲突 | `dict` |

所有端点需要认证 + `require_permission`。

## 关键数据流

1. **create**：创建 SpecWorkspace 行，自动生成 spec_root 路径
2. **import_from_repo**：从 repo 的 `.sillyspec` 目录读取文件到 spec_root
3. **sync**：根据 strategy 执行双向/单向同步，更新 `sync_status` 和 `last_synced_at`
4. **bootstrap**：
   - 获取 workspace + spec_workspace
   - 调用 `SpecValidator.validate()` 验证目录
   - 调用 `ClaudeCodeAdapter` agent 执行初始化
   - 验证失败时创建 `SpecConflict` 记录并设置 `sync_status=dirty`
   - 记录 `AgentRun` / `AgentRunLog` / `AuditLog`
5. **validator**：三级检查（目录结构 -> YAML schema 字段 -> 引用完整性），输出 `ValidationReport`

## 设计决策（表格）

| 决策 | 原因 |
|------|------|
| 三种策略模式 | 不同项目有不同的 spec 管理方式 |
| workspace_id 唯一索引 | 每个 workspace 只有一个 spec_workspace（1:1） |
| Bootstrap 使用 agent | 初始化需要智能填充默认文件 |
| 验证失败不阻断 | 记录冲突，允许后续手动解决 |
| sync_status 状态机 | clean/dirty/conflicted 跟踪同步健康度 |

## 依赖关系

- `app.core.auth_deps` — require_permission
- `app.core.config` — get_settings
- `app.core.db` — get_session
- `app.core.errors` — SpecWorkspaceNotFound, SpecConflictNotFound
- `app.core.logging` — get_logger
- `app.modules.agent.adapters.claude_code` — ClaudeCodeAdapter
- `app.modules.agent.base` — AgentSpecBundle
- `app.modules.agent.model` — AgentRun, AgentRunLog
- `app.modules.auth.model` — User
- `app.modules.auth.permissions` — Permission
- `app.modules.spec_profile.model` — SpecConflict
- `app.modules.spec_profile.schema` — SpecConflictListResponse
- `app.modules.workflow.model` — AuditLog
- `app.modules.workspace.model` — Workspace

## 注意事项

- Bootstrap 是异步操作，涉及 agent 调用，耗时较长
- `SpecValidator` 是纯同步文件系统检查，可在无数据库环境下独立使用
- 冲突解决后不会自动重新验证，需要再次调用 bootstrap

## 变更索引（表格，初始为空）

| 变更ID | 日期 | 改动摘要 |
|--------|------|----------|
