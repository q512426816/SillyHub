---
author: qinyi
created_at: 2026-08-21 06:05:00
scale: large
tier: independent
risk_level: standard
---

# 设计：mission 收敛巡检

## 1. 背景

见 proposal.md。核心事实链（代码依据）：

- `run_sync/service.py:1599` `agent_run.change_id is None → return`：项目维度 mission 的
  run 完成回调短路，`_handle_team_run_completion`（schedule_loop 唯一接线点）不可达。
- `complete_lease`（lease/service.py:683-699）无门槛调 `converge_mission_for_completed_run`，
  但主 agent run running 使 `derive_status` 返回 running 不收敛——设计内（主 agent 自主收敛），
  缺的是主 agent 不收敛时的兜底触发器。
- 主 agent interactive lease 永不过期（lease/service.py:261）：daemon 死亡无事件、无 expiry 兜底。
- worker lease 过期有既有兜底（handle_lease_expiry：重派或 attempt≥3 标 failed）。

## 2. 总体方案

新文件 `backend/app/modules/agent/patrol.py`（`MissionPatrolService`）+ `main.py` lifespan
接线常驻协程。每轮顺序执行三职责，全程单 mission 异常隔离。**每轮开独立短
session**（`get_session_factory()()` async with——巡检轮间不长期持连接，对齐
complete_lease 等请求路径的 session 生命周期）。

```
main.py lifespan
  └─ asyncio.create_task(mission_patrol_loop())     # 对齐 watchdog_task 模式
       └─ while settings.mission_patrol_enabled:
            ┌─ ① 收敛兜底：活跃 mission 逐个 schedule_loop（幂等）
            ├─ ② 离线重派：redispatch_pending_main_runs
            └─ ③ 僵尸两阶段：判死 / 复活 / 豁免解除
            await asyncio.sleep(interval)            # 60s 默认
```

### 2.1 收敛兜底

```python
# 活跃 mission 查询（limit 100）
select(AgentMission.id).where(
    AgentMission.converged_at.is_(None),
    AgentMission.cancelled_at.is_(None),
).order_by(AgentMission.created_at).limit(100)
# 逐个：OrchestratorService(session).schedule_loop(mid)
# external/single 无主 run → schedule_loop 内部跳过（零改动）
```

### 2.2 离线重派

直接调既有 `OrchestratorService.redispatch_pending_main_runs()`（ql-20260821-002 已建）。
巡检周期调用即覆盖"运行中 daemon 恢复"场景。

### 2.3 两阶段僵尸处理（本变更核心新增逻辑）

**判死链路**：主 run → 最新 lease（`daemon_task_leases.agent_run_id` order by `updated_at`
desc 取 1）→ `DaemonRuntime`（lease.runtime_id）→ `DaemonInstance`（runtime.daemon_instance_id）。

```text
候选：mission.change_id IS NULL（Grill P1：项目维度限定——change 维度 team
      mission 已有 _handle_team_run_completion 事件驱动兜底，不进判死范围，
      保 NFR-02 既有调用方语义不变）
      主 run role=orchestrator AND status='running' AND 有 lease
判死：daemon.status != 'online'
      AND now - daemon.last_heartbeat_at >= zombie_after_minutes(60)
  →  run.failed + error_code='orchestrator_zombie' + finished_at
      mission.constraints['zombie_marked_at'] = now ISO
      （不收敛——信号豁免期开始）

复活：run.error_code == 'orchestrator_zombie'
      AND now - zombie_marked_at < revive_window_minutes(30)
      AND daemon 恢复 online
  →  run.status='running'，error_code/finished_at 清空，zombie_marked_at 移除
      重渲染 render_orchestrator_prompt + dispatch_to_daemon 重派 lease

耗尽：run.error_code == 'orchestrator_zombie'
      AND now - zombie_marked_at >= revive_window_minutes
  →  constraints['zombie_converged']=true，豁免解除
      （下轮信号 1 视主 run 为终态 failed → 正常收敛）
```

**信号豁免的实现点**（`orchestrator.py schedule_loop` 信号 1 处；Grill P2-1
统一口径：**豁免只挡信号 1（worker 全终态收敛）**——信号 3 预算触顶是治理强收，
优先级高于复活等待，不豁免）：

```python
# 现有：all_workers_terminal → 强制 main_run 标 completed → converge
# 新增豁免：main_run.error_code == 'orchestrator_zombie'
#   AND 豁免未耗尽（zombie_marked_at 距今 < revive_window）
#   AND daemon 仍离线 → return None（等复活，不收敛）
# 豁免耗尽或 daemon 已恢复（复活路径已把 error_code 清了）→ 原逻辑不变
```

豁免判定不查 daemon（保持 schedule_loop 纯 DB 判断，daemon 恢复的复活由职责③处理——
恢复时 error_code 被清，豁免条件自然不成立）。**简化**：豁免 = `error_code ==
'orchestrator_zombie' AND now - zombie_marked_at < revive_window`。窗口耗尽后即使
error_code 还在（daemon 没恢复、职责③的复活不可能发生），豁免到期自然解除。

**pending 态不判死**：pending + no_online_daemon 归职责②重派；pending 无 lease 的
（未派出去过）不满足"有 lease"前提，天然排除。

**链路断链跳过**（Grill P2-2）：判死链任一环缺失（lease 无 runtime_id、
runtime.daemon_instance_id 为 NULL——迁移期遗留 nullable）→ 跳过该 run 不判死
（log debug），不猜不崩。

## 3. 配置（core/config.py Settings 四项）

| 键 | 默认 | 约束 |
|---|---|---|
| mission_patrol_enabled | True | 开关（False=字节级零回归） |
| mission_patrol_interval_seconds | 60 | ge=10 |
| mission_patrol_zombie_after_minutes | 60 | ge=5 |
| mission_patrol_revive_window_minutes | 30 | ge=5 |

## 4. 生命周期契约

| 事件 | 发起方 | 接收方 | 状态变化 |
|---|---|---|---|
| 巡检轮 | lifespan 协程 | patrol service | 无（只读判定 + 下述动作） |
| 信号 1/3 收敛 | patrol → schedule_loop | finalizer | mission → done/degraded（既有路径） |
| 离线重派 | patrol → redispatch | placement | 主 run pending→（claim 后 running） |
| 僵尸判死 | patrol | AgentRun/AgentMission | run running→failed(zombie)；constraints+zombie_marked_at |
| 僵尸复活 | patrol | AgentRun/lease | run failed→running；重派新 lease |
| 豁免耗尽 | patrol | AgentMission | constraints+zombie_converged → 下轮收敛 |

关停：lifespan yield 后 `task.cancel()` + `await asyncio.gather(task,
return_exceptions=True)`（比 watchdog 的 fire-and-forget cancel 更严谨——巡检轮内
有 DB 写，须等取消落地；Grill P2-4）。

## 5. 决策追踪

| 决策 | 标题 | 状态 |
|---|---|---|
| D-001 | 载体 = lifespan 常驻协程（否决事件驱动/独立进程） | accepted（用户确认） |
| D-002 | 三职责统一入口 patrol.py（收敛/重派/僵尸） | accepted（用户确认最完整档） |
| D-003 | 僵尸判死 = daemon 持续离线（last_heartbeat_at 起点），非瞬时状态 | accepted（用户长会话反馈） |
| D-004 | 两阶段可复活（判死≠收敛，30min 窗口内恢复自动续会话） | accepted（用户确认） |
| D-005 | zombie 标记复用 constraints JSON（无新列，同 conflict_attempts 模式） | accepted |
| D-006 | 豁免判定不查 daemon 在线状态（纯 DB 时间窗，复活由职责③清标记解除） | accepted |
| D-007 | 多实例分布式锁不做（单实例部署 + converged_at 守卫兜底，登记边界） | accepted |

## 6. 风险登记

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-01 | 复活重派后主 agent 上下文丢失（prompt 重渲染，非会话续传） | 中 | prompt 含 mission 全量上下文（objective/scope/worker 预设/关键标识），主 agent 可 list_workers 读进度接续；登记语义边界 |
| R-02 | daemon_instances.status 由心跳/断连维护，若断连标记滞后 → 判死延迟 | 低 | last_heartbeat_at 双条件（status+心跳时间），阈值 60min 远大于心跳滞后 |
| R-03 | 巡检与 complete_lease 并发收敛 | 低 | converged_at 原子 UPDATE 守卫（既有） |
| R-04 | 多实例部署重复巡检 | 低 | 当前单实例；converge 幂等 + 判死幂等（error_code 判重）；登记后续加 Redis 锁 |
| R-05 | mission 量大时单轮过载 | 低 | limit 100/轮 + created_at 序（老 mission 先巡检） |
| R-06 | 复活重派后旧 claimed interactive lease 残留（interactive 无 expiry 不回收） | 低 | claim 侧 lease 归属校验保安全（新 lease 优先）；登记 known 边界（Grill P2-5） |

## 7. 测试策略

- `tests/test_patrol.py`：service 级单测
  - 收敛兜底：活跃 mission 调 schedule_loop（mock 断言）；cancelled/converged 排除；异常隔离。
  - 离线重派：redispatch 调用断言 + 计数透传（Grill P2-6 补）。
  - 判死幂等：已 zombie 的 run 不重复标（Grill P2-6 补）。
  - 僵尸判死三分支：离线超阈值→failed(zombie)+zombie_marked_at；在线→不动；离线未超阈值→不动。
  - 复活：zombie + 窗口内 + daemon 恢复 → running + 重派（mock dispatch_to_daemon）。
  - 豁免：zombie 窗口内 schedule_loop 不收敛；窗口耗尽收敛。
  - enabled=False → 巡检循环直接退出。
- `schedule_loop` 豁免逻辑单测（test_orchestrator.py 追加）。
- lifespan 接线冒烟（既有 app 启动测试模式对齐）。

## 8. 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/agent/patrol.py` | MissionPatrolService（三职责 + 巡检循环） |
| 修改 | `backend/app/modules/agent/orchestrator.py` | schedule_loop 信号 1 zombie 豁免分支 |
| 修改 | `backend/app/core/config.py` | Settings 四项 |
| 修改 | `backend/app/main.py` | lifespan 接线巡检协程 |
| 新增 | `backend/app/modules/agent/tests/test_patrol.py` | 巡检单测 |
| 修改 | `backend/app/modules/agent/tests/test_orchestrator.py` | 豁免逻辑用例 |

## 9. 自审

- [x] 用户四项确认全覆盖（范围/载体/长会话/两阶段复活）。
- [x] 代码依据逐条核实（change_id 短路 / complete_lease 无门槛 converge / interactive 永不过期 / worker expiry 兜底 / last_heartbeat_at 存在性）。
- [x] 零回归边界：enabled=False 字节不变；schedule_loop 既有调用方语义不变（豁免只对 error_code=orchestrator_zombie 生效，该值只有巡检判死才写）。
- [x] 复活的状态翻回（failed→running）不违反模型约束（status 自由字符串列）。
- [x] 规模 medium + tier independent（4 源文件 + 2 测试文件，含状态机语义变更）。
