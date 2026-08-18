---
schema_version: 1
doc_type: module-card
module_id: knowledge
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 知识库浏览（knowledge）

## 定位
工作区知识库与快速日志的只读浏览层：解析 spec 树下 `knowledge/` 与 `quicklog/` 目录的 Markdown 文件并按条目返回。纯读模块——没有写端点，文件由 SillySpec CLI 在仓库侧维护；server 侧只负责「找到根目录 → 扫描 → 结构化」。

## 契约摘要
- `GET /api/workspaces/{workspace_id}/knowledge` → `KnowledgeList`（items 不含 content，total 计数）。
- `GET .../knowledge/{filename}` → `KnowledgeEntry`（含 content；找不到抛 `WorkspaceNotFound` 语义错误「知识库文件不存在，请刷新文件列表后重试」，details 带 workspace_id/filename）。
- `GET .../quicklog` → `QuicklogList`；`GET .../quicklog/{filename}` → `QuicklogEntry`，行为与错误语义同上。
- 四端点统一 `require_permission(Permission.KNOWLEDGE_READ)`。
- `ParsedEntry`：filename / path（相对根的正斜杠路径）/ title（正文第一个 `#` 行）/ content / last_modified_at。

## 关键逻辑
```
root = spec_ws.spec_root（SpecWorkspaceService 优先；失败兜底 Path(workspace.root_path)/".sillyspec"）
entries = parser.parse_knowledge(root) 或 parse_quicklog(root)
  # rglob 扫 .md；单文件 >1MB（MAX_CONTENT_BYTES）跳过
  # 读失败容错（_read_file_safe 返 ok 标志，不抛）
get: 全量 parse 后内存按 filename 匹配（无索引）
```

## 注意事项
- 与 platform_sync 的 `QuicklogEntryORM` 是**两个数据面**：本模块读仓库文件（CLI 落盘的 QUICKLOG md），platform_sync 存 CLI 主动上行的条目快照（DB 行），互不替代；前端消费点不同。
- `_spec_content_root` 的兜底分支只服务 spec_workspace 无数据的过渡场景；单一 daemon-client 架构下正常路径恒是 platform-managed 扁平布局的 `spec_root`（knowledge/ 直接在其下）。
- 每次请求都重新扫目录（无缓存、无 DB 化），list 与 get 都走全量 parse 后内存过滤——目录条目量大时这里是潜在热点，加索引/缓存前先量。
- `change` 模块复用本模块解析知识条目（map used_by: change），动 parser 输出结构前先查 change 侧消费点。
- get 的错误类型沿用了 `WorkspaceNotFound`（带中文文案区分文件级缺失），不是 404 裸抛——改错误类型会影响前端提示分支。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
