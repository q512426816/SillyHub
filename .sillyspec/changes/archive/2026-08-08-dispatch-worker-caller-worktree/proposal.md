---
author: qinyi
created_at: 2026-08-08 17:05:13
revised_at: 2026-08-08 17:55:00
---

# 提案（Proposal）— dispatch_worker 支持 caller worktree（路径A）+ mission external 模式

## 一句话

SillyHub `dispatch_worker` 增可选 `worktree_path`/`branch`/`worker_prompt` + `create_mission` 增 `orchestration_mode="external"`，让外部 caller（SillySpec）提供自己的 worktree 派 worker（不 spawn 僵尸 orchestrator、worker 不 commit、SillyHub 不 converge merge），SillySpec 自己 apply，端到端打通真实派发。

## 动机

SillySpec 派发抽象层已落地但 SillyHub 侧路径A 未落地，且 round-1 Design Grill 暴露两个 P0：① SillyHub mission = orchestrator+worker team 模型，create_mission 强制 spawn 无人驱动的僵尸 orchestrator；② worker 终态触发 converge `git merge` 会污染 caller 主仓。需 mission external 模式对齐 + converge 跳过 + dispatch_worker 参数，才能"真实可用"。

## 方案（方案A + mission external 模式）

`create_mission` 加 `orchestration_mode`（external 跳过 orchestrator spawn + constraints 标记）；`dispatch_worker` 加3可选参（worktree_path/branch/worker_prompt，默认 None 零回归），路径A 不写 `run.worktree_branch`；`converge_mission_for_completed_run` 检测 external 跳过 finalize/cleanup；两条 MCP 入口（链路B public + 链路A daemon stdio）透传；allowed_roots 约定 workspace root_path=仓根；SillySpec `isPathASupported` 探测 + `createMission` 传 external + 端到端 smoke。

## 不在范围内（Non-Goals）

- 不改 team 模式 mission worker / orchestrator 行为（orchestration_mode 默认 team 零回归）
- 不新增 MCP tool（8 tool 不变）
- 不新增 DB 列（constraints JSON 复用）
- 不解决 external mission 显式生命周期关闭（YAGNI）
- 不改 placement.py（已支持）

## 影响

跨 backend/agent（execution/orchestrator/finalizer）+ mcp_gateway + sillyhub-daemon + 跨仓 sillyspec 接通。round-2 改动面较 round-1 扩大（触及 converge 核心），详见 design.md。
