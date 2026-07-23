---
id: task-14
title: 删死代码 _run_sillyspec_background（agent/coordinator.py:563-651，无 caller）（覆盖：FR-05）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P2
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/coordinator.py
provides: []
expects_from: {}
goal: >
  一句话目标
implementation:
  - "步骤1（含核实结论：start_sillyspec_run 整簇死代码，非仅 _run_sillyspec_background）"
  - "步骤2"
acceptance:
  - "验收1"
verify:
  - "cd backend && uv run pytest && uv run mypy app && uv run ruff check ."
constraints:
  - "约束1（删前 grep 确认零生产 caller）"
---

# task-14 删死代码 _run_sillyspec_background（FR-05）

## goal

删除 task-01 daemon-only 重构后 `ExecutionCoordinatorService` 中残留的 sillyspec 后台执行死代码簇，收敛 coordinator.py。本变更点（design §5.5 / plan task-14）只承担"清死代码"，不引入新行为。

## 死代码核实（grep 实证，删除前必做）

`grep -rn "_run_sillyspec_background" backend`（2026-07-06 跑）：

- 生产代码：仅 `coordinator.py:563`（定义）+ `coordinator.py:529`（被 `start_sillyspec_run` 调用）+ `:550/:581`（docstring/日志字面量）。
- 测试：`backend/tests/modules/agent/test_coordinator.py:372, 405`（`patch.object(coordinator, "_run_sillyspec_background", AsyncMock)` 验证 deprecation）。

**结论 / STOP 条件触发**：`_run_sillyspec_background` **不是零 caller**——`start_sillyspec_run`（coordinator.py:473-540）是它的生产 caller。但 `start_sillyspec_run` 自身是顶层死入口（全仓无生产 caller，仅被其自己的 deprecation 测试和 `backend/tests/modules/change_writer/test_router.py:190` 的反向断言 `"start_sillyspec_run" not in source` 引用）。

因此删的是**deprecated 死代码簇**，不只 `_run_sillyspec_background`：

| 符号 | 行 | 生产 caller | 删除判定 |
|---|---|---|---|
| `start_sillyspec_run` | 473-540 | 无（顶层死入口） | 删 |
| `_run_sillyspec_background` | 563-658 | `start_sillyspec_run`（:529） | 随 `start_sillyspec_run` 一起删 |
| `_short_db` | 542-561 | 仅 `_run_sillyspec_background`（:590/616/633/645） | 删（随主删后变孤儿） |
| `_fire_background_task` / `_background_tasks` / `_on_background_task_done` | 86 / 95-123 | 在 coordinator.py 内仅 `start_sillyspec_run`（:528） | **核实后决定**：`AgentService`（service.py:291-322）有同名独立实现，coordinator 这份随主删后无 caller，删；若 coordinator 内仍有别处用则保留 |

> design/plan 的 task-14 行只点名 `_run_sillyspec_background:563-651`，与 grep 实证有出入（行号实际到 658；且它有 caller）。本卡按 constraints「以 grep 实证为准」扩大删除范围到整簇 deprecated 方法 + 孤儿辅助。**不误删** `service.py` 的 `_fire_background_task`（AgentService 独立副本，grep 显示有 self-use）。

## implementation

1. 删除前再跑 `grep -rn "_run_sillyspec_background\|start_sillyspec_run" backend/app` 确认仍无生产 caller；若有新增 caller 则 **STOP 报告**，不删。
2. 删除 `coordinator.py:473-658` 整段 deprecated 簇：`start_sillyspec_run` + `_short_db` + `_run_sillyspec_background`（连同 §7 "SillySpec dispatch" section 注释与分隔线）。
3. 核实 `_fire_background_task` / `_background_tasks` / `_on_background_task_done`（coordinator.py:86, 95-123）在本文件内除 `start_sillyspec_run` 外无其他 caller（grep 已示 service.py 有独立副本，coordinator 这份仅供 sillyspec 后台用）；确认无 caller 后一并删除；保留 `import asyncio`（核实其他方法是否仍用——coordinator 无其他 asyncio 用法则连同删 import）。
4. 删除 `backend/tests/modules/agent/test_coordinator.py` 中两段 deprecation 测试：`test_start_sillyspec_run_emits_deprecation_warning`（:357-387）+ `test_start_sillyspec_run_still_returns_agent_run`（:390-418）及对应 section 注释（:352-354）。
5. `backend/tests/modules/change_writer/test_router.py:190` 的反向断言 `assert "start_sillyspec_run" not in source` 仍成立（删除后更成立），**不改**；但跑该测试确认通过。
6. 清理因主删变成 unused 的 import（`asyncio` / `asyncio.create_subprocess_exec` 相关 / `asynccontextmanager` 若 `_short_db` 是唯一 user / `get_session_factory` 若无别处用 / `warnings` 若 `start_sillyspec_run` 是唯一 user）。逐个 grep 确认后再删。

## 验收标准

- `grep -rn "_run_sillyspec_background\|start_sillyspec_run" backend/app` 零命中。
- `grep -rn "_short_db\b" backend/app` 零命中（coordinator 内）。
- `coordinator.py` mypy + ruff 通过，无 unused import / undefined name。
- coordinator.py 内若保留 `_fire_background_task` 等辅助，则仍有 caller；若删则 grep 零命中。
- 全量 pytest 零回归（`backend/tests/modules/agent/test_coordinator.py` 其余 6 大段测试全绿；`backend/tests/modules/change_writer/test_router.py` 仍绿）。
- daemon-only 重构后的 dispatch 链路无行为变化（本 task 纯删代码，不改运行时路径）。

## verify

```bash
cd backend
uv run pytest -q
uv run mypy app
uv run ruff check .
# 回归确认
grep -rn "_run_sillyspec_background\|start_sillyspec_run\|_short_db" backend/app   # 应空
```

## constraints

- **删除前必须 grep 确认**：`_run_sillyspec_background` 实测**有 caller**（`start_sillyspec_run`），plan/design 的"无 caller"描述不准；本卡按 deprecated 簇整体删除。若 implementation 步骤 1 发现 `start_sillyspec_run` 出现新的生产 caller，**STOP 报告，不删**。
- 死代码判定以 grep 实证为准（已在「死代码核实」段落列出每符号 caller）。
- 不误删 `AgentService`（service.py）的同名 `_fire_background_task` / `_background_tasks` / `_on_background_task_done`——那是独立副本。
- 不删 `test_router.py:190` 的反向断言（删除后断言更成立，保留作回归守护）。
- 测试改动仅限"删除针对已删生产代码的 deprecation 测试"——非测试逻辑本身有误，符合 CLAUDE.md 规则 8（被测代码已不存在，测试随之移除）。
- 关联模块文档同步归 task-15；本 task 不写文档。
