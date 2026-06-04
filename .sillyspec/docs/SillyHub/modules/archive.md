---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# archive
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/archive/**

## 职责

Archive 模块负责变更（Change）生命周期的收尾阶段：将已完成的变更归档，并从已归档的变更中提炼知识（knowledge distillation）。归档意味着将变更从活跃状态转移到归档存储，知识提炼则从变更文档中提取关键经验并生成结构化的 Markdown 文件。

核心能力包括：
- 变更归档（状态校验、文件移动、数据库更新）
- 知识提炼（从归档变更中提取经验并渲染为 Markdown）

## 当前设计

模块结构精简，分为三层：

```
router.py    → HTTP 接口层（2 个端点）
service.py   → 业务逻辑层（ArchiveService）
tests/       → 测试
```

### 关键类

| 类 | 文件 | 说明 |
|---|---|---|
| `ArchiveService` | service.py | 归档服务，包含归档和知识提炼两个核心方法 |
| `ArchiveError` | service.py | 归档通用错误 |
| `ArchiveNotFound` | service.py | 归档记录未找到 |
| `ChangeNotArchivable` | service.py | 变更不可归档（状态不满足） |

### ArchiveService 方法

| 方法 | 说明 |
|---|---|
| `archive_change(workspace_id, change_id)` | 执行变更归档流程 |
| `distill_knowledge(workspace_id, change_id)` | 从归档变更提炼知识 |
| `_render_knowledge_md(summary)` | 静态方法，将知识摘要渲染为 Markdown |

## 对外接口（表格）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/workspaces/{workspace_id}/changes/{change_id}/archive` | 归档指定变更 |
| POST | `/workspaces/{workspace_id}/changes/{change_id}/distill` | 提炼变更知识 |

## 关键数据流

```
用户 → router.archive_change
  → ArchiveService.archive_change
    → 校验 Change 状态（必须是 accepted/done）
    → 通过 SpecPathResolver 解析文件路径
    → 移动文件到归档目录
    → 更新 Change 记录（archived_at 等）
```

```
用户 → router.distill_knowledge
  → ArchiveService.distill_knowledge
    → 读取 Change 及 ChangeDocument
    → 解析文档内容，提取关键经验
    → _render_knowledge_md → 生成 Markdown 文件
```

## 设计决策（表格）

| 决策 | 原因 | 备注 |
|---|---|---|
| 独立模块而非 change 子功能 | 归档是终态操作，职责清晰独立 | 与 change 模块解耦 |
| 前置状态校验 | 防止归档未完成的变更 | 抛出 ChangeNotArchivable |
| SpecPathResolver | 统一解析 SillySpec 文件路径 | 避免硬编码路径逻辑 |
| 静态方法渲染 Markdown | 知识渲染无状态依赖，便于测试 | _render_knowledge_md |

## 依赖关系

### 内部依赖（被本模块使用）

| 依赖模块 | 用途 |
|---|---|
| `app.core.auth_deps` | 权限校验（require_permission） |
| `app.core.db` | 数据库会话 |
| `app.core.errors` | AppError 基类 |
| `app.core.logging` | 日志 |
| `app.core.spec_paths` | SpecPathResolver 文件路径解析 |
| `app.modules.auth` | User 模型、Permission 权限 |
| `app.modules.change` | Change、ChangeDocument 模型、ChangeRead schema |
| `app.modules.workspace` | Workspace 模型 |

### 被依赖

暂无其他模块直接依赖 archive 模块。归档操作由用户通过 API 主动触发。

## 注意事项

1. **归档前置条件**：变更必须处于终态（如 accepted），否则抛出 `ChangeNotArchivable`。
2. **不可逆操作**：归档涉及文件移动，需要确保文件系统操作的原子性。
3. **知识提炼依赖文档质量**：`distill_knowledge` 的输出质量取决于 ChangeDocument 的完整度。
4. **路径安全**：通过 SpecPathResolver 统一处理路径，避免路径遍历风险。

## 变更索引（表格，初始为空）

| 变更 ID | 类型 | 简述 | 日期 |
|---|---|---|---|
