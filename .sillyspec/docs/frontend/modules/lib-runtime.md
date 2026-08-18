---
schema_version: 1
doc_type: module-card
module_id: lib-runtime
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 运行时进度客户端（lib-runtime）

## 定位
workspace 级「运行时进度与产物」只读 API 客户端（`frontend/src/lib/runtime.ts`，约 55 行）。查询 SillySpec 驱动的 workspace 当前阶段/步骤进度、用户原始输入、产物列表与内容。进度类型直接引用 OpenAPI 生成（`RuntimeProgress`/`StageProgress`/`StageStep`，对齐 backend runtime schema snake_case）。供 workspace 详情页（进度条）与 runtime 页（执行流水）消费。

## 契约摘要
| 函数 | HTTP | 返回 |
|---|---|---|
| `getRuntimeProgress(workspaceId)` | GET `/api/workspaces/{ws}/runtime` | `RuntimeProgress \| null` |
| `getRuntimeUserInputsRaw(workspaceId)` | GET `…/runtime/user-inputs/raw`（accept: text/plain） | `string`（非串守卫返 ""） |
| `getRuntimeArtifacts(workspaceId)` | GET `…/runtime/artifacts` | `ArtifactEntry[]` |
| `getRuntimeArtifactContent(workspaceId, filename)` | GET `…/runtime/artifacts/{filename}`（text/plain，filename encodeURIComponent） | `string` |

`ArtifactEntry`：`filename` / `size_bytes` / `last_modified`（手写 interface）。

## 关键逻辑
```
progress 无活跃运行时 → 后端返回 null（调用方判空渲染空态）
raw / artifact-content 端点返回 text/plain：
  typeof res === "string" ? res : ""   // 防后端异常时 JSON 错误体被当正文
```

## 注意事项
- 进度/步骤类型来自 gen:types（规则 20），后端 schema 改动须跑 `pnpm gen:types` 同步；`ArtifactEntry` 是手写例外。
- `stages` 是按阶段名索引的 map，遍历顺序由调用方按业务阶段序排。
- 数据非推送，刷新靠调用方轮询/重取。
- 仅依赖 `lib-api`；无 mutation（重解析走 `lib-workspaces.reparseWorkspace` 等别处）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
