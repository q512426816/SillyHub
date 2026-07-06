---
plan_level: medium
author: WhaleFall
created_at: 2026-07-06T11:40:00
change: 2026-07-06-allowed-roots-per-runtime
stage: plan
---

# Plan: allowed_roots per-runtime 隔离恢复

## 概述

DaemonRuntime 加回 allowed_roots 列（per-runtime），instance 保留作机器级 default，全链路（register/心跳/WS/PUT）per-runtime，CC/Hermes 互不影响。前端无改。schema breaking（心跳响应改 map + register 加字段），backend + daemon 同步部署（D-006）。

## Wave 分组

| Wave | 主题 | Tasks | 依赖 |
|---|---|---|---|
| 1 | 数据基础 | task-01 | 无 |
| 2 | backend 读写 runtime 级 | task-02, task-03, task-04, task-05, task-06 | Wave 1（task-06 还依赖 task-03） |
| 3 | daemon 适配新协议 | task-07 | Wave 2（task-02 + task-05 协议） |
| 4 | 测试 | task-08, task-09 | Wave 2 + Wave 3 |
| 5 | 端到端 | task-10 | 全部 |

## Task 清单

### task-01 数据模型 + 迁移
- **allowed_paths**: `backend/app/modules/daemon/model.py`, `backend/migrations/versions/20260706_runtime_allowed_roots.py`
- **依赖**: 无
- **覆盖**: FR-01, D-002
- **验收**: DaemonRuntime.allowed_roots 列存在（JSON）；迁移加列 + copy instance→runtime 成功；DB runtime 行有 allowed_roots 值；alembic upgrade head 无 multiple heads

### task-02 register copy default + 响应带 allowed_roots
- **allowed_paths**: `backend/app/modules/daemon/runtime/service.py`, `backend/app/modules/daemon/schema.py`
- **依赖**: task-01
- **覆盖**: FR-02, FR-07, D-003
- **验收**: 新建 runtime copy instance.allowed_roots → runtime.allowed_roots（已存在 runtime 不覆盖）；DaemonRegisterResponse.runtimes[].allowed_roots 返回 runtime 值

### task-03 update_allowed_roots 写 runtime 级
- **allowed_paths**: `backend/app/modules/daemon/runtime/service.py`
- **依赖**: task-01
- **覆盖**: FR-01, D-002
- **验收**: PUT update_allowed_roots 写 daemon_runtimes.allowed_roots（不写 instance）；DB 仅目标 runtime 行变

### task-04 _runtime_read 读 runtime 级 + 回退 ql-003
- **allowed_paths**: `backend/app/modules/daemon/router.py`
- **依赖**: task-01
- **覆盖**: FR-01
- **验收**: _runtime_read 读 runtime.allowed_roots（model_validate 直接命中列）；删除 ql-20260706-003 加的 instance 兜底填充行；list/GET 返回真实 runtime 值

### task-05 心跳响应改 per-runtime map
- **allowed_paths**: `backend/app/modules/daemon/router.py`, `backend/app/modules/daemon/schema.py`
- **依赖**: task-01
- **覆盖**: FR-05
- **验收**: DaemonHeartbeatResponse 改 `runtimes: list[DaemonHeartbeatRuntimePolicy]`（替代 allowed_roots: list[str]）；heartbeat 端点返该 daemon 下所有 runtime 的 allowed_roots map

### task-06 WS push roots 来源改 runtime
- **allowed_paths**: `backend/app/modules/daemon/router.py`
- **依赖**: task-03
- **覆盖**: FR-04
- **验收**: PUT 后 send_policy_update(daemon_id, runtime.allowed_roots, payload_runtime_id=rid)（roots 从 instance 改 runtime）；WS 仅 push 被 PUT 的 runtime

### task-07 daemon _syncAllowedRoots per-runtime + register 初始化 PolicyCache
- **allowed_paths**: `sillyhub-daemon/src/daemon.ts`
- **依赖**: task-02, task-05（协议格式）
- **覆盖**: FR-05, FR-07
- **验收**: _syncAllowedRoots 从 hbResp.runtimes map 同步 PolicyCache.set(runtime_id, roots)（兼容旧单值 allowed_roots 过渡）；register 响应处理 runtimes[].allowed_roots 初始化 PolicyCache（消除首次写窗口）

### task-08 backend 测试
- **allowed_paths**: `backend/app/modules/daemon/tests/`
- **依赖**: task-02~task-06
- **覆盖**: FR-01~FR-07
- **验收**: register copy default（新建继承 + 已存在不覆盖）/ update 写 runtime（CC 变 Hermes 不变）/ 心跳 map 响应 / _runtime_read 读 runtime / 空 allowed_roots fail-closed 全过；ruff + mypy 通过

### task-09 daemon 测试
- **allowed_paths**: `sillyhub-daemon/tests/`
- **依赖**: task-07
- **覆盖**: FR-05, FR-07
- **验收**: _syncAllowedRoots per-runtime（runtimes map 同步各 PolicyCache）/ register 响应初始化 PolicyCache / 兼容旧单值 全过；vitest + tsc 通过

### task-10 端到端验证
- **allowed_paths**: （无代码，真机 + DB 验证脚本）
- **依赖**: task-01~task-09
- **覆盖**: 全 FR
- **验收**: 配 CC 可写目录 Hermes 不变（DB + PolicyCache）/ 删 CC 某目录 Hermes 不变 / 新 daemon 注册 runtime 继承 default / WS sub-second 下发 per-runtime / 审计页 CC 记录按独立配置

## 部署策略（D-006 breaking 同步）

- Wave 2 + Wave 3 全部完成后，backend 镜像 + daemon bundle 一起 build + 同步重启（D-006）
- 迁移 task-01 在 backend 启动时 alembic upgrade head 执行
- 旧 daemon 连新 backend：心跳/register 解析新 map 格式失败 → 要求同步升级（daemon-entity-binding D-007 机制）
- 部署顺序：build backend → build daemon bundle → stop daemon → up backend（跑迁移）→ start daemon（新 bundle）

## 风险

- **schema breaking 同步部署**（D-006）：backend + daemon 必须同步，否则协议不匹配
- **迁移 copy**（task-01）：一次性，项目可重置测试数据
- **ql-003 回退**（task-04）：删除 ql-20260706-003 的 instance 填充行，改读 runtime 级
- **alembic multiple heads**（task-01）：加迁移时注意 merge heads（避免 ql-20260706-002 同款 crash loop）

## 自检

- Wave 分组按依赖顺序（数据基础 → backend 读写 → daemon 适配 → 测试 → e2e）✅
- task 粒度均匀（每 task 1-2 文件，单一职责）✅
- 依赖明确（task-06→task-03，task-07→task-02+task-05，测试→实现）✅
- allowed_paths 明确（每 task 列文件）✅
- 验收可测（每 task 具体检查点）✅
- 部署策略（breaking 同步）✅
- 风险识别（breaking + 迁移 + ql-003 回退 + alembic heads）✅
- 入口文件：design 未提 cli.ts/main.ts 入口改动（daemon 改 daemon.ts 内部函数，非入口签名；backend 改 router/service 内部，非 main.py 入口）→ 无入口接线问题 ✅
