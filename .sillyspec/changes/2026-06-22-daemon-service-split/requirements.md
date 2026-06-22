---
author: qinyi
created_at: 2026-06-22T10:10:00+08:00
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 后端开发者 | 实施拆分（文件移动 + facade + import 整理） |
| Code Reviewer | 验收行为不变（router diff / 全测 / 契约对比） |
| daemon/agent 模块维护者 | 受影响方，依赖 facade 兼容保证零感知 |
| 平台用户 | 间接受益（行为不变，无感知） |

## 功能需求

### FR-01: DaemonService facade 兼容，router.py 零改动
覆盖决策：D-002@v1

Given `router.py` 的端点以 `svc = DaemonService(session)` 实例化并调用 `DaemonService` 的方法
When 拆分完成，`DaemonService` 退化为持有 5 子 service 引用的 facade
Then `git diff backend/app/modules/daemon/router.py` 为空

Given 任一 daemon HTTP/WS 端点
When 拆分前后分别调用
Then HTTP 状态码、响应体、副作用（DB 写入 / Redis 事件 / audit log）逐位一致

### FR-02: 51 方法按子域归位，5 子包分层
覆盖决策：D-001@v1, D-004@v1

Given `DaemonService` 含 51 个方法，分布于 runtime/lease/run_sync/session/patch 五类（按操作主对象）
When 按 design §6 文件变更清单归位
Then 每个方法存在于对应子域 `service.py`（RuntimeService/LeaseService/RunSyncService/SessionService/PatchService）；`DaemonService` 同名方法改为委托；51 方法无遗漏

Given 私有辅助方法（`_get_owned_*`/`_converge_*`/`_build_claim_payload` 等）
When 归位
Then 随其主方法所在子域迁移（design §6 清单已列全）

Given 子域拆分后
When 统计各子域 service.py 行数
Then 最大子域（session/service.py）≤ 1500 行

### FR-03: DaemonLeaseService 原位保留，agent 跨模块调用不破
覆盖决策：D-003@v1

Given `agent/service.py:545` 执行 `from app.modules.daemon.lease_service import DaemonLeaseService` 并调用 `.cancel_lease(run_id)`
When 拆分完成
Then import 成功；`cancel_lease` 行为不变；`lease_service.py` 文件未被移动/重命名/删除

Given `DaemonService.lease_*`（create/claim/start/heartbeat/complete/expire）
When 迁移
Then 迁入新 `lease/service.py`（LeaseService），与 `DaemonLeaseService` 并存且互不影响

### FR-04: 生命周期契约不变（行为不变）
覆盖决策：D-001@v1

Given runtime/lease/agent_run/session 四对象的现有状态机、事件、字段定义（见 design §7.5 生命周期契约表）
When 拆分完成
Then 状态转移、触发条件、关键字段、活动态/终态定义全部不变

Given daemon 模块测试套件（`test_session_recovery` 16 用例、`test_lease_service`、`test_run_input_service` 等）
When 拆分后运行
Then 全部通过（无逻辑变更导致的行为偏差）

### FR-05: 异常类 re-export，import 路径兼容
覆盖决策：D-002@v1

Given `router.py:55` 的 `from app.modules.daemon.service import (DaemonLeaseNotFound, DaemonRpcForbiddenError, DaemonRpcGatewayError, DaemonRpcRemoteError, DaemonRpcRemoteGatewayError, DaemonRpcTimeout, DaemonRuntimeNotFound, DaemonRuntimeOffline, DaemonService, DaemonSessionNotFound)`
When 异常类定义迁入各子包
Then facade `service.py` 集中 re-export 全部上述符号；import 路径不变；router 零改动

Given 其他调用方 `from app.modules.daemon.service import XxxError`
When execute 阶段以 `grep -rn "from app.modules.daemon.service import"` 全量收集
Then 所有被引用符号均在 facade re-export 清单内

## 非功能需求

- **兼容性**：router.py / agent 模块 / 所有 `from app.modules.daemon.service import` 调用方零改动（D-002/D-003）。
- **可回退**：6 个 Wave 独立提交；任意 Wave 可 `git revert` 而不破坏 facade 契约（W1 后 facade 始终有效）。
- **可测试**：daemon 全测 + backend mypy + ruff 全过；`router.py` git diff 为空作机器可验证铁证。
- **性能**：facade 委托引入一层函数调用，开销可忽略（无 IO/序列化额外开销）。
- **协调性**：先于 `fix-interactive-lifecycle` W4 执行（design §10 R3）；W4 plan 需更新方法定位到新子包。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-04 | 方向 A（就地拆子包），不抽顶层 session；生命周期契约不变 |
| D-002@v1 | FR-01, FR-05 | facade 完全兼容，router 零改动，异常类 re-export |
| D-003@v1 | FR-03 | DaemonLeaseService 原位保留（独立活 service），仅迁 DaemonService.lease_* |
| D-004@v1 | FR-02 | 方案 A 5 子域标准粒度，session 不细分 |
