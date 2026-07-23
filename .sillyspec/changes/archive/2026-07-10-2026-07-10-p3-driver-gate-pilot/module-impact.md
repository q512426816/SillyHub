---
author: qinyi
created_at: 2026-07-10T19:40:00+08:00
---

# 模块影响分析 — P3 Driver Gate Pilot

## 变更概述

verify 阶段从"agent 声明态"改为"机器客观核验"：agent 跑完 verify 后，backend 后台跑 `sillyspec gate verify` 真测试（daemon 侧执行，够得着源代码），按 exit code 三态决策（0 推进 / 1 打回重跑 / 2 卡住报警）。gate 慢（27s+）后台异步不阻塞 close HTTP（<30s）。三约束交集：backend 触发 + daemon 执行 + 后台异步。

## 影响模块

### backend

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `app/modules/agent/model.py` | 修改 | AgentRun 加 `gate_status`（String(20) nullable）+ `gate_result`（JSON nullable）两列 |
| `app/modules/daemon/host_fs/delegate.py` | 修改 | 加第 9 方法 `run_command`（命令白名单 `_enforce_command_whitelist` 先于 RPC + send_rpc timeout 透传）；`_WsRpcLike.send_rpc` Protocol + `_via_rpc` 加 `timeout` 参数（M5 向下兼容，None 时不传 send_rpc 保现有 8 方法 + mock 零回归） |
| `app/modules/daemon/run_sync/service.py` | 修改 | 加 `_fire_background_task` + `_background_tasks` set（H4 强引用防 GC）；`close_interactive_run` 改造（gate_status=pending 随 commit + enqueue gate 任务不 await）；`_run_gate_decision_task`（H1 get_session_factory 独立 session + R3 cas pending→running + H2 内联 sync/auto_dispatch 不调 callback）；`_publish_gate_status_changed` SSE helper；`_resolve_gate_workspace_id` + `_resolve_gate_spec_root` |
| `app/modules/change/dispatch.py` | 修改 | `_run_gate_via_delegate` + `_read_gate_result`（含 Z1 合并探测，stderr 子命令缺失信号）；`auto_dispatch_next_step` stage_completed 分支三态决策（exit 0 推进/1 打回/2 卡住）+ verify stage 强制 gate（gate_result None 阻断 fail-loud，不读 verify-result.md）；`_record_gate_kickback` + `_read_latest_gate_result`；gate_retry_count（>=3 升级 exit 2）+ gate_last_errors（截断跨 run 持久）；`reconcile_pending_gate_decisions`（扫孤儿重置 pending + 重 enqueue） |
| `app/main.py` | 修改 | lifespan startup 挂 `reconcile_pending_gate_decisions`（yield 前，try/except 不阻断启动） |
| `migrations/versions/7c77e09b84e1_add_gate_fields_to_agent_runs.py` | 新增 | AgentRun 加 gate_status/gate_result 列（down_revision `419d34f8e33f`，dialect 无关 add_column） |

### sillyhub-daemon

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/host-fs-handler.ts` | 修改 | 加 `runCommand` handler（命令白名单 `isGateCommand` 字符级对齐 backend + execFile 非 shell + timeout 杀子进程 SIGTERM→exit 124 + cwd assertWithinAllowedRoots + env 合并 + duration_ms 计时）+ `RunCommandResult`/`RunCommandParams` 类型 |
| `src/daemon.ts` | 修改 | `_registerHostFsRpcHandler` 注册 `host_fs.run_command`（参数清洗 + timeout 透传不写死 12min） |

### frontend

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/lib/agent.ts` | 修改 | AgentRun 类型加 `gate_status`/`gate_result`（nullable，brownfield `?? null` 防御） |
| `src/lib/agent-stream.ts` | 修改 | `GateStatusEvent` interface + `gate_status_changed` 专用回调（onmessage 解析 event 字段，不进 `_emitMessage`，对齐 permission 模式）+ `onGateStatusChanged` 方法 |
| `src/lib/use-agent-run-stream.ts` | 修改 | `gateStatus` state + 订阅 `onGateStatusChanged` + 返回值 + clear 重置 |
| `src/components/agent-run-panel.tsx` | 修改 | `onGateStatusChanged` prop 透传（React.useEffect gateStatus 变化时调父回调） |
| `src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 修改 | gateStatus state + AgentRunPanel `onGateStatusChanged={setGateStatus}` + 四态徽标（pending/running animate-pulse 客观核验中 / decided+无 errors_summary 已通过 / decided+errors_summary 或 failed 核验失败） |

## 新增接口/契约

- `HostFsDelegate.run_command(workspace, *, command, args, cwd, timeout, env=None) -> {exit_code, stdout, stderr, duration_ms}`——第 9 方法，命令白名单只允 `sillyspec gate verify --change <name> --json [--stage <stage>]`，违例 raise HostFsDelegateError
- `_WsRpcLike.send_rpc(*, method, workspace_id, daemon_id, args, timeout: float | None = None)`——M5 timeout 向下兼容（None 走默认 30s，run_command 传 12min）
- `RunSyncService._run_gate_decision_task(*, agent_run_id, workspace_id, change_id)`——gate 决策后台任务（H1 独立 session + R3 cas + H2 内联 sync+auto_dispatch + H4 强引用调度）
- `SillySpecStageDispatchService.reconcile_pending_gate_decisions(session) -> {orphan_count, reset_to_pending, reenqueue}`——重启兜底扫孤儿
- daemon `host_fs.run_command` RPC handler（per-daemon WS channel）
- SSE `gate_status_changed` event（复用 `agent_run:{id}` channel，{event, agent_run_id, gate_status, errors_summary}）

## 数据模型变更

**AgentRun 加列**（migration `7c77e09b84e1`，down_revision `419d34f8e33f`）：
- `gate_status` String(20) nullable（pending/running/decided/failed，最长 7 字符）
- `gate_result` JSON nullable（`{exit_code: int, errors: list[str], raw_envelope: dict}`）

nullable brownfield 兼容（老 agent_run 无值，非 verify stage fallback 声明态）。

**change.stages last_dispatch 加字段**（JSON，非 migration）：
- `gate_retry_count` int（exit 1 打回 +1，>=3 升级 exit 2 报警人工，R12 死循环防护）
- `gate_last_errors` list[str]（exit 1 errors 截断摘要每条≤500/总≤10，跨 run 持久）

## 风险等级

**integration-critical**（design 含 daemon/session/lease/lifecycle/gate）。design §10 R1-R12 全应对（R1 reconcile 重启兜底 / R3 cas 防双发 / R4 sillyspec gate 发版前置 / R5 H4 强引用 / R6 H1 独立 session / R7 H2 不调 callback / R8 migration head 唯一 / R10 double-fire cas / R12 retry 3 上限）。

## 遗留验证

- 真实 daemon-client + sillyspec gate verify 27s 端到端联调待 sillyspec gate npm publish 发版（design §10 R4 硬前置）；当前 mock run_command 等价覆盖 AC-1~9 链路语义
- 生产 PG migration apply 部署验证（SQLite 测试通过，PG dialect 无关）

## 回退策略

纯增量可独立回退：
1. `alembic downgrade -1`（drop gate_status/gate_result 列）
2. 删新方法（run_command / _run_gate_decision_task / reconcile_pending_gate_decisions 等）+ 前端 gate 渲染条件
3. close_interactive_run 的 gate enqueue + gate_status 赋值两块删除

回退后 verify 回到 read_verify_result 声明态（agent 自述完成平台就信的原始行为）。close 改动回退后，interactive stage 完成不推进的原始 bug 仍在（独立于 gate，可单独修）。
