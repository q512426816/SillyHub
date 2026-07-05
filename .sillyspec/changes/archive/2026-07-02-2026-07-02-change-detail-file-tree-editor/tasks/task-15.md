---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-15
title: 前端 change-file-tree 渲染 + 状态机 + 排队徽标 + jsdom vi.mock
priority: P1
depends_on: [task-10]
wave: W6
requirement_ids: [FR-09]
decision_ids: []
allowed_paths:
  - frontend/src/components/__tests__/change-file-tree.test.tsx
---

# task-15 — change-file-tree 组件单测

## 目标
为 task-10 的 `change-file-tree.tsx` 补 vitest 单测，覆盖文件树渲染（多文件含子目录→树结构）、文本文件选中→textarea 显示内容并保存、保存五态状态机（idle→saving→done 直收 / pending 轮询至 done / failed）、pending 文件「排队中」徽标、二进制文件只读（无 textarea）。

## 依据
- design.md §5 Phase4（前端文件树+编辑器+状态机）、§10 R-06（轮询 2s + visibilitychange 暂停）、§6 文件清单（本测试路径）。
- plan.md Wave6 task-15 行 + 全局验收「task-15 覆盖文件树渲染 + 5 态状态机 + 排队徽标（jsdom vi.mock）」。
- 范式 `frontend/src/components/__tests__/workspace-access-guide.test.tsx`：`vi.mock("@/lib/...")` 顶层置 mock → import 组件 + `vi.mocked(fn)` 取实例 → `beforeEach vi.clearAllMocks` → `render`/`findByText`/`waitFor`（fireEvent 触交互）。
- 范式 `frontend/src/lib/__tests__/scan-docs-tree.test.ts`：扁平 path 清单造树断言（参考其 buildTree 验证思路，迁移到组件层）。
- CONVENTIONS [[frontend-markdown-text-jsdom-null]]：组件若用 `next/dynamic` 的 MarkdownPreview，jsdom 下渲染为 null，测试文件顶部须 `vi.mock` 成纯文本渲染（测父组件逻辑非 markdown 库）。

## 测试要点
- `vi.mock("@/lib/change-files", () => ({ listChangeFiles: vi.fn(), getChangeFileContent: vi.fn(), saveChangeFileContent: vi.fn(), listPendingChangeFiles: vi.fn(), buildChangeFileTree: vi.fn(...) }))`，buildChangeFileTree 直接返手搓 `TreeNode[]`（解耦树构建逻辑，专注组件层）；后端完全解耦，不真发 fetch（apiFetch 不入测）。
- 用例：① 渲染——多文件含子目录（如 `design.md`/`tasks/task-01.md`/`references/x.md`）→ 左树节点与缩进层级正确；② 选中文本文件→`getChangeFileContent` resolve 内容 → textarea 同步可读（断 `screen.getByRole("textbox")` value）；③ 保存按钮→`saveChangeFileContent` 调用入参正确 → mock resolve `{status:"done"}` → 断「已保存」文案；④ mock resolve `{status:"pending"}` + 起始 `listPendingChangeFiles` 返含该 path → `vi.useFakeTimers`/`waitFor` 推进 2s 轮询 → 后续轮询返 path 消失 → 断转「已保存」；⑤ pending 文件出现在树中 → 「排队中」徽标可见；⑥ 二进制文件（`is_text=false`）选中 → 无 textbox，显示只读提示。
- 若组件 import MarkdownPreview：文件顶 `vi.mock("@/components/markdown-text", () => ({ MarkdownText: ({ content }: { content: string }) => <>{content}</> }))`（纯文本降级，jsdom 可读）。
- 异步范式：`async/await` + `findByText`/`waitFor`（不裸 `getByText` 抢未 resolve 的异步）；轮询用 `vi.useFakeTimers()` + `vi.advanceTimersByTime(2000)` 驱动，避免真睡；用例结束 `vi.useRealTimers()`。

## 验收标准
- `cd frontend && pnpm exec vitest run change-file-tree`：渲染 + 5 态状态机 + 排队徽标全绿。
- `cd frontend && pnpm exec tsc --noEmit`：本文件无类型告警。

## 约束
- vi.mock 解耦后端，禁真发网络请求（apiFetch 全程不入测）。
- 类型从 `@/lib/change-files`/`@/components/change-file-tree` 导入，勿内联重定义 TreeNode/props 类型（以 task-09/task-10 实际导出为准）。
- jsdom 下 textarea 同步可读（fireEvent.change 后断 value）；轮询须 fake timer 驱动且用例结束复原 real timer，防泄漏跨用例污染。
- `vi.clearAllMocks()` 在 beforeEach，断言 `toHaveBeenCalledWith` 干净。

## 风险
- task-10 状态机字段名/保存返回枚举字面量（`status: "done"|"pending"`）若与 task-09 返回结构偏差 → 测试 mock 返回值须以 task-09/10 实际类型为准适配，勿硬编码假设。
- 轮询 effect 在组件卸载/切文件时 clearInterval——若 task-10 漏清，单测 fake timer 可能跨用例残留定时器（断言用例独立 + 用例结束 useRealTimers 兜底）。
