---
author: flow-machine-draft
created_at: 2026-10-10T00:34:34.662Z
---
# 设计记录（Design Record）— 2026-10-10-recheck-lease-freshness

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查发现复扫链 daemon 活性门只看实例 online 即豁免判死——daemon 进程重启丢失 run 执行状态但实例重新上线时，日志停滞+实例在线 → run 永卡 running、复扫链永驻空转（patrol 对 online 实例同样豁免，无第二兜底）。关键事实：健康 run 的 lease 由 daemon 每 lease_heartbeat_interval（默认 5s）续约刷新 `updated_at`（lease/service.py lease_heartbeat → task-runner.ts 每 5s 调用），daemon 重启丢态后不再为旧 run 续约。方案：`_run_daemon_alive` 的 online 分支叠加最新 lease 续约新鲜度核验——`now - lease.updated_at > STALE_RUN_ACTIVE_GRACE` 返回 False，fall through 到既有判死路径（FOR UPDATE 锁定重读 + SERVICE_RESTART_INTERRUPTED，daemon 后续真成功上报时由 FR-02 回正兜底 close_run_steps 改回 completed）。选 lease 续约信号而非豁免轮数上限：lease 续约是「daemon 仍持有此 run」的直接证据（无状态、无需在复扫循环里簿记轮数、不改 _recheck_deferred_runs 签名），轮数上限只能按时间盲猜且对合法长静默（等用户应答）有误杀面。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `backend/app/modules/agent/service.py`：`_run_daemon_alive`（模块内私有，仅 `_recheck_deferred_runs` 一个调用点，grep 实证）——最新 lease 查询从单列 runtime_id 改两列 (runtime_id, updated_at)（同一查询零额外开销）；online 分支返回值从恒 True 改为 lease 续约新鲜度判定；offline/None 分支语义零变化。对外 API/模型/协议零变化，无生成物面。
- `backend/tests/modules/agent/test_stale_run_recheck.py`：fixture `_make_daemon_chain` 新增 `lease_updated_age` 参数（默认 5s 新鲜）；新增 1 用例。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立：lease.updated_at 由 backend lease_heartbeat 单写者事务更新（每次续约 commit），复扫读的是已提交的最新值；「最新 lease 倒序首见即定」与既有 patrol 单条语义一致，迟到续约只会让下一次复扫轮放行（判死路径有 FOR UPDATE 重读，锁内仍 running 才写 failed）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   与判死路径既有并发语义一致：无锁预判（本变更所在层）可能读到过期视图，但写 failed 前有 FOR UPDATE 行锁重读（populate_existing），daemon 并发终态化的 run 在锁内被识别为非 running 跳过，不覆盖。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全：误判死（lease 停滞但 run 真活着的极端窗口——如 daemon 线程池饿死 10 分钟未续约）由 FR-02 回正兜底（close_run_steps 按 SERVICE_RESTART_INTERRUPTED+success 回正 completed），误杀代价为短暂假失败非数据损毁。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会：lease 按 agent_run_id 精确关联，最新 lease 单条即定；多实例（用户重启 daemon 生成新实例行）场景下旧实例 offline 分支语义不变，新实例 online 但无该 run 的 lease（链路按 lease 解析，不跨实例串）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：daemon 续约线程被长任务饿死超 10 分钟（宽限窗）导致健康 run 被误判死——缓解：lease 心跳在 daemon 独立定时器（task-runner 5s 间隔，与任务执行线程解耦）+ FR-02 回正兜底；极端饥饿 10 分钟本身已属病态，判死后回正比永卡合理。边界取舍：`last_heartbeat_at is None` 分支保持保守 True 不引入 lease 核验（从未心跳的实例语义模糊，patrol 同款跳过，不扩大本变更判死面）。试过但放弃：豁免轮数上限（dict 簿记 tracked→轮数）——放弃理由：按时间盲猜，对合法等用户应答的长静默轮有误杀面且需改 _recheck_deferred_runs 签名与全部既有用例；lease 续约是直接证据且零簿记。

## 文件变更清单（自声明）

交付文件（2 个）：

1. `backend/app/modules/agent/service.py`——_run_daemon_alive online 分支 lease 续约核验（FR-01/FR-02）
2. `backend/tests/modules/agent/test_stale_run_recheck.py`——fixture lease_updated_age 参数 + 新增判死用例（FR-03）
