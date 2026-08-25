---
author: qinyi
created_at: 2026-08-25 20:05:00
---

# 需求文档（Requirements）— 团队分身子会话化 P1 治理地基

## FR-01 会话树挂载

`agent_sessions` 新增 `parent_session_id`（自引用 FK + 索引）；分身子会话派发时
挂主控会话之下；`resolve_mission_for_session` 沿 parent 链爬根（visited 环检测）
命中 mission；`mission_worker_sessions(mission_id)` 按根一层枚举分身。

**验收**：分身派发后 DB 可查 parent 关系；环数据不死循环；mission 枚举不含主控轮
run 与追问轮次 run。

## FR-02 子会话三元组派发

dispatch_worker 对新形态建 `AgentSession(parent=主控, user_id=mission.created_by)`
+ interactive lease（metadata.stage=mission_worker）+ 首 run（mission_id + role
双标记），同事务原子提交；worktree 副本逻辑复用（含 git/direct 探测）；跨 ws
代表机器经 placement 代表钉定模式（跳属主校验，anchor 自有 runtime 优先）。

**验收**：派发成功后分身会话可流式 / 可 owner 追问；跨 ws scope 派发落在代表
机器；worktree 失败时分身 run/会话正确标 failed 不崩 mission。

## FR-03 分身受限工具注入

daemon 对 stage=mission_worker 的会话注入仅含 `worker_done` 单工具的受限 MCP
server（create/restore/reload 三路生效；env 门控裁剪工具注册；per-session id
注入覆盖受限 server）。分身**不可**调用 dispatch_worker / converge_mission 等
派发工具。

**验收**：分身会话工具列表只含 worker_done；重启恢复后注入保持；主控工具集
不变。

## FR-04 显式完成信号 worker_done

新 MCP 端点 `worker_done(summary)`：写会话 `worker_done_at`；summary 落
AgentArtifact 挂首 run（mission 链可见）；全分身完成沿 false→true 迁移唤醒主控
（SETNX 幂等键随重开工 DEL，支持重复完成周期）；mission 已终态的迟到调用 409
（resolve 支持 include_terminal）。

**验收**：分身调 worker_done 后状态可查；追问重开工后 is_worker_complete 回到
未完成、再次 worker_done 回到完成；迟到调用不写状态。

## FR-05 判据替换（单一真相源）

`is_worker_complete`（完成 = worker_done_at 非空且无活跃 turn；终结 = 会话终态；
存量 batch run = run 终态）与 `mission_derive_status`（虚拟 run 映射，workers_only
模式，done 优先于终态 failed）替换以下全部判据点：`_converge_core` busy 前置、
`converge_mission_for_completed_run`（converge_explicit）、`schedule_loop` 信号 1、
`_team_mission_summary`、`_mission_status_core`、`workers_all_terminal_with_stats`
（complete_lease / patrol 两调用点）、`cleanup_mission` 清理时机。

**验收**：分身 idle 未 done 时 mission 不误判完成/不触发超时收敛/不删其 worktree；
全 done 后各状态源一致。

## FR-06 生命周期批量收口

converge：merge 成功后沿树逐个 end_session（SESSION_END 硬杀链）；冲突 /
needs_manual 路径不收口（子会话保持活跃）。cancel：kill 名单 = runs + 分身子会话。
patrol：孤儿子会话扫描（mission 终态 + 子会话活跃 → 补发 end_session）。

**验收**：converge 成功后无活跃分身会话残留；冲突路径子会话仍可访问；cancel 后
daemon 无僵尸。

## FR-07 归属与成本

分身会话 owner=mission.created_by（追问/权限卡片/门户/审计 owner-only 机制不动）；
`cost_from_runs` 输入 union 分身子会话轮次 run，预算治理门覆盖追问轮成本；
`can_dispatch_worker` 并发口径 = 存量 running run + 未完成子会话。

**验收**：发起人可在门户看到分身并追问；治理门能拦超预算的追问轮派发。

## FR-08 最小 UI 入口

`TeamMissionWorkerSummary` 加 `sub_session_id`（+`first_run_id`）；
`team-task-block` 分身行点击复用 `session-panel` 打开（实时流 + 追问）；
`pnpm gen:types` 同步提交。

**验收**：派团队 → 点分身行 → 看到该分身实时流面板并可输入追问。

## FR-09 存量兼容

存量 mission batch 分身与新形态双判据混跑；`list_workers` / 摘要对新形态按子会话
行返回（含 first_run_id），存量回落 run 行；轮次 run 不混入 worker 列表。

**验收**：存量 mission 收敛行为不变；新 mission 分身列表正确。
