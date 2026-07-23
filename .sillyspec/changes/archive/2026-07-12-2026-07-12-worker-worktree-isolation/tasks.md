---
author: qinyi
created_at: 2026-07-13 00:19:51
change: 2026-07-12-worker-worktree-isolation
scale: large
---

# 任务清单（Tasks）

> 只列任务名 + 一句范围，细节（Wave 依赖/验收/测试用例）在 plan 阶段展开。对应 design §5.3 三 Wave。

## Wave 1 — 基础设施（HostFsDelegate + daemon host-fs-handler）

- **task-01**: backend `HostFsDelegate` 新增 `git_worktree_add` / `git_merge` / `git_worktree_remove`（走 `_via_rpc_or_degrade`，method=`host_fs.git_worktree_add` 等，degraded fallback）+ 单测（mock WS RPC，覆盖 ok/conflict/error/degraded）。
- **task-02**: daemon `host-fs-handler.ts` 新增 3 方法实现（对齐 `git_apply` git 子命令执行器；`git_worktree_add` 带默认 identity `-c user.name=worker -c user.email=worker@sillyhub`；`git_merge` 解析冲突标记；`git_worktree_remove` 带 `--force`）+ `daemon.ts`（:2205 附近）注册 3 RPC handler + 单测（mock git 子进程）。

## Wave 2 — worker 接线（execution + prompt）

- **task-03**: `execution.dispatch_worker`（:88）接 worktree（算 sibling 路径 `<root目录名>-workers/<run.id短8>/` + branch `workers/<run.id短8>` + `base_ref = ws.default_branch or "HEAD"` 兜底 + 调 `git_worktree_add` + 成功后副本路径作 root_path 传 `dispatch_to_daemon` + 填 `AgentRun.worktree_branch`；失败 worker run 标 failed）+ 单测。
- **task-04**: `execution.render_worker_prompt`（:65）加约束（只写代码不跑 test/build、完成后必 `git add -A && git commit`、按文件分工减冲突）+ 单测。

## Wave 3 — converge 合并 + 解冲突 + 清理

- **task-05**: `finalizer.finalize_execute_mission`（:167）实现分支合并（取各 worker `worktree_branch` → 逐个 `HostFsDelegate.git_merge` → ok 继续 / conflict 上报）+ 单测（mock git_merge 返回 ok/conflict）。
- **task-06**: `mcp_tools.converge_mission`（:293）改可重入（逐个 worker merge；冲突返回 `{status:conflict, conflicts}` 给主 agent；重入检测 merge in progress → `git merge --continue`；R-07 轮次上限超限 → `git merge --abort` + mission 标人工）+ 单测。
- **task-07**: finalizer 合并后清理（全成功 → `git_worktree_remove` 各副本 + 采合并 diff 作 `kind=patch` artifact；失败 → 副本保留）+ 单测。

## 集成/验收

- **task-08**: 三重收敛集成测试（mission 派多 worker → 各独立 worktree → worker commit → converge 逐个 merge → 冲突场景主 agent 解决 → 成功清理 / 失败保留）端到端单测链路。

## 遗留（非本变更范围）

- daemon `complete_lease` 真部署 e2e（merge 后 diff 回灌真链路）→ verify/部署阶段。
- AC-9 team-main-agent 真部署 e2e → 上游遗留。
