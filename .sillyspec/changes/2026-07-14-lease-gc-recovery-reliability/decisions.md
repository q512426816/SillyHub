# 决策台账（Decisions）— lease/GC/恢复机制可靠性提升

<!-- author: qinyi -->
<!-- created_at: 2026-07-14 10:10:08 -->

本文件记录本次变更有实现/验收影响的决策。每条带稳定版本 ID（D-xxx@vN）。后续 Design Grill 若修正，新版本 D-xxx@v(N+1) 并写明 supersedes。

---

## D-001@v1 — cancel 真停不纳入本变更（已具备）

- **type**: scope-exclusion
- **status**: accepted
- **source**: grill（代码查证，explore agent 2026-07-14）
- **question**: cancel 真停 daemon 进程（修 _ws_cancel_stub 僵尸）要不要在本变更做？
- **answer**: 不做。ql-20260712-001 已全链路打通。
- **normalized_requirement**: 本变更不触碰 cancel 链路（`_ws_cancel_stub` / SESSION_INTERRUPT / session-manager.interrupt / driver q.interrupt）。范围从原 10 项减为 9 项。
- **impacts**: 范围裁剪；design §3 非目标、§7.5 cancel 行标"不变"。
- **evidence**: backend `cancel_lease`（lease_service.py:281）interactive 分支调 `_send_interactive_cancel`（:461）发 SESSION_INTERRUPT WS；daemon daemon.ts:2469 `case SESSION_INTERRUPT → sessionManager.interrupt(sessionId)`；session-manager.ts:1594 `interrupt()` → driver.interrupt → claude-sdk-driver.ts:379 `q.interrupt()`（SDK 原生 turn 级中断）。全链路活。
- **priority**: P0

---

## D-002@v1 — lease service 死代码清理（不合并类）

- **type**: refactor
- **status**: accepted
- **source**: grill（代码查证）
- **question**: 两套 lease service（lease/service.py::LeaseService 与 lease_service.py::DaemonLeaseService）怎么统一？
- **answer**: 不合并类（分工明确）。清理 `DaemonLeaseService` 上的死代码，保留 cancel 能力。
- **normalized_requirement**: ① 删 `DaemonLeaseService.expire_overdue_leases`（lease_service.py:239，docstring 谎报"每分钟执行"）；② 删 DaemonLeaseService 上残留的正向 claim/heartbeat 方法（零生产引用，仅 test）；③ 保留 `cancel_lease`（:281）+ `_send_interactive_cancel`（:461）；④ `LeaseService`（lease/service.py）为正向生命周期 + expiry 回滚主路径，不变。
- **impacts**: lease_service.py（删死方法）+ test_lease_service.py（删对应测试）；design §6 文件清单、Wave 1。
- **evidence**: lease/__init__.py:1-7 分工注释；DaemonService facade（daemon/service.py:89）`self._lease = LeaseService(session)` 委托正向方法；DaemonLeaseService 生产实例化点仅 control.py:96/102 + agent/service.py:585/587（均 cancel/kill 路径）；`expire_overdue_leases` grep 全仓库零生产引用（仅 test_lease_service.py 调用）。**⚠️ 注意保留** lease/service.py:706 `expire_leases`（活代码，被 `handle_expired_leases_batch`:861 调用，是 lease GC 入口，勿误删；Grill P1-2 澄清 D-002 只删 lease_service.py:239 那个，不碰 lease/service.py:706）。
- **priority**: P1

---

## D-003@v1 — worktree GC 加 agent_run_id 外键（⚠️ superseded by D-003@v2，Grill P0-1/P0-2 修正）

- **type**: data-model
- **status**: accepted
- **source**: grill（AskUserQuestion 用户拍板，选"加外键关联 agent_run"）
- **question**: worktree lease 与 agent 任务零关联、GC 靠固定 TTL 会误杀长任务，判据怎么改？
- **answer**: WorktreeLease 加 `agent_run_id` 外键，GC 改判"关联 agent_run 存活→保留 / 终态→回收"。
- **normalized_requirement**: ① WorktreeLease 加 `agent_run_id: Optional[uuid]`（FK agent_runs.id, nullable=True, indexed）；migration 20260714_worktree_agent_run_fk；② `gc_expired_leases` 判据改为：`agent_run_id IS NOT NULL AND 关联 run 未终态 → 保留`（即使 expires_at 过期）；`关联 run 终态 AND expires_at<now → 回收`；`agent_run_id IS NULL（孤儿）→ 原 expires_at 判据`；③ `acquire`（worktree/service.py:45）接收 agent_run_id 参数；④ `_try_acquire_lease`（agent/service.py:1239）传 worker AgentRun id。
- **impacts**: worktree/model.py + worktree/service.py + agent/service.py + migration；design §6、§8.1、§7.5 worktree GC 行、Wave 1。
- **evidence**: WorktreeLease 当前字段（model.py:17-95）无 agent_run/daemon_lease/runtime/daemon 外键，run_id 是随机 uuid（service.py:64/91）；acquire 生产调用方 _try_acquire_lease（agent/service.py:1239）+ HTTP worktree/router.py:43（Grill P2-3 修正"唯一"为两个）；ttl 硬编码 3600；无任何代码自动调 extend（仅 HTTP 手动）。
- **priority**: P0

---

## D-003@v2 — worktree GC 外键 + acquire 回填 + 终态集（supersedes v1）

- **type**: data-model
- **status**: accepted（v1 superseded）
- **source**: design-grill（2026-07-14，P0-1/P0-2 修正）
- **supersedes**: D-003@v1
- **question**: v1 假设"acquire 时传 worker AgentRun id"，但代码上 acquire 时 run 尚未创建；且终态集未定义导致 cancelled worktree 泄漏。怎么落地？
- **answer**: ①外键同 v1；②acquire **后回填**（非前置传参）；③终态集明确含 cancelled；④acquire 参数可选（兼容 HTTP 路径）。
- **normalized_requirement**: ① WorktreeLease 加 agent_run_id（FK agent_runs.id, nullable, indexed）同 v1；② **回填方案**：`_try_acquire_lease`（agent/service.py:1031）acquire 时 run 不存在（AgentRun 在 :1120 建），顺序=acquire lease(agent_run_id 暂空) → 建 AgentRun → commit 前同事务回填 `lease.agent_run_id = run.id`；③ **终态集** = `{completed, failed, killed, cancelled}`（lease/service.py:768 completed/failed/killed + cancel_lease 产 cancelled lease_service.py:339），GC 判"关联 run 非终态→保留 / 终态 AND expires_at<now→回收"；④ `acquire` agent_run_id 参数**可选**（HTTP 手动 acquire worktree/router.py:43 不传，走孤儿 expires_at 判据）。
- **impacts**: worktree/model.py + worktree/service.py + agent/service.py（回填逻辑）+ migration；design §6/§7.5/§8.1。
- **evidence**: agent/service.py:1031 `_try_acquire_lease` 调用在 :1120 AgentRun 建表前（Grill 检出时序倒置）；lease/service.py:768 终态判断 `(completed,failed,killed)` 不含 cancelled；cancel_lease lease_service.py:339 设 status=cancelled；worktree/router.py:43 HTTP acquire 第二调用方。
- **priority**: P0

---

## D-004@v1 — 悬空 session 加可见性（不加自动兜底）

- **type**: feature-boundary
- **status**: accepted
- **source**: grill（代码查证 + 用户"不加自动兜底保持手动"决策推导）
- **question**: 用户不加"runtime offline 超时→session failed"自动兜底，但怎么让用户发现悬空 session？
- **answer**: 加 `runtime_online` 可见性（只读字段 + 前端徽标），不自动操作，用户手动 end/reopen。
- **normalized_requirement**: ① `AgentSessionRead`（schema.py）加 `runtime_online: bool`（运行时计算不入库）；② `list_agent_sessions`/`get_agent_session` join `daemon_runtimes` 算 `runtime_online = (now - last_heartbeat_at) < runtime_stale_seconds`；③ 前端 session-list-layout.tsx 加"daemon 离线"徽标（runtime_online=false）；④ **不**加自动 end/failed/abandoned，**不**加 session age timeout。
- **impacts**: daemon/schema.py + daemon/session/service.py（或 router.py）+ frontend session-list-layout.tsx；design §6、§8.2、Wave 3。
- **evidence**: AgentSessionRead（schema.py:18-39）字段无 runtime_online/daemon_status/last_heartbeat_at；list_sessions（router.py:1634）不 join runtime；SessionListEntry（session-list-layout.tsx:19-29）不带 daemon 状态；runtime 判活 cleanup_stale_runtimes（45s）存在但未透传到 session 响应。
- **priority**: P1

---

## D-005@v1 — batch 重跑不保进度，靠 sillyspec 工具幂等

- **type**: contract
- **status**: accepted
- **source**: exploration（AskUserQuestion 用户选"不保进度靠工具幂等"）
- **question**: batch 任务 daemon 断开重跑时，要不要保留执行进度（已完成子任务/已写产物）？
- **answer**: 不保。backend 不改产物落盘逻辑，靠 sillyspec 自身 progress 续跑（同机）+ task 幂等（换机）。
- **normalized_requirement**: ① backend 不改 `complete_lease` 产物落盘逻辑，不加 task/wave 进度字段；② design 明确契约"重跑=从头"；③ 标注换机重跑风险 R-1（task 不幂等则重复执行）；④ 预留未来保进度扩展点（design §9 兼容策略提及，不实现）。
- **impacts**: design §3 非目标、§10 R-1；**不改 backend 产物代码**（纯契约文档化）。
- **evidence**: patch 只在 complete_lease（lease/service.py:481）落盘，GC 路径（handle_lease_expiry:728）不碰产物；execute 子任务进度只在 daemon 侧 sillyspec.db；checkpoint/resume_token（coordinator.py:219）对 stage 路径无效（generate_resume_token 全库仅 service.py:459 task 级调用）；sillyspec execute 支持 step 级续跑（progress.js 记 done step）。
- **priority**: P1

---

## D-006@v1 — 采用 APScheduler 实现巡检调度

- **type**: implementation
- **status**: accepted
- **source**: option（AskUserQuestion 用户选方案 C）
- **question**: lease/worktree/runtime GC 的周期调度用什么实现？
- **answer**: APScheduler AsyncIOScheduler（非自建 asyncio 循环，非各模块独立定时器）。
- **normalized_requirement**: ① 新建 `LeaseReaperService`（reaper/service.py）封装 AsyncIOScheduler；② FastAPI lifespan startup 创建 scheduler + 注册各 GC job + start()，shutdown scheduler.shutdown()，重启先跑一次全量 reconcile；③ 各 GC 注册独立 job（lease 60s / worktree 300s / runtime stale 30s），env 可单独开关 + 周期可配；④ misfire `max_instances=1`（同 job 不并发）+ `coalesce=True`（堆积合并）；⑤ jobstore 用 MemoryJobStore（不持久化，重启重注册+reconcile 兜底）；⑥ pyproject.toml 加 `apscheduler>=3.10`。
- **impacts**: reaper/（新模块）+ main.py（lifespan）+ config.py（GC settings）+ pyproject.toml；design §5、§7.1、§7.3、Wave 1。
- **evidence**: 项目现有后台范式 _fire_background_task（agent/service.py:358 强引用防 GC）+ reconcile_pending_gate_decisions（main.py:87 启动兜底）；APScheduler AsyncIOScheduler 原生适配 asyncio FastAPI；用户选定换取精细调度/misfire 策略/成熟管控。
- **priority**: P0
