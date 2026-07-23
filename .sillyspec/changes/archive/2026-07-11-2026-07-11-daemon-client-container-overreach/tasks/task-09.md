---
id: task-09
title: 同步 requires_worktree 测试断言（test_dispatch_stage_config.py 4 处 + test_dispatch.py 跨两文件 5 处改 False）
title_zh: 同步 requires_worktree 测试断言
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: [task-03]
blocks: [task-11]
requirement_ids: [FR-2.3]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/tests/modules/change/test_dispatch_stage_config.py
  - backend/tests/modules/change/test_dispatch.py
  - backend/app/modules/change/tests/test_dispatch.py
---

# TaskCard — task-09: 同步 requires_worktree 测试断言

## 目标

task-03 把 `dispatch.py` STAGE_AGENT_CONFIG 的 brainstorm/plan/execute/archive 四个写阶段 `requires_worktree` 改 False（verify 早已 False）后，断言这些阶段 `requires_worktree is True` 的测试会失败。本任务把所有此类断言同步改 `is False`，让 change 模块 dispatch 测试与 D-002 真值对齐，恢复 task-03 留下的 9 处断言债。

## 实现要点

真实 grep 行号（9 处 `is True` 断言，分布在 3 个文件；design/plan 标称"6+5=11"含与 verify 已 False 项的重复计数及跨文件合并，以本表为准）：

1. **`backend/tests/modules/change/test_dispatch_stage_config.py`**（4 处）：
   - `:44` `ARCHIVE.requires_worktree is True`（`test_archive_exists_and_requires_worktree`）
   - `:67` `EXECUTE.requires_worktree is True`（`test_execute_requires_worktree`）
   - `:77` `BRAINSTORM.requires_worktree is True`（`test_brainstorm_requires_worktree`）
   - `:82` `PLAN.requires_worktree is True`（`test_plan_requires_worktree`）
   - （`:72` verify `is False` 不动；这几个测试函数 docstring 顺带改"require worktree"措辞）
2. **`backend/tests/modules/change/test_dispatch.py`**（2 处）：
   - `:101` brainstorm config `requires_worktree is True`（`test_get_config_for_brainstorm`）
   - `:463` `last_dispatch["config"]["requires_worktree"] is True`（brainstorm dispatch 集成）
3. **`backend/app/modules/change/tests/test_dispatch.py`**（3 处）：
   - `:48` brainstorm config 值断言（`TestStageAgentConfig.test_brainstorm_config_values`）
   - `:71` `test_write_stages_require_worktree` 循环内 `requires_worktree is True`（覆盖 execute/brainstorm/plan/archive 4 stage）；`:75` verify `is False` 不动，函数名/docstring 一并改
   - `:816` plan dispatch `call_kwargs["requires_worktree"] is True`

每处 `is True` → `is False`，仅改断言值与必要 docstring 措辞，不动测试结构、不删测试函数。

## 验收标准

- 两文件 dispatch 测试全绿（命令见 verify）。
- `grep -rn "requires_worktree is True" backend/tests backend/app/modules/change/tests` 零命中。
- `grep -rn "requires_worktree" backend/tests/modules/change/test_dispatch_stage_config.py` 仅余 verify（`:72`）的 `is False` 断言。
- 改后断言与 `dispatch.py` STAGE_AGENT_CONFIG 5 项真值（全 False）一致。

## verify

```bash
cd backend && uv run pytest -q --no-cov \
  tests/modules/change/test_dispatch_stage_config.py \
  tests/modules/change/test_dispatch.py \
  app/modules/change/tests/test_dispatch.py
```

## 约束

- 只改断言值（`is True` → `is False`）与 docstring/函数名"require worktree"措辞，不动测试结构、不删用例。
- **不动 verify stage 断言**（test_dispatch_stage_config.py:72 / app 模块 test_dispatch.py:75）——本就 `is False`。
- 不改任何源码（`dispatch.py` / `service.py` 属 task-03）。
- 不动其他 stage（brainstorm/plan/execute/archive 之外）断言，不碰 `_ensure_change_dir_in_worktree` 相关测试（如有，归 task-03）。
- pytest testpaths 含 `tests` 与 `app`，两个 `test_dispatch.py` 都被收集，必须同改否则 task-11 回归红。
