---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# scan_docs
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/scan_docs/**

## 职责

解析 workspace 下 `.sillyspec/docs/{component_key}/scan/*.md` 文件，将扫描文档持久化到 `scan_documents` 表，并提供查询和重新解析（reparse）接口。

## 当前设计

```
router.py  ── HTTP 入口，挂载到 /workspaces/{workspace_id}/scan-docs
service.py ── ScanDocsService，CRUD + reparse 逻辑
parser.py  ── ScanDocsParser，解析 markdown 文件为结构化 ParsedDoc
model.py   ── ScanDocument (SQLModel table)
schema.py  ── Pydantic DTOs（ScanDocRead / ScanDocSummary / ScanDocList / ScanDocWarning / ScanDocReparseResponse）
tests/     ── test_service.py / test_parser.py / test_router.py
```

核心流程：parser 从文件系统读取 `.md` -> 提取 title/content/doc_type/last_modified -> service 持久化到数据库并处理增删改。

## 对外接口（表格）

| 方法 | 路径 | 说明 | 返回类型 |
|------|------|------|----------|
| GET | `/workspaces/{workspace_id}/scan-docs` | 列出该 workspace 的所有扫描文档 | `ScanDocList` |
| GET | `/workspaces/{workspace_id}/scan-docs/{doc_type}` | 获取指定 doc_type 的文档 | `ScanDocRead` |
| POST | `/workspaces/{workspace_id}/scan-docs/reparse` | 从文件系统重新解析并同步 | `ScanDocReparseResponse` |

所有端点需要认证 + `require_permission`。

## 关键数据流

1. **list**：从数据库查询 `scan_documents` 表，按 workspace_id 过滤
2. **get by doc_type**：从数据库查询指定 doc_type 的记录
3. **reparse**：
   - 通过 `WorkspaceService` 获取 workspace -> spec_workspace -> spec_root
   - `ScanDocsParser.parse_component()` 扫描 spec_root 下 scan 目录
   - `_sync_other_docs()` 对比现有记录：新增 / 更新 / 标记不存在
   - 返回统计信息（created / updated / removed counts + warnings）

## 设计决策（表格）

| 决策 | 原因 |
|------|------|
| 数据库 + 文件双存储 | 文件是 source of truth，数据库用于快速查询和索引 |
| 唯一约束 (workspace_id, doc_type) | 每个 workspace 下同一 doc_type 只有最新一条 |
| reparse 幂等 | 多次调用结果一致，不产生重复记录 |
| 路径遍历防护 | parser 内有 path traversal guard |
| 大文件截断 | 防止超大 markdown 文件占满数据库 |

## 依赖关系

- `app.core.auth_deps` — require_permission
- `app.core.db` — get_session
- `app.core.errors` — ScanDocNotFound
- `app.core.logging` — get_logger
- `app.modules.auth.model` — User
- `app.modules.auth.permissions` — Permission
- `app.modules.workspace.service` — WorkspaceService

## 注意事项

- `ScanDocsParser` 是纯文件系统操作，不依赖数据库
- `doc_type` 由文件名自动推断（`_doc_type_from_filename`）
- reparse 会将磁盘上已删除的文件标记为 `exists=False`

## 变更索引（表格，初始为空）

| 变更ID | 日期 | 改动摘要 |
|--------|------|----------|
