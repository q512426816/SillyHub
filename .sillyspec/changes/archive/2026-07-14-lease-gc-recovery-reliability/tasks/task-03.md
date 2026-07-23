---
id: task-03
title: "lease GC job 接线 + 守护测试"
title_zh: "lease GC 定时任务接线与守护测试"
author: qinyi
created_at: 2026-07-14 11:01:53
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/reaper/service.py
  - backend/app/modules/daemon/reaper/tests/test_reaper.py
expects_from:
  task-02:
    - contract: "LeaseReaperService（reaper/service.py，APScheduler AsyncIOScheduler 骨架）"
      needs:
        - "注册 job 的接口：start() 内 scheduler.add_job(job_func, trigger=IntervalTrigger, id=..., kwargs...)，本任务在其回调位注册 lease GC job"
        - "env 开关守卫约定：job 回调入口先读 settings.gc_lease_enabled，False 则直接 return（与 §7.3 config 字段对齐）"
        - "持有 lease_service 引用（经 DaemonService facade 拿 handle_expired_leases_batch，facade 委托见 service.py:592）"
acceptance:
  - "reaper/service.py 注册 lease GC job：interval 读 settings.gc_lease_interval_sec（默认 60s），回调调 DaemonService.handle_expired_leases_batch（facade 委托 lease/service.py:854，经 expire_leases:706 → handle_lease_expiry:728 链路）"
  - "守护测试1（心跳续期→长任务不过期）：batch lease claimed + 持续 lease_heartbeat 续期，模拟 30min 心跳序列，job 多次触发后 lease.status 仍 claimed、AgentRun.status 仍 running，绝不被标 expired"
  - "守护测试2（interactive NULL 永不被扫到）：kind=interactive 的 lease（lease_expires_at=NULL）即使 daemon 离线，job 触发后 status 不变——WHERE 子句 status∈{claimed,pending} AND lease_expires_at<now 中 NULL<now 永为 false 豁免（红线，对应 §7.5 interactive lease 行）"
  - "守护测试3（batch lease 过期被回收重派）：batch lease claimed + lease_expires_at 设为过去，job 触发后 lease→expired、attempt<max 时 AgentRun→pending + 新 pending lease（attempt+1）；attempt≥max 时 AgentRun→failed"
  - "env 开关守卫：settings.gc_lease_enabled=False 时 job 回调直接 return，不调 handle_expired_leases_batch"
verify:
  - "cd backend && uv run pytest app/modules/daemon/reaper/tests/ -v（新增守护测试全绿）"
  - "cd backend && uv run pytest app/modules/daemon/lease/ -v（不破坏现有 lease 测试）"
  - "cd backend && uv run ruff check app/modules/daemon/reaper/ && uv run mypy app/modules/daemon/reaper/"
goal: "接通 lease GC 定时调度，让持有者失联（心跳断）的 batch lease 被周期回收重派，而不误杀持续心跳的长任务或永不过期的 interactive lease（NULL 豁免）。"
implementation:
  - "在 reaper/service.py（task-02 骨架）的 job 注册段加 lease GC job：scheduler.add_job(self._run_lease_gc, IntervalTrigger(seconds=settings.gc_lease_interval_sec), id='lease_gc', max_instances=1, coalesce=True)（misfire 防护，对应 §10 R-3）"
  - "_run_lease_gc：if not settings.gc_lease_enabled: return；取 session_factory（task-02 约定 H1 独立 session，非复用 lifespan session），async with session_factory() as s: facade = DaemonService(s); await facade.handle_expired_leases_batch()（facade 委托 lease/service.py:854）"
  - "守护测试用 SQLite in-memory + fake AsyncIOScheduler（直接 await reaper._run_lease_gc() 跳过调度，断言行为）"
  - "心跳续期测试：循环模拟 now 推进 + lease_heartbeat 续 lease_expires_at，每轮触发 _run_lease_gc，断言 lease 未变 expired（续期窗口永远领先 now）"
  - "interactive NULL 测试：建 kind=interactive lease（lease_expires_at=None），触发 _run_lease_gc，断言 status 不变（expire_leases:706 的 WHERE lease_expires_at<now 排除 NULL）"
  - "batch 过期重派测试：建 batch claimed lease，手动设 lease_expires_at=now-1s，触发 _run_lease_gc，断言旧 lease→expired + 新 pending lease（attempt+1）/ attempt≥max→failed"
constraints:
  - "只扫 batch lease，绝不碰 interactive lease（lease_expires_at=NULL 豁免，§7.5 interactive lease 行红线，对应 design §3 非目标'不加 interactive 悬空自动兜底'）"
  - "GC 只回收'持有者失联（心跳断）'的 lease，绝不开'任务跑了多久'的自动超时（§2 哲学红线，会误杀推理模型长任务）"
  - "job 回调用独立 session_factory（不复用请求级 session），异常 per-lease 吞掉只 log（handle_expired_leases_batch:875 已 try/except，不阻塞批次）"
  - "不改 lease/service.py 的 expire_leases/handle_expired_leases_batch/handle_lease_expiry 活代码（本任务只接线调用方，死代码清理归 task-05）"
notes:
  - "依赖 task-02 的 LeaseReaperService 骨架 + config.py 的 gc_lease_enabled/gc_lease_interval_sec 字段（§7.3）"
  - "handle_expired_leases_batch 链路：expire_leases(:706, WHERE status∈{claimed,pending} AND lease_expires_at<now) → 逐 lease handle_lease_expiry(:728, attempt<3→重建 pending lease 重派 / attempt≥3→AgentRun failed)"
  - "facade 委托链路：DaemonService.handle_expired_leases_batch(service.py:592) → LeaseService.handle_expired_leases_batch(lease/service.py:854)"
---
