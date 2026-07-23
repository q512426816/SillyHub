---
id: task-01
title: Add `_apply_session_terminal_status` helper + unit tests
title_zh: 新增辅助函数 `_apply_session_terminal_status` + 单测
author: qinyi
created_at: 2026-07-13 20:56:24
priority: P0
depends_on: []
blocks: [task-03, task-04]
requirement_ids: [FR-1]
decision_ids: [D-002@v2, D-005]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_apply_session_terminal_status.py
provides:
  - contract: _apply_session_terminal_status
    fields: [run: AgentRun, session: AgentSession, return: str | None]
---

# task-01 — 新增 `_apply_session_terminal_status` + 单测

## goal

在 `session/service.py` 新增纯函数，按 **D-002@v2 反向判定**计算 session 终态：多轮对话（`interactive + 无 change_id`）保持 `active`，其余所有单轮任务（stage/scan/mission worker/quick-chat/oneshot）收口 `ended`/`failed`；含 **D-005 幂等守卫**。供 task-03（close_interactive_run 回写）与 task-04（cancel_lease 收口）复用，是本变更的契约源头。

## implementation

1. 先写测试 `tests/test_apply_session_terminal_status.py`（TDD），再写实现。
2. 在 `session/service.py` 模块级新增纯函数：
   ```python
   def _apply_session_terminal_status(
       run: AgentRun,
       session: AgentSession,
   ) -> str | None:
       """按 run 终态 + 任务类型计算 session 终态（D-002@v2 反向判定 + D-005 幂等）。"""
       if session.status in ("ended", "failed"):
           return None  # D-005 幂等守卫
       is_multi_turn = run.spec_strategy == "interactive" and run.change_id is None
       if is_multi_turn:
           return "active"  # 多轮对话保持 active，等下一个 AgentRun
       return "ended" if run.status == "completed" else "failed"
   ```
3. **禁止**用 `getattr(run, "ask_user_only", False)` —— AgentRun 无此字段（D-002@v1 已被 v2 推翻，见 model.py:26-304 全字段核实）。
4. 字段依据：`AgentRun.spec_strategy`（model.py:109）、`AgentRun.change_id`（model.py:166）、`AgentRun.status`（model.py:85，取值 pending/running/completed/failed/killed）、`AgentSession.status`（model.py:466）、`AgentSession.ended_at`（model.py:498）、`AgentSession.last_active_at`（model.py:494）。
5. 函数风格遵循 service.py 现有惯例（`from __future__ import annotations` 已在文件头；`str | None` 联合类型可直接用；docstring 中文）。

## 验收标准

- 函数返回值符合 design §7.1 判定表全部 case。
- 幂等：`session.status in ("ended","failed")` 返回 `None`。
- 单测 `test_apply_session_terminal_status.py` 覆盖以下 case 全部通过：
  - `interactive + change_id=None` → `active`（多轮对话）
  - `interactive + change_id 非空` → `ended`（stage 经 interactive dispatch）
  - `platform-managed` → `ended`（scan）
  - `sillyspec` → `ended`（stage）
  - `quick-chat` → `ended`
  - 幂等：session 已 `ended` / 已 `failed` → `None`
  - run.status=`failed` 的单轮 → `failed`

## verify

```bash
cd backend && uv run pytest app/modules/daemon/tests/test_apply_session_terminal_status.py -q
cd backend && uv run mypy app/modules/daemon/session/service.py
cd backend && uv run ruff check app/modules/daemon/session/service.py app/modules/daemon/tests/test_apply_session_terminal_status.py
```

## constraints

- 纯函数：不访问 DB、不 commit、不改传入的 run/session 参数（返回新 status，由调用方落库）。
- 不加 `ask_user_only` 判定（AgentRun 无此字段，D-002@v2）。
- 遵循现有 service.py 函数风格，ruff line-length 100。
- allowed_paths 仅限 service.py + 新建测试文件，不碰其他模块（run_sync / lease_service 是 task-03/04 的职责）。
