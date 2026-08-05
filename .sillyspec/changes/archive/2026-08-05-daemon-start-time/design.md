---
name: 2026-08-05-daemon-start-time
title_zh: daemon 启动时间字段
author: WhaleFall
created_at: 2026-08-05 09:40:00
scale: large
---

# 设计文档（Design）— daemon 启动时间字段

## 1. 背景
/runtimes 机器列表（machines 端点 → 机器头 `machine-card.tsx`）当前显示 `last_heartbeat_at` / `status`，无法确定 daemon 进程**何时启动**。daemon 进程入口在 `cli.ts:757 new Daemon()`；启动时间需在 cli.ts 入口（`cli.ts:513` echo 启动信息附近）`Date.now()` 取，目前未记录/上报。backend `daemon_instances` 表无 `started_at` 字段（只有 `last_heartbeat_at` / `created_at` / `updated_at`；`created_at` 是 instance 行创建时间 ≠ daemon 进程启动）。

> 注：初稿曾误以为 `daemon.ts:1808` 的 `startedAt` 是进程启动时间 —— Design Grill 核实它是 `_fire()` 方法内 circuit-breaker 的 `survived_ms` 计算用局部变量，与进程启动无关，已弃用此误读。

## 2. 设计目标
- **FR-01**：daemon 在 cli.ts 入口取进程启动时间，上报 `started_at`（register + heartbeat，ISO 8601，恒定值）。
- **FR-02**：backend `daemon_instances` 加 `started_at` 字段（Alembic migration，nullable；register 写 + heartbeat 幂等覆盖；**machines 端点**经 instance JOIN 在 `DaemonMachineRead` 返回）。
- **FR-03**：前端机器头（`machine-card.tsx`）显示 `started_at`（相对「2 小时前」+ 绝对格式化，复用 `formatRelativeTime`）。

## 3. 非目标（Non-Goals）
- 不改 daemon 生命周期（register/heartbeat/session/lease/state 不变，仅 body 加只读字段）。
- 不改 `daemon_runtimes` 表、**不给 `DaemonRuntimeRead` 加 started_at**（runtime 级展示「进程启动时间」语义混乱，YAGNI；只 Machine 级展示）。
- 不动 `BUILD_ID` / `daemon_version`。
- 不算 uptime（前端 `now - started_at` 推导，不入库）。

## 4. 拆分判断
不拆分，单变更。改动跨 daemon + backend + 前端 3 端但逻辑高度内聚（`started_at` 字段贯穿上报→存储→机器头显示），无独立可交付子模块。

## 5. 总体方案

### A. daemon 取时与上报（sillyhub-daemon，对应 FR-01）
1. **cli.ts**：进程入口（`:513` echo 启动信息附近，或 `:757 new Daemon()` 前）`const processStartTime = Date.now()`，作为构造参数注入 `new Daemon({ ..., startedAt: processStartTime })`。
2. **daemon.ts**：Daemon 加 `private readonly _startedAt: number`（构造参数接收 cli.ts 传入），register（`:1008` 附近）/ heartbeat（`:1877` 附近）调 hub-client 时传 `startedAt: this._startedAt`。
3. **hub-client.ts**：`RegisterBody`（`:53-54`）+ `HeartbeatBody`（`:99-100`）加 `started_at: string | null`；`register`（`:337-345`）/ `heartbeat`（`:360-370`）接 `startedAt` 参数，填 `started_at: new Date(startedAt).toISOString()`。

### B. backend 存储与返回（对应 FR-02）
1. **model.py**：`DaemonInstance` 加 `started_at: datetime | None`（nullable，类比 `last_heartbeat_at:92-95`）。
2. **Alembic migration**：`backend/migrations/versions/<rev>_daemon_started_at.py`（alembic.ini 在 `backend/` 根，env.py 在 `backend/migrations/`）—— `add_column started_at DATETIME NULL` + downgrade `drop_column`（仿现有 migration 风格）。
3. **schema.py**：`DaemonRegisterRequest`（`:112`）加 `started_at: datetime | None`；**`DaemonMachineRead`（`:283`）加 `started_at: datetime | None`**（机器头实际消费此 DTO，见 `machine-card.tsx:169`）。
4. **router.py**：`DaemonHeartbeatRequest`（`:203`，定义在 router 非 schema）加 `started_at: datetime | None`；`_build_machine_read`（`:466-502`）填 `started_at`（从 instance JOIN）。`_runtime_read`（`:442-463`）**不加**（DaemonRuntimeRead 不加 started_at，§3 YAGNI）。
5. **runtime/service.py**：register（`:194-195`）+ heartbeat（`:349-352`）写 `instance.started_at = started_at`（幂等覆盖，恒定值无副作用）。

### C. 前端显示（对应 FR-03）
1. `pnpm gen:types`（后端 schema 改后刷新 `frontend/src/lib/api-types.ts` + `backend/openapi.json`，CLAUDE.md 规则 20）。
2. **`frontend/src/components/daemon/machine-card.tsx`**：显示 `started_at`，复用 `runtime-card-helpers` 的 `formatRelativeTime`（已在 `:169` 格式化 `last_heartbeat_at`）+ 绝对时间 tooltip。

## 6. 文件变更清单
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/cli.ts` | 入口取 `processStartTime = Date.now()`，注入 Daemon 构造 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_startedAt` field（构造参数）+ register/heartbeat 传 hub-client |
| 修改 | `sillyhub-daemon/src/hub-client.ts` | RegisterBody/HeartbeatBody 加 `started_at`；register/heartbeat 接 startedAt 填 |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonInstance.started_at`（nullable datetime） |
| 新增 | `backend/migrations/versions/20260805110000_daemon_started_at.py` | migration 加 `started_at` 列（nullable，revision 20260805110000 down_revision 20260802_agent_profile）+ downgrade drop_column |
| 修改 | `backend/app/modules/daemon/schema.py` | `DaemonRegisterRequest`（:112）+ `DaemonMachineRead`（:283）加 `started_at` |
| 修改 | `backend/app/modules/daemon/router.py` | `DaemonHeartbeatRequest`（:203）加 `started_at`；`_build_machine_read`（:466-502）填 |
| 修改 | `backend/app/modules/daemon/runtime/service.py` | RuntimeService register/heartbeat 写 `instance.started_at`（幂等） |
| 修改 | `backend/app/modules/daemon/service.py` | facade DaemonService register/heartbeat 透传 started_at 到 self._rt（execute 符号影响面检查发现，三层透传链中间层） |
| 修改 | `frontend/src/components/daemon/machine-card.tsx` | 显示 `started_at`（复用 formatRelativeTime + 绝对 tooltip） |
| 重新生成 | `frontend/src/lib/api-types.ts` | `pnpm gen:types`（DaemonMachineRead.started_at，task-07） |
| 重新生成 | `backend/openapi.json` | `uv run python scripts/dump_openapi.py` 重新 dump 反映 task-04 schema（task-07 gen:types 产物） |
| 修改 | `frontend/src/lib/daemon.ts` | 手写聚合 DaemonMachineRead 加 started_at（machine-card import 它，CLAUDE.md 规则 20 类型同步强制，task-07） |
| 修改 | `backend/app/modules/daemon/tests/test_register_heartbeat_daemon.py` | 扩展 TestDaemonStartedAt：register new/else 落值 + heartbeat 幂等 + 旧 daemon None（task-06，6 用例） |
| 修改 | `backend/app/modules/daemon/tests/test_machines_router.py` | _create_instance helper 加 started_at + machines 返回非 null/旧 daemon None 用例（task-06，2 用例） |
| 新增 | `backend/app/modules/daemon/tests/test_daemon_started_at.py` | migration upgrade/downgrade/re-add 可逆（importlib+MigrationContext SQLite）+ revision chain guardrail（task-06，2 用例） |

## 7. 接口定义
- `RegisterBody` / `DaemonHeartbeatRequest`（router.py:203）加 `started_at: datetime | None`（ISO 8601，进程启动时间，恒定）。
- **`DaemonMachineRead`** 加 `started_at: datetime | None`（机器头消费，instance JOIN 带出；旧 daemon None）。
- `DaemonRuntimeRead` **不加**（§3 YAGNI，runtime 级不展示进程启动时间）。
- 端点路径 / 方法 / response_model 结构不变（machines 响应仅**加字段**，向后兼容）。

## 7.5 生命周期契约
**不涉及生命周期契约**（lifecycle contract: N/A）：本变更不改 daemon 的 register / heartbeat / session / lease / agent_run / state_transition 任一事件（仅 register/heartbeat body 加只读字段 `started_at`）。无新事件、无状态变化。

## 8. 数据模型
`DaemonInstance` 加 `started_at: datetime | None`（nullable；旧 daemon 不上报则 NULL）。Alembic migration `ALTER TABLE daemon_instances ADD COLUMN started_at DATETIME NULL`（Postgres 加 nullable 列不锁表）+ downgrade `drop_column`。`daemon_runtimes` 表**不加**（machines 端点 JOIN `daemon_instances` 带出，复用 daemon-version 变更已修好的 instance JOIN 链路）。

## 9. 兼容策略
- 项目未上线，不要求历史兼容（CLAUDE.md 规则 11）。
- 旧 daemon（不上报 `started_at`）：register/heartbeat body 字段 Optional（None），`instance.started_at` 为 NULL，`DaemonMachineRead.started_at` 返回 None，前端显示「—」或隐藏。行为不变。
- 不改变的 API 路径 / 方法 / 表结构（仅加 nullable 列 + body/response 加 Optional 字段）。

## 10. 风险登记
| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | Alembic migration 加列 | P2 | nullable 列 + ALTER TABLE（Postgres 不锁表）；项目未上线可重置；downgrade drop_column |
| R-02 | daemon 时钟不准（`Date.now`） | P2 | `started_at` 仅展示参考，不参与版本判断 / 调度；前端相对时间容错 |
| R-03 | `gen:types` 暴露旧测试债（mock 缺 `started_at`） | P2 | gen:types 后顺手补 mock 字段（CLAUDE.md 规则 20 惯例） |
| R-04 | heartbeat 幂等覆盖 `started_at` 误覆盖 | P2 | `started_at` 恒定（进程启动），幂等覆盖同值无副作用；daemon 重启新 `started_at`（新进程）合理 |
| R-05 | Daemon 构造签名加 `startedAt` 参数影响调用方 | P2 | cli.ts 单点调用 `new Daemon()`，影响面可控；plan 知会 |

## 11. 决策追踪
见 `decisions.md`：
- **D-001@v1** 方案 A（register+heartbeat 幂等 `started_at`）→ §5.A / §5.B（evidence 已修正为 cli.ts 入口取时）
- **D-002@v1** `started_at` 存 `daemon_instances`，仅 `DaemonMachineRead` 返回（runtime 不加）→ §5.B / §8

## 12. 自审
- [x] 必填章节齐全（背景 / 目标 / 非目标 / 总体方案 / 文件清单 / 接口 / 数据模型 / 兼容 / 风险）
- [x] 生命周期契约：命中 daemon 关键词，已写豁免短语「不涉及生命周期契约」（紧邻）
- [x] 文件清单含具体路径 + 操作类型（cli.ts / daemon.ts / hub-client / model / migration / schema / router / service / machine-card / api-types）
- [x] 决策有稳定 ID（D-001~D-002@v1），design 引用全部当前版本决策
- [x] 需求带 FR-01/02/03 编号
- [x] 兼容策略覆盖旧 daemon（None）+ migration（nullable + downgrade）
- [x] 数据模型说明 `DaemonInstance.started_at` + migration + machines JOIN（runtime 不加）
- [x] **Design Grill 修正**：cli.ts 入口取 startTime（非 daemon.ts:1808 circuit-breaker）；migration 路径 `migrations/versions/`；heartbeat request 在 router.py:203；DTO 用 `DaemonMachineRead`（非 Instance/Runtime Read，YAGNI 砍 RuntimeRead）；前端 machine-card.tsx + formatRelativeTime。已消除初稿存疑点。
