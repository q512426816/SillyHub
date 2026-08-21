---
author: qinyi
created_at: 2026-08-21 06:05:00
---

# 提案：mission 收敛巡检（mission-converge-patrol）

## 问题

项目维度 team mission（change_id=None）缺常驻收敛兜底（2026-08-21 审查 BE-P1-6 关联登记，
docs/project-team-mission-review-2026-08-21.md「登记不做」章节）：

1. **收敛兜底无触发点**：`complete_lease` 虽无门槛调 `converge_mission_for_completed_run`，
   但主 agent run 通常 running 使 derive_status 不收敛——真正触发收敛的
   `schedule_loop`（信号 1 worker 全终态 / 信号 3 预算触顶）唯一接线点在
   `_handle_team_run_completion`，被 `change_id is None` 短路（run_sync/service.py:1599），
   项目维度 mission 永远走不到。主 agent 不主动调 converge MCP 工具时 mission 永久 running。
2. **no_online_daemon 重派只在启动时**：ql-20260821-002 给 main.py 加了启动重派，运行中
   daemon 恢复的场景不覆盖（登记过"常驻轮询留后续变更"）。
3. **主 agent 僵尸**：主 agent 是 interactive lease 永不过期（lease/service.py:261），
   daemon 死亡时主 run 卡 running，无任何事件发生，worker 也可能因 lease 过期重派/failed
   后全终态——但主 run 卡 running 使 mission 无法收敛。

## 方案（用户已确认）

main.py lifespan 常驻 asyncio 巡检协程（对齐 watchdog 模式），每轮（默认 60s）执行三职责：

1. **收敛兜底**：活跃 team mission 逐个调既有 `schedule_loop`（幂等自判信号 1/3）。
2. **离线重派**：调既有 `redispatch_pending_main_runs`（pending + no_online_daemon）。
3. **两阶段僵尸处理**（长会话安全，用户确认 60min/30min 默认值）：
   - 判死：主 run running + 有 lease + lease 链路 daemon 实体**持续离线**超
     `zombie_after_minutes`（用 `daemon_instances.last_heartbeat_at` 判离线起点，默认 60）
     → 标 `failed + error_code=orchestrator_zombie` + constraints 记 `zombie_marked_at`，
     **mission 不收敛**（信号豁免）。
   - 复活窗口（默认 30min）：窗口内 daemon 恢复在线 → 主 run 复活（failed → running），
     重渲染 prompt 重派 lease，会话继续。
   - 窗口耗尽仍离线 → 豁免解除，下轮巡检信号 1 正常收敛（worker 产物照常 merge）。

## 非目标

- 不做多实例分布式锁（当前单实例部署；converged_at 原子守卫已防重复收敛，登记边界）。
- 不改 run_sync 回调契约（事件驱动方案 B 已否决：daemon 死亡无事件可挂）。
- 不做 worker run 的僵尸检测（worker lease 有既有 expiry 重派/failed 兜底）。
- 不做巡检管理端点/前端页面（观测走结构化日志）。
- 不做 external/single 模式覆盖（schedule_loop 无主 run 自动跳过，天然隔离）。

## 验收要点

1. 主 agent 不收敛 + worker 全终态的 mission，巡检一轮内（≤ interval×2）收敛。
2. no_online_daemon 主 run 在 daemon 恢复后 ≤ 两轮内重派。
3. 僵尸三分支：持续离线超阈值判死（不收敛）；窗口内恢复→复活重派；窗口耗尽→收敛。
4. 长会话安全：daemon 在线时 run 跑多久都不触发僵尸判定；daemon 短暂离线（< 阈值）不判死。
5. 单 mission 巡检异常不影响其它 mission（逐个 try/except 隔离）。
