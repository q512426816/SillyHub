---
schema_version: 1
doc_type: module-card
module_id: lib-errors
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 错误文案与通知（lib-errors）

## 定位
前端错误文案与 antd 通知的统一入口（`frontend/src/lib/errors.ts` + 同名单测）。承接 `lib-api` 抛出的 `ApiError`，提供「取中文文案 `errMessage`」纯函数与「toast 通知 `useNotify`」hook，是全仓错误展示事实上的标准（非测试导入方 27 处，覆盖 pages / components / stores）。消灭 D 反模式（把英文 `HTTP_xxx` code 拼给中文用户）。无领域语义，纯表现层辅助。

## 契约摘要
- `errMessage(err: unknown, fallback?: string): string` — 纯函数，从任意错误取面向用户的中文文案，**任何分支绝不返回 `err.code`**（D-006@v1 铁律）。规则按顺序：① `ApiError` 且 `code === "network_error"` → 「网络连接失败，请检查网络后重试」（此时 err.message 是英文 `Failed to fetch`，不可展示）；② 其它 `Error` 且 message 非空 → `err.message`（后端 AppError.message 已是中文）；③ 否则 → `fallback ?? "操作失败"`。
- `useNotify()` → `{ error(err, fallback?), success(msg), warning(msg) }` — 封装 antd `App.useApp().message` + `errMessage`。**必须在 `<AntApp>` 内调用**（`components/antd-providers.tsx` 已全局包裹 dashboard，所有 dashboard 路由可直接用）。
- 测试（`errors.test.ts`）：errMessage 全分支 + 铁律断言（返回值不含 `HTTP_` / 业务码 / `Failed to fetch`）；useNotify 不测（需 renderHook + AntApp provider，收益低）。

## 关键逻辑
```
errMessage(err, fallback?):
  if err instanceof ApiError && err.code === "network_error": return 网络失败中文兜底
  if err instanceof Error && err.message:                    return err.message
  return fallback ?? "操作失败"
useNotify():
  const { message } = App.useApp()      // hook 内取 context，不缓存
  error/success/warning → message.error(errMessage(...)) / success / warning
```

## 注意事项
- **展示策略按场景区分**（error-message-l10n design §5）：操作类（删/建/改/启停）→ toast（`useNotify`）；页面加载 / 列表拉取失败 → inline 红条 `setError(errMessage(err))`，不走 toast；表单校验 → antd Form inline；危险操作二次确认 → `App.useApp().modal.confirm`（非 `window.confirm`）。
- 登录页 / 顶层 error-boundary 等不在 `<AntApp>` 内的位置不要用 `useNotify`，改 `errMessage` + 自行控制展示。
- store 层（如 `stores/kanban.ts`）不能用 hook，错误文案用 `errMessage` + 静态 message 字段。
- fallback 用于已知操作语义且后端可能空 message 的场景（如 `errMessage(err, "删除失败，请稍后重试")`）；默认「操作失败」是兜底的兜底。
- **固定文案误传陷阱（ql-20260903-012）**：`notify.error("某文案")` 把文案当 err 传入 → 被 `errMessage` 吞成「操作失败」。catch 里有错误对象时写 `notify.error(err, "某文案")`；纯固定提示走 `notify.warning("某文案")`（warning 直接收文案）。全仓曾有两处此误用，`errors.test.ts` 用例 7 已固化该契约。
- scan 重生本文档会保留 5 个标准 section，展示策略规范就写在本区，勿新增「变更记录」类 section。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
