---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-01
title: placement 强制 scan 模式
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/tests/test_interactive_session_placement.py
goal: 强制 prepare_interactive_dispatch 的 lease metadata manual_approval=True 且 ask_user_only=True，对齐 scan 模式消除 5min 超时。
implementation: |
  1. 定位 placement.py:430-440 metadata 写入段，将 manual_approval/ask_user_only 改为强制 True（忽略入参）。
  2. 函数签名 manual_approval/ask_user_only 默认 False 不动，保留向后兼容，仅 metadata 写入处强制。
  3. docstring 补一句"本变更起强制 True，入参被忽略"。
  4. prepare_scan_interactive_dispatch 不改（本就强制 True）。
  5. 同步更新 test_interactive_session_placement.py：line 79-107 断言改 is True 并补 ask_user_only is True；其余不动。
acceptance: |
  - lease metadata manual_approval==True 且 ask_user_only==True，无论入参传什么。
  - pytest test_interactive_session_placement.py 全绿。
  - pytest test_session_service.py 不回归。
  - task-07 端到端：verify/stage dispatch 后 daemon claim payload manual_approval=true + ask_user_only=true。
verify: pytest backend/app/modules/agent/tests/test_interactive_session_placement.py
constraints: 保留 manual_approval/ask_user_only 签名兼容不破坏 router/service/测试；不破坏 scan（prepare_scan_interactive_dispatch 本就强制 True）。
covers: [FR-001, D-001]
---
# task-01: placement 强制 scan 模式

## 文件
修改 `backend/app/modules/agent/placement.py`

## 背景
`prepare_interactive_dispatch`（placement.py:371-481）当前把入参 `manual_approval` / `ask_user_only` 透传进 lease metadata（placement.py:439-440）。stage/verify 流程调用方 `DaemonService.create_session`（session/service.py:319-387）默认传 `manual_approval=False` / `ask_user_only=False`（service.py:326-327），导致 daemon 侧所有非 AskUserQuestion 工具走远程人审 resolver（session-manager.ts:1184 `resolver.register`），前端无响应 → 5min 超时（根因 1，日志 a73e41a5 实证）。

D-001 决策：所有 stage 统一对齐 scan 模式（`prepare_scan_interactive_dispatch` placement.py:546-547 强制 `manual_approval=True + ask_user_only=True`），让 AskUserQuestion 走 dialog 人审（入口保留），其余工具 allow-through。

## 操作步骤
1. 读 `backend/app/modules/agent/placement.py:430-440`，定位 `prepare_interactive_dispatch` 内 metadata 写入段：
   ```python
   metadata["manual_approval"] = bool(manual_approval)
   metadata["ask_user_only"] = bool(ask_user_only)
   ```
2. 改为强制覆盖（忽略入参，对齐 scan）：
   ```python
   # 2026-07-08 D-001：所有 stage 统一 scan 模式（manual_approval=True +
   # ask_user_only=True）。AskUserQuestion 走 dialog 人审（入口保留），其余工具
   # allow-through，消除 5min 超时（根因 1）。入参 manual_approval/ask_user_only
   # 保留签名兼容但不再生效。
   metadata["manual_approval"] = True
   metadata["ask_user_only"] = True
   ```
3. 函数签名 `manual_approval: bool = False, ask_user_only: bool = False`（placement.py:380-381）**不动**（保留向后兼容，避免动 router/service/测试签名）；只在 metadata 写入处强制。docstring（placement.py:394 提到 "manual_approval" stored in metadata）补一句"本变更起强制 True，入参被忽略"。
4. `prepare_scan_interactive_dispatch`（placement.py:483+）**不改**（本就强制 True）。
5. 同步更新受影响单测 `backend/app/modules/agent/tests/test_interactive_session_placement.py`：
   - `test_...` (line 79-107)：入参 `manual_approval=False` 但断言 `meta["manual_approval"] is False`（line 107）→ 改断言为 `is True`，并补 `meta["ask_user_only"] is True`。
   - `test_model_field_stored_in_metadata` (line 114-126)：入参 `manual_approval=True`，断言 `is True`（line 126）仍过，无需改。
   - 其余测试（line 135/152/179/202）不查 manual_approval 字段，不动。

## 验收标准
- `prepare_interactive_dispatch` 写入的 lease metadata `manual_approval == True` 且 `ask_user_only == True`，无论入参传什么。
- `pytest backend/app/modules/agent/tests/test_interactive_session_placement.py` 全绿。
- `pytest backend/app/modules/daemon/tests/test_session_service.py` 不回归（这些用例不传 manual_approval，走默认 False 但被强制 True，需确认无断言依赖 False）。
- daemon 侧日志验证（task-07 端到端）：verify/stage dispatch 后 daemon claim payload `manual_approval=true + ask_user_only=true`，非 AskUserQuestion 工具 allow-through 不走 resolver。

## 依赖
无（Wave 1 起点task，可与 task-02 并行）。

## 风险
- R-05（plan 风险登记）：a73e41a5 config 空但走了人审，需在 task-07 端到端确认 daemon 创建 verify session 时 `effectiveAskUserOnly` 实际取 lease metadata 的 `ask_user_only`（session-manager.ts:813 `spec.effectiveAskUserOnly` 来源链）。本 task 只保证 lease metadata 正确，daemon 侧读取链路若另有覆盖点需 task-07 兜底验证。
- 入参 `manual_approval`/`ask_user_only` 保留签名但失效，若未来有调用方依赖传 False 控制（如纯 chat 不弹框），需另开 task 区分场景。当前所有 stage 走 scan 模式是 D-001 明确决策。
