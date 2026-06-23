---
schema_version: 1
doc_type: module-card
module_id: lib-runtime
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-runtime

## 定位
工作空间级"运行时进度与产物"的前端只读 API 客户端。查询 SillySpec 驱动的工作空间当前所处阶段/步骤进度、用户原始输入、以及运行产物（artifacts）列表与内容。对应 `/api/workspaces/{ws}/runtime*`。供 RuntimePage 展示执行流水。

## 契约摘要
| 函数 | 语义 | HTTP | 返回 |
|---|---|---|---|
| `getRuntimeProgress(workspaceId)` | 取当前进度（阶段/步骤/状态） | GET `/api/workspaces/{ws}/runtime` | `RuntimeProgress \| null` |
| `getRuntimeUserInputsRaw(workspaceId)` | 取用户输入的原始文本 | GET `/api/workspaces/{ws}/runtime/user-inputs/raw` | `string` |
| `getRuntimeArtifacts(workspaceId)` | 列出产物文件 | GET `/api/workspaces/{ws}/runtime/artifacts` | `ArtifactEntry[]` |
| `getRuntimeArtifactContent(workspaceId, filename)` | 取单个产物文件内容 | GET `/api/workspaces/{ws}/runtime/artifacts/{filename}` | `string` |

类型：
- `RuntimeProgress`：`version/project/current_stage/current_change/stages: Record<string, StageProgress>/last_active`。
- `StageProgress`：`status/steps: StageStep[]/started_at/completed_at`。
- `StageStep`：`name/status/started_at/completed_at/output`。
- `ArtifactEntry`：产物条目（filename 等，字段以源码为准）。

## 关键逻辑
```
getRuntimeProgress 可能返回 null（工作空间无活跃运行时）
raw/artifact-content 端点返回 text/plain，函数内做 string 类型守卫：
  typeof res === "string" ? res : ""
filename 用 encodeURIComponent 编码进 URL
```

## 注意事项
- `stages` 是按阶段名索引的 map，调用方遍历需自行排序（按业务阶段顺序）。
- 产物内容为纯文本返回，二进制产物不在此接口范围。
- `current_stage`/`current_change` 指示当前焦点，便于 UI 高亮。
- 进度数据非实时推送，刷新靠调用方轮询。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
