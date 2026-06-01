---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# scan_docs

> 最后更新：2026-05-31
> 最近变更：`53383c5` feat(component-as-workspace): Workspace Graph data plane
> 模块路径：`app/modules/scan_docs/**`

## 职责

扫描文档索引与解析模块。负责读取 `.sillyspec/docs/{component_key}/scan/*.md` 目录下的 Markdown 文件，解析为结构化数据后持久化到 `scan_documents` 表。支持列表查询、单文档查看和批量重新解析（reparse），为 Agent 提供项目上下文知识。

## 当前设计（架构 + 关键逻辑）

**三层架构**：`ScanDocsParser`（文件系统解析层）→ `ScanDocsService`（业务协调层）→ `router`（HTTP 层）。

1. **Parser 层**（`ScanDocsParser`）：
   - 扫描 `.sillyspec/docs/{component_key}/scan/` 目录
   - 文件名映射到标准 doc_type（ARCHITECTURE / CONVENTIONS / CONCERNS / INTEGRATIONS / PROJECT / STRUCTURE / TESTING），非标准名称归为 OTHER
   - 提取 Markdown 首个 `# Title` 作为标题
   - 文件大小超过 1MB 截断，路径穿越防护
   - 缺失的标准 doc_type 生成 `exists=False` 占位行

2. **Service 层**（`ScanDocsService`）：
   - `list_()` / `get()`：从 DB 读取，先验证 workspace 存在
   - `reparse()`：重新扫描文件系统 → 与 DB 现有行对比 → upsert/delete
   - OTHER 类型文档按路径去重（允许同一 doc_type 多文件）
   - 非 OTHER 类型最后写入胜出（覆盖）

3. **标准 Doc Types**：ARCHITECTURE, CONVENTIONS, CONCERNS, INTEGRATIONS, PROJECT, STRUCTURE, TESTING

## 对外接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/workspaces/{ws_id}/scan-docs` | 列出扫描文档（不含 content） | WORKSPACE_READ |
| GET | `/workspaces/{ws_id}/scan-docs/{doc_type}` | 获取单个扫描文档（含 content） | WORKSPACE_READ |
| POST | `/workspaces/{ws_id}/scan-docs/reparse` | 触发重新解析文件系统 | WORKSPACE_WRITE |

## 关键数据流

```
POST /workspaces/{ws_id}/scan-docs/reparse
  → ScanDocsService.reparse()
    → WorkspaceService.get()           # 验证 workspace 存在
    → ScanDocsParser.parse_component()
      → 遍历 .sillyspec/docs/{key}/scan/*.md
      → 文件名 → doc_type 映射
      → 读取内容 + 提取标题 + mtime
      → 返回 list[ParsedDoc] + warnings
    → 对比 DB 现有行（_fetch_existing）
    → 对每个 ParsedDoc：
        exists=True + DB有 → update
        exists=True + DB无 → create
        exists=False + DB有 → 标记 exists=False
    → _sync_other_docs() 处理 OTHER 类型
    → commit → 返回 stats + warnings
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 7 种标准 doc_type + OTHER 兜底 | 覆盖常见项目知识文档类型，未知文件名不至于丢失 |
| exists=False 占位行 | 前端可展示"待创建"状态，引导用户补全文档 |
| OTHER 类型按路径去重 | 非标准文件可能有多个，需全部保留 |
| 内容超 1MB 截断 | 防止超大文件占用过多内存和存储 |
| 路径穿越防护 | 解析时检查 resolve() 后路径是否仍在 sillyspec_root 内 |

## 依赖关系

- **上游**：workspace（Workspace.root_path、component_key）
- **模型**：ScanDocument（scan_documents 表，workspace_id + doc_type 唯一索引）
- **数据结构**：ParsedDoc / ScanDocsResult / ParseWarning（dataclass）

## 注意事项

- reparse 时若 workspace.component_key 为 None，直接返回空结果不做解析
- 列表接口返回 `ScanDocSummary`（不含 content 字段），避免大数据量传输
- parser 中 `_read_file_safe` 截断时使用 `MAX_CONTENT_BYTES // 4` 字符近似（4 字节/字符）
- `ux_scan_docs_workspace_type` 唯一索引意味着同一 workspace 下每个非 OTHER doc_type 最多一行

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-31 | 初始归档文档 |
