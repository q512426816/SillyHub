---
author: qinyi
created_at: 2026-07-14 10:58:44
plan_level: full
---

# 实现计划（Plan）— lease/GC/恢复机制可靠性提升

## Spike 前置验证
| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | alembic 多 head 收敛（Grill 检出当前 13 head）+ worktree agent_run_id 外键 migration 可建可升级 | task-01 推翻，先手动 alembic merge 收敛 head 再进 |
| spike-02 | APScheduler AsyncIOScheduler 集成 FastAPI lifespan（start/shutdown/重启 reconcile）在本项目 asyncio 环境跑通 | task-02 退回方案 A（自建 asyncio 循环，LeaseReaperService 内部换实现，接口不变） |

## Wave 1（P0 稳定性基本盘，部分并行）
- [ ] task-01: alembic head 收敛 + WorktreeLease 加 agent_run_id 外键 migration（覆盖：FR-03, D-003@v2）
- [ ] task-02: APScheduler 骨架——LeaseReaperService（reaper/service.py）+ main.py lifespan 集成 + config.py GC settings + pyproject 加 apscheduler（覆盖：FR-01, D-006@v1）
- [ ] task-03: lease GC 接线——reaper 注册 lease GC job 调 handle_expired_leases_batch（只扫 batch lease，interactive NULL 豁免）+ 守护测试（覆盖：FR-01, FR-02, D-006@v1）
- [ ] task-04: worktree GC 判据改造——gc_expired_leases 改判据（关联 agent_run 非终态保留/终态含 cancelled 回收/孤儿 expires_at）+ acquire 可选 agent_run_id + _try_acquire_lease 回填 + 守护测试（覆盖：FR-03, D-003@v2）
- [ ] task-05: DaemonLeaseService 死代码清理——删 expire_overdue_leases + 残留正向方法，保留 cancel_lease/_send_interactive_cancel + 活 expire_leases（覆盖：FR-07, D-002@v1）

## Wave 2（P1 韧性，依赖 Wave 1）
- [ ] task-06: 心跳窗口可配——lease_heartbeat/claim_lease/start_lease 三处 60s 读 config + attempt 上限可配（handle_lease_expiry）+ 守护测试（覆盖：FR-04, D-006@v1）

## Wave 3（P2 可用性 + 收尾，依赖 Wave 1/2）
- [ ] task-07: failed retry 端点——POST /workspaces/{ws}/agent/runs/{id}/retry（建新 run 从头跑 attempt=1）+ 前端 retry 按钮 + 守护测试（覆盖：FR-05, D-005@v1）
- [ ] task-08: 悬空 session 可见性——AgentSessionRead 加 runtime_online + list/get join daemon_runtimes + 前端离线徽标 + 守护测试（覆盖：FR-06, D-004@v1）
- [ ] task-09: 全量回归 + 部署验证——backend/daemon/frontend 全量测试 + alembic upgrade head + 容器重建 e2e smoke（覆盖：FR-08）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | alembic head 收敛 + worktree agent_run_id 外键 migration | W1 | P0 | — | FR-03, D-003@v2 | spike-01；外键 nullable indexed |
| task-02 | APScheduler LeaseReaperService 骨架 + lifespan + config + 依赖 | W1 | P0 | — | FR-01, D-006@v1 | spike-02；MemoryJobStore |
| task-03 | lease GC job 接线 + 守护测试 | W1 | P0 | task-02 | FR-01, FR-02, D-006@v1 | 只扫 batch lease |
| task-04 | worktree GC 判据改造 + acquire 回填 + 守护测试 | W1 | P0 | task-01, task-02 | FR-03, D-003@v2 | 终态集含 cancelled |
| task-05 | DaemonLeaseService 死代码清理 | W1 | P0 | — | FR-07, D-002@v1 | 保留 cancel + 活 expire_leases |
| task-06 | 心跳窗口/attempt 可配 + 守护测试 | W2 | P1 | task-02（config） | FR-04, D-006@v1 | start_lease 第三处 |
| task-07 | failed retry 端点 + 前端按钮 + 测试 | W3 | P2 | task-02 | FR-05, D-005@v1 | 建新 run 不保进度 |
| task-08 | 悬空 session 可见性 + 前端徽标 + 测试 | W3 | P2 | task-02 | FR-06, D-004@v1 | 不加自动兜底 |
| task-09 | 全量回归 + 部署验证 | W3 | P0 | task-01~08 | FR-08 | alembic upgrade + 容器 e2e |

## 关键路径
task-01 + task-02 → task-04 → task-06 → task-09（schema 外键 + GC 骨架先行，worktree 判据次之，韧性调优，最后全量回归）

## 全局验收标准
- [ ] backend 全量 pytest 通过（含新增守护测试，零回归）
- [ ] daemon 全量 vitest 通过（本变更 daemon 零改动，验证不破坏）
- [ ] frontend 全量 vitest + typecheck 通过
- [ ] alembic upgrade head 成功（多 head 已收敛）
- [ ] （brownfield）env GC 全关时行为同现状（lease 靠启动 cleanup 兜底）
- [ ] GC 接线后 daemon 断开 >心跳窗口+周期，batch lease 被回收重派
- [ ] daemon 持续心跳的 30min 长任务 lease 不被 GC（守护测试）
- [ ] interactive lease（NULL）永不被 GC
- [ ] worktree 关联 agent_run 非终态不回收 / 终态(含 cancelled)回收
- [ ] failed run 可 retry 建新 run
- [ ] session 列表显示 daemon 在线/离线
- [ ] 容器重建后 e2e smoke 通过（lease GC/worktree GC/retry/可见性）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | （非目标） | cancel 真停已由 ql-20260712-001 具备，本变更不碰 |
| D-002@v1 | task-05 | 死代码清理，保留 cancel + 活 expire_leases |
| D-003@v2 | task-01, task-04 | worktree 外键 + acquire 回填 + 终态集含 cancelled |
| D-004@v1 | task-08 | 悬空可见性，不加自动兜底 |
| D-005@v1 | task-07 | retry 建新 run 不保进度 |
| D-006@v1 | task-02, task-03, task-06 | APScheduler 骨架 + lease GC job + 心跳/attempt 可配 |
