---
author: qinyi
created_at: 2026-06-25T09:51:22+08:00
change: 2026-06-25-frontend-error-handling
project: frontend
status: draft
---

# Design — 前端错误处理规范化

> brainstorm 阶段产出。配套原型：`prototype-frontend-error-handling.html`。

## 1. 背景

后端错误响应规范早已统一：`AppError` 经 `register_exception_handlers`（`backend/app/core/errors.py:321-351`）翻译成 `{ code, message, request_id, details }`，`message` 为中文（如 daemon runtime 被绑定时的「该 daemon 仍被 N 个 workspace 绑定…」）。前端数据层 `lib/api.ts` 的 `apiFetch` 也已按此规范解析并抛 `ApiError`（`code/status/requestId/details/message`），后端中文 message 原样落到 `err.message`。

**问题在前端业务层（catch 处）**：调研发现 5 种错误处理模式并存，没有统一的 `showError` util：

| 模式 | 取值 | 问题 |
|---|---|---|
| A. inline 红条 `setError(err.message)` | err.message | dashboard 主流，~20 处 |
| B. antd `message.error(err.message)` | err.message | ppm 主流 |
| C. `err.code` 业务码映射 | err.code | 仅 `admin/users` 1 处 |
| **D. `${err.code}: ${err.message}`** | code+message | **把英文 `HTTP_409_…` 暴露给中文用户（反模式），~8 处** |
| E. 局部 `errMessage(err,fallback)` util | err.message | **重复实现 3 次**（kanban / ppm problem-list / problem-changes），没人抽全局 |

直接诱因：DELETE daemon runtime 被绑定返回 409 时，前端虽能拿到中文 message，但因业务层不统一，体验割裂；且 D 模式会把英文 code 弹给用户。

## 2. 设计目标

- **G1** 所有业务错误经统一 `errMessage(err, fallback?)` 取中文文案，消灭 D 反模式（暴露英文 code）。
- **G2** 按场景统一展示策略：操作类 toast、加载/列表 inline、表单字段 inline、二次确认 antd `Modal.confirm`。
- **G3** daemon runtime 删除作为首个落地场景：409 友好 toast + 成功 toast + `window.confirm`→`Modal.confirm`。
- **G4** 合并 3 处重复的局部 `errMessage` util 为全局 `lib/errors.ts`。

## 3. 非目标（YAGNI）

- **N1** 不维护前端 `code→中文` 映射表（后端 message 已是中文，避免双源漂移）。
- **N2** 不强改 store 层静态 `message`（`stores/kanban.ts` 等），本次聚焦组件层。
- **N3** 不全量收敛全站 80+ 处错误处理，仅收敛 D 反模式 ~8 处 + 合并 3 重复。
- **N4** 不改 `apiFetch` / `ApiError` 契约（已有 `api.test.ts` 覆盖）。
- **N5** 成功 toast 仅在 daemon 删除补范例，不扩展到全站创建/更新。

## 4. 拆分判断

本次为内聚的「错误处理规范化」，无多角色 / 无跨页状态流转 / 模块内聚，**不拆分**。D 模式收敛 ~8 处属相似小改且 < 10，**不走批量引擎**（plan 里作为同 Wave 多 task）。

## 5. 总体方案

### 展示策略规范（写进模块文档作为约定）

| 场景 | 展示方式 | 入口 |
|---|---|---|
| 操作类（删/建/改/启停，用户主动触发） | antd toast 即时反馈 | `useNotify().error/.success` |
| 页面加载 / 列表拉取 / 详情获取失败 | inline 红条（保留上下文） | `setError(errMessage(err))` |
| 表单字段校验 | inline 字段错误 | 现有方式 |
| 危险操作二次确认 | antd `Modal.confirm`（非 `window.confirm`） | `App.useApp().modal` |

**铁律**：任何路径都不把 `err.code`（英文 `HTTP_xxx`）拼给用户。

### Wave 划分

- **Wave 1 — 基础设施**：新增 `lib/errors.ts`（`errMessage` + `useNotify`）+ 单测。可独立验证。
- **Wave 2 — 首场景落地**：`runtimes/page.tsx` daemon 删除（Modal.confirm + notify）。端到端验证 409/204/404。
- **Wave 3 — 收敛**：D 模式 ~8 处 + 合并 3 处重复 util。依赖 Wave 1。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/lib/errors.ts` | `errMessage` 纯函数 + `useNotify` hook |
| 新增 | `frontend/src/lib/errors.test.ts` | errMessage 各分支单测（network 兜底/业务中文/非 ApiError/fallback） |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | handleDeleteRuntime：window.confirm→Modal.confirm，失败 setError→notify.error，成功补 notify.success |
| 修改 | `frontend/src/stores/kanban.ts` | 局部 errMessage（:181-185）改 import 全局 |
| 修改 | `frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx` | 同上 |
| 修改 | `frontend/src/app/(dashboard)/ppm/problem-changes/_forms.tsx` | 同上 |
| 修改 | `settings/api-keys/page.tsx` 等 16 处 | D 模式 `${code}: ${message}` → errMessage/notify（保持原 toast/inline 展示方式） |

> D 模式精确清单（Design Grill grep 实测 **16 处**）：`api-key-create-dialog.tsx:53`、`daemon-dir-browser.tsx:49`、`health-card.tsx:35`、`server-status-card.tsx:77`、`workspace-scan-dialog.tsx:92/111/125/142`(4)、`workspaces/[id]/members/page.tsx:57/82/110/131`(4)、`workspace-member-add-dialog.tsx:78/129`(2)、`settings/api-keys/page.tsx:50/82`(2)。

## 7. 接口定义

```ts
// frontend/src/lib/errors.ts

/** 从任意错误取出面向用户的中文文案。绝不暴露 err.code。 */
export function errMessage(err: unknown, fallback?: string): string;
//  - ApiError 且 code === "network_error" → "网络连接失败，请检查网络后重试"
//  - 否则 err.message（后端业务错误已中文）
//  - 无 message / 非 Error → fallback ?? "操作失败"

/** 组件内统一的通知入口（封装 antd App.useApp().message + errMessage）。必须在 <AntApp> 内使用。 */
export function useNotify(): {
  error: (err: unknown, fallback?: string) => void;   // messageApi.error(errMessage(err, fallback))
  success: (msg: string) => void;                      // messageApi.success(msg)
  // info/warning 按需扩展
};
```

依赖：`ApiError`（`lib/api.ts`，仅类型判断 `instanceof ApiError` + 读 `code`/`message`）、antd `App.useApp()`。

## 7.5 生命周期契约表

**不适用**。本次仅涉及 daemon runtime `DELETE` 端点的**前端错误展示**，不涉及后端 session/lease/agent_run/heartbeat 等 lifecycle 事件或状态转换（daemon runtime 删除的后端逻辑已在独立 quick `ql-20260625-001-b9e4` 完成）。无新增 lifecycle 事件，故省略此表。见 R-04。

## 8. 数据模型

无。纯前端，不涉及任何表结构 / 字段变更。

## 9. 兼容策略（brownfield）

- `errMessage` / `useNotify` 为**新增**，不改 `apiFetch`/`ApiError`，未接入的页面行为完全不变（渐进式）。
- D 模式收敛是**等价替换**：`${code}: ${message}` → `errMessage(err)`，原展示方式（toast/inline）保持，仅文案去掉英文 code。
- 合并 3 处局部 util：局部函数行为与全局 `errMessage` 等价（都取 `err.message ?? fallback`），替换无行为差异（全局版多了 network 兜底，是增强）。
- daemon 删除 UX 变化（`window.confirm`→`Modal.confirm`、inline→toast）属改善，无数据兼容问题。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | `useNotify` 依赖 `App.useApp()`，须在 `<AntApp>` 内调用 | P1 | dashboard layout 已被 `antd-providers.tsx` 的 `<AntApp>` 包裹；调用点均在 dashboard 内。Wave 2 验证。 |
| R-02 | D 模式 **16 处**（Grill grep 实测，多于初估 8）收敛可能误改展示方式或遗漏 | P1 | 清单已精确化（§6）；每处标注原展示方式；verify grep 残留 `${.*code.*}:` 应为 0 |
| R-03 | store 层静态 `message` 本次不强改，与新规范暂时不一致 | P2 | 记录为遗留，后续单独变更收敛（N2）。 |
| R-04 | daemon 关键词命中 7.5 检查，但本次无 lifecycle 事件 | P2 | 已在 7.5 明确不适用并说明理由。 |
| R-05 | `Modal.confirm` 替换 `window.confirm` 改变二次确认 UX | P2 | 视觉更一致，沿用 destructive 主题；低风险。 |
| R-06 | `runtimes/page.tsx` 已有 `runtimes/page.test.tsx`，Wave 2 改动可能破坏 | P2 | Wave 2 实现后跑 `pnpm test runtimes/page`；必要时同步更新测试 |

## 11. 决策追踪

| 决策 ID | 内容 | 覆盖 |
|---|---|---|
| D-001@v1 | errMessage util 设计：优先 err.message，network_error 中文兜底 | FR-01 / §5 / §7 |
| D-002@v1 | fallback 策略：签名 `errMessage(err, fallback?)`，默认 "操作失败" | FR-01 / §7 |
| D-003@v1 | 成功 toast 仅 daemon 删除范例，不扩展全站 | N5 |
| D-004@v2（supersedes D-004@v1） | D 模式精确清单 16 处（Grill grep 实测，含 members/page.tsx） | FR-04 / §6 |
| D-005@v1 | 方案 B：util + useNotify hook（否决 A 仅纯函数 / C 全局 static） | §5 / §7 |
| D-006@v1 | 不做 code→中文映射表（后端 message 已中文） | N1 |
| D-007@v1 | 展示策略按场景区分（操作 toast / 加载 inline / 表单 inline / 确认 Modal） | §5 |

## 12. 自审

- ✅ 文件清单覆盖新增 + 落地 + 收敛 + 合并四类，无遗漏大类。
- ✅ 接口签名明确，依赖（ApiError / App.useApp）已存在。
- ✅ lifecycle 关键词 daemon 命中，但本次无 lifecycle 事件，7.5 已说明不适用（R-04）。
- ✅ 兼容策略明确渐进式，不破坏现有契约。
- ✅ YAGNI 边界（N1-N5）清晰，避免 scope creep。
- ⚠ D 模式精确清单（D-004）留待 plan，已登记 R-02 应对。
