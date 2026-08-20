---
plan_level: full
---

# 实现计划（Plan）：mission 收敛巡检

## 来源

design.md（`.sillyspec/changes/2026-08-21-mission-converge-patrol/design.md`）：
main.py lifespan 常驻巡检协程，三职责（schedule_loop 收敛兜底 / redispatch 离线重派 /
两阶段僵尸处理），含 Grill P1/P2 修正（判死限定项目维度、豁免只挡信号 1、链路断链跳过）。

## Spike 前置验证

无（纯业务逻辑 + 已验证的既有模式复用：watchdog 协程 / redispatch / schedule_loop
全部存在且本次会话内读过源码，无技术不确定性）。

## Wave 1（并行：配置 + 骨架，无共享文件）

- task-01
- task-02

## Wave 2（收敛兜底）

- task-03

## Wave 3（离线重派）

- task-04

## Wave 4（僵尸判死）

- task-05

## Wave 5（僵尸复活）

- task-06

## Wave 6（豁免解除 + schedule_loop 豁免，二者无共享文件可并行）

- task-07
- task-08

## Wave 7（lifespan 接线）

- task-09

## Wave 8（全量回归 + 文档）

- task-10

> Wave 2~5/7 串行化原因（postcheck 蓝图一致性）：task-02~07/09 共享
> patrol.py + test_patrol.py（D-002 统一入口的必然），同 Wave 强制并行会互相
> 覆盖，按追加顺序拆为独立 Wave。

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | Settings 四项配置 | W1 | P0 | — | FR-04.1 | enabled/interval/zombie_after/revive_window + Field 约束 + 默认值单测 |
| task-02 | patrol.py 骨架 | W1 | P0 | — | FR-01.2/01.3, FR-04.2/04.3 | 巡检循环 + 活跃查询 limit100 + 异常隔离 + round_done 日志 + 每轮短 session |
| task-03 | 收敛兜底接线 | W2 | P0 | task-02 | FR-01 | 每轮调 schedule_loop，converged 计数 |
| task-04 | 离线重派接线 | W3 | P0 | task-02 | FR-02 | 调 redispatch_pending_main_runs，计数透传 |
| task-05 | 僵尸判死 | W4 | P0 | task-02 | FR-03.1, D-003 | running+有 lease+daemon 持续离线超阈值→failed(zombie)+zombie_marked_at；项目维度限定；链路断链跳过；幂等 |
| task-06 | 僵尸复活 | W5 | P0 | task-05 | FR-03.3 | 窗口内 daemon 恢复→running+清标记+重派；重派失败回滚 zombie 态 |
| task-07 | 豁免解除 | W6 | P0 | task-05 | FR-03.4 | 窗口耗尽→zombie_converged=true |
| task-08 | schedule_loop 豁免 | W6 | P0 | task-05 | FR-03.2, D-006 | 信号 1 对 zombie 窗口内 return None；信号 3 不豁免；既有调用方零回归 |
| task-09 | main.py lifespan 接线 | W7 | P0 | task-02~08 | FR-04.3 | create_task + cancel/gather；enabled=False 不启动；接线行为以 patrol 循环函数单测验证（conftest client 用 ASGITransport 不触发 lifespan，Plan Review gap-2） |
| task-10 | 全量回归 + 文档 | W8 | P0 | task-09 | NFR-01/02 | pytest agent+daemon / ruff / mypy / backend.md 备注 / 审查报告登记项更新 |

## 关键路径

task-02 → task-05 → task-08 → task-09 → task-10（骨架 → 判死 → 豁免 → 接线 → 回归）

## 全局验收标准

1. agent + daemon 模块 pytest 全绿（新增 test_patrol.py + test_orchestrator.py 豁免用例）。
2. ruff format/check + mypy 通过。
3. 零回归：mission_patrol_enabled=False 时无巡检协程启动；schedule_loop 既有调用方
   （_handle_team_run_completion / 测试）语义不变。
4. 验收要点对照 proposal.md 四条（收敛兜底/重派/僵尸三分支/长会话安全）。
5. （brownfield）未启用巡检的存量部署行为不变。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 | task-02/09 | lifespan 常驻协程接线 |
| D-002 | task-02~07 | patrol.py 三职责统一入口 |
| D-003 | task-05 | last_heartbeat_at 持续离线判定单测 |
| D-004 | task-05/06/07 | 两阶段可复活三分支单测 |
| D-005 | task-05 | constraints JSON 标记（无新列） |
| D-006 | task-08 | 豁免纯 DB 时间窗判定单测 |
| D-007 | task-10 | R-04 登记边界（无分布式锁） |
| FR-01 | task-02/03 | 收敛兜底用例 |
| FR-02 | task-04 | 重派用例 |
| FR-03 | task-05/06/07/08 | 僵尸全链路用例 |
| FR-04 | task-01/02/09 | 配置与观测用例 |
