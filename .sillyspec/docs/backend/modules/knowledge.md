---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# knowledge — 知识库

> 最后更新：2026-05-31
> 最近变更：初始模块文档
> 模块路径：`app/modules/knowledge/**`

## 职责

提供对 workspace 内知识库（knowledge）和快速日志（quicklog）的**只读**访问。从文件系统（`.sillyspec/knowledge/` 和 `.sillyspec/quicklog/`）解析 Markdown 文件，通过 REST API 返回结构化数据。无数据库持久化，所有内容来源于磁盘文件。

## 当前设计（架构 + 关键逻辑）

### 架构

采用三层结构：

- **Router** — 4 个 GET 端点，挂载在 `/workspaces/{workspace_id}/` 前缀下
- **Service** — `KnowledgeService`，纯只读，依赖 `WorkspaceService` 定位 workspace 路径
- **Parser** — `KnowledgeParser`，解析指定目录下所有 `*.md` 文件

### 关键逻辑

1. **路径定位**：通过 `workspace.root_path` 拼接 `.sillyspec/knowledge` 或 `.sillyspec/quicklog` 得到解析根目录
2. **文件解析**：遍历目录中所有 `*.md` 文件，按文件名排序
3. **安全检查**：使用路径 resolve + startswith 防止路径穿越（symlink 安全）
4. **内容限制**：单文件超过 1MB 时截断读取（仅取前 250KB）
5. **标题提取**：从 Markdown 内容中查找第一个 `# heading` 作为 title
6. **列表/详情区分**：列表接口不返回 `content`，详情接口返回完整内容

## 对外接口

| 方法 | 路径 | 权限 | 响应 | 说明 |
|------|------|------|------|------|
| GET | `/workspaces/{wid}/knowledge` | WORKSPACE_READ | `KnowledgeList` | 列出所有知识库条目（不含内容） |
| GET | `/workspaces/{wid}/knowledge/{filename}` | WORKSPACE_READ | `KnowledgeEntry` | 获取单条知识库（含内容） |
| GET | `/workspaces/{wid}/quicklog` | WORKSPACE_READ | `QuicklogList` | 列出所有快速日志条目（不含内容） |
| GET | `/workspaces/{wid}/quicklog/{filename}` | WORKSPACE_READ | `QuicklogEntry` | 获取单条快速日志（含内容） |

### 数据模型（Pydantic Schema）

**KnowledgeEntry / QuicklogEntry**：

| 字段 | 类型 | 说明 |
|------|------|------|
| filename | str | 文件名 |
| path | str | 相对路径（如 `.sillyspec/knowledge/xxx.md`） |
| title | str \| None | 从 Markdown 标题提取 |
| content | str \| None | 文件内容（列表接口为 null） |
| last_modified_at | datetime \| None | 文件最后修改时间 |

## 关键数据流

```
客户端 GET /knowledge
  → Router (权限检查: WORKSPACE_READ)
    → KnowledgeService.list_knowledge(workspace_id)
      → WorkspaceService.get(workspace_id)  # 获取 root_path
      → KnowledgeParser.parse_knowledge(sillyspec_root)
        → parse_md_directory(root/knowledge, root, prefix)
          → glob("*.md") + 路径安全检查 + 读取文件 + 提取标题
      → _to_knowledge_entry(entries, include_content=False)
    ← KnowledgeList(items, total)
```

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储方式 | 纯文件系统，无 DB | 知识库内容由 archive 模块蒸馏生成，写入 `.sillyspec/knowledge/`，保持与 SillySpec 规范一致 |
| 只读设计 | 仅提供 GET | 知识条目由 `ArchiveService.distill_knowledge()` 自动生成，不允许手动编辑 |
| 文件大小限制 | 1MB | 防止超大文件拖慢列表接口响应 |
| 路径安全 | resolve + startswith | 防止符号链接穿越到 sillyspec_root 之外的目录 |

## 依赖关系

- **workspace**：`WorkspaceService.get()` — 获取 workspace 的 `root_path`
- **auth**：`require_permission(Permission.WORKSPACE_READ)` — 所有端点均需读权限
- 无数据库表（本模块不定义 model.py）

## 注意事项

- knowledge 和 quicklog 的 Schema 结构完全一致，仅目录路径不同
- 文件未找到时抛出 `WorkspaceNotFound`（复用现有异常，语义上不够精确，未来可考虑专用异常）
- `KnowledgeParser` 是同步代码（文件 I/O），在 async 服务中直接调用；对于小目录开销可忽略

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-27 | 初始实现：knowledge + quicklog 只读 API |
| 2026-05-31 | 文档归档 |
