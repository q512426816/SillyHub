---
author: WhaleFall
created_at: 2026-08-05 10:25:00
---

# 任务清单（Tasks）

> 仅列任务名与要点，细节在 plan 阶段（Wave 分组 + 依赖）展开。

## A. daemon 取时与上报（sillyhub-daemon）
- [ ] task-01: `cli.ts` 入口取 `processStartTime = Date.now()` + 注入 `Daemon` 构造参数 `_startedAt`（daemon.ts）；register/heartbeat 传 hub-client
- [ ] task-02: `hub-client.ts` RegisterBody/HeartbeatBody 加 `started_at` + register/heartbeat 接 startedAt 填 ISO（depends: task-01）

## B. backend 存储 + 返回
- [ ] task-03: `model.py` DaemonInstance.started_at（nullable）+ Alembic migration `migrations/versions/<rev>_daemon_started_at.py`（add_column + downgrade drop_column）
- [ ] task-04: `schema.py` DaemonRegisterRequest + DaemonMachineRead 加 started_at；`router.py` DaemonHeartbeatRequest 加 started_at + `_build_machine_read` 填（depends: task-03）
- [ ] task-05: `runtime/service.py` register/heartbeat 写 instance.started_at（幂等）（depends: task-03, task-04）
- [ ] task-06: 测试 — register/heartbeat 后 GET machines 返回 started_at 非 null + 旧 daemon None 兼容（depends: task-04, task-05）

## C. 前端
- [ ] task-07: `pnpm gen:types` + `machine-card.tsx` 显示 started_at（复用 formatRelativeTime + 绝对 tooltip）（depends: task-04 后端 schema 定）

## D. 验证
- [ ] task-08: 端到端 — 重启 daemon + GET machines 看 started_at 接近重启时间 + 前端机器头显示（depends: task-01~07）
