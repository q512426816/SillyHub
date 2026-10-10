---
author: flow-machine-draft
created_at: 2026-10-10T00:34:34.662Z
---
# 需求规格（Requirements）— 2026-10-10-recheck-lease-freshness

## 功能需求

### FR-01: _run_daemon_alive 实例 online 分支必须叠加最新 lease 续约新鲜度核验：lease updated_at 停滞超宽限窗（STALE_RUN_ACTIVE_GRACE）→ 返回 False（实例活着但已放弃此 run），fall through 判死出列

- daemon 实例 status=online 时，活性门必须继续核验该 run 最新 lease 的续约新鲜度：`now - lease.updated_at > STALE_RUN_ACTIVE_GRACE` 时必须返回 False（daemon 重启丢态后不再为旧 run 续约的永卡形态）；续约新鲜（宽限窗内）必须返回 True（健康静默轮放行）。禁止只看实例 online 即豁免。

#### 场景：主路径

Given run running + 日志停滞超宽限窗 + 实例 online（心跳 1min 前）+ lease updated_at 停滞 1h / When 复扫单轮 / Then run 判死出列（failed / SERVICE_RESTART_INTERRUPTED / exit_code=-1）。
Given 同上但 lease updated_at 5s 前（续约中）/ When 复扫单轮 / Then 保持追踪不判死。

### FR-02: 健康 run（日志停滞但 lease 续约新鲜，如等用户应答/长工具调用）必须保持不判死；daemon 确死/链路不可解析语义不变

- 三类既有语义必须零回归：①实例 offline + 心跳停滞 → False 判死；②链路不可解析（无 lease/runtime/实例）→ None 退回 recency 判死；③实例 last_heartbeat_at 为 None → 保守 True（patrol 同款跳过，不引入 lease 核验）。

#### 场景：主路径

Given 既有 8 用例形态（含 fixture 对齐真实续约时序后的 pardons 用例）/ When 复跑 / Then 全绿。

### FR-03: 新增用例先红后绿：实例 online+心跳新鲜+lease updated_at 停滞 1h → 判死 failed/SERVICE_RESTART_INTERRUPTED；既有 pardons 用例 fixture 对齐真实续约时序（lease 新鲜）零回归

- 测试必须新增「实例在线但 lease 续约停滞」判死用例（实现前红：原实现豁免保持追踪）；fixture `_make_daemon_chain` 必须暴露 `lease_updated_age` 参数（默认 5s 新鲜，对齐 daemon lease_heartbeat_interval 真实时序）；全部用例实现后必须绿。

#### 场景：主路径

Given 未加核验的旧实现 / When 跑新用例 / Then 红（still == {run.id} 保持追踪）。
Given 加核验后 / When 全文件复跑 / Then 9/9 绿（相关面 liveness 合跑 13/13 绿）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_kills_run_with_online_daemon_but_stale_lease」
FR-02: backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_pardons_run_with_online_daemon」+「test_recheck_kills_silent_run_with_dead_daemon」+「test_recheck_unresolvable_daemon_falls_back_to_recency」（零回归，实测 9 passed 2026-10-10 08:38）
FR-03: backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_kills_run_with_online_daemon_but_stale_lease」（先红 1 failed 实证于 2026-10-10 08:36 运行，后绿 9/9 实证于 08:38 运行；相关面 test_stale_run_cleanup_liveness 合跑 13/13）
