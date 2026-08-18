---
schema_version: 1
doc_type: module-card
module_id: lib-utils
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 通用工具函数集（lib-utils）

## 定位

前端通用工具函数与展示标签常量集合，横跨 5 个文件（utils / client-path /
workspace-path / format-token / status-labels）。纯函数 + 常量导出，无请求无状态，
是 UI 原语、布局组件、移动端与多数页面的底层叶子依赖。

## 契约摘要

- `utils.ts`：
  - `cn(...inputs: ClassValue[]): string` — `twMerge(clsx(inputs))`，Tailwind
    class 合并去重的唯一入口（shadcn 风格组件全部用它）。
  - `asString(value: unknown): string` — 任意值安全转 string，null/undefined → ""。
- `client-path.ts`：`normalizeClientPath(path): string` — daemon 机器上的绝对路径
  规范化，Windows 盘符/UNC（`X:\`、`\\`）统一反斜杠并去重，其余统一正斜杠。
- `workspace-path.ts`：`formatDaemonRuntimeSummary(runtime): string`（label+版本+
  在线状态中文名）、`daemonRuntimeStatusVariant(runtime): "success" | "outline" |
  "destructive"`（Badge 变体；无 runtime → destructive）。
- `format-token.ts`：`formatTokenCount(n): string` — null → "—"、0 → "0"（区分
  未开始与零消耗）、<1000 原值、k/M 一位小数。
- `status-labels.ts`：`STATUS_LABELS`、`DAEMON_RUNTIME_STATUS_LABELS`、
  `AUDIT_RESOURCE_TYPE_LABELS`、`RISK_LABELS`、`GIT_IDENTITY_STATUS_LABELS` 五张
  中文映射表 + `labelOf(map, value)`（命中返中文，未命中原样返回，null/空 → "—"）。

## 关键逻辑

```
cn:          twMerge(clsx(inputs))
normalize:   isWindowsAbsPath ? 全转"\"并折叠 : 全转"/"
formatToken: n==null→"—"; n<1000→原值; <1e6→"X.Xk"; 否则"X.XM"
labelOf:     map[value] ?? value（null/"" → "—"）
```

## 注意事项

- `asString` 的存在动机：SSE 推送的 `content_redacted` 偶发 number/object 脏值，
  渲染链路 `.split("\n")` 只有 `?? ""` 降级防不住，会整页崩（ql-20260620）；
  日志渲染入口必须经它归一化。
- `workspace-path.ts` 原 path-source 系列（类型别名 + 判定/文案函数）已随
  2026-07-10-remove-server-local-workspace-mode 移除，仅剩 runtime 展示两个函数；
  `APPROVAL_STATUS_LABELS` 也已从 status-labels.ts 删除——按旧索引引用会编译错。
- status-labels 只汉化**面向用户的状态枚举**；技术标识符（日志频道 INFO/TOOL、
  Claude 工具名、字段名）保留英文，别往表里加。
- `formatDaemonRuntimeSummary` 的 label 回退链：name → provider → id 前 8 位。
- 有单测：`client-path.test.ts` / `workspace-path.test.ts` / `format-token.test.ts`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
