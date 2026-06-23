---
author: qinyi
created_at: 2026-06-23T15:40:00+08:00
---

# Tasks: /runtimes 会话弹窗化 + active 续聊

> 仅列任务名称 / 文件路径 / 覆盖 FR/D，细节在 plan 阶段展开。

## Wave-1: helper 提取（解耦前置）

- [ ] **task-01** 提取会话 helper 到 `runtime-session-helpers.tsx`
  - 文件：`frontend/src/components/daemon/runtime-session-helpers.tsx`（新增）
  - 提取：`SessionsSidebar` / `SessionHistoryView` / `InteractiveSessionChatSection` / `logsToTurns` / `canResumeSession` / `isActiveSession` / `resumeDisabledTitle` / `ACTIVE_SESSION_VIEW_STATUSES`
  - 覆盖：NFR-5（前置依赖，避免循环）

## Wave-2: 弹窗组件

- [ ] **task-02** 新建 `RuntimeSessionDialog` 组件
  - 文件：`frontend/src/components/daemon/runtime-session-dialog.tsx`（新增）
  - 内容：props(`runtime`/`open`/`onClose`/`runtimes`) + 自管 `sessions`/`selected`/`logs`/`attachSession` + `DialogContent` override 尺寸（`max-w-[900px] h-[80vh] p-0`）+ 左列表右三态渲染 + 默认态（D-002）
  - 覆盖：FR-01, FR-03, D-001@v1, D-002@v1

- [ ] **task-03** active 会话走 attach 续聊
  - 文件：`runtime-session-dialog.tsx`（`handleSelect` 改造）
  - 内容：active → `getAgentSessionLogs` → `logsToTurns` → `setAttachSession` → `InteractiveSessionChatSection` attach（建 SSE + 轮询到 active + 启用发送）
  - 覆盖：FR-02, D-004@v1, R-01

## Wave-3: 页面接入

- [ ] **task-04** `page.tsx` 精简 + 接弹窗 + URL 恢复
  - 文件：`frontend/src/app/(dashboard)/runtimes/page.tsx`
  - 内容：移除底部 `SessionListSection` + `sessionSectionRef`；新增 `dialogRuntime`；`handleOpenSession` → `setDialogRuntime`；卡片调大；helper 改 import；URL `?session=` 恢复接弹窗 open；`onClose` → `clearSessionParam`
  - 覆盖：FR-03, FR-05, FR-06, D-001@v1, D-003@v1

## Wave-4: 测试

- [ ] **task-05** 更新 `page.test.tsx`（C-4 四处断言重写）
  - 文件：`frontend/src/app/(dashboard)/runtimes/page.test.tsx`
  - 重写：①`max-h-[680px]`/`max-h-[520px]` class 断言；②「会话」按钮聚焦态 `会话 · MyClaude`+「显示全部」（改弹窗 header）；③active 只读无发送（D-004 改为 attach 可发送）；④URL 恢复需等 Dialog open 后断言
  - 覆盖：R-05, SC-1/6/7/8

- [ ] **task-06** 新增 `runtime-session-dialog` 测试
  - 文件：`frontend/src/components/daemon/runtime-session-dialog.test.tsx`（co-located，与 `page.test.tsx` 约定一致；plan 确认是否用 `__tests__/`）
  - 覆盖：FR-01, FR-02, FR-04, FR-05, SC-2/3/4/5

## Wave-5: 验收

- [ ] **task-07** lint + tsc + vitest 全绿
  - 覆盖：NFR-4, SC-9/10
