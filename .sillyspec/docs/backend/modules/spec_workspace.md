---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# spec_workspace — Spec workspace 管理

> 最后更新：2026-06-02
> 最近变更：2026-06-02-spec-bootstrap-agent-stream-interaction
> 模块路径：`app/modules/spec_workspace/**`

## 职责

管理每个 workspace 对应的 spec 空间。提供 spec workspace 的 CRUD、导入/同步（stub）、**异步 bootstrap（通过 AgentRun + ClaudeCodeAdapter 后台执行）** 以及 spec conflict 的列表和解决。本模块是 spec 体系的核心协调层。

## 当前设计（架构 + 关键逻辑）

### 架构

- **Router** — 7 个端点（4 个 spec workspace + 1 个 bootstrap + 2 个 conflict）
- **Service** — `SpecWorkspaceService`：CRUD + sync status
- **BootstrapService** — `SpecBootstrapService`：创建 AgentRun 记录、构造 bootstrap 专用 `AgentSpecBundle`，通过后台 `ClaudeCodeAdapter.run_with_bundle()` 异步执行 `sillyspec init` + `sillyspec run scan`，完成后 `SpecValidator` 验证收尾
- **Validator** — `SpecValidator`：验证 `.sillyspec` 目录结构和内容

### 数据模型

**spec_workspaces 表**（`SpecWorkspace`）：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | UUID (PK) | uuid4 | 主键 |
| workspace_id | UUID (FK→workspaces) | — | 关联 workspace（唯一） |
| spec_root | Text | — | spec 根目录绝对路径 |
| strategy | String(30) | `platform-managed` | 管理策略 |
| repo_sillyspec_path | Text \| None | None | 仓库内 .sillyspec 路径 |
| profile_version | String(50) | `0.1.0` | profile 版本 |
| sync_status | String(20) | `clean` | 同步状态 |
| last_synced_at | DateTime \| None | None | 最后同步时间 |
| created_at | DateTime | utcnow | 创建时间 |
| updated_at | DateTime | utcnow | 更新时间 |

- 策略类型：`platform-managed` / `repo-mirrored` / `repo-native`
- 同步状态：`clean` / `dirty` / `conflicted`

### Bootstrap 流程

`SpecBootstrapService.bootstrap()` 异步执行流程：

1. 加载 SpecWorkspace + Workspace 记录
2. 确保 spec_root 目录存在
3. 创建 AuditLog（start）
4. 创建 AgentRun(status=pending, agent_type="claude_code")
5. 创建 AgentRunWorkspace（M:N 关联 run 和 workspace）
6. 更新 AgentRun 状态为 running
7. 返回 agent_run_id + stream_url + status（立即返回，不等待执行完成）
8. 后台任务：构造 bootstrap 专用 AgentSpecBundle
   - task_key="spec-bootstrap"
   - task_title="Bootstrap spec workspace"
   - proposal/task_markdown 包含 init、scan、验证步骤
   - allowed_paths=[spec_root, code_root]
   - available_tools=["sillyspec"]
   - platform_metadata={"bootstrap": True, "workspace_id": ...}
9. 后台任务：ClaudeCodeAdapter.run_with_bundle() 执行
10. 后台任务：SpecValidator.validate(spec_root) 验证收尾
11. 后台任务：根据 CLI exit_code + 验证结果更新 run status、sync_status、创建 SpecConflict
12. 后台任务：创建 AuditLog（complete）

### SpecValidator 验证规则

| 检查项 | 类别 | 级别 | 说明 |
|--------|------|------|------|
| `.sillyspec/projects/` 存在 | structure | error | 必需目录 |
| 至少有 YAML 文件 | structure | warning | 内容完整性 |
| YAML 可解析 | schema | error | YAML 格式 |
| 包含 id / name / type 字段 | schema | error | 最小 schema |
| 仅含 name 的文件 | schema | pass | 视为合法占位符 |
| relations.target 引用存在 | reference | error | 引用完整性 |

## 对外接口

| 方法 | 路径 | 权限 | 响应 | 说明 |
|------|------|------|------|------|
| GET | `/workspaces/{wid}/spec-workspace` | WORKSPACE_READ | `SpecWorkspaceRead` | 获取 spec workspace 详情 |
| POST | `/workspaces/{wid}/spec-workspace/import` | WORKSPACE_WRITE | `SpecWorkspaceRead` | 从仓库导入 spec 文件（stub） |
| POST | `/workspaces/{wid}/spec-workspace/sync` | WORKSPACE_WRITE | `SpecWorkspaceRead` | 同步 spec 文件（stub） |
| PATCH | `/workspaces/{wid}/spec-workspace` | WORKSPACE_WRITE | `SpecWorkspaceRead` | 更新 spec workspace 配置 |
| POST | `/workspaces/{wid}/spec-bootstrap` | WORKSPACE_WRITE | `dict` | 创建异步 AgentRun 执行 bootstrap，立即返回 run 信息和 stream URL |
| GET | `/workspaces/{wid}/spec-conflicts` | WORKSPACE_READ | `SpecConflictListResponse` | 列出 spec 冲突 |
| POST | `/workspaces/{wid}/spec-conflicts/{id}/resolve` | WORKSPACE_WRITE | `SpecConflictRead` | 解决 spec 冲突 |

## 关键数据流

```
Bootstrap 流程:
  POST /spec-bootstrap
    → SpecBootstrapService.bootstrap(workspace_id, user_id)
      → 加载 SpecWorkspace + Workspace
      → mkdir spec_root
      → AuditLog("spec_bootstrap.start")
      → AgentRun(status=pending, agent_type="claude_code")
      → AgentRunWorkspace(agent_run_id, workspace_id)
      → AgentRun(status=running)
      → return { agent_run_id, stream_url, status, spec_root, message }
      → [后台] build AgentSpecBundle
      → [后台] ClaudeCodeAdapter.run_with_bundle(bundle, on_log=callback)
      → [后台] SpecValidator.validate(spec_root)
      → [后台] update AgentRun status + output + exit_code
      → [后台] update SpecWorkspace sync_status (clean/dirty)
      → [后台] create SpecConflict for failures
      → [后台] AuditLog("spec_bootstrap.complete")
  ← { agent_run_id, stream_url: "/api/workspaces/{wid}/agent/runs/{run_id}/stream", status: "pending", spec_root, message: "Bootstrap agent run started." }
```

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 1:1 关系 | workspace_id 唯一索引 | 每个 workspace 仅一个 spec 空间 |
| 三种策略 | platform-managed / repo-mirrored / repo-native | 适配不同团队工作流 |
| Bootstrap 异步 AgentRun | 创建 AgentRun 后立即返回，后台通过 ClaudeCodeAdapter 执行 | 前端可立即连接 SSE stream 获取实时进度，避免同步等待造成页面空白 |
| 验证后置 | bootstrap 完成后验证 | Agent 可能自修复，最终状态决定成功与否 |
| import/sync 为 stub | 仅更新 sync_status | 文件系统双向同步涉及复杂冲突处理，预留接口 |
| 分段写入日志 | 4000 字符/段 | 避免 DB 列长度溢出 |
| Bootstrap 验证由后端收尾 | Agent prompt 要求自查，但最终 sync_status 必须由 SpecValidator.validate() 决定 | 避免 CLI 自然语言输出和平台状态不一致 |

## 依赖关系

- **workspace**：`Workspace` model — 获取 `root_path`（代码根目录）
- **spec_profile**：`SpecConflict` model — conflict 的数据模型和 schema
- **agent**：`ClaudeCodeAdapter`, `AgentRun`, `AgentRunLog`, `AgentSpecBundle` — bootstrap 异步执行链路和日志流
- **workflow**：`AuditLog` — 审计日志记录
- **runtime**：依赖 `SpecWorkspace` 的 strategy 和 spec_root 来定位 `.runtime/` 目录

## 注意事项

- import 和 sync 端点当前为 stub，仅将 sync_status 设为 clean 并更新时间戳
- bootstrap 通过 ClaudeCodeAdapter 异步执行，prompt 包含 `sillyspec init --dir <spec_root>` 和 `sillyspec run scan --dir <spec_root>`；前端通过 SSE stream 实时获取执行进度
- bootstrap 后台进入 running 后会先写入并推送一条启动 `AgentRunLog`，随后 adapter 的 `on_log` 回调每条立即 commit，保证 SSE 后连可回放；实时 stdout/tool_call 仍由 `ClaudeCodeAdapter` 发布到 Redis。
- bootstrap 后台执行异常时，外层 try/except/finally 保证 AgentRun status 更新为 failed 并写入 stderr 日志
- SpecValidator 使用 `datetime.utcfromtimestamp()`（已被 Python 3.12 标记为 deprecated）
- conflict 解决端点直接在 router 中操作 DB，未通过 service 层（直接 session.get + commit）
- AgentRunLog 的分段写入策略（4000 字符）是硬编码常量，未做配置化

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-27 | 初始实现：model + service + router + bootstrap + validator |
| 2026-05-31 | 文档归档 |
| 2026-06-02 | 2026-06-02-spec-bootstrap-agent-stream-interaction | `/spec-bootstrap` 改为异步 AgentRun + ClaudeCodeAdapter 后台执行 + SpecValidator 验证收尾，立即返回 stream_url |
| 2026-06-02 | quick-fix-bootstrap-sse-log-empty | 修复 bootstrap `get_redis()` await 误用、日志批量 commit 造成 stream 运行中无业务内容的问题；同时为 adapter 启动失败补即时 SSE 错误事件，并保留无 `stdbuf` 环境兼容 |
