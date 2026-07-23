---
author: qinyi
created_at: 2026-07-13 00:19:51
change: 2026-07-12-worker-worktree-isolation
scale: large
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 主 agent（orchestrator） | 真 agent（daemon interactive lease，cwd=workspace root），指挥 worker、converge 时合并 + 解冲突 |
| worker | 用户预设的子 agent，在自己 worktree 副本写代码、commit |
| backend HostFsDelegate | 经 WS RPC 指挥 daemon 执行 git worktree/merge/remove |
| daemon host-fs-handler | 接收 RPC，在宿主机 workspace root 执行 git 命令 |

## 功能需求

### FR-01: per-worker 独立 worktree 创建
覆盖决策：D-001@v1, D-006@v1, D-008@v1
- Given team execute mission 的 worker run 处于 pending、workspace 绑定在线 daemon
- When backend dispatch_worker 调 `HostFsDelegate.git_worktree_add`
- Then daemon 在 `<root目录名>-workers/<run.id短8>/` 创建 worktree（base=`ws.default_branch or "HEAD"`，配默认 git identity），返回 `{ok, worktree_path}`；`AgentRun.worktree_branch` 填 `workers/<run.id短8>`
- Given `ws.default_branch` 为空
- When git_worktree_add 执行
- Then base_ref 兜底 `"HEAD"`（X-001 修正）

### FR-02: worker 在副本内写+commit（root_path 改向副本）
覆盖决策：D-002@v1, D-003@v1
- Given worktree 创建成功
- When dispatch_worker 把 worktree_path 作 root_path 传 `dispatch_to_daemon`
- Then daemon worker 进程 cwd=副本；`render_worker_prompt` 约束"只写代码不跑 test/build、完成后必 `git add -A && git commit`、按文件分工"
- Given worker 完成提交
- When daemon complete_lease
- Then 从副本 cwd 采 commit diff → diff_summary 回灌（task-04 既有链路自动指向副本）

### FR-03: converge 分支合并
覆盖决策：D-003@v1, D-006@v1
- Given mission 所有 worker 终态、主 agent 调 `converge_mission`
- When `finalizer.finalize_execute_mission` 逐个调 `HostFsDelegate.git_merge(worker_branch)`
- Then daemon 在 workspace root `git merge --no-ff <worker_branch>`，返回 `{ok, conflicts, merged_files}`；ok=True 继续下一个，ok=False+conflicts 进 FR-04

### FR-04: 冲突主 agent 自动解决（converge_mission 可重入）
覆盖决策：D-004@v1
- Given git_merge 返回冲突
- When `converge_mission` tool 返回 `{status:conflict, conflicts:[{file,marker_lines}]}` 给主 agent
- Then 主 agent 用 SDK `Read` 冲突文件（cwd=workspace root）、推理解决、`Write` 回写、`Bash git add`；再调 `converge_mission` 重入 → backend `git merge --continue` 或合下一个分支
- Given 解冲突轮次超 R-07 上限（如 3 轮）仍失败
- When converge 终止
- Then `git merge --abort` 回退 + 标 mission 需人工介入 + worker 副本保留（X-003 修正）

### FR-05: 合并后清理 + patch 采集
覆盖决策：D-005@v1
- Given 全部 worker 分支合并成功
- When finalizer 调 `HostFsDelegate.git_worktree_remove` 各副本
- Then daemon `git worktree remove --force <sibling>`；副本删除；采 workspace root 合并 diff 作 `kind=patch` artifact
- Given merge 失败回退
- When mission 标人工介入
- Then worker 副本**保留**（不清理），供人工排查（X-003）

### FR-06: worker 副本 git identity（X-002）
覆盖决策：D-008@v1
- Given daemon 全局 git config 未配 user.name/email
- When `git_worktree_add` 创建副本
- Then 副本带默认 identity（`git -c user.name=worker -c user.email=worker@sillyhub` 透传），worker `git commit` 不失败

## 非功能需求

- **兼容性**：single mode / bootstrap mission / execute 无 patch 三路径零回归（design §9）。
- **可回退**：merge 整体失败 → `git merge --abort` + 副本保留 + mission 标人工。
- **可测试**：backend pytest（mock WS RPC）+ daemon vitest（mock git 子进程）覆盖 3 方法 + dispatch 接线 + converge 合并/冲突/cleanup。
- **跨平台**：sibling_path 走 daemon 侧宿主机原生路径（Win/Linux/macOS 通用，`resolve_root_path_for_daemon` 模式）。
- **安全**：git 命令经 host_fs 独立 method（非 `run_command` 白名单），daemon `assertWithinAllowedRoots` 守 cwd 越界。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | sibling worktree 位置（`<root目录名>-workers/<run.id短8>/`）|
| D-002@v1 | FR-02 | worker 只写代码不跑 test/build |
| D-003@v1 | FR-02, FR-03 | 分支合并方案（worker commit + git merge）|
| D-004@v1 | FR-04 | 冲突主 agent LLM 自动解决 |
| D-005@v1 | FR-05 | 合并后立即清理（无 GC）|
| D-006@v1 | FR-01, FR-03 | 走 HostFsDelegate 轻量路径，不复用 bare-clone 模块 |
| D-007@v1 | —（scope） | 无前端改动（YAGNI）|
| D-008@v1 | FR-06 | worker 副本默认 git identity |

> 所有 D-001@v1 ~ D-008@v1 均被 FR 覆盖，无剩余风险决策。
