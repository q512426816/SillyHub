---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# change_writer
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/change_writer/**

## 职责

Change Writer 模块是变更文档的写入通道，负责在 Worktree 隔离环境中创建变更、生成和批量生成标准文档模板（proposal/requirements/design/plan/tasks/verification），管理文档生成与批量模板构建，并提供 git commit/push 和 GitHub PR 创建能力。

核心能力包括：
- 在 Worktree 中创建变更目录结构（含 master.md frontmatter）
- 生成标准文档模板（proposal、requirements、design、plan、tasks、verification）
- 批量生成多个文档模板（支持 lease_id=None 的 workspace root 模式）
- 触发变更执行（execute_change）
- 自动添加 frontmatter（author、created_at）
- Git 提交推送（git_commit_and_push）
- GitHub PR 创建（create_pull_request）

## 当前设计

模块结构：

```
router.py          → HTTP 接口层（4 个端点）
service.py         → 业务逻辑层（ChangeWriterService）
markdown_builder.py → Markdown 模板构建器（6 种模板）
schema.py          → Pydantic 请求/响应 schema
tests/             → 测试（router, markdown_builder）
```

### 关键类

| 类 | 文件 | 说明 |
|---|---|---|
| `ChangeWriterService` | service.py | 核心服务，管理变更创建、文档生成、git 操作和 PR |
| `ChangeWriteError` | service.py | 写入错误 |
| `ChangeCreateRequest` | schema.py | 创建变更请求 |
| `ChangeCreateResponse` | schema.py | 创建变更响应 |
| `MarkdownGenerateRequest` | schema.py | 文档生成请求 |
| `MarkdownGenerateResponse` | schema.py | 文档生成响应 |
| `BatchGenerateRequest` | schema.py | 批量生成请求 |
| `BatchGenerateResponse` | schema.py | 批量生成响应 |

### ChangeWriterService 方法

| 方法 | 说明 |
|---|---|
| `create_change(...)` | 在 Worktree 中创建变更目录 + master.md |
| `generate_document(...)` | 生成单个文档模板 |
| `batch_generate_templates(...)` | 批量生成文档模板 |
| `_ensure_frontmatter(...)` | 确保文档包含 frontmatter |
| `_get_active_lease(...)` | 获取活跃的 Worktree 租约 |
| `_get_change(...)` | 获取变更记录 |

### markdown_builder 函数

| 函数 | 说明 |
|---|---|
| `build_master_md(...)` | 构建 master.md 内容 |
| `build_proposal_md(...)` | 构建 proposal 模板 |
| `build_requirements_md(...)` | 构建 requirements 模板 |
| `build_design_md(...)` | 构建 design 模板 |
| `build_plan_md(...)` | 构建 plan 模板 |

通过 `DOCUMENT_BUILDERS` 字典注册所有模板类型。

## 对外接口（表格）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/workspaces/{workspace_id}/changes/create` | 创建变更（目录 + master.md） |
| POST | `/workspaces/{workspace_id}/changes/{change_id}/documents/generate` | 生成单个文档 |
| POST | `/workspaces/{workspace_id}/changes/{change_id}/documents/batch-generate` | 批量生成文档 |
| POST | `/workspaces/{workspace_id}/changes/{change_key}/execute` | 触发变更执行 |

## 关键数据流

```
前端/Agent → router.create_change
  → ChangeWriterService.create_change
    → _get_active_lease() 获取 Worktree 租约
    → build_master_md() 构建 master.md
    → 在 worktree 文件系统中创建目录结构
    → upsert Change + ChangeDocument 数据库记录
```

```
前端/Agent → router.generate_document
  → ChangeWriterService.generate_document
    → 从 markdown_builder 获取模板
    → _ensure_frontmatter() 添加元数据
    → 写入文件到 worktree
    → upsert ChangeDocument 记录
```

```
前端/Agent → router.execute_change
  → 触发 change.dispatch 调度（SillySpecStageDispatchService）
  → 启动 Agent 执行
```

## 设计决策（表格）

| 决策 | 原因 | 备注 |
|---|---|---|
| 独立于 change 模块 | 写入操作需要 Worktree 租约和文件系统操作，职责独立 | change 模块负责读取和流转 |
| 模板函数式构建 | markdown_builder 使用纯函数生成 Markdown | 便于测试和扩展 |
| DOCUMENT_BUILDERS 注册表模式 | 方便扩展新模板类型 | 字典注册 |
| frontmatter 自动注入 | 确保所有文档都有标准元数据 | _ensure_frontmatter |
| Worktree 隔离写入 | 所有文件写入在租约的 Worktree 中，避免跨变更污染 | 通过 _get_active_lease |
| upsert 语义 | 文档生成支持重复执行，幂等更新 | generate_document 的 upsert 行为 |
| 支持 lease_id=None 的 workspace root 模式 | Phase A 不需要 lease 也能工作 | 批量生成 |
| change_key 由日期 + slug 化 title 生成 | 唯一性 + 可读性 | create_change |

## 依赖关系

### 内部依赖（被本模块使用）

| 依赖模块 | 用途 |
|---|---|
| `app.core.auth_deps` | 用户认证（get_current_user） |
| `app.core.db` | 数据库会话 |
| `app.core.errors` | 错误类型（AppError, WorkspaceNotFound, WorktreeLeaseNotFound） |
| `app.core.logging` | 日志 |
| `app.core.spec_paths` | SpecPathResolver 文件路径解析 |
| `app.modules.auth` | User 模型 |
| `app.modules.change` | Change、ChangeDocument 模型、SillySpecStageDispatchService（执行调度） |
| `app.modules.worktree` | WorktreeLease 模型、ExecEnvBuilder |
| `app.modules.workspace` | Workspace 模型、_rewrite_path 工具函数 |

### 被依赖

暂无其他模块直接依赖 change_writer 模块。操作由前端或 Agent 通过 API 触发。

## 注意事项

1. **Worktree 租约必须有效**：所有写入操作依赖活跃的 Worktree 租约，租约过期会导致操作失败。批量生成支持 lease_id=None 的 workspace root 模式。
2. **文件路径安全**：通过 SpecPathResolver 和 _rewrite_path 统一处理路径，防止路径遍历。
3. **模板扩展**：新增文档类型需在 markdown_builder.py 添加对应构建函数并注册到 DOCUMENT_BUILDERS。
4. **execute_change**：该端点会触发 Agent 调度，是异步操作，执行状态通过 change 模块的 agent-status 端点查询。
5. **PAT 安全**：GitHub API 调用涉及的 PAT 在内存中使用后不落日志。

## 变更索引（表格，初始为空）

| 变更 ID | 类型 | 简述 | 日期 |
|---|---|---|---|
