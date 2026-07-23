---
id: task-03
title: change_dir 删死路径（dispatch.py propose/plan/execute/archive requires_worktree 改 False + 删 _ensure_change_dir_in_worktree 及调用点）
title_zh: change_dir 删死路径
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: []
blocks: [task-09]
requirement_ids: [FR-2.1, FR-2.2]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/agent/service.py
---

# TaskCard — task-03: change_dir 删死路径

## 目标

消除 `_ensure_change_dir_in_worktree` 这条容器越界活路径（容器内 `shutil.copytree` 跨宿主源码路径），并把 propose/plan/execute/archive 四个写阶段的 `requires_worktree` 全改 False，与 verify（`dispatch.py:108`，D-004 已改）对齐。写阶段不再在 backend 容器内预创建 change 目录——目录由 daemon 侧 sillyspec 各 stage 自建。

## 实现要点

源文件：`backend/app/modules/change/dispatch.py`、`backend/app/modules/agent/service.py`。

1. **dispatch.py STAGE_AGENT_CONFIG 4 处改 False**（对齐 `:108` verify 的 D-004）：
   - `BRAINSTORM`（`:84`）`requires_worktree=True` → `False`
   - `PLAN`（`:92`）`requires_worktree=True` → `False`
   - `EXECUTE`（`:100`）`requires_worktree=True` → `False`
   - `ARCHIVE`（`:116`）`requires_worktree=True` → `False`
2. **删 agent/service.py:1208-1250** `_ensure_change_dir_in_worktree` 整个函数（容器内 `shutil.copytree` 跨界源在此）。
3. **删 agent/service.py:1059-1065** 唯一调用点（`if change.change_key and not read_only:` 分支连同 `await self._ensure_change_dir_in_worktree(...)` 整块移除）。
4. **确认 work_dir（:1038-1047）独立保留**：`resolve_work_dir` 调用不删，其 `requires_worktree=requires_worktree` 形参传入保留（死参数，函数体 :289-317 不读，design §5 Phase 2.3 / Grill G4 已确认），仅 STAGE_AGENT_CONFIG 入参变 False——work_dir 变量仍由后续 placement/lease 链路消费，**无死变量**。

## 验收标准

- `grep -rn "requires_worktree=True" backend/app` 仅余注释或零命中（5 个 STAGE_AGENT_CONFIG 全 False 后，运行期不应再有 True 字面量；verify `:108` 本已是 False）。
- `grep -rn "_ensure_change_dir_in_worktree" backend/` 零命中（函数定义 + 唯一调用点全删）。
- `grep -rn "shutil.copytree" backend/app/modules/agent/` 该跨界用法随函数删除消失。
- STAGE_AGENT_CONFIG 5 项（brainstorm/plan/execute/verify/archive）`requires_worktree` 字段全为 False。
- 测试套件（见 verify）通过。

## verify

```bash
cd backend && uv run pytest -q --no-cov backend/tests/modules/change backend/tests/modules/agent
```

注意：本任务执行后，`test_dispatch_stage_config.py`（6 处）与 `test_dispatch.py`（5 处）共 11 处 `requires_worktree is True` 断言会失败——这些断言的同步修改属于 **task-09**（本任务 blocks task-09）。本任务的验收以"源码 grep + agent 模块测试通过"为准；change 模块 dispatch 测试的失败由 task-09 收尾修复。

## 约束

- **不动 `resolve_work_dir` 签名**（`service.py:289-317`）：`requires_worktree` 形参保留（死参数，Grill G4 确认零行为影响），仅 STAGE_AGENT_CONFIG 传入值改 False。
- **不删 `_try_acquire_lease`**（`service.py:1252`）：保留（D-003），requires_worktree 改 False 后该入口恒不达，成事实死代码，本变更不强删。
- **不改 stage 流转**：`start_stage_dispatch` 的 placement / `dispatch_to_daemon` / lease.metadata 透传链路完全不动，仅删 change_dir 预创建分支。
- **不动 WorktreeService.acquire / worktree 子系统**：独立后续 cleanup（design §3 非目标）。
- 测试断言同步归 task-09，本任务不修测试文件。
