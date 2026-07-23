---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-07
title: 测试 scan 模式 + 人审入口
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - backend/tests/modules/agent/test_placement_scan_mode.py
  - sillyhub-daemon/tests/interactive/session-manager-askuser-dialog.test.ts
goal: 验证 scan 模式强制（manual_approval+ask_user_only）与 AskUserQuestion dialog 不超时、非 AskUserQuestion allow-through
implementation: backend 新建 test_placement_scan_mode.py 3 用例断言 lease.metadata 强制 scan 模式且 permissionMode 非 bypass；daemon 新建 session-manager-askuser-dialog.test.ts 3 用例断言 AskUserQuestion 走 dialog 不 5min 超时、非 AskUserQuestion allow-through、permissionMode=default
acceptance: backend 3 用例全绿（scan 模式 metadata 强制）；daemon 3 用例全绿（AskUserQuestion 不超时 + allow-through + permissionMode=default）；只 mock SDK/WS 不 mock 被测单元
verify: pnpm test（sillyhub-daemon）+ pytest backend/tests/modules/agent/test_placement_scan_mode.py 全绿
constraints: 测试只 mock SDK/WS，PermissionResolver/SessionManager 真实跑；AskUserQuestion 识别靠 toolName==='AskUserQuestion'，别误判 mcp__ 前缀
covers: [FR-001, FR-006]
---
# task-07: 测试 scan 模式 + 人审入口

## 文件
新增 backend/tests/modules/agent/test_placement_scan_mode.py
新增 sillyhub-daemon/tests/interactive/session-manager-askuser-dialog.test.ts

## 操作步骤
### backend 侧（scan 模式强制）
1. 新建 `backend/tests/modules/agent/test_placement_scan_mode.py`，pytest 风格，参考 `backend/tests/modules/change/test_e2e_stage_dispatch.py` 的 fixture（real DB + mock daemon）。
2. 用例 1 `test_prepare_interactive_dispatch_forces_scan_mode`：
   - 调 `RunPlacementService.prepare_interactive_dispatch(manual_approval=..., ask_user_only=...)`（placement.py:371），验证 stage dispatch 入口（task-01 落地后）强制传入 `manual_approval=True, ask_user_only=True`。
   - 断言 lease.metadata（line 439-440）写入 `manual_approval=True` + `ask_user_only=True`。
   - 若 task-01 改为在 `dispatch()` / `_dispatch_stage` 调用处强制（非 placement 签名），则断言 dispatch 链路透传到 prepare_interactive_dispatch 的入参。
3. 用例 2 `test_verify_stage_dispatch_uses_scan_mode`：verify/stage/brainstorm/plan/execute 各 stage 的 lease metadata 均含 `manual_approval=True + ask_user_only=True`（覆盖 FR-001）。
4. 用例 3 `test_scan_mode_not_bypass_canUseTool`：确认 `permissionMode` 未设 `bypassPermissions`（task-02 撤回后改回 default），canUseTool 注入仍生效（metadata 无 `permissionMode=bypassPermissions`）。

### daemon 侧（AskUserQuestion dialog 不超时）
5. 新建 `sillyhub-daemon/tests/interactive/session-manager-askuser-dialog.test.ts`，vitest 风格，参考 `session-manager-permission.test.ts`（line 1-50 的 `makeDriverCapturingOpts` helper + mock SDK）。
6. 用例 1 `AskUserQuestion 走 dialog 不触发 5min 超时 resolver`：
   - 构造 `ask_user_only=true, manual_approval=true` 的 session。
   - mock driver 的 `canUseTool` 回调，传入 `toolName='AskUserQuestion'`。
   - 断言走 `resolver.register`（PERMISSION_REQUEST 发出，pending Promise）而非 5min fallback 超时（`PERMISSION_FALLBACK_TIMEOUT_MS` 不 settle）。
   - 用 `vi.useFakeTimers()` 推进超过 5min，断言 AskUserQuestion 的 promise 仍 pending（不超时），dialog 等待前端响应。
7. 用例 2 `非 AskUserQuestion 工具 allow-through`：
   - `canUseTool` 传 `toolName='Bash'`（ask_user_only=true 下）。
   - 断言立即 allow（不调 `resolver.register`，`pendingCount` 保持 0），无 PERMISSION_REQUEST 发出（覆盖 FR-006，5min 超时消除）。
8. 用例 3 `permissionMode=default`（task-02 撤回验证）：session 创建时 `permissionMode` 不为 `bypassPermissions`（断言 driver.start 的 opts 不含 bypass）。

## 验收标准
- backend 3 用例全绿：verify/stage 等 stage dispatch 的 lease metadata 强制 scan 模式。
- daemon 3 用例全绿：AskUserQuestion dialog 不超时 + 非 AskUserQuestion allow-through + permissionMode=default。
- `pnpm test`（sillyhub-daemon）+ `pytest backend/tests/modules/agent/test_placement_scan_mode.py` 全绿。
- 测试只 mock SDK/WS，不 mock 被测单元（PermissionResolver / SessionManager 真实跑）。

## 依赖
task-01（placement 强制 scan 模式）、task-02（撤回 bypassPermissions）。本 task 验证这两者落地效果。

## 风险
- task-01 若改的是 `dispatch()` 而非 `prepare_interactive_dispatch` 签名，backend 用例 1 的断言点要跟着调整（断言 dispatch 透传入参而非 placement 签名）。
- daemon 侧 AskUserQuestion 的识别靠 `toolName === 'AskUserQuestion'`（session-manager.ts:1167-1170 现有逻辑），测试别误把 `mcp__` 前缀工具当 AskUserQuestion。
