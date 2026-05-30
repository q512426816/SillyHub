---
author: qinyi
created_at: 2026-05-30 16:48:00
---

# change_writer

> 最后更新：2026-05-30
> 最近变更：2026-05-30-change-writer
> 模块路径：`backend/app/modules/change_writer/**`

## 职责

在 worktree lease 隔离目录内创建 SillySpec Change 包（目录 + MASTER.md + 模板文档），并管理文档生成与批量模板构建。

## 当前设计

`ChangeWriterService` 封装了变更包的完整文件写入生命周期：

1. **创建变更**：`create_change()` 在 lease worktree 或 workspace root 的 `.sillyspec/changes/change/<change_key>/` 下创建目录和 MASTER.md，同时写入 DB（Change + ChangeDocument 表）
2. **单文档生成**：`generate_document()` 向变更目录写入指定 doc_type 的 markdown 文件，DB upsert ChangeDocument 记录
3. **批量模板生成**：`batch_generate_templates()` 通过 `DOCUMENT_BUILDERS` 注册表批量生成模板文档，支持无 lease 的 workspace root 模式

`markdown_builder.py` 提供 6 种文档模板生成函数，通过 `DOCUMENT_BUILDERS` 字典注册。

### 关键内部方法

- `_get_active_lease()`：验证 lease 存在、归属、状态为 locked
- `_get_change()`：查询并验证 Change 记录

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| POST `/workspaces/{ws_id}/changes/create` | `create_change()` | 创建变更目录 + MASTER.md | 前端/Agent |
| POST `/workspaces/{ws_id}/changes/{id}/documents/generate` | `generate_document()` | 写入单个文档 | 前端/Agent |
| POST `/workspaces/{ws_id}/changes/{id}/documents/batch-generate` | `batch_generate_templates()` | 批量生成模板文档 | 前端/Agent |

## 关键数据流

```text
前端/Agent → router → ChangeWriterService
  → _get_active_lease() / _get_change()
  → markdown_builder (模板生成)
  → filesystem (文件写入)
  → DB (Change + ChangeDocument upsert)
  → 返回结果
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| 文件写入限定在 lease 目录内 | 隔离安全，避免跨变更污染 | 初始设计 |
| 支持 lease_id=None 的 workspace root 模式 | Phase A 不需要 lease 也能工作 | Phase A 实现 |
| change_key 由日期 + slug 化 title 生成 | 唯一性 + 可读性 | 初始设计 |
| DOCUMENT_BUILDERS 注册表模式 | 方便扩展新模板类型 | Phase A 实现 |

## 依赖关系

### 依赖本模块
- (暂无直接调用方，通过 router 暴露 HTTP API)

### 本模块依赖
- `change` 模块：Change、ChangeDocument 模型
- `worktree` 模块：WorktreeLease 模型、ExecEnvBuilder
- `workspace` 模块：Workspace 模型、`_rewrite_path()`
- `app.core.errors`：AppError、WorkspaceNotFound、WorktreeLeaseNotFound
- `app.core.logging`：get_logger

## 注意事项

- `BatchGenerateRequest` 的 `lease_id` 字段尚未添加（当前 proposal 设计中提到但代码中未实现）
- `build_master_md` 的 `author`、`change_key` 参数尚未增强（当前 proposal 设计中提到但代码中未实现）
- `build_tasks_md`、`build_verification_md` 尚未添加到 `DOCUMENT_BUILDERS`
- Phase B（git_commit_and_push、create_pull_request）功能尚未在此模块实现

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-30 | 2026-05-30-change-writer | Phase A 增强 + Phase B 设计（模板增强 + git commit/PR 计划） |
