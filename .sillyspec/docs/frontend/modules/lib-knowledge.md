---
schema_version: 1
doc_type: module-card
module_id: lib-knowledge
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 知识库读取客户端（lib-knowledge）

## 定位
知识库（Knowledge）与 QUICKLOG 文档的读取客户端（后端 `knowledge/schema.py` 的前端镜像）。四个只读函数按 filename 取列表/正文，类型全部从 OpenAPI 生成。消费方为工作区 knowledge 页。注意职责边界：**QUICKLOG 的条目级轮询/详情已拆到 `lib/quicklog.ts`（lib-quicklog 模块）**，本模块只保留文档级读取。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `listKnowledge(workspaceId)` | 知识库条目摘要列表 | GET `/api/workspaces/{ws}/knowledge` |
| `getKnowledge(workspaceId, filename)` | 单个知识文档正文 | GET `/api/workspaces/{ws}/knowledge/{filename}` |
| `listQuicklog(workspaceId)` | QUICKLOG 文档摘要列表 | GET `/api/workspaces/{ws}/quicklog` |
| `getQuicklog(workspaceId, filename)` | 单条 QUICKLOG 正文 | GET `/api/workspaces/{ws}/quicklog/{filename}` |

类型再导出（生成版）：`KnowledgeEntry` / `KnowledgeList` / `QuicklogEntry` / `QuicklogList`。

## 关键逻辑
```
四函数均为单端点 GET 直传；filename 一律 encodeURIComponent
list 返回 { items, total } 包装；get 按文件名定位（非 id）
```

## 注意事项
- knowledge 与 quicklog 是两套并行端点、结构相同语义不同：长期知识文档 vs 速记日志，UI 分开展示。
- 条目以 **filename** 为标识（workspace 下 knowledge/quicklog 目录内的文件名），不是数字 id；含特殊字符必须编码（实现已处理，绕过本函数直拼 URL 时要自查）。
- 字段细节（content 是否摘要态、last_modified_at 等）以生成版 api-types 为单一真相，本卡不复制。
- QUICKLOG 相关的条目级轮询、ql-ID 条目、状态筛选等能力在 `lib/quicklog.ts`，勿在本模块补——两模块的端点层级不同（文档级 vs 条目级）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
