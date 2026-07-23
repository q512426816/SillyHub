---
author: qinyi
created_at: 2026-07-13 00:19:51
change: 2026-07-12-worker-worktree-isolation
scale: large
---

# 提案书（Proposal）

## 动机

team-main-agent v2（`2026-07-12-team-main-agent-orchestration`）已落地主 agent 真编排（MCP tool + 用户预设 worker + 三重收敛）。但当前 `execution.dispatch_worker`（execution.py:88）把 `ws.root_path` 作 root_path 传 daemon → **所有 worker 共用 workspace root 作为 cwd，并发写代码互相覆盖**，team 模式实际不可用。

task-02 已为 `AgentRun` 加 `worktree_branch` 字段、task-04 已采 patch（`diff_summary` → `kind=patch` artifact）并接好 converge 路由，但 **per-worker worktree 隔离 + converge 实际 git merge** 被拆为本变更（task-04b，含 daemon 改动、范围较大）。`finalizer.finalize_execute_mission`（finalizer.py:167）当前只是"采 patch 列表供人审 apply-back"，注释明确"实际 git merge 留 task-04b"——合并逻辑完全缺失。

本变更解决：worker 并发写隔离（每 worker 独立 git worktree）+ 主 agent converge 时合并各 worker 产出（git merge 各分支）。

## 关键问题

1. **并发写覆盖**：当前所有 worker cwd=workspace root，多 worker 同时改代码互相覆盖，team 模式不可用。
2. **converge 合并缺失**：`finalize_execute_mission`（:167）只采 patch 列表，无实际 git merge —— 合并逻辑 0 实现。
3. **跨 backend+daemon**：daemon-client 架构下 worker 在 daemon 侧跑（Claude SDK），backend 不能直接跑 git，必须走 HostFsDelegate → daemon WS RPC；现有 host_fs 9 方法（stat/read_file/list_dir/git_apply/git_rev_parse/pollution_archive/read_package_json/read_local_yaml/run_command）无 worktree/merge/remove。

## 变更范围

- **backend** `HostFsDelegate`（delegate.py）新增 3 async 方法：`git_worktree_add` / `git_merge` / `git_worktree_remove`（仿 `git_apply` 走 `_via_rpc_or_degrade`，method=`host_fs.git_worktree_add` 等）。
- **daemon** `host-fs-handler.ts` 新增 3 方法实现（对齐现有 `git_apply` git 子命令执行器，`git_worktree_add` 带默认 identity `-c user.name=worker -c user.email=worker@sillyhub`）+ `daemon.ts`（:2205 附近）注册 3 RPC handler。
- **backend** `execution.dispatch_worker`（:88）接 worktree（算 sibling 路径 + `base_ref` 兜底 + 调 git_worktree_add + 副本路径作 root_path 传 dispatch_to_daemon + 填 worktree_branch）；`render_worker_prompt`（:65）加约束（只写代码、必 commit、按文件分工）。
- **backend** `finalizer.finalize_execute_mission`（:167）实现分支合并（逐个 git_merge）+ `mcp_tools.converge_mission`（:293）改可重入（冲突返回标记、主 agent SDK 解决后重入）+ 合并后清理 + R-07 轮次上限/失败回退。
- 单测：backend delegate/execution/finalizer + daemon host-fs-handler。

## 不在范围内（显式清单）

- **不复用** `backend/app/modules/worktree/`（bare-clone lease 模块，daemon-client 下死代码）。
- **不做前端冲突人审 UI**（冲突主 agent LLM 全自动解决，D-004）。
- **不做 worktree GC 机制**（合并后立即清理，D-005）。
- **worker 不在副本跑测试/构建**（副本缺 node_modules/.venv，验证留 converge 后主工作区，D-002）。
- **不做 worker 自动拆解 / DAG 依赖**（继承 team-main-agent v2）。
- **不做新 migration**（`worktree_branch` / `kind=patch` 字段 task-02/04 已加）。

## 成功标准（可验证）

- single mode mission 零回归（不触发 dispatch_worker worktree 路径）。
- bootstrap mission（read-only summary）零回归（走 `finalize_bootstrap_mission`，不触发 git merge）。
- team execute mission：各 worker 获得独立 worktree 副本（sibling 目录），并发写不覆盖。
- converge 成功合并各 worker 分支到 workspace root（有 worker commit 历史，可追溯）。
- merge 冲突时主 agent 自己 SDK Read/Write 解决、`converge_mission` 可重入继续合并。
- 合并成功后 worker 副本清理；merge 失败则副本保留供排查。
- worker 副本 commit 不因 daemon 全局 git config 缺失而失败（默认 identity，D-008）。
- backend pytest + daemon vitest 全绿，无回归。
