---
schema_version: 1
doc_type: module-card
module_id: lib-utils
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# lib-utils

## 定位
前端通用工具函数与展示标签常量的集合，横跨 5 个文件。提供 Tailwind class 合并、路径规范化、工作区路径标签、token 数格式化、各类状态/资源枚举的中文标签映射，是几乎所有 UI 组件与页面的底层依赖。无请求、无状态，纯函数 + 常量导出。

## 契约摘要
- `utils.ts`：
  - `cn(...inputs: ClassValue[]): string` — Tailwind class 合并（`clsx` + `tailwind-merge`，shadcn 标准）。
  - `asString(value: unknown): string` — 安全转字符串：string 直返，null/undefined → `""`，其余 `String(value)`。防 SSE 日志 number/object 让 `.split` 崩溃。
- `client-path.ts`：工作区文件树路径工具。
  - `normalizeClientPath(path): string` — 规范化（去首尾斜杠、统一分隔）。
  - `joinClientPath(base, name): string` — 拼接子路径。
  - `parentClientPath(path): string | null` — 取父路径。
- `workspace-path.ts`：工作区路径来源标签。
  - `isDaemonClientWorkspace(workspace): boolean` — 是否 daemon client 类型工作区。
  - `workspacePathSourceLabel(pathSource): string` — 路径来源中文标签。
  - `workspaceRootPathLabel(pathSource): string` — 根路径标签。
  - `formatDaemonRuntimeSummary(...): string` — daemon 运行时摘要文本。
  - `daemonRuntimeStatusVariant(...)` — 状态对应的 UI variant。
- `format-token.ts`：`formatTokenCount(n): string` — token 数人类可读格式（k/m 缩写等）。
- `status-labels.ts`：枚举 → 中文标签的常量与兜底函数。
  - 常量：`STATUS_LABELS` / `DAEMON_RUNTIME_STATUS_LABELS` / `AUDIT_RESOURCE_TYPE_LABELS` / `APPROVAL_STATUS_LABELS` / `APPROVAL_ACTION_LABELS` / `RISK_LABELS` / `GIT_IDENTITY_STATUS_LABELS`。
  - `labelOf(map, value): string` — 从映射取标签，未命中**原样返回 value**（避免显示 undefined）。

## 关键逻辑
```
cn(...inputs):  twMerge(clsx(inputs))   // 去冲突 class（如 px-2 px-4 → px-4）
asString(v):    typeof v==="string"?v : v==null?"" : String(v)
labelOf(map, value): map[value] ?? value   // 未命中不报错，回退原值
normalizeClientPath(p): 去首尾 "/"，统一格式，空 → 根标识
```

## 注意事项
- `asString` 是日志渲染链路防崩的关键入口：SSE 推送的 `content_redacted` 声明 str|None 但偶发 number/object，所有 `.split("\n")` 前必须经它归一化（否则 client-side exception）。
- `labelOf` 未命中返回原值而非空串——既保证不显示 undefined，也意味着调用方需确保传入的 value 本身可读，或自行兜底。
- 标签常量与后端枚举必须对齐：新增枚举值时同步补标签，否则会直接显示英文 code。
- `cn` 是 shadcn ui 基元依赖，所有 `components-ui` 组件都用到。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
