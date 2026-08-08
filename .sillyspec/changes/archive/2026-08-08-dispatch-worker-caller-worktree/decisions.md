---
author: qinyi
created_at: 2026-08-08 17:05:13
revised_at: 2026-08-08 17:55:00
---

# 决策台账（Decisions）— dispatch_worker caller worktree（路径A）+ mission external 模式

## D-001@v1 方案A caller 全权控制 worker_prompt

`dispatch_worker` 加可选 `worker_prompt`，caller 传则完全替代 `render_worker_prompt`。

**为何**：SillySpec 侧已有"绝不 commit/不越界 allowedPaths"覆写文本，直接复用，caller 全权控制最灵活。

**否决**：方案B（render 加 commit flag）；方案C（加 close_mission tool 扩张对外契约）。

**覆盖**：FR-02。

## D-002@v1 不新增 DB 列

`worktree_path`/`branch`/`worker_prompt` 仅入参 + lease metadata；`orchestration_mode` 存 `AgentMission.constraints` JSON（model.py:601 已存在）。

**覆盖**：design §8。

## D-003@v2 finalizer 改（检测 external 跳过）【round-2 修订】

`converge_mission_for_completed_run`（finalizer.py:470）加 external 检测：`mission.constraints.orchestration_mode=="external"` → 跳过 finalize_execute_mission / cleanup_mission。

**为何修订**：round-1 v1"finalizer 不改"被 Design Grill 证伪——worker 终态必触发 converge，路径A worker 分支含 SillySpec change 真实 commit 历史，`git merge --no-ff` 会污染 caller 主仓（P0-1）。必须改 finalizer 检测 external 跳过。

**覆盖**：design §7.5；R-01 根解。

## D-004@v1 路径A 不 converge/cleanup

SillySpec 自己 git diff + apply 回主干，不依赖 SillyHub 合并 tool。

**覆盖**：design §7.5。

## D-005@v1 SillySpec 探测 tools/list

`isPathASupported()` 调 MCP `tools/list` 查 dispatch_worker schema 含 `worktree_path` → true。

**覆盖**：FR-04；R-04。

## D-006@v1 范围含跨仓 SillySpec 接通

本 change 开在 SillyHub 仓但 design 跨仓登记 SillySpec 侧接通。

**覆盖**：FR-04/FR-07。

## D-007@v1 mission external 模式【round-2 新增，解 P0-2】

`create_mission` 加 `orchestration_mode` 参（默认 "team" 零回归，路径A 传 "external"）。external → team_mission_entry 跳过 orchestrator run/lease + constraints 存 mode。converge 检测 external 跳过 finalize。

**为何**：SillyHub mission = orchestrator+worker team 模型，路径A = SillySpec 外部调度，架构不匹配。create_mission 强制 spawn 僵尸 orchestrator（占 lease + mission 卡 running）。external 模式让路径A 复用 mission 容器但不引入无人驱动的 orchestrator。

**覆盖**：FR-08/FR-09；R-02。

## D-008@v1 路径A 不写 run.worktree_branch【round-2 新增，解 P0-1 双保险】

`AgentRun.worktree_branch`（model.py:332）是 team 模式 converge finalize 查 merge 的触发字段（finalizer.py:255）。路径A SillySpec 自己 apply 不需 SillyHub merge，**不写该列**（保持 None）。`branch` 入参仅作 lease metadata 记录。

**为何**：双保险——即使 D-003 external 检测失效，finalize 查 worktree_branch 为空也跳过 merge。

**覆盖**：design §7.2；R-01 防御层②。

## D-009@v1 字段名统一 branch【round-2 修订】

dispatch_worker 入参用 `branch`（不是 round-1 的 `worktree_branch`），对齐跨仓契约 `sillyhub-path-a-contract.md`（第1处用 branch）+ sillyspec client.js（已传 branch）。

**为何修订**：round-1 design 用 worktree_branch 与跨仓契约/SillySpec client 漂移，落地撞 schema。

**覆盖**：design §7.3；R-06。
