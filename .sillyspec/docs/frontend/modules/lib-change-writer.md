---
schema_version: 1
doc_type: module-card
module_id: lib-change-writer
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-change-writer

## 定位
工作空间级"变更创建与文档批量生成"的前端 API 客户端。负责按 SillySpec 规范创建一个新 change，并批量生成 proposal/design/tasks 等文档骨架。注意与 `lib-changes` 区分：本模块专注"创建 + 文档生成"，而 `lib-changes` 覆盖 change 的全生命周期（流转/审批/进度等）。

## 契约摘要
| 函数 | 语义 | HTTP | 返回 |
|---|---|---|---|
| `createChange(workspaceId, input)` | 创建一个新变更 | POST `/api/workspaces/{ws}/changes/create` | `CreateChangeResponse` |
| `generateDocs(workspaceId, changeId, docTypes)` | 生成文档（内部转调 batch） | （见下） | `BatchGenerateResponse` |
| `batchGenerateDocuments(workspaceId, changeId, docTypes)` | 批量生成多类文档骨架 | POST `/api/workspaces/{ws}/changes/{cid}/documents/batch-generate` | `BatchGenerateResponse` |

类型：
- `CreateChangeInput`/`CreateChangeResponse`：变更创建入参与返回（含 change id 等，字段以源码为准）。
- `GenerateDocsInput`：`{ doc_types: string[] }`。
- `BatchGenerateResponse`：`{ generated: string[] }`（成功生成的文档类型列表）。

## 关键逻辑
```
generateDocs 是 batchGenerateDocuments 的薄包装：
  注释说明单文档 /generate 端点需要 {doc_type, content}（用于上传已有内容），
  而批量生成才是"创建骨架"，故统一走 batch-generate
batch-generate 入参为 { doc_types: [...] }，返回实际生成的类型数组
```

## 注意事项
- 切勿把本模块 `createChange` 与 `lib-changes.createChange` 混用，二者签名与用途不同（本模块面向"文档骨架生成"，lib-changes 面向"生命周期管理"）。
- `doc_types` 取值与 SillySpec 文档类型对齐（如 proposal/design/tasks 等），传错会被后端忽略或报错。
- 批量生成为同步返回生成结果列表，不涉及流式。
- `generateDocs` 实际不发独立请求，仅转发给 batch 端点。
- `_module-map` 标注 used_by 为空，目前无页面直接调用（多为 Agent 内部触发）。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
