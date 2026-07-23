---
author: qinyi
created_at: 2026-07-14 10:10:08
scale: large
---

# 设计文档（Design）— lease/GC/恢复机制可靠性提升

## 1. 背景

SillyHub 是面向千人规模的多智能体协作平台，daemon（本地守护进程）负责在宿主机执行 Claude Code agent。backend 通过 **lease 租约机制**（batch lease 靠心跳续期、interactive lease 永不过期）管理任务的生命周期。

三轮代码调研（2026-07-14，3 个 explore agent 固化）发现：daemon 长时间断开后，任务基本等于丢失，可靠性不足以支撑产品化。核心病灶：

1. **lease GC 定时器生产无调用方**：`handle_expired_leases_batch`（lease/service.py:854）写好+测好但全库无 cron/apscheduler/asyncio 循环/lifespan hook 调用，`expire_overdue_leases`（lease_service.py:240）docstring 谎报"每分钟执行"。daemon 断开后 lease 不回收，AgentRun 永久卡 running，直到 `cleanup_stale_runs`（main.py:76，启动时无时间窗一刀切 failed）或 `reconcile_stale_runs`（dispatch.py:587，2h 窗标 killed）。
2. **worktree GC 判据错误**：`WorktreeLease` 与 agent 任务零关联（只有随机 run_id），GC 纯靠 `expires_at < now`（固定 1h TTL），无心跳无自动续期。挂定时器会误删长任务目录。
3. **batch 重跑不保留进度**：patch 只在 `complete_lease`（lease/service.py:481）落盘，GC 路径不碰产物；execute 子任务进度只在 daemon 侧 sillyspec.db。
4. **attempt 上限硬编码 3 + failed 无重试入口**：前端 grep retry/resume 零命中。
5. **悬空 session 不可见**：daemon 彻底失联时 interactive lease（NULL expires）不被 GC、runtime offline 不级联 session、无 abandoned 兜底、`AgentSessionRead` 无 runtime_online 字段——用户看不到哪个 session 悬空了。
6. **心跳窗口 60s 偏紧**：单次网络抖动 >60s 即过期重派，连续 3 次 = 误判 failed。
7. **DaemonLeaseService 残留死代码**：`expire_overdue_leases` + 正向 claim/heartbeat 方法零生产引用（仅 test）。

## 2. 设计目标

- **接通 lease/worktree GC 的周期调度**，让失联任务的 lease 被正确回收（而非卡死被一刀切）。
- **worktree GC 判据改造**为"关联 agent_run 存活才保留"，彻底消除长任务误删。
- **抬升断开韧性**：放宽心跳窗口、attempt 可配、failed 后可重试。
- **悬空 session 可见**：用户能看到持有 session 的 daemon 是否离线，支撑手动清理。
- **全程不违背"不误杀长任务"哲学**（interactive-idle-timeout-fix D-003 + knowledge）：GC 只回收"持有者失联（心跳断）"的 lease，绝不开"任务跑了多久"的自动超时。
- **清理死代码**，统一 lease service 表面。

## 3. 非目标

- **不加任何"绝对时长上限"自动超时**（历史决策红线，会误杀推理模型长任务/长 turn）。
- **不加 interactive 悬空 session 自动转 failed 兜底**（用户明确决策：保持手动 end/delete，遵循严格"不自动超时"哲学）。
- **cancel 真停 daemon 进程**：已由 ql-20260712-001 全链路打通（backend SESSION_INTERRUPT + daemon `q.interrupt()`），本变更不重复。
- **batch 重跑保留进度**：用户决策"不保，靠 sillyspec 工具幂等"，backend 不改产物落盘逻辑。
- **水平扩展/多实例**：本变更只解决单实例下的 GC/恢复，daemon WS 路由表外置等留待未来。
- **前端 HTML 原型**：前端仅 2 个小增量（retry 按钮 + 离线徽标），参照现有组件，不走原型。

## 4. 拆分判断

范围评估为 **large**（backend 主 + daemon 次 + 少量 frontend，约 9 项工作，涉及并发原语+生命周期+跨进程）。

满足拆分条件 1 条（3+ 可独立交付模块组），但**所有子项共享 lease/恢复机制核心**（同碰 lease/service.py、worktree/model.py、session/schema.py），拆 MASTER 会重复触碰同批文件增合并成本。故**单变更分 Wave**，不走批量模式（独立功能非模板×数据）。

## 5. 总体方案

采用 **APScheduler AsyncIOScheduler** 作为统一巡检骨架（D-006@v1，用户选定），集成进 FastAPI lifespan。各 GC 类型注册成独立 job，env 可单独开关/配周期，便于排查（用户核心担忧=误杀，能临时关停某类 GC）。

### Wave 1 — P0 稳定性基本盘
- APScheduler 骨架：新建 `LeaseReaperService`，lifespan startup 创建 scheduler + 注册 job + start，shutdown 关闭，重启先跑一次全量 reconcile。
- lease GC 接线：job 调 `LeaseService.handle_expired_leases_batch`，**只扫 batch lease**（interactive lease 的 `lease_expires_at=NULL` 保持豁免，`NULL < now` 永为 false）。
- worktree GC 判据改造：`WorktreeLease` 加 `agent_run_id` 外键，GC 改判"关联 agent_run 活着→保留 / 终态→回收"。
- DaemonLeaseService 死代码清理（D-002）。

### Wave 2 — P1 韧性调优
- 心跳窗口放宽：`lease_heartbeat` 续期 60s → 可配（默认 300s），claim 窗口同步。
- attempt 上限硬编码 3 → config 可配（默认 3）。

### Wave 3 — P2 可用性
- failed 重试入口：后端 `POST /agent/runs/{id}/retry`（建新 AgentRun 从头跑）+ 前端按钮。
- 悬空 session 可见性：`AgentSessionRead` 加 `runtime_online`，list/get 端点 join runtime 表，前端"daemon 离线"徽标。

### Wave 4 — 守护测试（穿插各 Wave，TDD）
心跳续期→长任务不过期 / interactive NULL 不被扫 / worktree 关联任务活着不误删 / GC env 开关 / retry 建新 run。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/daemon/reaper/__init__.py | LeaseReaperService 包 |
| 新增 | backend/app/modules/daemon/reaper/service.py | APScheduler 骨架 + job 注册 + 全量 reconcile |
| 新增 | backend/app/modules/daemon/reaper/tests/test_reaper.py | GC 调度/开关/判据守护测试 |
| 新增 | backend/migrations/versions/20260714_worktree_agent_run_fk.py | WorktreeLease 加 agent_run_id 外键 |
| 修改 | backend/app/main.py | lifespan 集成 LeaseReaperService（startup start / shutdown shutdown / 启动全量 reconcile） |
| 修改 | backend/app/core/config.py | 加 GC settings（周期/开关/心跳窗口/attempt 上限） |
| 修改 | backend/app/modules/daemon/lease/service.py | `lease_heartbeat`(:266)/`claim_lease`(:187)/**`start_lease`(:224)** 三处 60s 窗口读 config（Grill P1-1：原 design 漏 start_lease 第三处硬编码）；`handle_lease_expiry`(:779) attempt 上限读 config |
| 修改 | backend/app/modules/daemon/lease_service.py | 删 `expire_overdue_leases` + 残留正向 claim/heartbeat 方法（保留 cancel_lease/_send_interactive_cancel） |
| 修改 | backend/app/modules/worktree/model.py | `WorktreeLease` 加 `agent_run_id`（FK agent_runs.id, nullable, indexed） |
| 修改 | backend/app/modules/worktree/service.py | `gc_expired_leases`(:209) 判据改造（关联 agent_run 非终态→保留）；`acquire`(:45) 接收 **可选** agent_run_id 参数（HTTP 手动 acquire worktree/router.py:43 不传，留 NULL 走孤儿判据，Grill P2-3） |
| 修改 | backend/app/modules/worktree/tests/test_service.py | worktree GC 判据守护测试 |
| 修改 | backend/app/modules/agent/service.py | `_try_acquire_lease`(:1031/:1239) **acquire 后回填** lease.agent_run_id=run.id（Grill P0-1：acquire 在 :1031、AgentRun 建表在 :1120，无法前置传 id，改为建 run 后同事务回填，详见 §8.1） |
| 修改 | backend/app/modules/agent/router.py | 加 `POST /workspaces/{ws}/agent/runs/{run_id}/retry` 端点 |
| 修改 | backend/app/modules/agent/service.py | 加 `retry_run` 方法（建新 AgentRun，继承 change/stage，不继承 attempt/产物） |
| 修改 | backend/app/modules/daemon/schema.py | `AgentSessionRead` 加 `runtime_online: bool` 字段 |
| 修改 | backend/app/modules/daemon/session/service.py | `list_agent_sessions`/`get_agent_session` join daemon_runtimes 算 runtime_online |
| 修改 | backend/pyproject.toml | 加 `apscheduler>=3.10` 依赖 |
| 修改 | frontend/src/components/daemon/session-list-layout.tsx | daemon 离线徽标（runtime_online=false 时显示） |
| 修改 | frontend/src/（agent run 详情组件） | failed run 加"重试"按钮调 retry 端点 |

## 7. 接口定义

### 7.1 LeaseReaperService（新增）
```python
class LeaseReaperService:
    def __init__(self, scheduler: AsyncIOScheduler, lease_service, worktree_service, runtime_service, settings): ...
    async def start(self) -> None:  # lifespan startup：注册 job + scheduler.start() + 全量 reconcile
    async def shutdown(self) -> None:  # lifespan shutdown
    async def reconcile_all(self) -> None:  # 启动兜底：全量扫 active 子集（status∈claimed/pending 的 lease + locked 的 worktree），不扫终态历史行（Grill P1-4 统一定义，与 §10 R-5 一致）
    # job 回调（各自 env 开关守卫）
    async def _run_lease_gc(self) -> None:     # 调 LeaseService.handle_expired_leases_batch
    async def _run_worktree_gc(self) -> None:  # 调改造后 WorktreeService.gc_expired_leases
    async def _run_runtime_stale(self) -> None  # 调 cleanup_stale_runtimes；与 list 端点懒触发(runtime/service.py:874)重复但幂等(标 offline 无副作用)，reaper 为主路径、懒触发保留作端点即时收敛（Grill P1-3）
```

### 7.2 retry 端点（新增）
```
POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/retry
  → 201 {new_run_id, ...}
```
语义：仅接受 `status in (failed, killed)` 的 run；建新 AgentRun（同 change_id/stage/workspace_id，新 attempt=1，不继承产物/日志），触发 dispatch。

### 7.3 GC 配置项（config.py 新增 Settings 字段）
```python
gc_lease_enabled: bool = True
gc_lease_interval_sec: int = 60
gc_worktree_enabled: bool = True
gc_worktree_interval_sec: int = 300
gc_runtime_stale_enabled: bool = True
gc_runtime_stale_interval_sec: int = 30
lease_heartbeat_ttl_sec: int = 300   # 原 60s 硬编码
lease_claim_window_sec: int = 300
lease_max_attempts: int = 3          # 原硬编码 3
runtime_stale_seconds: int = 45      # 已有，保留
```

## 7.5 生命周期契约表

本变更触及 lease / agent_run / session / daemon / heartbeat 关键词，契约事件如下（现有事件标注改动，新增事件标注 NEW）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| heartbeat（续期窗口放宽） | daemon | backend | leaseId, claimToken | lease_expires_at = now + lease_heartbeat_ttl_sec（原 60s→可配 300s） |
| lease GC 扫描（NEW 接线） | LeaseReaperService | backend | —（扫 status∈{claimed,pending} AND lease_expires_at<now AND 非NULL） | 过期 batch lease → expired；attempt<max → 重建 pending lease 重派；attempt≥max → AgentRun failed |
| interactive lease（不变） | backend | daemon | leaseId, kind=interactive, lease_expires_at=NULL | 永不过期，GC 扫不到（NULL<now=false 豁免） |
| worktree GC（改判据） | LeaseReaperService | backend | worktree lease.agent_run_id | 关联 agent_run 非终态(pending/running)→保留；关联终态(completed/failed/killed/**cancelled**) AND expires_at<now→expired+cleanup；孤儿(agent_run_id NULL)→原 expires_at 判据（Grill P0-2：cancelled 纳入终态，否则 cancel 任务 worktree 永久泄漏） |
| retry run（NEW） | 用户(前端) | backend | run_id（须 failed/killed） | 建新 AgentRun（attempt=1，同 change/stage），触发 dispatch；旧 run 的 lease/cancelled 残留行无影响（GC 按 agent_run_id 关联，旧 lease 不绑新 run，Grill P2-2） |
| session 可见性查询（NEW） | 前端 | backend | session_id | 返回 AgentSessionRead 含 runtime_online（join runtime.last_heartbeat_at < stale_seconds） |
| cancel（不变，ql-20260712-001 已修） | 用户 | backend→daemon | leaseId, sessionId | lease→cancelled, run→killed, daemon q.interrupt() 真停 |

**自审验证**：每个事件均有对应代码任务（§6 文件清单）+ 接口定义（§7）+ 测试任务（Wave 4）。必需字段（leaseId/claimToken/agent_run_id/runtime_online）均出现在 DTO/service 签名中。

## 8. 数据模型

### 8.1 WorktreeLease 加 agent_run_id（migration 20260714_worktree_agent_run_fk）
```python
class WorktreeLease(...):
    ...
    agent_run_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="agent_runs.id", nullable=True, index=True
    )
```
- nullable=True：兼容孤儿 worktree（历史数据 + HTTP 手动 acquire worktree/router.py:43 不传 agent_run_id）。
- indexed：GC 查询 `WHERE agent_run_id IS NOT NULL` 要快。
- **回填方案（Grill P0-1）**：`_try_acquire_lease`（agent/service.py:1031）调 acquire 时 AgentRun 尚未创建（run 在 :1120 才建），无法前置传 run.id。顺序定为：① acquire worktree lease（agent_run_id 暂空）；② 建 AgentRun（:1120）；③ commit 前同事务回填 `lease.agent_run_id = run.id`。run.lease_id 与 lease.agent_run_id 双向回填，避免鸡生蛋。
- **终态集定义（Grill P0-2）**：worktree GC 判"关联 agent_run 是否终态"，终态集 = `{completed, failed, killed, cancelled}`（lease/service.py:768 的 completed/failed/killed + cancel_lease 实际产出 cancelled lease_service.py:339）。非终态（pending/running）= 活着→保留。**cancelled 必须纳入终态**，否则 cancel 的任务 worktree 永久泄漏。
- down_revision：执行前 `alembic heads` 核实（Grill 检出当前多 head，必须先 merge 收敛再 down，见 R-6 + [migration-chain-fragmentation-pattern]）。
- 项目未上线，down 直接 drop 列（不需数据回填）。

### 8.2 AgentSessionRead schema 加 runtime_online（非表字段）
```python
class AgentSessionRead(BaseModel):
    ...
    runtime_online: bool  # 运行时 join 计算，不入库
```
计算逻辑：`session.runtime_id` join `daemon_runtimes.last_heartbeat_at`，`runtime_online = (now - last_heartbeat_at) < runtime_stale_seconds`。

### 8.3 无其他表结构变更
DaemonTaskLease（attempt/lease_expires_at/kind 已有）、AgentRun（status 已有）、daemon_runtimes（last_heartbeat_at/status 已有）均复用现有字段，不改表。

## 9. 兼容策略

- **未配置新功能时行为不变**：所有 GC settings 默认值与现状等价（lease_heartbeat_ttl 默认虽提到 300s，但这是放宽=更宽容抖动，不破坏现有任务；若需严格回退设 60）。
- **env 开关默认全开**：GC 接线后默认启用（解决"卡死"核心病灶）；排查时设 `GC_LEASE_ENABLED=false` 等单独关停。
- **worktree agent_run_id nullable**：历史 worktree lease（agent_run_id NULL）按原 expires_at 判据回收，零回归。
- **Migration 可逆**：down drop 列，项目未上线无数据兼容负担（CLAUDE.md 规则 11）。
- **retry 端点幂等**：重复调用建多个新 run（不做幂等去重，用户主动行为）。
- **APScheduler 用 MemoryJobStore**：不持久化 job（GC 无状态，重启重注册 + 全量 reconcile 兜底），避免 jobstore 表 migration。
- **不改的 API/表**：interactive lease NULL 语义、cancel 链路、SSE pub/sub、claim_token 机制均不动。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-1 | batch 换机重跑时 sillyspec task 不幂等 → 重复执行已完成的子任务 | P1 | design 明确契约"重跑=从头靠工具幂等"；execute Wave 核实关键 stage（scan/execute）幂等性；不幂等的 task 标注并文档化用户须知 |
| R-2 | APScheduler 引入新依赖，与现有 asyncio 后台范式（_fire_background_task）并存，团队需理解两套 | P2 | LeaseReaperService 内部封装 scheduler，对外只暴露 start/shutdown；文档说明为何选 APScheduler（精细调度+misfire） |
| R-3 | GC job 单次执行慢（大库扫表）阻塞事件循环 | P2 | APScheduler misfire 策略 max_instances=1 + coalesce=True；job 内分批查询（limit + 游标） |
| R-4 | worktree agent_run_id 关联不准（_try_acquire_lease 传错 id）导致 GC 误判 | P1 | 守护测试钉死"关联任务活着→不回收"；acquire 传 id 的单元测试 |
| R-5 | 全量 reconcile 启动时扫表慢，拖慢启动 | P2 | reconcile 仅扫 active 子集（claimed/pending lease + locked worktree），不扫终态历史行（Grill P1-4 统一） |
| R-6 | Migration down_revision 接错 head → crash-loop（[migration-chain-fragmentation-pattern]） | P1 | execute 前先 `alembic heads` 确认唯一 head；down 接真实当前 head |
| R-7 | lease_heartbeat_ttl 放宽到 300s 后，真失联的 daemon 回收延迟增加（最多 300s+GC 周期） | P2 | 可接受（失联回收延迟换抖动容忍）；attempt 重试仍兜底 |

## 11. 决策追踪

当前版本决策见 `decisions.md`（D-001@v1 ~ D-006@v1）。覆盖关系：

| 决策 | 覆盖章节 / FR | 状态 |
|---|---|---|
| D-001@v1 cancel 真停已具备不做 | §3 非目标、§7.5 cancel 行 | 已解决（ql-20260712-001） |
| D-002@v1 lease service 死代码清理 | §6（lease_service.py）、Wave 1 | 待实现 |
| D-003@v2 worktree 加 agent_run_id 外键 + acquire 回填 + 终态集（supersedes v1，Grill P0-1/P0-2 修正） | §6、§8.1、§7.5 worktree GC 行、Wave 1 | 待实现 |
| D-004@v1 悬空 session 可见性 | §6（schema/session service）、§8.2、Wave 3 | 待实现 |
| D-005@v1 batch 重跑靠工具幂等不保进度 | §3 非目标、§10 R-1 | 已明确契约，待文档化 |
| D-006@v1 APScheduler 实现方案 | §5、§7.1、Wave 1 | 待实现 |

**无未解决决策**。剩余风险见 §10。

## 12. 自审

- **需求覆盖**：9 项工作（lease GC 接线 / worktree 外键判据 / 死代码清理 / 心跳放宽 / attempt 可配 / retry 入口 / 可见性 / 守护测试 / batch 幂等契约）全部在 §5 Wave + §6 文件清单 + §7 接口中体现。✅
- **Grill 覆盖**：D-001~D-006 全部在 §11 引用并标注覆盖章节/状态。✅
- **约束一致性**：与 CONVENTIONS.md（TDD / ruff / 文档驱动 / 可重置数据）一致；与 ARCHITECTURE.md（FastAPI lifespan / 领域模块分层）一致；新模块 reaper/ 遵循 vertical slice（service.py + tests/）。✅
- **真实性**：表名（worktree_leases/agent_runs/daemon_runtimes）、字段（lease_expires_at/attempt_number/last_heartbeat_at）、方法（handle_expired_leases_batch/gc_expired_leases/_try_acquire_lease/cancel_lease）均来自真实代码行号（§1 已注）。新增项（LeaseReaperService/agent_run_id/runtime_online/retry 端点）已标注"新增"。✅
- **YAGNI**：无非必要功能；APScheduler 经用户选定非 AI 自加；可见性是"手动清理"的必要配套非额外。✅
- **验收标准**：§7.5 契约表 + Wave 4 守护测试给出可测断言（心跳续期不过期 / NULL 不被扫 / 关联任务活着不回收 / env 开关 / retry 建新 run）。✅
- **非目标清晰**：§3 明确 6 项不做（自动超时 / 悬空兜底 / cancel 重做 / batch 保进度 / 水平扩展 / HTML 原型）。✅
- **兼容策略**：§9 给出回退路径（env 全开=默认 / worktree nullable 零回归 / migration 可逆 / MemoryJobStore）。✅
- **风险识别**：§10 列 R-1~R-7 含等级+应对。✅
- **生命周期契约表**：§7.5 完整，7 个事件覆盖 lease/agent_run/session/daemon/heartbeat，必需字段均在 DTO/interface，每个事件有代码+测试任务。✅

**自审结论：通过**，无 ⚠️ 自审存疑项。
