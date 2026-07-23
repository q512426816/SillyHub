---
id: task-09
title: frontend 测试（渲染分流/聚合去重/上下文条/跳转/SSE占位→回填）
title_zh: 前端组件与聚合测试
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-06, task-07, task-08]
blocks: [task-10]
allowed_paths:
  - frontend/src/components/permissions/session-permission-panel.test.tsx
  - frontend/src/components/permissions/dialog-context-bar.test.tsx
provides:
  fields: [frontend_tests]
expects_from:
  task-06:
    needs: ["approvals aggregation"]
  task-07:
    needs: ["dialog_kind render split"]
  task-08:
    needs: [DialogContextBar]
---

# task-09 · 前端组件与聚合测试

## 目标

为 task-06/07/08 的前端改动补单测，覆盖：渲染分流（dialog_kind 有无）/ SSE+查询
聚合去重 / 来源上下文条 / 跳转入口 / SSE 占位→查询回填。对应 design §4.2/§4.3/§4.4，
收口 AC-1/2/3/5/6 的前端侧验收（AC-8 测试维度）。

## 实现

**`session-permission-panel.test.tsx`**（新建，参照 `ask-user-dialog-card.test.tsx` 的
`vi.mock("@/stores/session")` + `vi.spyOn(fetch)` 模式）：

- **test_渲染分流**：mock `sessionIds` + 触发 SSE onmessage。
  - `dialog_kind` 非空 → 断言渲染 `AskUserDialogCard`（找到 header/question 文本或 badge）；
  - `dialog_kind` 缺失 → 渲染 `PermissionApprovalCard`（allow/deny 按钮文本）。
- **test_聚合去重**：同 `request_id` 的 SSE 推入与查询结果注入合并后只出现一张卡；
  permission_resolved（`decision` 字段）按 `request_id` 移除卡片。
- **test_SSE占位→回填**：SSE 推入时 `session_type`/`run_summary` 为 undefined → 卡片
  来源条显示占位「加载中」；查询注入同 `request_id` 带真实来源字段 → 占位被覆盖回填
  （design §4.4 C4：查询覆盖 SSE 占位，不反向）。

**`dialog-context-bar.test.tsx`**（新建，task-08 提供 `DialogContextBar`）：

- **test_上下文条**：渲染 workspace_name · session_type badge（scan/对话/stage）·
  会话链接 · 时间 · run_summary（空则占位「会话进行中」）。
- **test_跳转**：会话链接 `href` 含 `/runtimes?session=<session_id>`（design §4.4 C8 +
  R-2，复用 runtimes/page.tsx `?session=` query 解析）；运行链接按 `run_id` 跳转。

## 验收标准

- AC-1/2：scan/stage + 普通对话触发 AskUserQuestion，分流到 `AskUserDialogCard`（测试断言）。
- AC-3：上下文条字段齐全 + 跳转 `href` 正确（`/runtimes?session=<id>`）。
- AC-5：SSE 占位「加载中」→ 查询回填覆盖（断言字段值变化）。
- AC-6：无 `dialog_kind` 仍渲染 `PermissionApprovalCard`。
- 既有前端测试零回归（`ask-user-dialog-card.test.tsx` 等不挂）。

## 验证

```bash
cd frontend && pnpm test
```

vitest run 全量绿（含新增两份测试文件 + 既有组件测试）。

## 约束

- **markdown-text jsdom null 坑**（memory `frontend-markdown-text-jsdom-null`）：凡渲染走
  `markdown-text.tsx`（`next/dynamic ssr:false`）的组件，jsdom 同步 render 处于 loading 返回
  null 致 `getByText` 失败。测试文件顶部 `vi.mock("@/components/markdown-text", ...)` 改纯文本
  渲染（测父组件分流/聚合逻辑，非 markdown 库本身）。
- **console.error 静默坑**（memory `react-query-migration-status`）：测试触发的预期错误（如 SSE
  解析失败兜底分支）会冒泡 console.error 污染输出，按需 `vi.spyOn(console, "error").mockImplementation(() => {})`
  或断言后恢复。
- 中文断言文本 + 中文注释（CLAUDE.md §11 / §15）。
- SSE onmessage 测试构造 `MessageEvent<string>`（payload = `JSON.stringify`），与现有
  `session-permission-panel.tsx:50` 解析路径一致。
