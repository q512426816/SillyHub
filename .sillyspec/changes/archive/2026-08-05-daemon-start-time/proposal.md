---
author: WhaleFall
created_at: 2026-08-05 10:25:00
---

# 提案书（Proposal）

## 动机
/runtimes 机器列表无法确定 daemon 进程**何时启动**（只有 `last_heartbeat_at` / `status`），排障/审计时不知道 daemon 跑了多久、是否半夜重启过。

## 关键问题
1. daemon 进程启动时间**未记录上报**（`cli.ts` 入口没取 `Date.now()`）。
2. backend `daemon_instances` 无 `started_at` 字段（`created_at` 是 instance 行创建时间 ≠ 进程启动）。
3. 前端机器头无启动时间显示。

## 变更范围
- **A. daemon**：`cli.ts` 入口取 `processStartTime` → Daemon `_startedAt` field → `hub-client` register/heartbeat 上报 `started_at`。
- **B. backend**：`daemon_instances` 加 `started_at`（Alembic migration）+ register/heartbeat 写 + machines 端点 `DaemonMachineRead` 返回。
- **C. 前端**：`machine-card.tsx` 显示 `started_at`（复用 `formatRelativeTime`）+ `pnpm gen:types`。

## 不在范围内（显式清单）
- 不改 daemon 生命周期 / `daemon_runtimes` 表 / `DaemonRuntimeRead`（不加 started_at，YAGNI）。
- 不动 `BUILD_ID` / `daemon_version`。
- 不算 uptime（前端 `now - started_at` 推导，不入库）。

## 成功标准（可验证）
- daemon register+heartbeat 上报 `started_at`（进程启动 ISO 时间）。
- `GET /api/daemon/machines` 返回 `started_at`（非 null，新 daemon）。
- 前端机器头显示启动时间（相对 + 绝对）。
- 旧 daemon 兼容（`started_at` None）。
- migration 可 up/down。
