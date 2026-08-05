---
author: qinyi
created_at: 2026-08-05 19:19:24
plan_level: full
---

# 实现计划（Plan）— daemon kill 通道统一

## Spike 前置验证

无新增 Spike。关键技术不确定性已在前置 explore + spike 验证（SDK `query.close()` kill 链 `sdk.mjs:60` / Codex `_close` 经 `state.driverHandle` 可达 `session-manager.ts:919` / budget 累计器现状），均经源码核实。

## Wave 1（并行，无依赖，止血 P0 启动）

- [x] task-01: Claude close 契约 + session-manager `_terminateSession`（覆盖：FR-01, FR-02, FR-06, D-001@v2, D-003, D-004）
- [x] task-04: LEASE_CANCEL 双端协议 + daemon handler（覆盖：FR-03, R-06）
- [x] task-07: budget backend 下发 + gen:types（覆盖：FR-05, D-005, D-009）
- [x] task-10: terminating_at model + Alembic migration（覆盖：FR-04, R-05）

## Wave 2（依赖 Wave 1）

- [x] task-02: cancel_lease 对 interactive 改发 SESSION_END（覆盖：FR-09, D-001@v2, XC-01）
- [x] task-05: backend cancel_lease 对 batch 发 LEASE_CANCEL（覆盖：FR-03）
- [x] task-08: daemon budget 累计 + 软切断检查点（覆盖：FR-05, D-006, D-009）
- [x] task-13: 前端 terminating 态显示（覆盖：FR-04 展示, R-08）

## Wave 3（依赖 Wave 2）

- [x] task-03: Phase1 测试（end/fail→close、interrupt 不→close、cancel→END 集成）
- [x] task-06: Phase2 测试（LEASE_CANCEL 收发、双触发幂等）
- [x] task-09: Phase3 测试（超 budget 软切断、input+output 口径、None 短路）
- [x] task-11: terminating_at 写/清 + sweeper（覆盖：FR-04, D-007, XC-03/04/08）

## Wave 4（依赖 Wave 3）

- [x] task-12: Phase4 测试（terminating_at 写仅 cancel/清、sweeper 超时告警、end_session 不写）
- [x] task-15: Windows 强制验收（R-04 mcpServers 孙进程残留检查）

## Wave 5（收尾）

- [x] task-14: 文档同步（CONCERNS.md / protocol 双端消息表 / QUICKLOG）（覆盖：FR-08）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | Claude close + `_terminateSession` | W1 | P0 | — | FR-01/02/06, D-001@v2/D-003/D-004 | claude-sdk-driver close + session-manager `_terminateSession`；end/fail 改调；interrupt 不动 |
| task-02 | cancel_lease 改发 SESSION_END | W2 | P0 | task-01 | FR-09, D-001@v2/XC-01 | backend lease_service 对 interactive 改发 END |
| task-03 | Phase1 测试 | W3 | P0 | task-01,02 | FR-01/02/09 | mock driver/SDK + cancel→END 集成 |
| task-04 | LEASE_CANCEL 协议 + daemon handler | W1 | P1 | — | FR-03, R-06 | 双端 protocol + daemon.ts case → taskRunner.cancel |
| task-05 | cancel_lease batch 发 LEASE_CANCEL | W2 | P1 | task-04 | FR-03 | backend lease_service 对 batch 发 |
| task-06 | Phase2 测试 | W3 | P1 | task-04,05 | FR-03 | 收发 + 双触发幂等 |
| task-07 | budget backend 下发 + gen:types | W1 | P1 | — | FR-05, D-005/D-009 | LeaseCtx budget_tokens + execution dispatch |
| task-08 | daemon budget 累计 + 检查点 | W2 | P1 | task-07 | FR-05, D-006/D-009 | task-runner 新增累计器 + 软切断 |
| task-09 | Phase3 测试 | W3 | P1 | task-07,08 | FR-05 | 口径 / 软切断 / None 短路 |
| task-10 | terminating_at model + migration | W1 | P1 | — | FR-04, R-05 | DaemonTaskLease + Alembic |
| task-11 | terminating_at 写/清 + sweeper | W3 | P1 | task-10,02,05 | FR-04, D-007, XC-03/04/08 | 仅 cancel 写；sweeper 独立查询 |
| task-12 | Phase4 测试 | W4 | P1 | task-10,11 | FR-04 | 写 / 清 / 告警 |
| task-13 | 前端 terminating 态 | W2 | P2 | task-10 | FR-04 展示, R-08 | "终止中…" + 两按钮文案 |
| task-14 | 文档同步 | W5 | P2 | all | FR-08 | CONCERNS / protocol 表 / QUICKLOG |
| task-15 | Windows 强制验收 | W4 | P0 | task-01,03 | FR-06, R-04 | mcpServers 孙进程残留 |

## 关键路径

task-01 → task-02 → task-11 → task-12（terminating_at 全链，最深 4 Wave，决定交付周期）。次关键：task-01 → task-03 → task-15（Windows P0 验收）；task-07 → task-08 → task-09（budget 链）。

## 全局验收标准

- [ ] daemon 测试全绿（排除 local.yaml 所列 3 flaky 文件，按 maxForks=1 独跑）；backend daemon/agent 子模块测试全绿
- [ ] gen:types 无漂移（`git diff --exit-code` 双端 api-types.ts + openapi.json）
- [ ] Windows + 注入 mcpServers 场景 kill 后无孙进程残留（R-04 强制，task-15）
- [ ] brownfield：无 budget / 无 close 的旧路径行为不变（FR-07）
- [ ] P0：Claude/Codex interactive END/cancel + batch cancel 在卡死 turn 场景下 ≤10s 终止子进程
- [ ] grep daemon 代码无 `taskkill /IM`（D-004）

## 覆盖矩阵（decisions.md / requirements.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-01, task-02, task-03 | AC: interrupt 不 close + cancel→END 硬杀 |
| D-002@v1 | 全局（不动 binding） | AC: 文件清单无 binding 文件 |
| D-003@v1 | task-01 | AC: Claude close = query.close |
| D-004@v1 | task-01, task-15 | AC: 无 taskkill + Windows 验收 |
| D-005@v1 | task-07, task-08 | AC: budget 下发 + 检查点 |
| D-006@v1 | task-08 | AC: 软切断不调 close |
| D-007@v1 | task-10, task-11 | AC: 无 outbox，sweeper 独立查询 |
| D-009@v1 | task-07, task-08, task-09 | AC: input+output per-run 口径 |

| FR | 覆盖任务 |
|---|---|
| FR-01 | task-01, task-03 |
| FR-02 | task-01, task-03 |
| FR-03 | task-04, task-05, task-06 |
| FR-04 | task-10, task-11, task-12, task-13 |
| FR-05 | task-07, task-08, task-09 |
| FR-06 | task-01, task-15 |
| FR-07 | 全局验收 |
| FR-08 | task-14 |
| FR-09 | task-02, task-03 |
