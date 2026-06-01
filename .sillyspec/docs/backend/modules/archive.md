---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# archive — 归档操作

> 最后更新：2026-05-31
> 最近变更：初始模块文档
> 模块路径：`app/modules/archive/**`

## 职责

提供已完成变更的归档和知识蒸馏功能。将状态为 `done` 的 change 目录移动到 `archive/` 目录，并从变更文档中提取关键信息生成知识库 Markdown 文件，写入 `.sillyspec/knowledge/`。

## 当前设计（架构 + 关键逻辑）

### 架构

- **Router** — 2 个 POST 端点，无 workspace 前缀（直接挂载在根路由）
- **Service** — `ArchiveService`，同时操作数据库和文件系统

### 核心业务：归档（archive_change）

1. 从 DB 加载 Change 记录，校验状态必须为 `done`
2. 使用 `shutil.move()` 将 change 目录从 `{root_path}/{change.path}` 移至 `{root_path}/archive/{change.path（斜杠替换为连字符）}`
3. 更新 Change 状态为 `archived`，设置 `archived_at` 时间戳

### 核心业务：知识蒸馏（distill_knowledge）

1. 加载 Change 及其关联的 ChangeDocument 列表
2. 读取每个文档文件内容（截取前 2000 字符，预览取前 500 字符）
3. 组装摘要信息：change_key、title、status、change_type、affected_components、documents
4. 使用 `_render_knowledge_md()` 生成 Markdown 内容
5. 写入 `.sillyspec/knowledge/{change_key}.md`

## 对外接口

| 方法 | 路径 | 权限 | 响应 | 说明 |
|------|------|------|------|------|
| POST | `/workspaces/{wid}/changes/{cid}/archive` | CHANGE_ARCHIVE | `ChangeRead` | 归档一个已完成的变更 |
| POST | `/workspaces/{wid}/changes/{cid}/distill` | CHANGE_READ | `dict` | 从变更蒸馏生成知识文件 |

### 自定义异常

| 异常类 | code | HTTP 状态码 | 触发条件 |
|--------|------|-------------|----------|
| `ArchiveError` | ARCHIVE_ERROR | 400 | 归档过程通用错误（基类） |
| `ArchiveNotFound` | ARCHIVE_NOT_FOUND | 404 | Change 或 Workspace 不存在 |
| `ChangeNotArchivable` | CHANGE_NOT_ARCHIVABLE | 409 | Change 状态不是 `done` |

## 关键数据流

```
归档流程:
  POST /changes/{id}/archive
    → ArchiveService.archive_change(workspace_id, change_id)
      → DB: session.get(Change, change_id)
      → 校验: status == "done" && workspace_id 匹配
      → DB: session.get(Workspace, workspace_id)
      → shutil.move(change_dir → archive_dir)
      → DB: change.status = "archived", change.archived_at = now
      → commit
    ← ChangeRead

蒸馏流程:
  POST /changes/{id}/distill
    → ArchiveService.distill_knowledge(workspace_id, change_id)
      → DB: 加载 Change + ChangeDocument 列表
      → 读取文档文件内容（截断）
      → _render_knowledge_md(summary)
      → 写入 .sillyspec/knowledge/{change_key}.md
    ← { change_key, title, status, documents, distilled_at, ... }
```

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 归档路径格式 | `archive/{change.path（/→-）}` | 避免深层嵌套目录，保持扁平结构 |
| 蒸馏内容截断 | 文档 2000 字符 / 预览 500 字符 | 知识文件应精炼，避免冗余 |
| 知识文件命名 | `{change_key}.md` | 以 change_key 作为唯一标识 |
| 归档权限 | CHANGE_ARCHIVE（高于 CHANGE_READ） | 归档是破坏性操作，需更高权限 |
| 蒸馏权限 | CHANGE_READ | 只读操作，仅需读权限 |
| 仅允许 done 状态归档 | 硬性校验 | 防止未完成的变更被错误归档 |

## 依赖关系

- **change**：`Change`, `ChangeDocument` model — 加载变更及关联文档
- **workspace**：`Workspace` model — 获取 `root_path` 用于文件操作
- 无自有数据库表（不定义 model.py）
- `knowledge` 模块依赖本模块蒸馏产出的 `.sillyspec/knowledge/` 文件

## 注意事项

- `archive_change` 使用 `shutil.move()`，是同步阻塞操作，如果 change 目录很大可能影响事件循环
- 归档目标目录名中的斜杠替换（`/` → `-`）可能导致不同 path 生成相同文件名（如 `a/b` 和 `a-b`）
- `distill_knowledge` 无状态校验——不要求 change 状态为 `done`，任何状态的变更都可以蒸馏
- 蒸馏文件直接写入磁盘，如果文件已存在会被覆盖（无冲突处理）

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-27 | 初始实现：archive + distill API |
| 2026-05-31 | 文档归档 |
