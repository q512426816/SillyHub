---
plan_level: full
author: WhaleFall
created_at: 2026-08-05 10:38:07
---

# 实现计划（Plan）— daemon 启动时间字段

> 复杂度分类：`plan_level: full`（跨 daemon(Node) + backend(Python) + 前端 3 端/3 模块，CLI 入口取时 + 平台 schema/migration + 前端显示联动，10 文件，8 task，含 DB schema 变更）。技术方案明确（Design Grill 已消除存疑点：cli.ts 入口取时非 daemon.ts:1808 circuit-breaker；migration 路径 `migrations/versions/`；DTO 用 `DaemonMachineRead`，runtime 不加），**无 Spike 前置**。

## Spike 前置验证
无。技术方案确定性高（仿 daemon-version 变更已修好的 instance JOIN 链路 + 既有 formatRelativeTime），无不经验证的技术不确定性。

## 依赖方向修正（相对 tasks.md 草案）
tasks.md 草案标注「task-02 depends task-01」，但技术上 `daemon.ts` 调 `hubClient.register({ startedAt })` 要求 hub-client 先接受参数（`RegisterBody.started_at` / `register()` 签名）。故 plan 修正为 **task-01 depends_on task-02**（hub-client 接口先行，cli.ts/daemon.ts 调用随后）。其余依赖不变。

## Wave 1（并行，无依赖）
- [x] task-02: hub-client.ts `RegisterBody`/`HeartbeatBody` 加 `started_at: string | null`；`register`/`heartbeat` 接 `startedAt` 参数填 `new Date(startedAt).toISOString()`（覆盖：FR-01, D-001@v1）
- [x] task-03: `model.py` `DaemonInstance.started_at: datetime | None`（nullable）+ Alembic migration `migrations/versions/<rev>_daemon_started_at.py`（add_column NULL + downgrade drop_column）（覆盖：FR-02, D-002@v1）

## Wave 2（依赖 Wave 1，并行）
- [x] task-01: `cli.ts` 入口取 `processStartTime = Date.now()`（`:513` echo 启动信息附近 / `:757 new Daemon()` 前）注入 `new Daemon({ ..., startedAt })`；`daemon.ts` 加 `_startedAt` field（构造参数），register/heartbeat 调 hub-client 传 `startedAt`（depends: task-02）（覆盖：FR-01, D-001@v1）
- [x] task-04: `schema.py` `DaemonRegisterRequest`（`:112`）+ `DaemonMachineRead`（`:283`）加 `started_at`；`router.py` `DaemonHeartbeatRequest`（`:203`）加 `started_at` + `_build_machine_read`（`:466-502`）从 instance JOIN 填（`_runtime_read` 不加，§3 YAGNI）（depends: task-03）（覆盖：FR-02, D-002@v1）

## Wave 3（依赖 Wave 2，并行）
- [x] task-05: `runtime/service.py` register（`:194-195`）+ heartbeat（`:349-352`）写 `instance.started_at = started_at`（幂等覆盖，恒定值无副作用）（depends: task-03, task-04）（覆盖：FR-02, D-001@v1）
- [x] task-07: `pnpm gen:types`（刷新 `frontend/src/lib/api-types.ts` + `backend/openapi.json`，CLAUDE.md 规则 20）+ `machine-card.tsx` 显示 `started_at`（复用 `formatRelativeTime` + 绝对 tooltip，None 显示「—」）；gen:types 暴露的旧 mock 测试债顺手补字段（depends: task-04）（覆盖：FR-03）

## Wave 4（依赖 Wave 3）
- [x] task-06: 后端测试 — register/heartbeat 后 `GET /api/daemon/machines` 返回 `started_at` 非 null（新 daemon）+ 旧 daemon 不上报则 None 兼容 + migration upgrade/downgrade 各一次（depends: task-04, task-05）

## Wave 5（依赖 Wave 1~4）
- [x] task-08: 端到端 — 重启 daemon + `GET machines` 看 `started_at` 接近重启时间 + 前端机器头显示相对/绝对时间（depends: task-01~07）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 涉及文件 |
|---|---|---|---|---|---|---|
| task-01 | cli.ts 取 processStartTime + daemon.ts `_startedAt` + 调 hub-client 传 startedAt | W2 | P0 | task-02 | FR-01, D-001@v1 | `sillyhub-daemon/src/cli.ts`, `sillyhub-daemon/src/daemon.ts` |
| task-02 | hub-client.ts RegisterBody/HeartbeatBody 加 started_at + register/heartbeat 接 startedAt 填 ISO | W1 | P0 | — | FR-01, D-001@v1 | `sillyhub-daemon/src/hub-client.ts` |
| task-03 | model.py DaemonInstance.started_at（nullable）+ Alembic migration add_column/drop_column | W1 | P0 | — | FR-02, D-002@v1 | `backend/app/modules/daemon/model.py`, `backend/migrations/versions/<rev>_daemon_started_at.py`（新增） |
| task-04 | schema.py DaemonRegisterRequest + DaemonMachineRead 加 started_at；router.py DaemonHeartbeatRequest + `_build_machine_read` 填 | W2 | P0 | task-03 | FR-02, D-002@v1 | `backend/app/modules/daemon/schema.py`, `backend/app/modules/daemon/router.py` |
| task-05 | runtime/service.py register/heartbeat 写 instance.started_at（幂等） | W3 | P0 | task-03, task-04 | FR-02, D-001@v1 | `backend/app/modules/daemon/runtime/service.py` |
| task-06 | 后端测试：machines 返回 started_at 非 null + 旧 daemon None 兼容 + migration up/down | W4 | P0 | task-04, task-05 | FR-02 验收 | `backend/app/modules/daemon/tests/`（或 `runtime/tests/`） |
| task-07 | pnpm gen:types + machine-card.tsx 显示 started_at（formatRelativeTime + 绝对 tooltip） | W3 | P0 | task-04 | FR-03 | `frontend/src/lib/api-types.ts`（重新生成）, `frontend/src/components/daemon/machine-card.tsx` |
| task-08 | 端到端：重启 daemon + machines 看 started_at 接近重启时间 + 前端机器头显示 | W5 | P1 | task-01~07 | FR-01/02/03 验收 | —（人工/集成验证） |

## 关键路径
task-03 → task-04 → task-05 → task-06 → task-08（后端存储→返回→写入→测试→端到端，5 Wave 最长链，决定最短交付周期）。daemon 链（task-02 → task-01 → task-08）与前端链（task-04 → task-07 → task-08）均短于关键路径，可在 W1/W2/W3 并行收敛。

## 全局验收标准
- [ ] 后端 daemon 模块单测通过（`cd backend && pytest app/modules/daemon`）
- [ ] Alembic migration `upgrade head` + `downgrade -1` 各一次成功（nullable 列，Postgres 不锁表）
- [ ] 前端 `pnpm gen:types` 后 `gen:types:check`（`git diff --exit-code`）干净，无类型漂移
- [ ] 前端 `pnpm build` / typecheck 通过
- [ ] daemon vitest 通过（若 hub-client/daemon 有相关测试）
- [ ] 旧 daemon 兼容：不上报 `started_at` 时 machines 返回 null、前端显示「—」，行为不变
- [ ] 新 daemon：register+heartbeat 上报 `started_at`，`GET /api/daemon/machines` 返回非 null（接近进程启动时间）
- [ ] gen:types 暴露的无关旧 mock 测试债顺手补字段（CLAUDE.md 规则 20 惯例，不为躲报错改回手写）
- [ ] 不改 daemon 生命周期 / `daemon_runtimes` 表 / `DaemonRuntimeRead`（§3 非目标边界）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-01, task-05 | register + heartbeat 幂等上报 started_at（hub-client 加字段 → cli.ts/daemon.ts 取时传入 → service 写 instance） |
| D-002@v1 | task-03, task-04 | started_at 存 `daemon_instances`（instance 级）+ 仅 `DaemonMachineRead` 返回（runtime 不加，machines 端点 JOIN 带出） |
