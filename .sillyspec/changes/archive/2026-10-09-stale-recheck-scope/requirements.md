---
author: flow-machine-draft
created_at: 2026-10-08T17:21:38.088Z
---
# 需求规格（Requirements）— 2026-10-09-stale-recheck-scope

## 功能需求

### FR-01: 复扫链只追踪启动清理时因日志新鲜而跳过的轮，启动后新开的轮不再进入复扫判死面

- 复扫循环的判死对象必须限定为「启动清理时点因日志 recency 在宽限窗内而被跳过的 run_id 快照集合」；启动后新创建的 running 轮禁止进入复扫判死面（其长期僵尸判定归属 patrol 既有职责）。

#### 场景：启动后新开的静默轮不被复扫波及

- Given 后端启动时存在一个被宽限跳过的追踪轮 A，启动后用户新开一个无任何日志的 running 轮 B
- When 复扫链执行一轮 `_recheck_deferred_runs`
- Then A 按追踪语义处理，B 保持 running 且不在追踪集合内（未被判死）

#### 场景：追踪项正常收口后自动出列

- Given 追踪轮 A 被 daemon 正常收口为 completed
- When 复扫链执行一轮
- Then A 从追踪集合移除，循环在追踪集合清空后退出

### FR-02: 复扫判死前叠加 daemon 活性守卫：daemon 在线或心跳宽限窗内则保持 running 继续追踪（对齐 patrol 判死段双条件语义），run→daemon 链路不可解析时退回纯日志 recency 语义

- 复扫对「日志已停滞超宽限窗」的追踪轮，必须先解析 run→lease→runtime→daemon 链路判 daemon 活性：daemon status=online 或 last_heartbeat_at 在宽限窗内时禁止判死（保持 running 并继续追踪）；链路不可解析（无 lease/runtime/实例）时必须退回纯日志 recency 判死语义（保持 FR-01 防永卡兜底不变）。

#### 场景：daemon 在线的长静默轮不被误杀

- Given 追踪轮 A 日志停滞超宽限窗（等待用户应答/长工具调用），其 lease→runtime→daemon 链路解析出的 daemon status=online
- When 复扫链执行一轮
- Then A 保持 running、error_code 为 None，且仍在追踪集合中

#### 场景：daemon 死亡且日志停滞的追踪轮被判死

- Given 追踪轮 A 日志停滞超宽限窗，daemon status=offline 且心跳距今超宽限窗
- When 复扫链执行一轮
- Then A 被判 failed + SERVICE_RESTART_INTERRUPTED，pending 对话框被取消，且移出追踪集合

#### 场景：链路不可解析退回 recency 语义

- Given 追踪轮 A 日志停滞超宽限窗，且不存在任何 DaemonTaskLease 行
- When 复扫链执行一轮
- Then A 按既有 recency 语义判 failed（防永卡兜底不因解析失败而缩小）

### FR-03: 复扫循环单次迭代异常不再终止整链：逐迭代捕获记日志，连续失败超上限才放弃并留 error 痕迹

- 复扫循环每次迭代必须以 try/except 包裹（异常 log.exception 含剩余追踪数与连续失败计数），连续失败达到模块常量上限（`_RECHECK_MAX_CONSECUTIVE_ERRORS`）时必须以 log.error 留痕后退出；单次瞬时异常不得终止循环。

#### 场景：单次 DB 抖动后链继续工作

- Given 追踪集合非空，第一轮迭代抛 RuntimeError，第二轮正常返回空集合
- When `_recheck_stale_runs_loop` 运行
- Then 循环不在首轮异常处终止，第二轮后正常退出且无未处理异常外溢

#### 场景：连续失败超限放弃留痕

- Given 每轮迭代均抛异常且连续次数达到上限
- When `_recheck_stale_runs_loop` 运行
- Then 循环在上限次数后返回（不外溢异常），放弃事件有 error 级日志留痕

### FR-04: 行锁收窄：启动清理与复扫都先无锁判日志活性，仅对确定要判死的轮 FOR UPDATE 重读，并逐轮提交即时释放锁

- 启动清理与复扫必须把日志 recency 判定移到 FOR UPDATE 之前（日志新鲜的活跃轮零锁面；快照元数据完整的恢复分支仍走行锁）；FOR UPDATE 重读仅发生在确定要终态化（恢复或判死）的轮上；每处理完一个轮必须立即 commit 释放行锁，禁止跨轮持锁到循环末统一提交。

#### 场景：活跃轮在清理全程不被加行锁

- Given 一个日志新鲜（宽限窗内）的 running 轮
- When 启动清理执行
- Then 该轮在无 FOR UPDATE 的路径上被跳过，daemon 并发收口不受行锁阻塞

#### 场景：并发收口守卫语义保持

- Given 快照后、写入前某轮被并发收口置 completed（评审 P2 用例）
- When 清理处理到该轮并 FOR UPDATE 重读
- Then 重读见终态即放弃，不盲写覆盖回 failed

### FR-05: 既有 liveness/错误码/并发收口守卫用例保持绿；新增复扫范围、daemon 活性、循环韧性用例先红后绿

- 本变更必须保持既有测试文件全绿：`tests/modules/agent/test_stale_run_cleanup_liveness.py`、`app/modules/agent/tests/test_cleanup_stale_runs_error_code.py`、`app/modules/daemon/tests/test_session_permissions.py`（stale 清理相关用例）；新增用例必须先红（对旧实现失败）后绿（对新实现通过）。

#### 场景：回归面与新增面双绿

- Given 实现完成
- When 运行上述既有文件与新增 `tests/modules/agent/test_stale_run_recheck.py`
- Then 全部通过，且新增文件中的范围/活性/韧性用例在旧实现上可证失败

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_ignores_new_silent_run_outside_tracked_set」
FR-02: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_pardons_run_with_online_daemon」
FR-02: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_kills_silent_run_with_dead_daemon」
FR-02: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_unresolvable_daemon_falls_back_to_recency」
FR-03: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_loop_survives_transient_error」
FR-03: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_loop_gives_up_after_consecutive_errors」
FR-04: test/backend/tests/modules/agent/test_stale_run_cleanup_liveness.py「test_cleanup_skips_run_closed_concurrently_after_snapshot」（守卫语义保持）
FR-04: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_cleanup_skips_recent_run_without_lock」（活跃轮零锁面）
FR-05: test/backend/tests/modules/agent/test_stale_run_cleanup_liveness.py「既有 4 用例全绿」
FR-05: test/backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「既有用例全绿」
