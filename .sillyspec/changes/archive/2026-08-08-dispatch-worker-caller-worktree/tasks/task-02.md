---
id: task-02
title: execution dispatch_worker 加 worktree_path/branch/worker_prompt 三参（路径A核心）
title_zh: execution.dispatch_worker 支持 caller 自带 worktree（路径A：跳过自建 + 不写 worktree_branch + worker_prompt 覆写）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: []
blocks: [task-05, task-06, task-08]
requirement_ids: [FR-01, FR-02, FR-03, FR-10]
decision_ids: [D-001@v1, D-008@v1, D-009@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\execution.py
provides:
  - contract: dispatch_worker_caller_worktree
    fields: [worktree_path/branch/worker_prompt 三可选参, "路径A 不写 run.worktree_branch（D-008）", "worker_prompt 覆写 render_worker_prompt（D-001）"]
goal: >
  dispatch_worker 加 worktree_path/branch/worker_prompt 三可选参；worktree_path 非空时跳过 git_worktree_add 自建、root_path=worktree_path、不写 run.worktree_branch、worker_prompt 覆写 prompt；默认 None 走原逻辑零回归。
implementation:
  - "加形参 worktree_path: str | None = None、branch: str | None = None、worker_prompt: str | None = None（均 keyword-only，默认 None）"
  - execution.py:190 自建条件追加 `and not worktree_path`：caller 提供工作区时短路 git_worktree_add 整段（含 run.worktree_branch 写入）
  - worktree_path 非空时：root_path = worktree_path（作 daemon root_path / worker cwd）；branch 入参仅随 lease metadata 透传，**绝不赋给 run.worktree_branch**（D-008，保持 None）
  - execution.py:245 prompt 改 `prompt = worker_prompt if worker_prompt is not None else render_worker_prompt(run)`（D-001 方案A，caller 全权覆写；design §7.4 逐字）
  - 三参默认 None → 自建分支 + render + worktree_branch 写入均原样执行（team 模式 / 既有调用方字节不变）
acceptance:
  - 传 worktree_path → 不调 host_fs_delegate.git_worktree_add + root_path 透传 dispatch_to_daemon + run.worktree_branch 保持 None
  - 传 worker_prompt → dispatch_to_daemon 的 prompt == worker_prompt（不调 render_worker_prompt）
  - 不传三参 → 行为与改动前一致（test_dispatch_worker_worktree 全绿）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_dispatch_worker_worktree.py app/modules/agent/tests/test_execution_context.py -q
---

## 实现依据
- design §7.2 dispatch_worker 新签名（worktree_path/branch/worker_prompt + ⚠️ 路径A 不写 run.worktree_branch）
- design §7.4 worker_prompt 覆写语义：`worker_prompt if worker_prompt is not None else render_worker_prompt(run)`
- design §6（execution.py:190 加 `and not worktree_path` 短路 + :245 prompt 覆写）
- design §11 D-001（caller 全权 worker_prompt）/ D-008（不写 worktree_branch，R-01 防御层②）/ D-009（字段名 branch）
- 源码：execution.py:190 自建 if（host_fs_delegate+ws+root_path）、:228 run.worktree_branch=worktree_branch（路径A 禁触）、:245 prompt=render_worker_prompt(run)

## 跨任务契约
- provides `dispatch_worker_caller_worktree`：被 task-04（mcp_gateway dispatch_worker 透传）/ task-05（链路A HTTP）/ task-06（daemon）/ task-08（测试）消费
- branch 仅入 lease metadata（daemon_task_leases.metadata JSON），不入 AgentRun 列（D-002 不加列）
- R-01 三重防御之一：不写 worktree_branch → finalize（finalizer.py:255）查空也跳过 merge
