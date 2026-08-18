---
schema_version: 1
doc_type: module-card
module_id: lib-change-files
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 变更 spec 文件客户端（lib-change-files）

## 定位
变更（change）spec 文件树 / 内容读写的 API 客户端 + 文件树构造器（`frontend/src/lib/change-files.ts`，134 行）。会话驱动化翻转后变更文档不再走旧 documents 端点，统一经本模块读 `.sillyspec/changes/<change>/` 下的扁平清单与单文件内容。`components-changes`（ChangeFileTree / 文件卡片）的数据源。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `listChangeFiles(ws, cid)` | 变更文件清单（扁平） | GET `.../changes/{cid}/files` → `ChangeFileList` |
| `getChangeFileContent(ws, cid, path)` | 读单文件内容 | GET `.../changes/{cid}/files/content?path=` → `ChangeFileContent` |
| `saveChangeFileContent(ws, cid, path, content)` | 写单文件 | POST `.../changes/{cid}/files/content` → `ChangeFileWriteResponse` |
| `listPendingChangeFiles(ws, cid)` | 待写回文件清单 | GET `.../changes/{cid}/files/pending` → `PendingFileList` |
| `buildChangeFileTree(items)` | 扁平清单→目录树（纯前端，无 HTTP） | — |

- `ChangeFileEntry`：`path` 相对变更目录 posix（如 `tasks/task-01.md`）、`is_text` 标记可否文本读、`last_modified_at` 可 null。
- `ChangeFileContent`：`content` 可 null（二进制/大文件）、`exists`。
- `ChangeFileWriteResponse`：`status: "done" | "pending"` + `task_id`（pending 时后台任务落盘）。
- `PendingFileEntry`：`status: "pending" | "claimed"`（claimed=已有任务认领写回）。
- `ChangeFileTreeNode`：`doc?` 挂文件元数据，`children` 递归。

## 关键逻辑
```
buildChangeFileTree(items):
  按 path.split("/") 逐段建/复用节点，末段挂 doc
  排序: 目录(无 doc)优先 → 同层 name.localeCompare 字母序，递归子层
```

## 注意事项
- 写回是**异步落盘**语义：`status=pending` 时内容由后台任务（`task_id`）写回，调用方需轮询 `listPendingChangeFiles` 看 `pending/claimed` 消化情况；`status=done` 才是立即落盘。
- `path` 是相对变更目录的 posix 路径，读内容时走 `encodeURIComponent` 防注入。
- `is_text=false` / `content=null` 的条目别硬渲染为文本。
- 类型对齐后端 `change/schema.py` file tree DTOs，本文件手写（未走 OpenAPI 索引）；后端 DTO 改动需同步此处。
- `buildChangeFileTree` 为纯函数，可单测，不依赖网络。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
