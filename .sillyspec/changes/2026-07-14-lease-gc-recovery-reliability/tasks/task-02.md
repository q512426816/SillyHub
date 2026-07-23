---
id: task-02
title: APScheduler 骨架——LeaseReaperService + lifespan 集成 + config GC settings
title_zh: APScheduler 统一巡检骨架——新建 LeaseReaperService + main.py lifespan 接入 + config.py 加 GC 配置项 + pyproject 加 apscheduler 依赖
priority: P0
estimated_hours: 2
created_at: 2026-07-14 11:01:53
author: qinyi
depends_on: []
blocks: [task-03, task-04, task-06, task-07, task-08]
requirement_ids: [FR-01]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/reaper/service.py
  - backend/app/modules/daemon/reaper/__init__.py
  - backend/app/main.py
  - backend/app/core/config.py
  - backend/pyproject.toml
provides:
  - contract: LeaseReaperService
    fields: [start, shutdown, reconcile_all, _run_lease_gc, _run_worktree_gc]
  - contract: GCSettings
    fields: [gc_lease_enabled, gc_lease_interval_sec, lease_heartbeat_ttl_sec, lease_max_attempts]
---

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/daemon/reaper/__init__.py | 包初始化，re-export `LeaseReaperService` |
| 新增 | backend/app/modules/daemon/reaper/service.py | `LeaseReaperService`：AsyncIOScheduler 骨架 + job 注册槽位 + 启动全量 reconcile |
| 修改 | backend/app/main.py | lifespan startup 在 bootstrap 后 `await LeaseReaperService(...).start()`，shutdown 关闭（仅挂骨架与 reconcile，job 回调体在 task-03/04 接入） |
| 修改 | backend/app/core/config.py | Settings 末尾加 GC 配置块（§7.3，env 全默认开） |
| 修改 | backend/pyproject.toml | dependencies 加 `apscheduler>=3.10` |

## 实现要求

design §5 Wave1 + §7.1 + §7.3 + §9。本任务只搭"骨架"：scheduler 能起能停、reconcile_all 能被调用、job 注册的挂载点（`_run_lease_gc`/`_run_worktree_gc` 方法）存在但回调体留 TODO 占位（task-03/04 填实现）。spike-02 先验证 APScheduler AsyncIOScheduler 在本项目 asyncio 环境跑通 lifespan start/shutdown/重启 reconcile，不通过则退回方案 A（自建 asyncio 循环，接口不变）。

### LeaseReaperService 接口（design §7.1）

```python
class LeaseReaperService:
    def __init__(self, scheduler: AsyncIOScheduler, lease_service, worktree_service,
                 runtime_service, settings): ...
    async def start(self) -> None:      # startup：注册 job（env 开关守卫）+ scheduler.start() + await reconcile_all()
    async def shutdown(self) -> None:   # shutdown：scheduler.shutdown(wait=False)
    async def reconcile_all(self) -> None:  # 启动兜底：仅扫 active 子集（claimed/pending lease + locked worktree），不扫终态历史行
    async def _run_lease_gc(self) -> None:    # TODO task-03：调 LeaseService.handle_expired_leases_batch
    async def _run_worktree_gc(self) -> None: # TODO task-04：调改造后 WorktreeService.gc_expired_leases
```

### main.py lifespan 接入点

startup 段（main.py:73-93 `async with factory() as session` 块内）：在 gate reconcile（:87-93）之后，新建 `LeaseReaperService` 并 `await svc.start()`；`start()` 内部跑 `reconcile_all()` 做启动兜底（design §9：GC 无状态，重启重注册 + 全量 reconcile）。shutdown 段（:95-98 finally）：`await svc.shutdown()`，与 `dispose_engine()`/`close_redis()` 同段。用模块级变量或 app.state 持有 svc 引用供 shutdown 取回。异常 try/except 不阻断启动，对齐 :79/:92 现有 log.exception 模式。

### config.py GC 配置块（design §7.3）

在 Settings 类末尾（model_config 之前）新增：

```python
gc_lease_enabled: bool = True
gc_lease_interval_sec: int = 60
gc_worktree_enabled: bool = True
gc_worktree_interval_sec: int = 300
gc_runtime_stale_enabled: bool = True
gc_runtime_stale_interval_sec: int = 30
lease_heartbeat_ttl_sec: int = 300
lease_claim_window_sec: int = 300
lease_max_attempts: int = 3
runtime_stale_seconds: int = 45  # 已有则不重复加
```

## 边界处理（必填，≥5 条）

1. **AsyncIOScheduler + MemoryJobStore**：`AsyncIOScheduler(jobstores={'default': MemoryJobStore()})`，不持久化 job（design §9：GC 无状态，重启重注册 + reconcile 兜底，避免 jobstore 表 migration）。
2. **重启先跑全量 reconcile**：`start()` 内 `scheduler.start()` 后 `await reconcile_all()`，兜底断电/重启期间过期的 active lease/worktree（design §5 Wave1 + §10 R-5）。
3. **misfire 策略**：job 注册带 `max_instances=1` + `coalesce=True`（design §10 R-3：防止 GC 慢扫表时多实例并发阻塞事件循环 + 堆积合并）。
4. **reconcile_all 只扫 active 子集**：status∈{claimed,pending} 的 lease + locked 的 worktree，不扫终态历史行（design §7.1 + §10 R-5：避免启动拖慢）。
5. **骨架方法留 TODO 占位**：`_run_lease_gc`/`_run_worktree_gc` 方法签名齐全但回调体 `# TODO task-03/04`，不调真实 GC（本任务不依赖 task-01 外键），保证 task-03/04 能直接填实现而不改签名。
6. **env 开关守卫 job 注册**：`gc_lease_enabled=False` 时不注册 lease GC job（design §9：排查时可单独关停某类 GC）。本任务骨架期可只注册占位 job 或条件跳过，task-03/04 填实现时校准。
7. **异常不阻断启动**：lifespan 接入包 try/except + log.exception，对齐 :79/:92 现有模式；scheduler 起不来不能让 backend crash-loop。
8. **spike-02 前置**：先验证 APScheduler 集成跑通，不通过则退回方案 A（自建 asyncio 循环，LeaseReaperService 接口不变，仅内部换实现，task-03~08 不受影响）。

## 非目标（本任务不做的事）

- 不实现 lease GC 回调体（调 handle_expired_leases_batch，归 task-03）。
- 不实现 worktree GC 判据改造（归 task-01 外键 + task-04 判据）。
- 不改 lease_heartbeat/claim/start_lease 读 config（归 task-06）。
- 不删 DaemonLeaseService 死代码（归 task-05）。
- 不加 retry 端点 / 不加 runtime_online 可见性（归 task-07/08）。
- 不为 MemoryJobStore 加 DB 表 / migration。

## 参考

- design.md §5 Wave1（APScheduler 骨架）/ §7.1 LeaseReaperService 接口 / §7.3 GC 配置项 / §9 兼容策略 MemoryJobStore / §10 R-2/R-3/R-5
- plan.md task-02 行 + spike-02（不通过后果=退回方案 A，接口不变）
- 现状：main.py lifespan startup（:54-94 cleanup_stale_runs:76 / reconcile_pending_gate_decisions:87）/ shutdown finally（:95-98）；config.py Settings 结构（:186 model_config）；pyproject.toml dependencies（:7-25）

## 验收标准

| 编号 | 验收项 | 判定方式 | 期望结果 |
|---|---|---|---|
| AC-1 | apscheduler 依赖加入 | `grep apscheduler backend/pyproject.toml` | `apscheduler>=3.10` 在 dependencies |
| AC-2 | LeaseReaperService 类存在 | 查看 reaper/service.py | 含 start/shutdown/reconcile_all/_run_lease_gc/_run_worktree_gc 五方法 |
| AC-3 | config GC 字段齐全 | 查看 config.py | §7.3 所列 9 项字段全在，默认值正确 |
| AC-4 | lifespan 集成 | 查看 main.py | startup 调 start()、shutdown 调 shutdown()，异常 try/except 不阻断启动 |
| AC-5 | spike-02 通过 | 本地起 backend | AsyncIOScheduler start/shutdown 无异常，重启 reconcile_all 被调用 |
| AC-6 | 零回归 | `cd backend && pytest` | 全量通过（骨架不接真实 GC，现有行为不变） |

## 验证方式（verify）

- spike-02：本地 `uvicorn app.main:app` 起/停一次，日志确认 scheduler.start + reconcile_all + scheduler.shutdown 三事件，无异常栈。
- `cd backend && pytest app/modules/daemon/reaper/` 守护测试（本任务可只加 start/shutdown 调度冒烟测试，job 回调守护测试归 task-03/04）。
- `cd backend && ruff check app/modules/daemon/reaper/ app/main.py app/core/config.py` + `mypy` 绿。
- `cd backend && pytest`（全量零回归）。

## 约束（constraints）

- AsyncIOScheduler + MemoryJobStore（不持久化，design §9）。
- 重启先跑全量 reconcile 兜底（design §5 Wave1）。
- misfire `max_instances=1` + `coalesce=True`（design §10 R-3）。
- 骨架方法留 TODO 占位，签名不变供 task-03/04 填实现。
- spike-02 验证 lifespan 集成，不通过则退回方案 A（接口不变）。
