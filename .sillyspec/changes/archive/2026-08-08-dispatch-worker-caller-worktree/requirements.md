---
author: qinyi
created_at: 2026-08-08 17:05:13
revised_at: 2026-08-08 17:55:00
---

# 需求（Requirements）— dispatch_worker caller worktree（路径A）+ mission external 模式

## 功能需求

**FR-01** dispatch_worker 支持 caller 提供 worktree
`MissionExecutionService.dispatch_worker` 与两条 MCP 入口接受可选 `worktree_path`/`branch`/`worker_prompt`；caller 提供时 worker cwd = worktree_path。

**FR-02** worker_prompt 覆写
caller 传 `worker_prompt` 完全替代 `render_worker_prompt`；不传走原 render（team 模式不变）。

**FR-03** caller 提供 worktree 跳过自建
`execution.py:190` 自建 if 加 `and not worktree_path` 短路；不调 `git_worktree_add`，root_path=worktree_path。

**FR-04** SillySpec 探测路径A 落地
sillyspec `isPathASupported()` 探测 MCP `tools/list` dispatch_worker schema 含 `worktree_path` → true；保守 fallback Local。

**FR-05** 零回归
`orchestration_mode` 默认 team + dispatch_worker 三参默认 None + converge external 默认不命中；team 模式 / 既有调用方字节不变；现有测试全绿。

**FR-06** allowed_roots 放行
daemon allowed_roots 含 SillySpec 仓根（worktree 落仓内前缀放行）；smoke 前置校验 + 部署文档。

**FR-07** 端到端可用
某仓 SillySpec execute 一波 → SillyHub worker 在该仓 worktree 写码 → SillySpec 回收 review.json + apply。

**FR-08** mission external 模式不 spawn orchestrator【round-2】
`create_mission(orchestration_mode="external")` → team_mission_entry 跳过 orchestrator run/lease；constraints 存 `{"orchestration_mode":"external"}`。team 模式（默认）行为不变。

**FR-09** converge external 跳过 finalize【round-2】
`converge_mission_for_completed_run` 检测 external mission → 跳过 finalize/cleanup（不 merge 不清 caller worktree）。

**FR-10** 路径A 不写 worktree_branch【round-2】
路径A dispatch 不写 `run.worktree_branch`（避免 converge finalize merge 触发，P0-1 双保险）。

## 验收标准

- **AC-01** caller 传 worktree_path → execution 不调 git_worktree_add + root_path=worktree_path + 不写 run.worktree_branch + worker_prompt 进 prompt（单测）
- **AC-02** 三参默认 None + orchestration_mode 默认 team → 既有调用方字节不变（零回归）
- **AC-03** mcp_gateway + mcp_tools 两入口透传 worktree_path/branch 到 execution（端到端单测）
- **AC-04** create_mission(external) → 无 orchestrator run + constraints 含 mode（单测）
- **AC-05** converge external mission → 跳过 finalize/cleanup（单测）
- **AC-06** daemon create_mission/dispatch_worker inputSchema 含新字段（schema 测试）
- **AC-07** SillySpec isPathASupported 探测 schema 含 worktree_path → true（跨仓单测）
- **AC-08** 端到端 smoke：SillySpec execute → create_mission(external) → dispatch_worker → worker 写码 → 回收 apply
