---
schema_version: 1
doc_type: module-card
module_id: lib-errors
source_commit: dffcdacd
author: qinyi
created_at: 2026-06-25T12:25:00+08:00
---
# lib-errors

## 定位
前端错误文案 + 通知的统一入口（`frontend/src/lib/errors.ts`）。承接 `lib-api` 抛出的 `ApiError`，向上层组件/页面/store 提供「取中文文案（`errMessage`）」与「antd 通知（`useNotify`）」两个能力，消灭 D 反模式（`${code}: ${message}` 把英文 `HTTP_xxx` 暴露给中文用户）与重复局部 util。不携带任何领域语义，纯表现层辅助。

## 契约摘要
- `errMessage(err: unknown, fallback?: string): string` — 纯函数，从任意错误取面向用户的中文文案。**绝不返回 `err.code`**。规则（按顺序匹配）：
  - `ApiError` 且 `code === "network_error"` → 「网络连接失败，请检查网络后重试」（apiFetch catch fetch 异常时抛此 code，err.message 此时是英文 `Failed to fetch`，不能直接展示）。
  - 否则 `Error` 且 `err.message` 非空 → `err.message`（后端 `AppError.message` 已是中文）。
  - 否则 → `fallback ?? "操作失败"`（兜底的兜底）。
- `useNotify(): { error(err, fallback?): void; success(msg): void }` — hook，封装 antd `App.useApp().message` + `errMessage`。**必须在 `<AntApp>` 内调用**（dashboard layout 已被 `components/antd-providers.tsx` 的 `<AntApp>` 包裹，所有 dashboard 路由均可直接调用）。
  - `error(err, fallback?)` = `messageApi.error(errMessage(err, fallback))`。
  - `success(msg)` = `messageApi.success(msg)`。

依赖：`ApiError`（`lib-api`，仅 `instanceof` 类型判断 + 读 `code`/`message`）、antd `App.useApp()`。

## 关键逻辑
```
errMessage(err, fallback?):
  if err instanceof ApiError && err.code === "network_error":
    return "网络连接失败，请检查网络后重试"   # 网络层失败，后端无业务 message，err.message 是英文 Failed to fetch
  msg = (err as Error)?.message
  if typeof msg === "string" && msg.length > 0:
    return msg                              # 后端业务错误，message 已是中文
  return fallback ?? "操作失败"              # 兜底
# 铁律：任何分支都不读 err.code 拼进文案（code 是英文 HTTP_xxx）

useNotify():
  messageApi = App.useApp().message         # 每次调用走 hook 取最新 context，不在 hook 外缓存
  return {
    error:   (err, fallback?) => messageApi.error(errMessage(err, fallback)),
    success: (msg)           => messageApi.success(msg),
  }
```

## 注意事项
> **重要**：依据记忆 `scan-regenerates-module-docs.md`，sillyspec-scan 重生模块文档时会删除手动追加的「变更记录」section，但保留 5 个标准 section 的内容。展示策略规范写进本区，不要新增「变更记录 / Change Log」section。

1. **【铁律】绝不把 `err.code` 拼给用户**。`err.code` 是英文 `HTTP_xxx`（如 `HTTP_409_DAEMON_RUNTIME_IN_USE`），暴露给中文用户是 D 反模式（design §1）。任何展示路径都走 `errMessage(err)` 或 `notify.error(err)`，文案只来自后端中文 message / network 兜底 / fallback。用例 6（`errors.test.ts`）已断言所有分支返回值不含 `HTTP_` / 业务码 / `Failed to fetch`。

2. **【展示策略规范·按场景区分】**（D-007@v1，源自 design §5）：

   | 场景 | 展示方式 | 入口 |
   |---|---|---|
   | 操作类（删/建/改/启停，用户主动触发） | antd toast 即时反馈 | `useNotify().error/.success` |
   | 页面加载 / 列表拉取 / 详情获取失败 | inline 红条（保留页面上下文） | `setError(errMessage(err))` |
   | 表单字段校验失败 | inline 字段错误 | 现有 antd Form 校验方式 |
   | 危险操作二次确认 | antd `Modal.confirm`（**非** `window.confirm`） | `App.useApp().modal` |

   选型理由：操作类需即时反馈且不依赖页面位置 → toast；加载类失败需保留已渲染列表/详情上下文 → inline；二次确认需统一 destructive 主题与样式 → `Modal.confirm`。

3. **useNotify 调用约束**：必须在 `<AntApp>` 内调用。当前 dashboard layout（`components/antd-providers.tsx`）已全局包裹 `<AntApp>`，故所有 dashboard 内页面/组件均可直接 `useNotify()`。**登录页 / 顶层 error-boundary 等不在 `<AntApp>` 内的位置不要用 useNotify**，改用 `errMessage(err)` + 自行控制展示（design R-01）。

4. **范例（task-04 落地）**：daemon runtime 删除是首场景，完整展示三条策略：失败 `notify.error(err)`（409 时弹后端中文「该 daemon 仍被 N 个 workspace 绑定…」而非英文 code）、成功 `notify.success("运行时已移除")`、二次确认 `App.useApp().modal.confirm({...})` 取代 `window.confirm`。详见 `app/(dashboard)/runtimes/page.tsx` 的 `handleDeleteRuntime`。

5. **store 层例外**（design N2 / R-03 遗留）：`stores/kanban.ts` 等 zustand store 内不能用 hook（`useNotify`），store 错误文案用 `errMessage(err)` + 静态 `message` 字段（task-07 已把 store 局部 errMessage 改 import 全局）。

6. **fallback 用法**：当 catch 处已知操作语义、且后端可能返回空 message 时，传业务化 fallback，如 `errMessage(err, "删除失败，请稍后重试")`。默认 fallback「操作失败」是兜底的兜底。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
