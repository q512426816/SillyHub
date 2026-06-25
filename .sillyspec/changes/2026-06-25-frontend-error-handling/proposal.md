---
author: qinyi
created_at: 2026-06-25 10:06:00
change: 2026-06-25-frontend-error-handling
project: frontend
---

# Proposal — 前端错误处理规范化

## 动机

后端错误响应规范早已统一：`AppError` → `{ code, message(中文), request_id, details }`（`backend/app/core/errors.py:321-351`）。前端数据层 `lib/api.ts` 的 `apiFetch` 也已按规范抛 `ApiError`，后端中文 message 原样落到 `err.message`。**接口数据是通的**，问题在前端业务层（catch 处）错误处理不统一，导致业务错误（典型：DELETE daemon runtime 被绑定返回 409）无法一致、友好地展示。

## 关键问题（现有方案为何不够）

1. **5 种错误处理模式并存，无全局 showError util** —— 同一类业务错误在不同 UI 位置提示方式不同（列表页 inline 红条 vs ppm 表单 toast vs 别处硬编码），体验割裂，维护时不知该跟哪个范式。
2. **D 反模式 16 处把英文 `err.code` 拼给中文用户**（`${err.code}: ${err.message}`）—— 用户看到 `HTTP_409_DAEMON_RUNTIME_IN_USE: 该 daemon 仍被...`，英文 code 是噪音。
3. **局部 `errMessage` util 重复实现 3 次**（`stores/kanban.ts`、`ppm/problem-list/_forms.tsx`、`ppm/problem-changes/_forms.tsx`），逻辑几乎相同却没人抽全局，改一处忘其他两处。

## 变更范围

- 新增 `frontend/src/lib/errors.ts`：`errMessage(err, fallback?)` 纯函数（network_error 中文兜底）+ `useNotify()` hook（封装 antd `App.useApp().message`）+ 单测。
- daemon runtime 删除落地（`runtimes/page.tsx`）：`window.confirm`→`Modal.confirm`，失败 `notify.error`（409 友好中文），成功补 `notify.success`。
- D 模式 16 处收敛：`${code}: ${message}` → `errMessage`/`notify`（保持原 toast/inline）。
- 合并 3 处重复局部 `errMessage` util → import 全局。
- 展示策略规范写入模块文档。

## 不在范围内（显式清单）

- **不做** 前端 `code→中文` 映射表（后端 message 已中文，避免双源）。
- **不做** store 层静态 `message` 强改（kanban.ts 等，本次聚焦组件层）。
- **不做** 全量收敛全站 80+ 处错误处理（仅 D 反模式 16 处 + 合并 3 重复）。
- **不做** `apiFetch`/`ApiError` 契约变更。
- **不做** 成功 toast 全站铺开（仅 daemon 删除补范例）。

## 成功标准（可验证）

- `errMessage` 对业务错误返回后端中文 `message`；对 `network_error` 返回中文「网络连接失败，请检查网络后重试」；**绝不返回 `err.code` 或英文浏览器 message**（单测覆盖）。
- daemon runtime 被 workspace 绑定时，点删除得到友好中文 toast 提示去解绑（而非 500/英文 code/无反馈）。
- D 模式 16 处全部收敛，`rg '\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]' frontend/src` 残留 = 0。
- 现有 `lib/api.test.ts` / `runtimes/page.test.tsx` 不破坏；`pnpm test` 全绿；`tsc --noEmit` 0 error。
- 未接入新 util 的页面行为完全不变（渐进式，零回归）。
