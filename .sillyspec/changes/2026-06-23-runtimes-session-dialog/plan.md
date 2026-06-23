---
plan_level: light
author: qinyi
created_at: 2026-06-23T15:50:00+08:00
---

# 轻量计划：/runtimes 会话弹窗化 + active 续聊

## 来源

brainstorm（`2026-06-23-runtimes-session-dialog`）结论：方案 B（新建 `RuntimeSessionDialog`），4 Phase（弹窗组件 / active 续聊 attach / 页面精简 / URL 恢复）。详见 `proposal.md` / `design.md` / `requirements.md` / `tasks.md`。

## 范围

- 新增：`frontend/src/components/daemon/runtime-session-dialog.tsx`（会话工作台弹窗）
- 新增：`frontend/src/components/daemon/runtime-session-helpers.tsx`（提取 `SessionsSidebar` / `SessionHistoryView` / `InteractiveSessionChatSection` / `logsToTurns` / `canResumeSession` / `isActiveSession` / `resumeDisabledTitle` / `ACTIVE_SESSION_VIEW_STATUSES`）
- 修改：`frontend/src/app/(dashboard)/runtimes/page.tsx`（移除底部常驻会话区、接 `dialogRuntime`、URL 恢复、卡片调大、helper 改 import）
- 修改：`frontend/src/app/(dashboard)/runtimes/page.test.tsx`（C-4 四处断言重写）
- 新增：`frontend/src/components/daemon/runtime-session-dialog.test.tsx`（弹窗渲染 / active attach / ended 续聊 / 关闭清理；co-located，与 `page.test.tsx` 约定一致）
- 模块文档同步：`app-pages.md` 人工备注（`ql007` active 只读→可续聊；`runtimes-layout` 会话区→弹窗）— verify 阶段处理
- 不涉及后端 / `lib/daemon.ts` API 变更

## Tasks

> 依赖：task-01 是 task-02/03/04 前置（helper 解耦）；task-04 依赖 task-01/02；测试（task-05/06）依赖实现；task-07 验收最后。

- [x] task-01: 提取会话 helper 到独立 helpers 文件 (Wave-1, 覆盖 NFR-5)
- [x] task-02: 新建 RuntimeSessionDialog 弹窗组件 (Wave-2, 覆盖 FR-01 FR-03)
- [x] task-03: active 会话走 attach 续聊 (Wave-3, 覆盖 FR-02)
- [x] task-04: page.tsx 精简并接弹窗与 URL 恢复 (Wave-3, 覆盖 FR-03 FR-05 FR-06)
- [x] task-05: 更新 page.test.tsx 四处断言重写 (Wave-4, 覆盖 R-05)
- [x] task-06: 新增弹窗组件测试文件 (Wave-4, 覆盖 FR-01 FR-02 FR-04 FR-05)
- [x] task-07: lint 与 tsc 与 vitest 全绿 (Wave-5, 覆盖 NFR-4)

## Wave 分组（基于 depends_on 拓扑重排）

- **Wave 1**：task-01（无依赖）
- **Wave 2**：task-02（依赖 01）
- **Wave 3**：task-03、task-04（均依赖 01+02，互不依赖，可并行）
- **Wave 4**：task-05（依赖 04）、task-06（依赖 02/03）
- **Wave 5**：task-07（依赖 01~06）
- **关键路径**：task-01 → task-02 → task-04 → task-05 → task-07（5 Wave）

## 验收

- **SC-1**：点 runtime 卡片「会话」→ 弹窗打开，左侧列出该 runtime 历史会话（task-02/05/06）
- **SC-2**：active 会话点开 → 可发送续聊（task-03/06）
- **SC-3**：ended/failed claude → 只读 + 「继续对话」可点 reopen（task-02/06）
- **SC-4**：codex ended → 只读，续聊按钮置灰（task-06）
- **SC-5**：弹窗关闭 → SSE/轮询清理无泄漏（task-02/04/06）
- **SC-6**：页面无底部常驻会话区，runtime 卡片更舒展（task-04/05）
- **SC-7**：活跃中刷新 → URL `?session=` 自动开弹窗 attach（task-04/05）
- **SC-8**：主动关闭弹窗 → 清 `?session=`，刷新不再自动弹（task-04/05）
- **SC-9**：`page.test.tsx` 全绿 + 新增弹窗测试通过（task-05/06）
- **SC-10**：`pnpm lint` + `tsc --noEmit` 通过（task-07）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 弹窗单例 | task-02, task-04 | SC-1, FR-01（单一 dialogRuntime） |
| D-002@v1 默认态 | task-02 | SC-1, FR-01（有活跃→attach 最近活跃） |
| D-003@v1 URL恢复(+onClose) | task-04 | SC-7, SC-8, FR-05/06 |
| D-004@v1 active复用attach | task-03 | SC-2, FR-02 |
