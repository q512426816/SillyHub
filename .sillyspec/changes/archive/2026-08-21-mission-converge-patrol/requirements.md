---
author: qinyi
created_at: 2026-08-21 06:05:00
---

# 需求：mission 收敛巡检

## FR-01 收敛兜底（核心）

巡检周期内对活跃 team mission（`converged_at IS NULL AND cancelled_at IS NULL`）调
`OrchestratorService.schedule_loop`：worker 全终态（信号 1）或预算触顶（信号 3）时
强制收敛。覆盖项目维度 mission（change_id=None，run 完成回调短路无触发点）与
主 agent 忘记/无法调 converge MCP 工具的场景。

- FR-01.1 巡检间隔默认 60s，`mission_patrol_interval_seconds` 可配（ge=10）。
- FR-01.2 单轮单 mission 异常隔离（try/except + warning 日志），不阻断同轮其它 mission。
- FR-01.3 每轮限量（limit 100）防 mission 积压时单轮过载。

## FR-02 离线重派

每轮调 `redispatch_pending_main_runs`：pending + error_code=no_online_daemon 的主 run
在 daemon 恢复在线后重派 lease。补充 ql-20260821-002 仅启动时重派的缺口。

- FR-02.1 重派失败（daemon 仍离线）保持 pending，不判死（职责归僵尸检测的 running 态）。

## FR-03 两阶段僵尸处理（长会话安全）

- FR-03.1 判死：主 run（role=orchestrator）`status=running` 且有 lease，且 lease 链路
  （lease → runtime → daemon_instance）的 daemon 实体**持续离线**——
  `status != 'online'` 且 `last_heartbeat_at` 距今 ≥ `mission_patrol_zombie_after_minutes`
  （默认 60）→ 标 `failed` + `error_code=orchestrator_zombie` + `finished_at`，
  mission.constraints 记 `zombie_marked_at`（ISO 时间戳）。
- FR-03.2 判死不收敛：`schedule_loop` 信号 1 对主 run 为 zombie failed 且豁免期内的
  mission 不触发收敛（worker 产物不 merge，等复活）。
- FR-03.3 复活：豁免期内（`zombie_marked_at` 距今 < `mission_patrol_revive_window_minutes`，
  默认 30）daemon 恢复在线 → 主 run `failed → running`，清 zombie 标记
  （error_code/zombie_marked_at），重渲染 `render_orchestrator_prompt` 重派 lease，会话继续。
- FR-03.4 窗口耗尽：`zombie_marked_at` 距今 ≥ 复活窗口且 daemon 仍离线 → 豁免解除，
  下轮巡检信号 1 正常收敛，constraints 记 `zombie_converged=true`（收敛原因可见）。
- FR-03.5 长会话安全：daemon 在线的 mission 无论 run 运行多久，僵尸判定永不触发；
  daemon 离线未超阈值的 running 主 run 不判死。

## FR-04 配置与观测

- FR-04.1 Settings 四项：`mission_patrol_enabled`（默认 True）、
  `mission_patrol_interval_seconds`（默认 60，ge=10）、
  `mission_patrol_zombie_after_minutes`（默认 60，ge=5）、
  `mission_patrol_revive_window_minutes`（默认 30，ge=5）。
- FR-04.2 每轮结束 `mission_patrol_round_done` 结构化日志：
  checked / converged / redispatched / zombie_marked / zombie_revived 计数 + 耗时。
- FR-04.3 lifespan 关停：yield 后 cancel 巡检任务（对齐 watchdog 模式）。

## 约束

- NFR-01 巡检与 complete_lease 并发收敛安全：复用既有 converged_at 原子 UPDATE 守卫，不新增锁。
- NFR-02 零回归：巡检关闭（enabled=False）时行为与现状字节一致；schedule_loop 既有
  调用方（_handle_team_run_completion）语义不变。
- NFR-03 无 schema 变更：zombie 标记复用 constraints JSON 列（同 conflict_attempts 模式）。
