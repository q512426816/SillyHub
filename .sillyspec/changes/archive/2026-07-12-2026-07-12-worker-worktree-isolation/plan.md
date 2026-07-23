---
author: qinyi
created_at: 2026-07-13 00:32:00
change: 2026-07-12-worker-worktree-isolation
plan_level: full
scale: large
---

# 实现计划（Plan）— per-worker worktree 隔离

## Spike 前置验证

无 Spike。技术方案确定：`git worktree add/merge/remove` 是标准 git 命令；`HostFsDelegate` 仿 `git_apply`（:267）走 `_via_rpc_or_degrade`（:616）是既有模式；daemon `host-fs-handler.ts` 仿 `git_apply`（:454）子命令执行器是既有模式。无新技术栈/未验证集成。

## Wave 1（并行，无依赖 — 基础设施）

- [x] task-01: backend `HostFsDelegate` 新增 `git_worktree_add` / `git_merge` / `git_worktree_remove`（走 `_via_rpc_or_degrade`，method=`host_fs.git_worktree_add` 等，含 degraded fallback）+ 单测（mock WS RPC，覆盖 ok/conflict/error/degraded）（覆盖：FR-01/03/05 后端侧, D-006）
- [x] task-02: daemon `host-fs-handler.ts` 新增 3 方法实现（`git_worktree_add` 带 `-c user.name=worker -c user.email=worker@sillyhub`；`git_merge` 解析冲突标记；`git_worktree_remove` 带 `--force`）+ `daemon.ts`（:2205 附近）注册 3 RPC handler + 单测（mock git 子进程）（覆盖：FR-01/03/05/06 daemon 侧, D-006, D-008）

## Wave 2（依赖 Wave 1 — worker 接线）

- [x] task-03: `execution.dispatch_worker`（:88）接 worktree（D-001@v2 路径 `.worktrees/<run.id短8>/` workspace 内 + branch `workers/<run.id短8>` + `base_ref = ws.default_branch or "HEAD"` 兜底 + 调 `git_worktree_add` + 成功后副本路径作 root_path 传 `dispatch_to_daemon` + 填 `AgentRun.worktree_branch`；创建失败 worker run 标 failed）+ 单测（覆盖：FR-01, FR-02 部分, D-001@v2）依赖 task-01
- [x] task-04: `execution.render_worker_prompt`（:65）加约束（只写代码不跑 test/build、完成后必 `git add -A && git commit`、按文件分工减冲突）+ 单测（覆盖：FR-02, D-002, D-003）依赖 —（可独立）

## Wave 3（依赖 Wave 1+2 — converge 合并/解冲突/清理）

- [x] task-05: `finalizer.finalize_execute_mission`（:167）实现分支合并（取各 worker `worktree_branch` → 逐个 `HostFsDelegate.git_merge` → ok 继续 / conflict 上报）+ 单测（mock git_merge 返回 ok/conflict）（覆盖：FR-03, D-003）依赖 task-01, task-03
- [x] task-06: `mcp_tools.converge_mission`（:293）改可重入（逐个 worker merge；冲突返回 `{status:conflict, conflicts}` 给主 agent SDK 解决；重入继续；R-07 轮次上限超限 → 标 needs_manual + 副本保留，**简化不实际 git merge --abort** 因 workspace root 在 daemon 侧 backend 不可控）+ 单测（覆盖：FR-04, D-004）依赖 task-05
- [x] task-07: `finalizer` 合并后清理（全成功 → `git_worktree_remove` 各副本 + 采 workspace root 合并 diff 作 `kind=patch` artifact；失败 → 副本保留）+ 单测（覆盖：FR-05, D-005）依赖 task-01, task-05

## Wave 4（集成 — 依赖 Wave 1-3）

- [x] task-08: 三重收敛集成测试（mission 派多 worker → 各独立 worktree → worker commit → converge 逐个 merge → 冲突场景主 agent SDK 解决 → 成功清理 / 失败保留）端到端单测链路（覆盖：FR-01~06 集成）依赖 task-01~07

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | HostFsDelegate 新增 3 方法 + 单测 | W1 | P0 | — | FR-01/03/05 后端, D-006 | backend 侧 RPC 客户端 |
| task-02 | daemon host-fs-handler 3 实现 + 注册 + 单测 | W1 | P0 | — | FR-01/03/05/06 daemon, D-006, D-008 | daemon 侧命令执行（含默认 identity）|
| task-03 | dispatch_worker 接 worktree + 单测 | W2 | P0 | task-01 | FR-01, FR-02 部分, D-001 | worker cwd 改向副本 |
| task-04 | render_worker_prompt 约束 + 单测 | W2 | P0 | — | FR-02, D-002, D-003 | worker 只写代码必 commit |
| task-05 | finalize_execute_mission 分支合并 + 单测 | W3 | P0 | task-01, task-03 | FR-03, D-003 | converge 逐个 git merge |
| task-06 | converge_mission 可重入 + 解冲突 + 单测 | W3 | P0 | task-05 | FR-04, D-004 | 主 agent SDK 解决 + 轮次上限 |
| task-07 | 合并后清理 + patch 采集 + 单测 | W3 | P0 | task-01, task-05 | FR-05, D-005 | 成功清理失败保留 |
| task-08 | 三重收敛集成测试 | W4 | P1 | task-01~07 | FR-01~06 | 端到端单测链路 |

## 关键路径

task-01 → task-03 → task-05 → task-06 → task-08（最长 5 节点链，决定最短交付周期）

> task-02（daemon handler）与 task-01 并行（W1），task-04 与 task-03 并行（W2），task-07 与 task-06 并行（W3 内 task-07 依赖 task-05 不依赖 task-06）。

## 全局验收标准

- [ ] backend `pytest`（delegate/execution/finalizer 单测）全绿，零回归
- [ ] daemon `vitest`（host-fs-handler 单测）全绿，零回归
- [ ] （brownfield）single mode mission 零回归（不触发 dispatch_worker worktree 路径）
- [ ] （brownfield）bootstrap mission（read-only summary）零回归（走 `finalize_bootstrap_mission`，不触发 git merge）
- [ ] （brownfield）execute mission 无 patch 零回归（`finalize_execute_mission` 返回空 → 回退 bootstrap 路由）
- [ ] team execute mission：各 worker 获独立 worktree 副本（sibling 目录），并发写不覆盖
- [ ] converge 成功合并各 worker 分支到 workspace root（有 worker commit 历史）
- [ ] merge 冲突时主 agent SDK Read/Write 解决、`converge_mission` 可重入继续
- [ ] 合并成功后 worker 副本清理；merge 失败则副本保留
- [ ] worker 副本 commit 不因 daemon 全局 git config 缺失而失败（默认 identity，D-008）
- [ ] ruff + mypy + tsc 全绿

## 覆盖矩阵（decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（sibling worktree 位置）| task-03 | AC: worktree 在 `<root目录名>-workers/<run.id短8>/` |
| D-002@v1（worker 只写代码不跑 test）| task-04 | AC: render_worker_prompt 含约束文案 + 单测 |
| D-003@v1（分支合并方案 A）| task-04, task-05 | AC: worker commit + finalizer 逐个 git_merge |
| D-004@v1（冲突主 agent LLM 自动解）| task-06 | AC: converge_mission 可重入 + 冲突返回标记 |
| D-005@v1（合并后立即清理）| task-07 | AC: 成功 git_worktree_remove，无 GC |
| D-006@v1（走 HostFsDelegate 轻量路径）| task-01, task-02 | AC: delegate + handler 3 方法，不碰 worktree/ 模块 |
| D-007@v1（无前端改动）| —（scope）| AC: 文件清单不含 frontend/ |
| D-008@v1（worker 副本默认 git identity）| task-02 | AC: git_worktree_add 带 `-c user.name/email` |

## 文件覆盖自检

design §6 文件清单 → task 覆盖：
- `delegate.py` → task-01 ✅
- `host-fs-handler.ts` + `daemon.ts` → task-02 ✅
- `execution.py`（dispatch_worker + render_worker_prompt）→ task-03, task-04 ✅
- `finalizer.py`（finalize_execute_mission + cleanup）→ task-05, task-07 ✅
- `mcp_tools.py`（converge_mission）→ task-06 ✅
- 单测 → task-01~08 ✅

## 跨任务契约自检

- task-01（provider: delegate 3 方法签名 §7）← task-03（git_worktree_add）/ task-05（git_merge）/ task-07（git_worktree_remove）：method 名 + args + 返回对齐 design §7 ✅
- task-02（provider: daemon RPC handler）← task-01（delegate 经 RPC 调）：`host_fs.git_worktree_add/git_merge/git_worktree_remove` method 名对齐 §7 RPC 表 ✅
- task-03（provider: `AgentRun.worktree_branch` 填值）← task-05（取各 worker worktree_branch 合并）：字段名对齐 §8 ✅
