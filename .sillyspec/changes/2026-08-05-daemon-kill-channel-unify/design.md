---
author: qinyi
created_at: 2026-08-05 16:57:16
scale: large
risk_level: contract-required
---

# 设计文档（Design）— daemon kill 通道统一

> 前置：基于 explore + spike 诊断（见 `prototype-kill-channel.html`）。原 P0-1/P0-2（backend→WS 信号层）已于 `d06d9a32`/`9e4faf06`/`372e52d8`（2026-07-12~14）修复；本次聚焦下一层"daemon 物理杀进程"+ budget 强制点 + 终态可见性。
>
> **v2（Design Grill XC-01~XC-08 修订）**：XC-01 发现 cancel 路径盲区（→D-001@v2），XC-02 budget 口径未定义（→D-009），XC-03/04/08 terminating_at 写入点/sweeper 修正，XC-05 关闭 Codex 存疑，XC-06 隐患1 描述修正，XC-07 R-04 升级。

## 1. 背景

SillyHub 的 interactive 会话（Claude/Codex）与 batch lease 在用户主动终止时，存在"backend 已标记终态、但 daemon 侧子进程未必真停"的缺口。经代码 + SDK 源码核实，当前 4 个活隐患：

- **隐患 1（P0）Claude 终止路径不能可靠杀进程**：daemon 的 end 路径只做 `q.interrupt()`（SDK 仅往 claude stdin 写 `{subtype:"interrupt"}` 控制消息，不 kill）+ `inputQueue.close()`（给 stdin 发 EOF，不 kill）。SDK 内部其实有强制 kill 链（`close()`：stdin EOF → 2s → SIGTERM → 5s → SIGKILL），但 daemon 没调 `query.close()`、consume 也不 break——触发条件没满足（注：`Options.abortController` 非必需，`close()` 内部用自己的 controller；**根因是"不调 query.close()"**，XC-06 修正）。当前 turn 卡死（如 hang 死的 bash）时 claude 不退，consume 永久挂起，僵尸进程持续烧 token。
  - **Design Grill XC-01 补充（P0 盲区）**：用户"取消/停止一个 run"走 `cancel_lease`，它对 interactive 当前发 `SESSION_INTERRUPT`（软，lease_service.py:363），daemon 走 `interrupt()` 也不杀——即 END 路径修好也不覆盖 cancel 路径。本次一并修正（D-001@v2）：cancel_lease 对 interactive 改发 `SESSION_END`。
- **隐患 2（P1）Codex END 不主动收口**：`_close`（SIGTERM + 2s SIGKILL）已存在，但 `SessionManager.end/fail/interrupt` 都不直接调 `driverHandle.close()`，要等当前 turn 的 `turn/completed` 回来后才在 consume finally 收敛。
- **隐患 3（P2）batch kill 靠心跳轮询**：`_killChild`（SIGTERM/SIGKILL）有，但唯一触发源是 `_runLeaseHeartbeatLoop`（task-runner.ts:905）检测 backend `status==='cancelled'`。无 WS 即时通道，有一个 heartbeat 周期延迟。
- **隐患 4（P1）budget_tokens 全链路零强制点**：daemon 连 budget 字段都没收到（`LeaseCtx` types.ts:252-345 无 budget 字段）；token usage 仅累加用于上报显示，无阈值比较；唯一运行期切断是时间看门狗。backend 也只在 `can_dispatch_worker`（control.py:69-87）做 pre-dispatch 门，已派出的 worker 不再检查。

## 2. 设计目标

1. interactive（Claude/Codex）END/fail/**cancel** 都能在当前 turn 卡死场景下可靠终止子进程（接通 SDK 已有 kill 链；cancel 路径盲区见 D-001@v2）。
2. batch lease 取消走 WS 即时通道，不再依赖心跳周期。
3. budget_tokens 有运行期检查点，超阈值软停（口径 = input+output，per-run，D-009）。
4. 引入轻量终态确认，让"backend 标记终止但 daemon 没回传"的可见性黑洞可观测（对照 multica "执行端确认"思想）。
5. 全程遵守 D-001@v2/D-002~D-009（保留"打断本轮"软中断、不动 binding、Windows 靠 SDK、不引入 outbox 重试）。

## 3. 非目标（Non-Goals）

- **不**改 daemon-entity-binding / WorkspaceMemberRuntime 绑定结构（D-002）。
- **不**改 `lease.status`/`AgentSession.status`/`AgentRun.status` 状态机取值集合（仅加 `terminating_at` 时间戳，D-007）。
- **不**引入 provider-neutral "TerminationController" 大抽象（方案 B 已否决）。
- **不**引入 outbox / report-with-retry 重试组件（D-007）。
- **不**把"打断本轮"按钮（SESSION_INTERRUPT）改成硬杀（D-001@v2）；但"取消/停止 run"（cancel_lease）属终止语义，改发 SESSION_END 硬杀（D-001@v2）。
- **不**做 budget 硬切断（D-006，避免丢失当前 turn 工作）。
- **不**做 budget 计费/配额/跨 workspace 统计（仅运行期软停 + 回传事件）。
- **不**做前端 budget 进度条的完整可视化（Phase 5 仅最小"终止中…"态，进度条后置）。

## 4. 拆分判断

4 个隐患主题相关（都是"daemon 切断通道"），但工作量差异大：1+2+3 是 kill 契约（纯 daemon driver 层），4 是 budget（跨 backend+daemon+前端）。用户在 brainstorm step 3 选择"全做"统一为一个 change（D-005）。不拆分、不批量。预计 plan 分 5 个 Phase + 跨切测试/文档。

## 5. 总体方案（分 Phase）

### Phase 1 · Interactive 切断契约（止血 P0）

**Claude**：`ClaudeDriverHandle` 新增 `close` 方法 = `() => { handle.query.close(); }`（D-003，接通 SDK kill 链）。
**Codex**：`_close` 已存在且经 `state.driverHandle.close` 可达（codex-app-server-driver.ts:531），无需新增、无需改 driver.ts。**注（task-14 RS-1 勘误）**：`state.driverHandle` **仅 codex 赋值**；claude 句柄存在 `state.query`（运行时实为 `ClaudeDriverHandle`，session-manager.ts:950），并非"两 provider 都赋值 `state.driverHandle`"。`_terminateSession` 按 provider 分流取 target（`state.provider === 'claude' ? state.query : state.driverHandle`，session-manager.ts:2164-2167），两侧均经可选契约 `close?.()` 收口。
**收敛**：`session-manager.ts` 新增私有 `_terminateSession(state, reason)`，统一做 `terminateTarget?.close?.()`（按 provider 取 claude `state.query` / codex `state.driverHandle`，非字面 `driverHandle.close`）+ `inputQueue.close()` + abort 权限 resolver + 清 partial buffer + 设 status。`end()`（session-manager.ts:1937-1958）和 `fail()` 改为调它。**`interrupt()`（session-manager.ts:1772-1789）不动**，仍只调 `q.interrupt()`（"打断本轮"按钮保持软，守 D-001@v2）。

**cancel 路径（D-001@v2，XC-01 修正）**：backend `cancel_lease` 对 interactive lease 当前发 `SESSION_INTERRUPT`（lease_service.py:363），本次改发 `SESSION_END`——让"取消/停止 run"也走 `_terminateSession` 硬杀链。SESSION_INTERRUPT 消息此后**仅**对应"打断本轮"按钮（interruptSession 端点）。

效果：END/fail/cancel 后 SDK 走 stdin EOF → 2s → SIGTERM → 5s → SIGKILL，当前 turn 卡死也能在 ~7s 内强杀。

### Phase 2 · Batch 即时取消（LEASE_CANCEL）

新增 WS 消息 `daemon:lease_cancel`（双端 protocol，backend `protocol.py` + daemon `protocol.ts`）。backend `cancel_lease`（lease_service.py:281）对 batch lease（`kind != interactive`）标记 cancelled 后，经 `ws_hub.send_to_runtime`（ws_hub.py:132）即时发给对应 daemon（best-effort，失败靠现有心跳兜底）。daemon `_handleWsMessage`（daemon.ts:2426）新增 case → `taskRunner.cancel(leaseId)`，**复用现有** `AbortController.abort → _killChild`（task-runner.ts:327/332/2034）。

### Phase 3 · Budget 执行循环检查点（软切断）

**口径（D-009，XC-02 定义）**：budget 累计 = `input_tokens + output_tokens`（**不含** cache_read/cache_creation），归集维度 = **per AgentRun**（与成本归集一致）。

**backend**：claim payload（`LeaseClaimResponse.payload`，开放 dict `additionalProperties:true`）增加运行时透传键 `budget_tokens: int | None`（context.py task-07 双写 `budget_tokens`/`budgetTokens`，对齐 daemon execPayload 归一化惯例），dispatch 时从 `AgentMission.budget_tokens`（model.py:595）或 run 级 budget 下发。**注（task-14 RS-2 勘误）**：因 payload 是开放 dict，`budget_tokens` **不进 OpenAPI 命名 schema**——api-types.ts 不显式含此命名字段（同 `profile_version` 等透传键），仅作为 dict 键存在；typed 接收在 daemon 侧 `LeaseCtx.budget_tokens?: number`（`sillyhub-daemon/src/types.ts`，task-08）。
**daemon**：`LeaseCtx`（types.ts）加 `budget_tokens`；**interactive** 复用 `session-manager.ts` 现有 input/output 累计器（session-manager.ts:374-381）；**batch（task-runner.ts）当前无 token 累计器，本次新增**（从 adapter stats 累计 input+output，per-run）。执行循环检查点：累计 ≥ budget → 设 `overBudget` flag → **软切断**（当前 turn/step 跑完不续，守 D-006）+ 经现有 `notifyRunResult`/`submit_lease_messages` 回传 `budget_exceeded` reason + usage。

### Phase 4 · 轻量终态确认（执行端可见性）

backend：`DaemonTaskLease` 加 `terminating_at: datetime | None`。**写入点（XC-03/04 修正）**：仅 `cancel_lease`（batch + interactive）写 `terminating_at`——因为 `end_session` 同事务即把 lease 置 `completed`（session/service.py:927），sweeper 对它无意义；cancel_lease 发出取消信号后 lease 处于"已标 cancelled、等 daemon 回传确认"的间隙，正是 `terminating_at` 的观测窗口。另：`cancel_lease` 已同步把 session.status='ended'（lease_service.py:319-325），故 session 维度不另设 terminating 字段（XC-04）。

daemon 收到取消信号、完成 kill 后，**复用现有** `complete_lease`/`notifySessionEnd` 上报终态，backend 收到即清 `terminating_at`。新增轻量 sweeper：**独立查询** `terminating_at IS NOT NULL`（**不并入**现有 `expire_overdue_leases`，因后者只扫 `status='claimed'`，XC-08），`terminating_at` 超 30s 仍无回传 → 日志告警 + 标记（不阻塞、不重试、不改 lease.status，D-007）。

### Phase 5 · 前端最小

会话面板：lease 处于 `terminating` 态（`terminating_at` 非空）时显示"终止中…"而非立刻"已停止"。budget 进度条后置（可不做）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | `ClaudeDriverHandle` 新增 `close`（调 `query.close()`） |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | 新增私有 `_terminateSession`；`end`/`fail` 改调它；budget 累计检查点 + overBudget 软切断 |
| — | `sillyhub-daemon/src/interactive/codex-app-server-driver.ts` | 无需改（XC-05：`_close` 经 `state.driverHandle.close` 已可达） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_handleWsMessage` 新增 `LEASE_CANCEL` case → `taskRunner.cancel` |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 暴露 `cancel(leaseId)` 给 WS 路径调用（已有内部 cancel）；**新增 batch token 累计器**（input+output，per-run，D-009）+ budget 检查点 |
| 修改 | `sillyhub-daemon/src/protocol.ts` | 新增 `LEASE_CANCEL = 'daemon:lease_cancel'` 常量 |
| 修改 | `sillyhub-daemon/src/types.ts` | `LeaseCtx` 加 `budget_tokens?: number` |
| 修改 | `sillyhub-daemon/src/api-types.ts` | `pnpm gen:types` 重新生成。**注（task-14 RS-2 勘误）**：`budget_tokens` 是 claim payload 开放 dict（`LeaseClaimResponse.payload`，`additionalProperties:true`）上的**运行时键**，非 OpenAPI 命名 schema 字段——api-types.ts 不显式含此命名字段，仅随 dict 透传（同 `profile_version`）；typed 字段在 daemon 侧 `types.ts` `LeaseCtx.budget_tokens?: number`（task-08） |
| 修改 | `backend/app/modules/daemon/protocol.py` | 新增 `DAEMON_MSG_LEASE_CANCEL` 常量 + payload |
| 修改 | `backend/app/modules/daemon/lease_service.py` | `cancel_lease` 对 **interactive 改发 SESSION_END**（D-001@v2）；对 batch 发 `LEASE_CANCEL` WS；写 `terminating_at`；新增 terminating_at sweeper（独立查询，XC-08） |
| — | `backend/app/modules/daemon/ws_hub.py` | 无需改（`send_to_runtime` 可复用） |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonTaskLease` 加 `terminating_at` 字段 + migration |
| 新增 | `backend/migrations/versions/<date>_lease_terminating_at.py` | Alembic 加 `terminating_at` 列 |
| 修改 | `backend/app/modules/agent/execution.py` | `dispatch_worker`/batch dispatch 下发 `budget_tokens` 到 claim payload |
| — | `backend/app/modules/agent/model.py` | 无需改（`budget_tokens` 字段已有，model.py:595） |
| 修改 | `frontend/src/components/daemon/interactive-session-panel.tsx` | `terminating` 态显示"终止中…" |
| 修改 | `frontend/src/lib/api-types.ts` | `pnpm gen:types` 重新生成 |

## 7. 接口定义

```typescript
// sillyhub-daemon/src/interactive/driver.ts（close 已是可选契约，Claude 补实现）
interface InteractiveDriverHandle {
  readonly provider: 'claude' | 'codex';
  close?(): void;              // 已存在（可选）；Claude 本次补实现
  // ...其余不变
}

// claude-sdk-driver.ts
interface ClaudeDriverHandle extends InteractiveDriverHandle {
  readonly query: Query;
  close: () => void;           // 新增：() => { this.query.close(); }
}

// session-manager.ts（私有收敛）
private async _terminateSession(state: SessionState, reason: 'manual' | 'driver_error'): Promise<void>;

// protocol.ts（新消息）
const LEASE_CANCEL = 'daemon:lease_cancel';   // payload: { lease_id, runtime_id }
```

```python
# backend/app/modules/daemon/protocol.py
DAEMON_MSG_LEASE_CANCEL = "daemon:lease_cancel"   # 新增

# backend/app/modules/daemon/model.py
class DaemonTaskLease(...):
    terminating_at: datetime | None = Field(default=None, nullable=True)  # 新增
```

## 7.5 生命周期契约表

涉及 session/lease/agent_run/daemon 关键词，必填。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| SESSION_END（WS） | backend | daemon | session_id, lease_id | session active → ending（daemon 收口，硬杀）。**cancel_lease 对 interactive 也改发此消息**（D-001@v2） |
| SESSION_INTERRUPT（WS） | backend | daemon | session_id, lease_id | 软中断，不改 session 状态（**仅"打断本轮"按钮**，D-001@v2） |
| **LEASE_CANCEL（WS，新增）** | backend | daemon | lease_id, runtime_id | lease cancelled（backend 已标记）→ daemon 即时 `_killChild` |
| session end（REST 回传） | daemon | backend | session_id, status, reason | session active → ended；清 `terminating_at` |
| lease complete（REST 回传） | daemon | backend | lease_id, claim_token, result(status) | lease → completed/cancelled；清 `terminating_at` |
| budget_exceeded（事件回传） | daemon | backend | lease_id/run_id, reason='budget_exceeded', usage(input+output) | 设 overBudget → 当前 turn 完成后终止 |
| terminating 超时（sweeper） | backend sweeper | （日志/告警） | lease_id, terminating_at | 标记 terminate_timeout（不改 lease.status） |

> 注：本表覆盖本次新增的 `LEASE_CANCEL` 与 `budget_exceeded`；SESSION_END 本次扩大使用范围（cancel_lease 复用）；SESSION_INTERRUPT 收窄为仅"打断本轮"按钮。无遗漏事件。

## 8. 数据模型

- `DaemonTaskLease` 新增 `terminating_at: datetime | None`（nullable，default None）。需 Alembic migration（本项目未上线，允许新列；PPM 不依赖此表，零回归）。
- backend claim payload（`LeaseClaimResponse.payload`）是开放 dict（`additionalProperties:true`），`budget_tokens` 作为**运行时透传键**写入（context.py task-07 双写 `budget_tokens`/`budgetTokens`），非命名 schema 字段（task-14 RS-2 勘误：不进 OpenAPI api-types 命名，同 `profile_version`）。daemon 侧 `LeaseCtx`（`sillyhub-daemon/src/types.ts`，task-08）以 typed `budget_tokens?: number` 声明接收。`AgentMission.budget_tokens`（model.py:595）已存在，本次只把它下发到 claim payload。
- budget 口径（D-009）：累计 = `input_tokens + output_tokens`，per AgentRun 归集（不含 cache）。
- 不新增表，不改现有表的其他列。

## 9. 兼容策略（brownfield）

- **未配置新功能时行为不变**：`budget_tokens` 为 None 时 daemon 检查点短路（不触发软切断）；`close` 是可选契约，Claude 补实现、Codex 已有、其他 driver 不实现也不报错（`?.()`）。
- **`terminating_at` 默认 None**：现有 lease 不受影响；sweeper 只对 `terminating_at` 非空且超时的 lease 告警。
- **LEASE_CANCEL 是 best-effort**：发送失败（daemon 离线/WS 无连接）靠现有心跳轮询兜底（task-runner.ts:905 不变）。
- **cancel_lease 对 interactive 改发 SESSION_END**：daemon 侧 SESSION_END handler 已存在（daemon.ts:2592-2596），向后兼容（旧 daemon 已支持 SESSION_END）。
- **不改的 API/表结构**：不删字段、不改 lease.status 取值、不删 WS 已有消息；LEASE_CANCEL 是纯新增消息，旧 daemon 收到走 default 分支仅 warn。
- **PPM 已上线零回归**：不动 PPM 相关表/路由；`terminating_at` 在 daemon 域表，与 PPM 正交。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | Claude `query.close()` 在 SDK 某些状态下抛错/无效 | P1 | close 调用包 try/catch（不阻塞 end/cancel 流程）；SDK close 内部已有 SIGTERM→SIGKILL 升级 + 进程退出钩子兜底；测试覆盖正常 + 异常路径 |
| R-02 | budget 软切断仍会跑完当前 turn/step，多花一些 token | P2 | 接受（D-006，避免丢工作）；后续可加配置项切硬切；事件回传让用户感知 |
| R-03 | `terminating_at` sweeper 误报（daemon 回传延迟但 <30s 正常完成） | P2 | 阈值取 30s 宽裕；只告警不强制改状态；可配置 |
| R-04 | Windows 下 SDK SIGKILL（TerminateProcess）对 claude.exe 及其 **MCP 孙进程**的级联清理（XC-07 升级：主 agent session 注入 `options.mcpServers` 会 spawn 孙进程，TerminateProcess 不级联孙进程） | P1 | 依赖 SDK close() 资源清理；**execute 强制验收**：Windows + 注入 mcpServers 场景 kill 后检查孙进程残留；残留则记录 QUICKLOG + 补显式清理 |
| R-05 | migration 多 head 冲突（项目活跃 change 多） | P1 | execute 阶段先 `alembic heads` 确认单 head；migration 基于当前 head；本地 apply + 跑 daemon 模块测试 |
| R-06 | batch `LEASE_CANCEL` 与心跳轮询双触发 `cancel`（重复 kill） | P2 | `taskRunner.cancel` 幂等（AbortController 已 aborted 则 no-op，`_killChild` 检查 `child.killed`）；测试覆盖 |
| R-07 | scope 大（跨 backend+daemon+前端），plan 波次多，工期长 | P1 | plan 严格分 Wave（Phase1 先止血可独立验收），每 Wave 独立测试；Phase1 优先 |
| R-08 | cancel_lease 改发 SESSION_END 后，"打断本轮"与"取消 run"行为差异需前端文案对齐 | P2 | Phase5 前端确认两按钮文案/反馈；文档注明 SESSION_INTERRUPT 仅按钮用 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：
- **D-001@v2**（INTERRUPT 软只守"打断本轮"按钮；cancel/终止硬杀，取代 v1）→ 覆盖于 §5 Phase1（interrupt 不动 + cancel_lease 改发 END）、FR-02/FR-09、§7.5
- **D-002@v1**（不改 binding）→ 覆盖于 §3 Non-Goals、§9 兼容策略
- **D-003@v1**（Claude close 用 SDK）→ 覆盖于 §5 Phase1、§7 接口定义、FR-02
- **D-004@v1**（Windows 靠 SDK）→ 覆盖于 §5 Phase1、§10 R-04、FR-06
- **D-005@v1**（含 budget）→ 覆盖于 §4 拆分判断、§5 Phase3、FR-05
- **D-006@v1**（budget 软切断）→ 覆盖于 §5 Phase3、§10 R-02、FR-05
- **D-007@v1**（方案 C，无 outbox）→ 覆盖于 §3 Non-Goals、§5 Phase4、FR-04
- **D-009@v1**（budget 口径 = input+output，per-run，batch 补累计器）→ 覆盖于 §5 Phase3、§8、FR-05

Design Grill（XC-01~XC-08）已全部处理：XC-01→D-001@v2，XC-02→D-009，XC-03/04/08→§5 Phase4 修正，XC-05 关闭（Codex `_close` 经 `state.driverHandle` 可达，无需改 driver.ts），XC-06→§1 隐患1 描述修正，XC-07→R-04 升级。无未解决 P0/P1 blocker。

## 12. 自审（Self-Review）

| 检查项 | 结果 | 说明 |
|---|---|---|
| 必填章节齐全（背景/目标/非目标/总体方案/文件变更清单/接口定义/风险登记） | ✅ pass | 全部含 |
| 生命周期契约表（涉及 session/lease/daemon） | ✅ pass | §7.5 含表 + 无遗漏声明 |
| 决策 D-001@v2/D-002~D-009 全部被章节覆盖 | ✅ pass | §11 逐条映射（含 Grill 后 D-001@v2/D-009） |
| 不违反 D-001@v2（"打断本轮"软；cancel/终止硬） | ✅ pass | §5 Phase1 明确 interrupt 不动 + cancel 改发 END |
| 不违反 D-002（不动 binding） | ✅ pass | 文件清单无 binding 文件 |
| 文件清单覆盖 backend+daemon+前端 | ✅ pass | §6 |
| 数据模型变更（terminating_at）有 migration | ✅ pass | §6 + §8 |
| Windows 兼容（D-004） | ✅ pass | §5 Phase1 + §10 R-04，靠 SDK close() |
| gen:types 同步（CLAUDE.md 规则 20） | ✅ pass | §6 含 api-types.ts 重新生成 |
| Codex `_close` 经 `driverHandle.close` 可达 | ✅ pass（Grill XC-05 关闭；task-14 RS-1 勘误措辞） | codex 句柄存 `state.driverHandle`（`handle.close` 经 codex-app-server-driver.ts:531 的 `_close` 已可达）；claude 句柄存 `state.query`（**非** driverHandle）。`_terminateSession` 按 provider 分流取 target（session-manager.ts:2164-2167），非"两 provider 均赋值 driverHandle"。无需改 driver.ts |
| `_terminateSession` 与现有 `end` 的 partial buffer 清理 / spec sync 触发顺序 | 待 verify（execute） | execute 阶段对照 session-manager.ts:1937-1958 现有 end 实现细化，避免漏清 |
| Design Grill blocker 已处理 | ✅ pass | XC-01→D-001@v2，XC-02→D-009，XC-03/04/08→§5 Phase4，XC-06→§1，XC-07→R-04 |

自审结论：章节齐全、决策一致、无硬性违反。Design Grill P0/P1 blocker 全部处理；1 处"自审存疑"（partial buffer 清理顺序）留 execute 阶段对照源码细化，不阻塞进入 plan。
