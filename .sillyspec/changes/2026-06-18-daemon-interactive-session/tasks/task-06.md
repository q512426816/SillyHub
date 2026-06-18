---
id: task-06
title: Wave1 端到端联调 + 空闲回收（30min + end_session 统一入口）
wave: W1
priority: P0
depends_on: [task-03, task-05, spike-01]
covers: [FR-06, D-004]
created_at: 2026-06-18 14:11:24
author: qinyi
---

# task-06 — Wave1 端到端联调 + 空闲回收（session_idle_timeout_sec 默认 30min + service.end_session 统一结束入口）

> 设计依据：`../design.md` §5 Wave1（sessionStore + 空闲回收）、§7.3 SessionStore API、§8.4 三元关系、§8.5 interactive lease 过期语义 + 统一结束入口、§10 R-04、§12 验收标准 1-4,8、D-004；`../plan.md` task-06 行 + 全局验收 AC-1/AC-2/AC-3/AC-6；`../decisions.md` D-004@v1（session 空闲 30min 自动结束）。
>
> 本任务只写蓝图，不写代码。execute 阶段按编号步骤实施。

## 1. 目标

1. **空闲回收（FR-06 / D-004）**：daemon 侧 SessionStore 每会话维护 `last_active_at`，新增空闲扫描循环按 `session_idle_timeout_sec`（默认 1800s = 30min）扫描 active session，超时自动触发结束，防止交互式 lease 长期占用 daemon 进程槽。
2. **统一结束入口（§8.5 / R-04）**：`service.end_session(session_id)` 作为唯一的会话终止真相源——手动 `POST /sessions/{id}/end`、空闲超时、daemon 退出通知 **三条路径全部汇聚到此**，原子地更新 `agent_sessions.status=ended` + 关联 `daemon_task_leases.status=completed`，规避 lease expiry 回收逻辑（`handle_lease_expiry` 走 `claimed/pending + expires_at`，interactive lease status 走 `active/completed`，天然不进该路径，但需显式确认）与 sessionStore 双重回收冲突。
3. **Wave1 端到端联调**：claude + codex 两条适配器链路各跑通完整链路——发起 → 首轮（result）→ 中途追问第二轮 → 打断本轮 → 结束会话，覆盖验收标准 1-4,8。
4. **批处理兼容验证（AC-6 / 验收 8）**：现有 workspace agent run（`kind=batch`）在 Wave1 全部改动落地后行为零变化。

## 2. 前置依赖（硬门）

| 依赖 | 状态 | 说明 |
|---|---|---|
| spike-01 | 必须 PASS | R-01 端到端铁证——claude/codex stream-json stdin 连续两轮 `result`。**spike-01 不通过则 task-06 无法开工**（核心多轮机制不成立，整套 session 模型回退为伪多轮）。 |
| task-03 | 必须完成 | daemon session 侧——`session-store.ts`（SessionStore 类，task-03 新建）、task-runner session 模式（result 不 end stdin）、ws-client 控制消息路由、daemon `_executeTask` 按 `lease.kind` 分流。本任务在 task-03 的 SessionStore 上加 `last_active_at` 字段 + idle scan。 |
| task-05 | 必须完成 | session 级 SSE 聚合——Redis channel `agent_session:{id}` + `stream_session_logs` + `submit_messages` 双 publish。本任务联调脚本依赖其跨 turn SSE 连续性。 |
| task-04 | 间接依赖 | backend `end_session` 落在 task-04 的 `service.py`（`DaemonService.end_session`），本任务负责把空闲超时路径接入并校验三条入口收敛。 |

> 当前快照（2026-06-18）：`sillyhub-daemon/src/session-store.ts` 尚不存在（task-03 待建）；`backend/app/modules/daemon/service.py` 无 `end_session`（task-04/本任务待建）；`backend/app/core/config.py` 无 `session_idle_timeout_sec`（本任务新增）。所有"涉及文件"改动在 task-03/04 完成后才可执行。

## 3. 涉及文件

| 操作 | 文件路径 | 当前状态 | 本任务改动 |
|---|---|---|---|
| 修改 | `sillyhub-daemon/src/session-store.ts` | task-03 新建 | SessionState 加 `last_active_at: Date` 字段；`create`/`inject`/活动事件触发时更新；新增 `scanIdle(timeoutSec, now): SessionState[]` 纯查询方法（不直接 end，返回候选供调用方决定） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 现有三循环（`daemon.ts:321-323`） | 启动时新增第四循环 `_idleScanLoop`（挂载点：line 323 后追加 `this._fire((signal) => this._idleScanLoop(signal));`）；循环体内每 `idle_scan_interval`（建议 60s，硬编码或加 config）扫描 sessionStore，对超时 session 调 `sessionStore.end` + 上报 backend `end_session` |
| 修改 | `backend/app/modules/daemon/service.py` | task-04 新增 `end_session`（基础版） | 校验/补全 `end_session(session_id, *, reason)` 三入口收敛（手动 / 空闲超时 / daemon 通知），原子更新 `agent_sessions.status=ended + ended_at=now` + `daemon_task_leases.status=completed + updated_at=now`；幂等（已 ended 直接返回）；发布 session 终态 Redis 事件 |
| 修改 | `backend/app/core/config.py` | 无相关字段 | `Settings` 加 `session_idle_timeout_sec: int = Field(1800, ge=60, le=86400)`（默认 30min，下限 1min 上限 24h，CONVENTIONS 配置集中约定） |
| 新增 | `sillyhub-daemon/test/session-store.idle.test.ts` | — | vitest 单测：mock 时间，验证 `scanIdle` 阈值边界（边界-1/边界/边界+1）、`last_active_at` 在 create/inject 更新 |
| 新增 | `sillyhub-daemon/test/daemon.idle-scan.test.ts` | — | vitest 单测：mock `_idleScanLoop` + SessionStore，验证超时触发 end + 上报 |
| 新增 | `backend/tests/modules/daemon/test_end_session.py` | — | pytest：三入口幂等、lease.status=completed、agent_sessions.status=ended、Redis 事件发布、batch lease 不受影响 |
| 新增 | `backend/tests/integration/test_session_e2e.py` | — | pytest 集成：claude + codex 全链路（mock adapter）发起→首轮→追问→打断→结束 + 空闲超时自动结束 |

## 4. 实现步骤

### Step 1 — SessionStore 加 `last_active_at` + `scanIdle`（session-store.ts）

1. `SessionState` 接口/类追加字段 `last_active_at: Date`（创建时 = now）。
2. `create(sessionId, ...)`：初始化 `last_active_at = new Date()`。
3. `inject(sessionId, prompt)`：写 stdin 成功后 `state.last_active_at = new Date()`（即"用户活动 = 注入新 prompt"算活跃；**注意**：agent 自身跑过程中的流式输出不算用户活动，避免长 turn 永不超时误判——D-004 语义是"用户最后一次交互后 30min 无新输入"）。
4. 新增纯查询方法 `scanIdle(timeoutSec: number, now: Date = new Date()): SessionState[]`：返回 `status==='active' && (now - last_active_at) >= timeoutSec*1000` 的候选；**不**在此方法内 end，保持单一职责，由 `_idleScanLoop` 决定后续动作。
5. 显式定义：`interrupt` **不**更新 `last_active_at`（打断本身是用户活动，但若用户连按打断不应反复续命——保守取 inject 算活跃，interrupt 不算。可在 review 阶段调整，需在 decisions 补 D-004 细化）。

### Step 2 — daemon 挂载空闲扫描循环（daemon.ts）

1. 在 `daemon.ts:323` 后追加：`this._fire((signal) => this._idleScanLoop(signal));`（与现有 heartbeat/poll/ws 三循环同模式，复用 `_fire` 的 AbortController + 错误吞掉 + `_loopPromises` 追踪）。
2. 新增 `private async _idleScanLoop(signal: AbortSignal): Promise<void>`：
   - 循环：`while (!signal.aborted)` + `await sleep(IDLE_SCAN_INTERVAL_MS, signal)`（建议 `IDLE_SCAN_INTERVAL_MS = 60_000`，常量顶部声明，注释说明可后续 config 化）。
   - 主体：`const idle = this._sessionStore.scanIdle(timeoutSec)`，`timeoutSec` 从 hub-client 拉取的 runtime config 或硬编码 1800（**优先复用 hub-client 同步下来的 `session_idle_timeout_sec`**，本任务可在 daemon `Config` 加只读字段，由 backend register_runtime/heartbeat 下发，见 Step 4）。
   - 对每个 idle session：try `this._sessionStore.end(id.id)` → 通过 `hub-client` / `submitMessages` REST 通道上报 backend `end_session(session_id, reason='idle_timeout')`；失败仅 `logger.warn` 不重试（避免雪崩；sessionStore 内存已清，后续 inject 会自然失败提示重开）。
3. 循环异常按现有 `_heartbeatLoop`/`_pollLoop` 模式：`catch (e) { this._logger.warn('idle_scan_loop_error', { error: e }); }` + 继续下一轮。

### Step 3 — backend `end_session` 统一结束入口（service.py）

1. 在 `DaemonService` 加 `async def end_session(self, session_id: UUID, *, reason: str = "manual") -> AgentSession`（task-04 已建基础版时，本步聚焦"三入口收敛 + 幂等 + lease 同步"）。
2. 加载 `AgentSession`（task-01 新表）；不存在 → 抛 `SessionNotFound`（404）。
3. **幂等**：若 `status in ('ended','failed')` 直接返回（log info `end_session_already_ended`），避免空闲超时与用户手动 end 并发触发时双重回收（§8.5 R-04 修正核心）。
4. 原子更新（同一事务）：
   - `agent_sessions.status = 'ended'`，`ended_at = now`，`updated_at = now`。
   - 关联 `DaemonTaskLease`（经 `agent_sessions.lease_id`）：`status = 'completed'`，`updated_at = now`（注意 `lease_expires_at` 本就 NULL，不动）。
5. daemon 通知路径：daemon 侧已先 `sessionStore.end`（kill 进程）再调本端点，本端点无需再回推 WS；手动 end 路径需通过 `ws_hub.send_session_control(runtime_id, SESSION_END)` 通知 daemon 执行 kill（task-04 已接通）。
6. Redis 事件：`publish("agent_session:{id}", {event: "session_ended", reason, ended_at})` 供前端 SSE 终止 + 前端提示。
7. 显式 **跳过** `handle_lease_expiry`：该函数按 `status IN ('claimed','pending') + lease_expires_at < now` 扫描（service.py:894-897），interactive lease 走 `active → completed`，天然不在其扫描集，无需改 `handle_lease_expiry`。在 `end_session` 注释中显式说明此隔离（R-04 应对）。

### Step 4 — config 加 `session_idle_timeout_sec`（config.py）

1. `Settings` 加字段：
   ```python
   # ── Interactive session (task-06 / D-004) ──────────────────────────
   session_idle_timeout_sec: int = Field(
       1800, ge=60, le=86400,
       description="Interactive session idle timeout in seconds (D-004, default 30min). "
       "Sessions with no user inject for this duration are auto-ended.",
   )
   ```
2. 默认 1800（30min，D-004），下限 60s（防误配为 0 导致刚创建即超时），上限 86400（24h）。
3. CONVENTIONS 集中配置约定：遵循 `config.py` 顶部 docstring「All runtime configuration MUST live here」，不读 `os.environ`。
4. 下发链路（execute 时确认）：daemon 需拿到该值——优先在 `register_runtime`/`heartbeat` response 或 capabilities 里下发；若链路未通，daemon 侧硬编码 1800 兜底，并在日志 `idle_scan_using_default_timeout` 标记。

### Step 5 — Wave1 端到端联调脚本/集成测试

1. **集成测试** `test_session_e2e.py`（mock adapter，不打真实 claude/codex）：
   - claude 链路：`POST /sessions`（provider=claude）→ 等 SSE 首轮 result → `POST /inject`（第二轮 prompt）→ 等 result → `POST /interrupt`（断言会话仍 active）→ `POST /end`（断言 status=ended + lease=completed + Redis session_ended 事件）。
   - codex 链路：同上 provider=codex。
   - 空闲超时分支：创建 session 后 mock `time.monotonic` 推进 `session_idle_timeout_sec + 10`，触发 daemon idle scan，断言 session 自动 ended、reason=idle_timeout。
   - 兼容性断言：同一 daemon 同时跑一个 `kind=batch` lease（workspace agent run），验证 session 结束后 batch lease 状态不受影响（AC-6 / 验收 8）。
2. **手动联调脚本**（可选，列在文档而非代码）：起 backend + daemon + (前端或 curl)，对真实 claude/codex 跑一次完整链路，截图/日志归档到 `tasks/task-06-evidence/`（execute 阶段产物）。spike-01 已对真实 agent 验证过两轮 result，此处聚焦 SSE 回显 + 打断/结束的 UI/状态机联动。
3. **跨 turn SSE 连续性**（AC-3）：集成测试断言单一 `GET /sessions/{id}/stream` SSE 连接贯穿两轮，事件流携带 `run_id` 区分 turn 边界（依赖 task-05 的 session 级 channel）。

## 5. 完成标准（验收）

对照 `design.md` §12 验收标准 + `plan.md` 全局 AC：

- [ ] **验收 1（核心）**：claude + codex 各跑通——首轮 result 后中途追问写入 stdin，看到第二轮响应（集成测试 + 手动联调各一）。
- [ ] **验收 2（打断）**：`POST /interrupt` 后 agent 停当前 turn，`agent_sessions.status` 仍 `active`，可继续 inject（集成测试覆盖）。
- [ ] **验收 3（结束）**：`POST /end` 后进程 kill，`agent_sessions.status=ended` + `daemon_task_leases.status=completed`（Step 3 端到端）。
- [ ] **验收 4（SSE 回显）**：一个 SSE 连接贯穿整个会话，多 turn 输出实时回显，历史可在 AgentRunLog 回看（依赖 task-05，本任务集成测试断言）。
- [ ] **验收 8（兼容）**：现有批处理 lease（workspace agent run，`kind=batch`）行为零变化——集成测试显式断言 batch lease 在 session 创建/结束全程状态不变。
- [ ] **FR-06 / D-004（空闲 30min 自动结束）**：`session_idle_timeout_sec` 默认 1800；空闲超时后 session 自动 ended、reason=idle_timeout、lease=completed（vitest mock 时间单测 + pytest 集成测试）。
- [ ] **R-04 防双重回收**：`handle_lease_expiry` 不会回收 interactive lease（status 路径隔离）；`end_session` 幂等（并发触发仅生效一次）。
- [ ] **测试通过**：`cd sillyhub-daemon && pnpm test`（vitest，含新增 idle 单测）；`cd backend && uv run pytest`（含 end_session + 集成测试）。

## 6. 测试要点

### vitest（daemon 侧，session-store.ts + daemon.ts）

- **`session-store.idle.test.ts`**：
  - mock 时间（vitest `vi.useFakeTimers()` + `vi.setSystemTime()`）。
  - `scanIdle` 边界：`last_active_at` 距 now = `timeoutSec*1000 - 1`（不超时）、`= timeoutSec*1000`（超时）、`+1`（超时）。
  - `last_active_at` 在 `create` 时初始化、`inject` 成功后刷新、`interrupt` 不刷新（按 Step 1 决策）。
  - `scanIdle` 不动 sessionStore 状态（纯查询），已 ended/failed session 不返回。
- **`daemon.idle-scan.test.ts`**：
  - mock SessionStore + hub-client，驱动 `_idleScanLoop` 一次 tick。
  - 超时 session 触发 `sessionStore.end` + 上报 `end_session(reason='idle_timeout')`。
  - 上报失败仅 warn 不抛（循环不中断）。
  - AbortSignal abort 后循环干净退出。

### pytest（backend 侧，service.py + 集成）

- **`test_end_session.py`**（单测）：
  - 手动 end：status ended + lease completed + Redis `session_ended` 事件。
  - 幂等：对已 ended session 再调 `end_session` 不报错、不重复 publish、不重复更新。
  - 空闲超时路径（reason=idle_timeout）走同一方法，结果与手动一致。
  - batch lease（kind=batch）调用 end_session 抛错或 no-op（按 task-04 定义，interactive-only）。
  - `handle_lease_expiry` 对 status=active 的 interactive lease 不动作（隔离验证）。
- **`test_session_e2e.py`**（集成）：
  - claude + codex 全链路（mock adapter 注入 fake result/SSE）。
  - 跨 turn SSE 单连接断言（事件含 run_id）。
  - 空闲超时自动结束（mock daemon idle scan 触发）。
  - 批处理 lease 并存不受影响。

## 7. 风险与注意

| 风险 | 应对 |
|---|---|
| **spike-01 未过则 task-06 停工** | spike-01 是硬前置。若 R-01 验证 claude 第一轮后 exit，整个 Wave1 回退伪多轮（每轮新 spawn + `--resume`），task-03/05 重设计，本任务"空闲扫描"语义仍成立（last_active_at 改由每次 inject 续命），但 session 模式 no-op。需在开工前确认 spike-01 PASS。 |
| **空闲扫描误杀活跃 session** | `last_active_at` 仅 inject 续命（Step 1 决策）；长 turn 中 agent 跑超过 30min 但用户无新输入会触发结束——这是 D-004 预期行为（用户已离开），不算误杀。若 review 认为应"任何 daemon→server 上行（submitMessages）都续命"，则在 sessionStore 暴露 `bumpActivity(sessionId)` 由 ws-client 收到任意 session 事件时调用，并在 decisions 补 D-004 细化。 |
| **end_session 并发双重回收（R-04）** | Step 3 幂等：先 load 再判 status，已 ended 直接返回。数据库层可选加 `SELECT ... FOR UPDATE`（本项目未上线、并发度低，单事务 + status 判断足够）。 |
| **idle scan 循环异常导致 session 永不回收** | 循环异常按现有 `_heartbeatLoop` 模式 catch + warn + 继续，不退出循环；单 session end 失败不影响其他 session。 |
| **daemon 重启丢失 sessionStore（Wave1 R-03）** | Wave1/2 不做崩溃恢复（D-003）：daemon 重启 = 活跃 session 全部标 failed，由 task-03 在启动时清理 + 通知 backend（本任务不涉及，但联调脚本需覆盖"daemon 重启后 active session 被 backend 标 failed"的兼容路径）。 |
| **timeout 配置下发链路** | daemon 拿 `session_idle_timeout_sec` 优先 backend 下发；兜底硬编码 1800 + 日志标记。execute 时确认下发通道（register_runtime/heartbeat response 字段 vs capabilities），避免两端取值不一致。 |
| **批处理 lease 受影响** | Step 3 显式 `end_session` 仅处理 interactive（经 `agent_sessions.lease_id` 反查），batch lease 无 agent_sessions 记录，天然不进；集成测试覆盖。 |
| **测试用真实 claude/codex 的成本** | 单测/集成测试一律 mock adapter；真实 agent 仅在手动联调脚本跑一次（spike-01 已验证协议层），避免 CI 消耗 API 配额。 |

## 8. 不做（YAGNI / 越界）

- ❌ 不做崩溃恢复 / resume 持久化（D-003，Wave3 task-09）。
- ❌ 不做权限暂停往返（Wave2 task-07/08）。
- ❌ 不做前端会话面板（Wave4 task-10/11）——本任务后端 + daemon 联调用 curl/集成测试代替前端。
- ❌ 不改 `handle_lease_expiry` / `expire_leases`（interactive lease 天然不在其扫描集，R-04 靠 status 隔离而非改函数）。
- ❌ 不改批处理 lease 生命周期（`kind=batch` 路径零改动，AC-6）。
- ❌ 不做多 daemon 跨主机均衡（非目标 §3）。
