---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# spec_workspace — Spec workspace 管理

> 最后更新：2026-05-31
> 最近变更：初始模块文档
> 模块路径：`app/modules/spec_workspace/**`

## 职责

管理每个 workspace 对应的 spec 空间。提供 spec workspace 的 CRUD、导入/同步（stub）、bootstrap（Agent 驱动初始化）以及 spec conflict 的列表和解决。本模块是 spec 体系的核心协调层。

## 当前设计（架构 + 关键逻辑）

### 架构

- **Router** — 7 个端点（4 个 spec workspace + 1 个 bootstrap + 2 个 conflict）
- **Service** — `SpecWorkspaceService`：CRUD + sync status
- **BootstrapService** — `SpecBootstrapService`：通过 Agent + CLI 初始化 spec 空间
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

`SpecBootstrapService.bootstrap()` 是本模块最复杂的操作：

1. 加载 SpecWorkspace + Workspace 记录
2. 确保 spec_root 目录存在
3. 创建 AuditLog（start）
4. 构建 `AgentSpecBundle`（含 bootstrap prompt + allowed_paths）
5. 创建 `AgentRun` 记录，通过 `ClaudeCodeAdapter` 执行
6. Agent 使用 `sillyspec init` + `sillyspec run scan` 初始化
7. 写入 AgentRunLog（分段写入，每段 4000 字符）
8. `SpecValidator.validate()` 验证结果
9. 通过 → sync_status=clean；失败 → sync_status=dirty + 创建 SpecConflict
10. 创建 AuditLog（complete），返回结果 dict

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
| POST | `/workspaces/{wid}/spec-bootstrap` | WORKSPACE_WRITE | `dict` | Agent 驱动初始化 spec 空间 |
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
      → 构建 AgentSpecBundle (prompt + tools)
      → AgentRun(status=pending → running)
      → ClaudeCodeAdapter.run_with_bundle(timeout=1800s)
        → Agent 调用 sillyspec init + scan
      → 写入 AgentRunLog (分段)
      → SpecValidator.validate(spec_root)
        → _check_directory_structure
        → _check_yaml_schema
        → _check_references
      → passed? → sync_status=clean : dirty + SpecConflict
      → AuditLog("spec_bootstrap.complete")
    ← { agent_run_id, validation_passed, sync_status, errors, warnings }
```

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 1:1 关系 | workspace_id 唯一索引 | 每个 workspace 仅一个 spec 空间 |
| 三种策略 | platform-managed / repo-mirrored / repo-native | 适配不同团队工作流 |
| Agent 驱动 bootstrap | ClaudeCodeAdapter + sillyspec CLI | spec 初始化需要理解代码结构，Agent 比硬编码逻辑更灵活 |
| 验证后置 | bootstrap 完成后验证 | Agent 可能自修复，最终状态决定成功与否 |
| import/sync 为 stub | 仅更新 sync_status | 文件系统双向同步涉及复杂冲突处理，预留接口 |
| 分段写入日志 | 4000 字符/段 | 避免 DB 列长度溢出 |

## 依赖关系

- **workspace**：`Workspace` model — 获取 `root_path`（代码根目录）
- **spec_profile**：`SpecConflict` model — conflict 的数据模型和 schema
- **agent**：`ClaudeCodeAdapter`, `AgentRun`, `AgentRunLog`, `AgentSpecBundle` — Agent 执行
- **workflow**：`AuditLog` — 审计日志记录
- **runtime**：依赖 `SpecWorkspace` 的 strategy 和 spec_root 来定位 `.runtime/` 目录

## 注意事项

- import 和 sync 端点当前为 stub，仅将 sync_status 设为 clean 并更新时间戳
- bootstrap 的 Agent 超时设为 1800 秒（30 分钟），对于大型项目可能不够
- SpecValidator 使用 `datetime.utcfromtimestamp()`（已被 Python 3.12 标记为 deprecated）
- conflict 解决端点直接在 router 中操作 DB，未通过 service 层（直接 session.get + commit）
- AgentRunLog 的分段写入策略（4000 字符）是硬编码常量，未做配置化

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-27 | 初始实现：model + service + router + bootstrap + validator |
| 2026-05-31 | 文档归档 |
