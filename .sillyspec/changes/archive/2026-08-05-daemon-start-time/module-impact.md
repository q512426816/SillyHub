---
author: WhaleFall
created_at: 2026-08-05 13:35:42
---

# 模块影响分析（Module Impact）— daemon 启动时间字段 started_at

## 概述
本变更新增 daemon 进程启动时间字段 `started_at`，贯穿 daemon 上报（sillyhub-daemon）→ backend 存储（daemon_instances + Alembic migration）→ 前端显示（machine-card）三端。共 16 个源码/测试/生成文件改动，映射到 3 个模块（daemon / frontend_components / frontend_lib）。以 git diff 为准（真实 > 声明）。

## 三重交叉验证
- **声明范围**（design.md §6 文件变更清单）：cli.ts / daemon.ts / hub-client.ts / model.py / migration / schema.py / router.py / runtime/service.py / facade service.py / machine-card.tsx / api-types.ts / openapi.json / daemon.ts(lib) / 3 测试文件
- **任务范围**（plan.md + tasks/task-NN.md allowed_paths）：与声明一致（task-01~07 覆盖）
- **真实变更**（git diff --name-only HEAD）：16 文件，与声明完全一致
- 结论：三重一致，无遗漏/超范围

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| daemon（backend） | 数据结构变更 + 接口变更 + 逻辑变更 + 配置变更 | `backend/app/modules/daemon/model.py`（DaemonInstance.started_at nullable datetime）、`schema.py`（DaemonRegisterRequest + DaemonMachineRead 加 started_at）、`router.py`（DaemonHeartbeatRequest 加 started_at + _build_machine_read 填 + endpoint 透传）、`runtime/service.py`（RuntimeService register/heartbeat 写 instance.started_at 幂等）、`service.py`（facade DaemonService 透传 started_at 到 self._rt）、`migrations/versions/20260805110000_daemon_started_at.py`（add_column/drop_column）、`tests/test_register_heartbeat_daemon.py` + `test_machines_router.py` + `test_daemon_started_at.py`（10 用例）、`backend/openapi.json`（dump 重新生成） | daemon_instances 加 started_at 列（migration）+ register/heartbeat 上报链路（三层透传 router→facade→runtime）+ machines 端点 JOIN 返回 + 单测覆盖 | false |
| daemon（sillyhub-daemon） | 接口变更 + 逻辑变更 | `sillyhub-daemon/src/cli.ts`（startAction 入口取 processStartTime=Date.now() 注入 new Daemon options.startedAt）、`daemon.ts`（DaemonOptions 加 startedAt + _startedAt field + 构造存 + ClientLike 鸭子接口同步 register params/heartbeat 第 3 参 + _registerDaemon/heartbeat 调用传 startedAt）、`hub-client.ts`（RegisterBody/HeartbeatBody 加 started_at + register/heartbeat 接 startedAt 填 ISO） | daemon 进程入口取启动时间，register/heartbeat 上报 started_at（ISO），null 兼容旧 daemon | false |
| frontend_components | 逻辑变更 | `frontend/src/components/daemon/machine-card.tsx`（机器头 meta 区加「启动」展示，非 null 复用 formatRelativeTime 相对时间 + 绝对 tooltip，null 显「—」） | /runtimes 机器头显示 daemon 进程启动时间（FR-03） | false |
| frontend_lib | 接口变更 | `frontend/src/lib/api-types.ts`（pnpm gen:types 重新生成，DaemonMachineRead.started_at）、`frontend/src/lib/daemon.ts`（手写聚合 DaemonMachineRead 加 started_at，machine-card import 它，规则 20 类型同步） | 前端类型从 OpenAPI 生成 + 手写聚合 DTO 同步 started_at | false |

## 未匹配文件
无。16 个 git diff 文件全部映射到模块（daemon / frontend_components / frontend_lib）。

## 备注
- daemon 模块跨 backend（daemon 模块）+ sillyhub-daemon（Node 进程）两个实现，_module-map.yaml 的 daemon 模块 paths 同时覆盖 `backend/app/modules/daemon/**` + `sillyhub-daemon/src/**`
- backend/openapi.json 是 gen:types 产物（uv run dump_openapi.py），归 daemon 模块（schema 改动驱动）
- frontend/src/lib/daemon.ts 超 task-07 allowed_paths（machine-card import 手写聚合 DTO，CLAUDE.md 规则 20 类型同步强制，非越权）
- 三层透传链 router→facade DaemonService→runtime RuntimeService 是符号影响面检查（execute Step 2）补的，plan 阶段漏标 facade service.py
