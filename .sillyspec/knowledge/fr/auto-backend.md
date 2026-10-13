---
author: sillyspec-fr-index
created_at: 2026-10-08T01:35:36.843Z
---

# FR 索引 — auto-backend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-backend-118 sed 换源改为 https://mirror.sjtu.edu.cn（连协议一起换），安装的包集合与语义零变化
变更：2026-10-08-backend-dockerfile-apt-mirror-sjtu
状态：active
摘要：换源不改语义
全文：.sillyspec/changes/archive/2026-10-08-backend-dockerfile-apt-mirror-sjtu/requirements.md#FR-01
最近确认：d304aefe57ac5e79cc74c094f21d1760d3e5ac5f

## FR-auto-backend-119 backend 镜像本地构建通过（apt 层完成即验证），部署链可继续
变更：2026-10-08-backend-dockerfile-apt-mirror-sjtu
状态：active
摘要：构建即验证
全文：.sillyspec/changes/archive/2026-10-08-backend-dockerfile-apt-mirror-sjtu/requirements.md#FR-02
最近确认：d304aefe57ac5e79cc74c094f21d1760d3e5ac5f

## FR-auto-backend-120 Dockerfile 改动以显式 pathspec 提交并在本变更内收口
变更：2026-10-08-backend-dockerfile-apt-mirror-sjtu
状态：active
摘要：收口
全文：.sillyspec/changes/archive/2026-10-08-backend-dockerfile-apt-mirror-sjtu/requirements.md#FR-03
最近确认：d304aefe57ac5e79cc74c094f21d1760d3e5ac5f

## FR-auto-backend-121 backend/Dockerfile NODE_VERSION=22，构建注释说明 sillyspec >=3.30 对 node:sqlite 的依赖
变更：2026-10-08-backend-node22-for-sillyspec332
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-node22-for-sillyspec332/requirements.md#FR-01
最近确认：f7eeb237e90fa48bd4da92409503176dd6ef99a4

## FR-auto-backend-122 重建后容器内 sillyspec --version 为 3.32.0 且 flow 子命令不再报 node:sqlite 崩溃
变更：2026-10-08-backend-node22-for-sillyspec332
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-node22-for-sillyspec332/requirements.md#FR-02
最近确认：f7eeb237e90fa48bd4da92409503176dd6ef99a4

## FR-auto-backend-123 容器内 /app/sillyspec-skills 仍为 21 个技能、/api/health ok
变更：2026-10-08-backend-node22-for-sillyspec332
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-node22-for-sillyspec332/requirements.md#FR-03
最近确认：f7eeb237e90fa48bd4da92409503176dd6ef99a4

## FR-auto-backend-124 不改 apt 包集合与其它层语义
变更：2026-10-08-backend-node22-for-sillyspec332
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-node22-for-sillyspec332/requirements.md#FR-04
最近确认：f7eeb237e90fa48bd4da92409503176dd6ef99a4

## FR-auto-backend-125 后端重启清理时，近期仍有 daemon 上报的运行轮不再被判死，等真终态
变更：2026-10-08-backend-restart-fake-failed
状态：active
摘要：近期有上报的运行轮不判死；上报停滞性超过宽限的轮照常清理；无日志行的运行轮照常清理
全文：.sillyspec/changes/archive/2026-10-08-backend-restart-fake-failed/requirements.md#FR-01
最近确认：89a7e9a42c4d0438ccccf1c85a4297cf19d04226

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-backend-restart-fake-failed:flow:测试绑定FR-01
  tests: backend/tests/modules/agent/test_stale_run_cleanup_liveness.py「test_cleanup_fails_run_without_logs」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-backend-restart-fake-failed
  status: active

## FR-auto-backend-126 被误标 SERVICE_RESTART_INTERRUPTED 的轮收到 daemon 迟到的成功结果后能回正为 completed
变更：2026-10-08-backend-restart-fake-failed
状态：active
摘要：误杀轮收到迟到成功结果回正；其余终态重复上报仍拒收
全文：.sillyspec/changes/archive/2026-10-08-backend-restart-fake-failed/requirements.md#FR-02
最近确认：89a7e9a42c4d0438ccccf1c85a4297cf19d04226

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-backend-restart-fake-failed:flow:测试绑定FR-02
  tests: backend/tests/modules/daemon/test_close_interactive_run_retroactive.py「test_other_terminal_results_stay_noop」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-backend-restart-fake-failed
  status: active

## FR-auto-backend-127 补充对应用例覆盖上述两条路径
变更：2026-10-08-backend-restart-fake-failed
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-restart-fake-failed/requirements.md#FR-03
最近确认：89a7e9a42c4d0438ccccf1c85a4297cf19d04226

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-backend-restart-fake-failed:flow:测试绑定FR-03
  tests: backend/tests/modules/agent/test_stale_run_cleanup_liveness.py | backend/tests/modules/daemon/test_close_interactive_run_retroactive.py「全文件用例集」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-backend-restart-fake-failed
  status: active

## FR-auto-backend-128 test_align_platform_change_events_migration.py 链尾锚更新为 20261008100000（注释链同步），该文件全绿
变更：2026-10-08-ci-sweep-2-migration-anchor
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given versions 目录含 20261008100000（down_revision=20261006200000）/ When test_file_exists
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2-migration-anchor/requirements.md#FR-01
最近确认：efb85fc566889705e304026f05380aacc58d77b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2-migration-anchor:flow:测试绑定FR-01
  tests: backend/tests/test_align_platform_change_events_migration.py「TestMigrationStructure::test_file_exists_and_single_head_chain」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2-migration-anchor
  status: active

## FR-auto-backend-129 backend-ci 推送后转绿（其余 workflow 无后端改动不触发或保持绿）
变更：2026-10-08-ci-sweep-2-migration-anchor
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given versions 目录含 20261008100000（down_revision=20261006200000）/ When test_file_exists
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2-migration-anchor/requirements.md#FR-02
最近确认：efb85fc566889705e304026f05380aacc58d77b2

## FR-auto-backend-130 复扫链只追踪启动清理时因日志新鲜而跳过的轮，启动后新开的轮不再进入复扫判死面
变更：2026-10-09-stale-recheck-scope
状态：active
摘要：启动后新开的静默轮不被复扫波及；追踪项正常收口后自动出列
全文：.sillyspec/changes/archive/2026-10-09-stale-recheck-scope/requirements.md#FR-01
最近确认：ef3fca11264f031c7ef95c05eb7da475e76cbb81

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-stale-recheck-scope:flow:测试绑定FR-01
  tests: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_ignores_new_silent_run_outside_tracked_set」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-stale-recheck-scope
  status: active

## FR-auto-backend-131 复扫判死前叠加 daemon 活性守卫：daemon 在线或心跳宽限窗内则保持 running 继续追踪（对齐 patrol 判死段双条件语义），run→daemon 链路不可解析时退回纯日志 recency 语义
变更：2026-10-09-stale-recheck-scope
状态：active
摘要：daemon 在线的长静默轮不被误杀；daemon 死亡且日志停滞的追踪轮被判死；链路不可解析退回 recency 语义
全文：.sillyspec/changes/archive/2026-10-09-stale-recheck-scope/requirements.md#FR-02
最近确认：ef3fca11264f031c7ef95c05eb7da475e76cbb81

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-stale-recheck-scope:flow:测试绑定FR-02
  tests: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_unresolvable_daemon_falls_back_to_recency」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-stale-recheck-scope
  status: active

## FR-auto-backend-132 复扫循环单次迭代异常不再终止整链：逐迭代捕获记日志，连续失败超上限才放弃并留 error 痕迹
变更：2026-10-09-stale-recheck-scope
状态：active
摘要：单次 DB 抖动后链继续工作；连续失败超限放弃留痕
全文：.sillyspec/changes/archive/2026-10-09-stale-recheck-scope/requirements.md#FR-03
最近确认：ef3fca11264f031c7ef95c05eb7da475e76cbb81

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-stale-recheck-scope:flow:测试绑定FR-03
  tests: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_loop_gives_up_after_consecutive_errors」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-stale-recheck-scope
  status: active

## FR-auto-backend-133 行锁收窄：启动清理与复扫都先无锁判日志活性，仅对确定要判死的轮 FOR UPDATE 重读，并逐轮提交即时释放锁
变更：2026-10-09-stale-recheck-scope
状态：active
摘要：活跃轮在清理全程不被加行锁；并发收口守卫语义保持
全文：.sillyspec/changes/archive/2026-10-09-stale-recheck-scope/requirements.md#FR-04
最近确认：ef3fca11264f031c7ef95c05eb7da475e76cbb81

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-stale-recheck-scope:flow:测试绑定FR-04
  tests: test/backend/tests/modules/agent/test_stale_run_recheck.py「test_cleanup_skips_recent_run_without_lock」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-stale-recheck-scope
  status: active

## FR-auto-backend-134 既有 liveness/错误码/并发收口守卫用例保持绿；新增复扫范围、daemon 活性、循环韧性用例先红后绿
变更：2026-10-09-stale-recheck-scope
状态：active
摘要：回归面与新增面双绿
全文：.sillyspec/changes/archive/2026-10-09-stale-recheck-scope/requirements.md#FR-05
最近确认：ef3fca11264f031c7ef95c05eb7da475e76cbb81

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-stale-recheck-scope:flow:测试绑定FR-05
  tests: test/backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「既有用例全绿」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-stale-recheck-scope
  status: active

## FR-auto-backend-135 _infer_task_times 跳过 detail 带非 tasks stage 前缀的 task-done 事件（对齐 CLI e.stage && e.stage !== 'tasks' 语义；无前缀裸形态仍参与推断）
变更：2026-10-09-timeline-tick-stage-filter
状态：active
摘要：design 自审清单事件被跳过；裸形态仍参与推断
全文：.sillyspec/changes/archive/2026-10-09-timeline-tick-stage-filter/requirements.md#FR-01
最近确认：ece14180dc23240f0a83d34f61bc9aab0d9d2f16

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-timeline-tick-stage-filter:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_timeline.py「test_timeline_task_time_skips_non_tasks_stage」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-timeline-tick-stage-filter
  status: active

## FR-auto-backend-136 回归用例钉住实证形态：design · checked 0→6 → tasks · checked 0→5 → tasks · checked 1→2…，断言任务时刻不被 design 事件污染
变更：2026-10-09-timeline-tick-stage-filter
状态：active
摘要：实证序列回归被拦
全文：.sillyspec/changes/archive/2026-10-09-timeline-tick-stage-filter/requirements.md#FR-02
最近确认：ece14180dc23240f0a83d34f61bc9aab0d9d2f16

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-timeline-tick-stage-filter:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_timeline.py「test_timeline_task_time_skips_non_tasks_stage」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-timeline-tick-stage-filter
  status: active

## FR-auto-backend-137 既有 backend change timeline 测试面（test_timeline.py）全绿
变更：2026-10-09-timeline-tick-stage-filter
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-timeline-tick-stage-filter/requirements.md#FR-03
最近确认：ece14180dc23240f0a83d34f61bc9aab0d9d2f16

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-timeline-tick-stage-filter:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-timeline-tick-stage-filter
  status: active

## FR-auto-backend-138 /machines 机器列表排序稳定：保留 online 优先，其余改为展示名（coalesce(display_alias, hostname)）升序 + id 兜底，连续多次刷新顺序不变
变更：2026-10-09-daemon-page-stable-sort
状态：active
摘要：机器卡顺序不随心跳翻转；online 优先保留；别名参与排序
全文：.sillyspec/changes/archive/2026-10-09-daemon-page-stable-sort/requirements.md#FR-01
最近确认：4ce2c98e6e18c17b277ae923ca5c957fd5228455

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-daemon-page-stable-sort:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_machines_router.py「test_machines_sort_online_first_then_display_name_asc」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-daemon-page-stable-sort
  status: active

## FR-auto-backend-139 机器内 runtime（agent）列表排序稳定：provider 升序 + created_at/id tiebreaker，同 provider 多 agent 顺序不变
变更：2026-10-09-daemon-page-stable-sort
状态：active
摘要：同 provider 多 agent 顺序固定
全文：.sillyspec/changes/archive/2026-10-09-daemon-page-stable-sort/requirements.md#FR-02
最近确认：4ce2c98e6e18c17b277ae923ca5c957fd5228455

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-daemon-page-stable-sort:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_machines_router.py「test_machines_nested_runtimes_same_provider_stable_order」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-daemon-page-stable-sort
  status: active

## FR-auto-backend-140 共享给我的区块内 runtimes 明细同口径加 tiebreaker
变更：2026-10-09-daemon-page-stable-sort
状态：active
摘要：共享机器 agent 明细顺序固定
全文：.sillyspec/changes/archive/2026-10-09-daemon-page-stable-sort/requirements.md#FR-03
最近确认：4ce2c98e6e18c17b277ae923ca5c957fd5228455

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-daemon-page-stable-sort:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_machines_router.py「test_machines_shared_to_me_runtimes_same_provider_stable_order」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-daemon-page-stable-sort
  status: active

## FR-auto-backend-141 新增/扩展后端测试覆盖上述排序稳定性，相关既有测试全部通过
变更：2026-10-09-daemon-page-stable-sort
状态：active
摘要：排序行为有回归保护
全文：.sillyspec/changes/archive/2026-10-09-daemon-page-stable-sort/requirements.md#FR-04
最近确认：4ce2c98e6e18c17b277ae923ca5c957fd5228455

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-daemon-page-stable-sort:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_machines_router.py「test_machines_sort_online_first_then_display_name_asc + test_machines_nested_runtimes_same_provider_stable_order + test_machines_shared_to_me_runtimes_same_provider_stable_order」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-daemon-page-stable-sort
  status: active

## FR-auto-backend-142 dump 端点的信封 JSON 序列化与 gzip 压缩必须卸载到工作线程（asyncio.to_thread），事件循环零同步 CPU 段
变更：2026-10-10-dump-gzip-thread-offload
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 大图（>100KB payload）dump 请求 / When 端点处理 / Then gzip.compress 在工作线程执行（spy 线程 id ≠ 事
全文：.sillyspec/changes/archive/2026-10-10-dump-gzip-thread-offload/requirements.md#FR-01
最近确认：c2dea0074b6fc874e20bd6a894d932dd25842239

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dump-gzip-thread-offload:flow:测试绑定FR-01
  tests: backend/app/modules/knowledge/tests/test_graph.py「test_graph_dump_compress_offloaded_to_worker_thread」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dump-gzip-thread-offload
  status: active

## FR-auto-backend-143 响应字节与响应头（Content-Encoding: gzip / Vary）与卸载前完全一致（行为零变化，既有 4 用例零回归）
变更：2026-10-10-dump-gzip-thread-offload
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 卸载后实现 / When 复跑 dump 组既有用例 / Then 全绿（6/6，含新增卸载钉）。
全文：.sillyspec/changes/archive/2026-10-10-dump-gzip-thread-offload/requirements.md#FR-02
最近确认：c2dea0074b6fc874e20bd6a894d932dd25842239

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dump-gzip-thread-offload:flow:测试绑定FR-02
  tests: backend/app/modules/knowledge/tests/test_graph.py「test_graph_dump_happy_path_gzip_envelope」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dump-gzip-thread-offload
  status: active

## FR-auto-backend-144 新增用例先红后绿：gzip.compress 执行线程 ≠ 事件循环线程（旧实现同线程必红）
变更：2026-10-10-dump-gzip-thread-offload
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 未卸载的旧实现 / When 跑新增用例 / Then 红（compress 在事件循环线程）。 to_thread 卸载后 / When 同用例 / Then
全文：.sillyspec/changes/archive/2026-10-10-dump-gzip-thread-offload/requirements.md#FR-03
最近确认：c2dea0074b6fc874e20bd6a894d932dd25842239

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dump-gzip-thread-offload:flow:测试绑定FR-03
  tests: backend/app/modules/knowledge/tests/test_graph.py「test_graph_dump_compress_offloaded_to_worker_thread」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dump-gzip-thread-offload
  status: active

## FR-auto-backend-145 _run_daemon_alive 实例 online 分支必须叠加最新 lease 续约新鲜度核验：lease updated_at 停滞超宽限窗（STALE_RUN_ACTIVE_GRACE）→ 返回 False（实例活着但已放弃此 run），fall through 判死出列
变更：2026-10-10-recheck-lease-freshness
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given run running + 日志停滞超宽限窗 + 实例 online（心跳 1min 前）+ lease updated_at 停滞 1h / When 复扫单
全文：.sillyspec/changes/archive/2026-10-10-recheck-lease-freshness/requirements.md#FR-01
最近确认：f1d975bf97dcd3bbb12c85e510dae5617809c797

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-recheck-lease-freshness:flow:测试绑定FR-01
  tests: backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_kills_run_with_online_daemon_but_stale_lease」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-recheck-lease-freshness
  status: active

## FR-auto-backend-146 健康 run（日志停滞但 lease 续约新鲜，如等用户应答/长工具调用）必须保持不判死；daemon 确死/链路不可解析语义不变
变更：2026-10-10-recheck-lease-freshness
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 既有 8 用例形态（含 fixture 对齐真实续约时序后的 pardons 用例）/ When 复跑 / Then 全绿。
全文：.sillyspec/changes/archive/2026-10-10-recheck-lease-freshness/requirements.md#FR-02
最近确认：f1d975bf97dcd3bbb12c85e510dae5617809c797

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-recheck-lease-freshness:flow:测试绑定FR-02
  tests: backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_pardons_run_with_online_daemon」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-recheck-lease-freshness
  status: active

## FR-auto-backend-147 新增用例先红后绿：实例 online+心跳新鲜+lease updated_at 停滞 1h → 判死 failed/SERVICE_RESTART_INTERRUPTED；既有 pardons 用例 fixture 对齐真实续约时序（lease 新鲜）零回归
变更：2026-10-10-recheck-lease-freshness
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-10-recheck-lease-freshness/requirements.md#FR-03
最近确认：f1d975bf97dcd3bbb12c85e510dae5617809c797

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-recheck-lease-freshness:flow:测试绑定FR-03
  tests: backend/tests/modules/agent/test_stale_run_recheck.py「test_recheck_kills_run_with_online_daemon_but_stale_lease」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-recheck-lease-freshness
  status: active

## FR-auto-backend-148 daemon 唤醒加最短时长门槛：任务实际运行不足 60 秒不注入唤醒（emit/落行/注销语义不变），elapsed_ms 缺失时用注册表 startedAt 兜底计算，两者都缺时保持原唤醒行为
变更：2026-10-10-task-wakeup-quiet-threshold
状态：active
摘要：短任务静默；长任务照常唤醒；时长无从判定保持原行为
全文：.sillyspec/changes/archive/2026-10-10-task-wakeup-quiet-threshold/requirements.md#FR-01
最近确认：9852d96f58056927f03e7497ec1a609c7b75eed3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-task-wakeup-quiet-threshold:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「时长无从判定（无 elapsed 无注册条目）保持唤醒」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-task-wakeup-quiet-threshold
  status: active

## FR-auto-backend-149 backend 排队满员检查不再把 [后台任务通知] 系统通知计入用户 5 条额度：队满时用户消息照常入队判断不受通知挤占，系统通知队满也不被丢弃（仍走既有同条合并）
变更：2026-10-10-task-wakeup-quiet-threshold
状态：active
摘要：通知不占用户额度；队满时通知不被丢弃；用户满员语义零回归
全文：.sillyspec/changes/archive/2026-10-10-task-wakeup-quiet-threshold/requirements.md#FR-02
最近确认：9852d96f58056927f03e7497ec1a609c7b75eed3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-task-wakeup-quiet-threshold:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_session_queue.py「用户满员语义零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-task-wakeup-quiet-threshold
  status: active

## FR-auto-backend-150 daemon 与 backend 各有针对性测试覆盖新行为，仅跑修改相关测试，全量留给 CI
变更：2026-10-10-task-wakeup-quiet-threshold
状态：active
摘要：测试绑定可追溯
全文：.sillyspec/changes/archive/2026-10-10-task-wakeup-quiet-threshold/requirements.md#FR-03
最近确认：9852d96f58056927f03e7497ec1a609c7b75eed3

## FR-auto-backend-151 孙任务不冒泡（缺可靠 SDK 信号需 spike）与排队栏前端分开展示（纯展示优化）本变更不做，留待后续
变更：2026-10-10-task-wakeup-quiet-threshold
状态：active
摘要：非目标边界
全文：.sillyspec/changes/archive/2026-10-10-task-wakeup-quiet-threshold/requirements.md#FR-04
最近确认：9852d96f58056927f03e7497ec1a609c7b75eed3

## FR-auto-backend-152 db.py 的 pool_size/max_overflow 从 DB_POOL_SIZE/DB_MAX_OVERFLOW 环境变量读取，未配置时默认值 20/30 保持现行为不变
变更：2026-10-10-server-db-pool-tuning
状态：active
摘要：主路径（未配置环境变量）；小规格服务器配置小池
全文：.sillyspec/changes/archive/2026-10-10-server-db-pool-tuning/requirements.md#FR-01
最近确认：e3bca7777d2c72a74e7292e1c5b98326478a7a61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-server-db-pool-tuning:flow:测试绑定FR-01
  tests: test/backend/tests/core/test_db_pool_settings.py「test_default_pool_values」 | test/backend/tests/core/test_db_pool_settings.py「test_env_override_engine_pool_params」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-server-db-pool-tuning
  status: active

## FR-auto-backend-153 环境变量配置非法值（非整数）时行为可预期（用默认值并记录警告，或显式报错，实现内注明）
变更：2026-10-10-server-db-pool-tuning
状态：active
摘要：非法值启动失败
全文：.sillyspec/changes/archive/2026-10-10-server-db-pool-tuning/requirements.md#FR-02
最近确认：e3bca7777d2c72a74e7292e1c5b98326478a7a61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-server-db-pool-tuning:flow:测试绑定FR-02
  tests: test/backend/tests/core/test_db_pool_settings.py「test_invalid_pool_value_raises」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-server-db-pool-tuning
  status: active

## FR-auto-backend-154 新增单元测试覆盖：默认值、环境变量覆盖生效、（如选静默回退）非法值回退
变更：2026-10-10-server-db-pool-tuning
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-10-server-db-pool-tuning/requirements.md#FR-03
最近确认：e3bca7777d2c72a74e7292e1c5b98326478a7a61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-server-db-pool-tuning:flow:测试绑定FR-03
  tests: test/backend/tests/core/test_db_pool_settings.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-server-db-pool-tuning
  status: active

## FR-auto-backend-155 既有相关测试全部通过
变更：2026-10-10-server-db-pool-tuning
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-10-server-db-pool-tuning/requirements.md#FR-04
最近确认：e3bca7777d2c72a74e7292e1c5b98326478a7a61

## FR-auto-backend-156 close_interactive_run 同事务收口该 run 的非终态任务行
变更：2026-10-10-run-close-task-sweep
状态：active
摘要：子代理未上报终态（线上 47e2ff1a 实证）
全文：.sillyspec/changes/archive/2026-10-10-run-close-task-sweep/requirements.md#FR-01
最近确认：9efccfff7751ef838fe436eafa9da030ef68554d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-run-close-task-sweep:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_finalize_sweeps_running_to_stopped_terminal_untouched」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-run-close-task-sweep
  status: active

## FR-auto-backend-157 启动兜底清扫（自愈存量脏数据）
变更：2026-10-10-run-close-task-sweep
状态：active
摘要：部署重启自愈存量
全文：.sillyspec/changes/archive/2026-10-10-run-close-task-sweep/requirements.md#FR-02
最近确认：9efccfff7751ef838fe436eafa9da030ef68554d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-run-close-task-sweep:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_orphans_terminal_run_only」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-run-close-task-sweep
  status: active

## FR-auto-backend-158 挂载引用与跳转
变更：2026-10-11-linked-repo-workspace-ref
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台上存在多个工作区；When owner/admin 在关联仓表单中从工作区下拉选择一个（排除当前工作区自身）并保存；Then 登记行 ref_workspace_id 写入；列表条目返回对方工作区 {id, name, slug}；前端条目可点击跳转 `/workspaces/{id}
全文：.sillyspec/changes/archive/2026-10-11-linked-repo-workspace-ref/requirements.md#FR-01
最近确认：0f7af00fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-linked-repo-workspace-ref:task-01:acc-0-3c9095f1
  tests: backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: eed231994c23d9f6e11d4cc211532c609f9635e7
  source_change: 2026-10-11-linked-repo-workspace-ref
  status: active
- row: 2026-10-11-linked-repo-workspace-ref:task-01:acc-1-349bd3a6
  tests: backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: eed231994c23d9f6e11d4cc211532c609f9635e7
  source_change: 2026-10-11-linked-repo-workspace-ref
  status: active

## FR-auto-backend-159 摘除与软删降级
变更：2026-10-11-linked-repo-workspace-ref
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已挂载条目；When 编辑时清空选择（null=显式摘除）或对方工作区被软删除；Then 编辑场景摘除引用（行保留）；软删场景读时降级——摘要/跳转/匹配输出一律为 null（登记行与 FK 落库值保留；匹配与挂载校验均过滤 deleted_at，G
全文：.sillyspec/changes/archive/2026-10-11-linked-repo-workspace-ref/requirements.md#FR-02
最近确认：0f7af00fe

## FR-auto-backend-160 回显匹配提示
变更：2026-10-11-linked-repo-workspace-ref
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本机回显快照含 local_only 条目；When backend 对照时仅对 local_only 条目、按 key 在当前用户可见工作区集（过滤软删；限定可见集防泄露，Grill X-002）name/slu；Then 命中时该条目附 matched_workspace {id, name, slug}（提示性字段，不写库不自动挂载）；未命中为 null。
全文：.sillyspec/changes/archive/2026-10-11-linked-repo-workspace-ref/requirements.md#FR-03
最近确认：0f7af00fe

## FR-auto-backend-161 前端展示
变更：2026-10-11-linked-repo-workspace-ref
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户查看关联仓卡片；When 条目已挂载 → 显示对方名+跳转图标；回显条目 matched_workspace 命中 → 显示「匹配到 XX」提示；Then 挂载跳转用 router push；未挂载条目行为不变；双主题 brand 语义阶。
全文：.sillyspec/changes/archive/2026-10-11-linked-repo-workspace-ref/requirements.md#FR-04
最近确认：0f7af00fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-linked-repo-workspace-ref:task-02:acc-0-5034f1dd
  tests: frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: eed231994c23d9f6e11d4cc211532c609f9635e7
  source_change: 2026-10-11-linked-repo-workspace-ref
  status: active

## FR-auto-backend-162 backend 新增迁移单头断言测试（alembic heads 输出恰一行，多头即 fail），随测试套件进 CI
变更：2026-10-11-alembic-single-head-guard
状态：active
摘要：主路径（当前单头通过）；多头红灯（2026-10-11 事故形态复现）
场景正文：
- 场景：主路径（当前单头通过） — Given 迁移图单头（当前 c515ffd62859）；When 运行该测试；Then 通过。
- 场景：多头红灯（2026-10-11 事故形态复现） — Given 并行变更各自新增迁移形成两 head（同日实证 20261011020000/20261011160000 形态）；When CI 运行该测试；Then fail，报错含 merge heads 解法提示——PR 阶段拦截，不再等部署宕机才发现。
全文：.sillyspec/changes/archive/2026-10-11-alembic-single-head-guard/requirements.md#FR-01
最近确认：e81fef9f12b4d99f7bfa71cb3354adfb2e40f5fb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-alembic-single-head-guard:flow:测试绑定FR-01
  tests: backend/tests/test_migration_single_head.py「test_alembic_single_head」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-alembic-single-head-guard
  status: active

## FR-auto-backend-163 deploy/scripts/build-and-save.sh 打镜像前预检 alembic 单头，多头直接非零退出并提示 merge heads 解法
变更：2026-10-11-alembic-single-head-guard
状态：active
摘要：主路径（单头放行）；多头拦截；本地环境缺失
场景正文：
- 场景：主路径（单头放行） — Given 迁移图单头；When 运行 build-and-save.sh；Then 预检打印「单头 OK: <revision>」并继续构建。
- 场景：多头拦截 — Given 迁移图两 head；When 运行 build-and-save.sh；Then 打印两 head 清单与 merge 提示后 exit 1，不进入 docker build。
- 场景：本地环境缺失 — Given backend Python 环境缺 alembic（命令报错）；When 运行 build-and-save.sh；Then exit 1 并提示 `uv sync` 修复，不静默跳过预检。
全文：.sillyspec/changes/archive/2026-10-11-alembic-single-head-guard/requirements.md#FR-02
最近确认：e81fef9f12b4d99f7bfa71cb3354adfb2e40f5fb

## FR-auto-backend-164 改动相关测试全绿（全量留给 CI）
变更：2026-10-11-alembic-single-head-guard
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-11-alembic-single-head-guard/requirements.md#FR-03
最近确认：e81fef9f12b4d99f7bfa71cb3354adfb2e40f5fb

## FR-auto-backend-165 sweep_confirmed_dead_tasks 对每个候选 runtime 先经 _resolve_daemon_id_for_runtime 映射出 daemon 路由键再发 session_live_tasks RPC；runtime 行缺失时该 runtime 的候选跳过（fail-open 保活）；daemon_instance_id 为 NULL（D-007 迁移窗）沿用 helper 既有语义回落 runtime_id 作路由键
变更：2026-10-12-task-sweep-rpc-route-key
状态：active
摘要：绑定 instance 的 runtime 按映射键路由；runtime 行缺失跳过；legacy NULL 回落不变
全文：.sillyspec/changes/archive/2026-10-12-task-sweep-rpc-route-key/requirements.md#FR-01
最近确认：a339d492bcea7f038e3715617f6004967c8f3368

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-task-sweep-rpc-route-key:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_routes_rpc_by_daemon_instance_id」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-task-sweep-rpc-route-key
  status: active

## FR-auto-backend-166 新增用例：runtime 绑定 daemon_instance_id 后 send_rpc 收到的路由键为 daemon_instance_id 而非 runtime_id（先红后绿）；既有清扫用例语义不变全绿
变更：2026-10-12-task-sweep-rpc-route-key
状态：active
摘要：路由键断言用例
全文：.sillyspec/changes/archive/2026-10-12-task-sweep-rpc-route-key/requirements.md#FR-02
最近确认：a339d492bcea7f038e3715617f6004967c8f3368

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-task-sweep-rpc-route-key:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_routes_rpc_by_daemon_instance_id」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-task-sweep-rpc-route-key
  status: active

## FR-auto-backend-167 启动清扫从 lifespan 同步 await 改为延迟后台任务（对齐 _recheck_stale_runs_loop 模式：独立 session、强引用防 GC、done 回收异常），给 daemon 留重连窗口后再确认，异常不阻断启动
变更：2026-10-12-task-sweep-rpc-route-key
状态：active
摘要：延迟任务在独立 session 上执行清扫；清扫异常不冒泡
全文：.sillyspec/changes/archive/2026-10-12-task-sweep-rpc-route-key/requirements.md#FR-03
最近确认：a339d492bcea7f038e3715617f6004967c8f3368

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-task-sweep-rpc-route-key:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_startup_orphan_task_sweep_deferred_on_own_session」 | backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_startup_orphan_task_sweep_swallows_errors」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-task-sweep-rpc-route-key
  status: active

## FR-auto-backend-168 仅跑本改动相关测试（规则 0）：test_agent_session_tasks.py 全文件
变更：2026-10-12-task-sweep-rpc-route-key
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-task-sweep-rpc-route-key/requirements.md#FR-04
最近确认：a339d492bcea7f038e3715617f6004967c8f3368

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-task-sweep-rpc-route-key:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-task-sweep-rpc-route-key
  status: active

## FR-auto-backend-169 close 对 duration_api_ms 仅回填不覆盖
变更：2026-10-12-duration-backfill-harness-align
状态：active
摘要：实测值权威；NULL 回填
全文：.sillyspec/changes/archive/2026-10-12-duration-backfill-harness-align/requirements.md#FR-01
最近确认：a339d492bcea7f038e3715617f6004967c8f3368

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-duration-backfill-harness-align:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py「test_close_backfills_duration_api_ms_when_null」 | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py「test_close_does_not_override_measured_duration_api_ms」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-duration-backfill-harness-align
  status: active

## FR-auto-backend-170 模块卡语义同步
变更：2026-10-12-duration-backfill-harness-align
状态：active
摘要：卡面一致
全文：.sillyspec/changes/archive/2026-10-12-duration-backfill-harness-align/requirements.md#FR-02
最近确认：a339d492bcea7f038e3715617f6004967c8f3368

## FR-auto-backend-171 相关测试通过（不跑全量）
变更：2026-10-12-duration-backfill-harness-align
状态：active
摘要：绿
全文：.sillyspec/changes/archive/2026-10-12-duration-backfill-harness-align/requirements.md#FR-03
最近确认：a339d492bcea7f038e3715617f6004967c8f3368

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-duration-backfill-harness-align:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-duration-backfill-harness-align
  status: active

## FR-auto-backend-172 build-and-save.sh 零条 head 不再静默退出：grep -c 的非零退出被容忍（|| true），计数 0 走既有 [-ne 1] 分支打印 alembic heads 全文与解法引导后退出 1；多头路径行为逐字不变
变更：2026-10-12-ci-guard-diagnosability
状态：active
摘要：零头给引导
全文：.sillyspec/changes/archive/2026-10-12-ci-guard-diagnosability/requirements.md#FR-01
最近确认：775cb3de8104fb40bd864ed6b1bc223e50d7e749

## FR-auto-backend-173 test_migration_single_head.py 对 CWD 不敏感：Config 显式 set_main_option script_location 为 backend_root/migrations 绝对路径，从仓库根与从 backend/ 两处跑均绿且多头时给出设计的中文提示（bash -n 校验脚本语法）
变更：2026-10-12-ci-guard-diagnosability
状态：active
摘要：双 CWD 均绿
全文：.sillyspec/changes/archive/2026-10-12-ci-guard-diagnosability/requirements.md#FR-02
最近确认：775cb3de8104fb40bd864ed6b1bc223e50d7e749

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ci-guard-diagnosability:flow:测试绑定FR-02
  tests: backend/tests/test_migration_single_head.py「test_alembic_single_head」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ci-guard-diagnosability
  status: active

## FR-auto-backend-174 仅跑本改动相关测试（规则 0）：pytest 该测试文件（backend/ 与仓库根两处 CWD 各跑一次）+ bash -n 脚本语法校验 + grep 计数模拟
变更：2026-10-12-ci-guard-diagnosability
状态：active
摘要：相关面验证
全文：.sillyspec/changes/archive/2026-10-12-ci-guard-diagnosability/requirements.md#FR-03
最近确认：775cb3de8104fb40bd864ed6b1bc223e50d7e749

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ci-guard-diagnosability:flow:测试绑定FR-03
  tests: backend/tests/test_migration_single_head.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ci-guard-diagnosability
  status: active

## FR-auto-backend-175 POST /api/workspaces/{id}/init 的权限门从 WORKSPACE_WRITE 改为 WORKSPACE_READ,仍 workspace-scoped
变更：2026-10-12-init-permission-relax
状态：active
摘要：权限档位替换
全文：.sillyspec/changes/archive/2026-10-12-init-permission-relax/requirements.md#FR-01
最近确认：4c27f731d5dec5a89ad1d7e3bc9503808c73a424

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-init-permission-relax:flow:测试绑定FR-01
  tests: backend/tests/modules/workspace/test_init_permission.py「test_init_developer_member_without_binding_gets_409_not_403」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-init-permission-relax
  status: active

## FR-auto-backend-176 本工作区成员(含 developer 等只读角色)发起 init 不再 403,无 daemon 绑定时走既有 409 MemberBindingNotFound 业务路径
变更：2026-10-12-init-permission-relax
状态：active
摘要：developer 成员无 daemon 绑定发起初始化
全文：.sillyspec/changes/archive/2026-10-12-init-permission-relax/requirements.md#FR-02
最近确认：4c27f731d5dec5a89ad1d7e3bc9503808c73a424

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-init-permission-relax:flow:测试绑定FR-02
  tests: backend/tests/modules/workspace/test_init_permission.py「test_init_developer_member_without_binding_gets_409_not_403」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-init-permission-relax
  status: active

## FR-auto-backend-177 非本工作区成员发起 init 仍 403(FR-09 隔离意图不回退)
变更：2026-10-12-init-permission-relax
状态：active
摘要：非成员发起初始化
全文：.sillyspec/changes/archive/2026-10-12-init-permission-relax/requirements.md#FR-03
最近确认：4c27f731d5dec5a89ad1d7e3bc9503808c73a424

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-init-permission-relax:flow:测试绑定FR-03
  tests: backend/tests/modules/workspace/test_init_permission.py「test_init_non_member_still_403」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-init-permission-relax
  status: active

## FR-auto-backend-178 workspace activate 端点不动(仍是 WORKSPACE_WRITE,本次仅放宽 init)
变更：2026-10-12-init-permission-relax
状态：active
摘要：activate 端点不受影响
全文：.sillyspec/changes/archive/2026-10-12-init-permission-relax/requirements.md#FR-04
最近确认：4c27f731d5dec5a89ad1d7e3bc9503808c73a424

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-init-permission-relax:flow:测试绑定FR-04
  tests: backend/tests/modules/workspace/test_init_permission.py「test_activate_still_requires_write_non_member_403」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-init-permission-relax
  status: active

## FR-auto-backend-179 先写失败测试(developer 409 而非 403 / 非成员仍 403)再改实现,相关 pytest 全绿
变更：2026-10-12-init-permission-relax
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-12-init-permission-relax/requirements.md#FR-05
最近确认：4c27f731d5dec5a89ad1d7e3bc9503808c73a424

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-init-permission-relax:flow:测试绑定FR-05
  tests: backend/tests/modules/workspace/test_init_permission.py「全文件先红后绿」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-init-permission-relax
  status: active

## FR-auto-backend-180 接口契约无 DTO 变化,无需重生成 api-types
变更：2026-10-12-init-permission-relax
状态：active
摘要：契约零变化
全文：.sillyspec/changes/archive/2026-10-12-init-permission-relax/requirements.md#FR-06
最近确认：4c27f731d5dec5a89ad1d7e3bc9503808c73a424

## FR-auto-backend-181 会话轮消息中出现 sillyspec run/flow --change 命令后，平台记录会话级「当前变更上下文」（agent_sessions 新列），后续新开轮（inject）创建的 AgentRun.change_id 记为该上下文
变更：2026-10-12-run-level-change-attribution
状态：active
摘要：主路径；切换
全文：.sillyspec/changes/archive/2026-10-12-run-level-change-attribution/requirements.md#FR-01
最近确认：74fbd1ec26e5d14e6cd93fbe686c32b339010057

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-run-level-change-attribution:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_inject_change_context.py「TestInjectChangeContextStamp::test_inject_run_stamped_with_session_context + ::test_inject_run_unstamped_when_context_none + ::test_context_switch_retargets_next_run」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-run-level-change-attribution
  status: active

## FR-auto-backend-182 bind_session_to_change 返回变更 id 供 run_sync 通道回写上下文；platform_sync agent-logs 通道绑定行为不变
变更：2026-10-12-run-level-change-attribution
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-run-level-change-attribution/requirements.md#FR-02
最近确认：74fbd1ec26e5d14e6cd93fbe686c32b339010057

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-run-level-change-attribution:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_spec_binding.py「test_bind_change_returns_change_id_contract + test_bind_change_failure_is_best_effort_no_raise（失败路径 None 断言）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-run-level-change-attribution
  status: active

## FR-auto-backend-183 变更用量聚合口径调整：带 change_id 的 run 独占归该变更；change_session_links 会话链路只认领 change_id 为空的 run（存量无锚 run 行为不变，防回归）
变更：2026-10-12-run-level-change-attribution
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-run-level-change-attribution/requirements.md#FR-03
最近确认：74fbd1ec26e5d14e6cd93fbe686c32b339010057

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-run-level-change-attribution:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_usage_stats.py「TestChangeAggregationSemantics::test_anchored_run_exclusive_to_owning_change + ::test_shared_session_counted_in_both_changes（无锚 run 回归护栏）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-run-level-change-attribution
  status: active

## FR-auto-backend-184 同一会话先后执行两个变更（打锚后）时，两个变更的执行用量统计互不相同且各只含自己时段的轮
变更：2026-10-12-run-level-change-attribution
状态：active
摘要：主路径；主路径
全文：.sillyspec/changes/archive/2026-10-12-run-level-change-attribution/requirements.md#FR-04
最近确认：74fbd1ec26e5d14e6cd93fbe686c32b339010057

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-run-level-change-attribution:flow:测试绑定FR-04
  tests: backend/app/modules/change/tests/test_usage_stats.py「TestChangeAggregationSemantics::test_two_changes_sequential_split」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-run-level-change-attribution
  status: active

## FR-auto-backend-185 既有 usage_stats 与相关 binding 测试全部通过，并新增打锚与聚合拆分用例
变更：2026-10-12-run-level-change-attribution
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-run-level-change-attribution/requirements.md#FR-05
最近确认：74fbd1ec26e5d14e6cd93fbe686c32b339010057

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-run-level-change-attribution:flow:测试绑定FR-05
  tests: backend/app/modules/agent/tests/test_agent_session_model.py「全量通过」 | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_inject_change_context.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-run-level-change-attribution
  status: active

## FR-auto-backend-186 默认配置（spec_backup_retention_days=None）下 _prune_spec_backups 直接返回，永不删除备份区任何目录、不做磁盘扫描
变更：2026-10-12-spec-backup-keep-forever
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-keep-forever/requirements.md#FR-01
最近确认：94b977abe67ff46b0d4ec02bdbebec150d5beb19

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-backup-keep-forever:flow:测试绑定FR-01
  tests: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「test_default_retention_never_prunes」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-backup-keep-forever
  status: active

## FR-auto-backend-187 配置 spec_backup_retention_days=正整数 N 时恢复原机会式修剪语义（早于 N 天的时间戳目录被清理，逃生门）
变更：2026-10-12-spec-backup-keep-forever
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-keep-forever/requirements.md#FR-02
最近确认：94b977abe67ff46b0d4ec02bdbebec150d5beb19

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-backup-keep-forever:flow:测试绑定FR-02
  tests: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「test_deletes_only_dirs_older_than_retention」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-backup-keep-forever
  status: active

## FR-auto-backend-188 修剪节流（PRUNE_THROTTLE_INTERVAL_S 600s 冷却）在启用修剪时语义不变（ql-20260924 OOM 防护保留）
变更：2026-10-12-spec-backup-keep-forever
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-keep-forever/requirements.md#FR-03
最近确认：94b977abe67ff46b0d4ec02bdbebec150d5beb19

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-backup-keep-forever:flow:测试绑定FR-03
  tests: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「test_throttled_second_call_is_noop」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-backup-keep-forever
  status: active

## FR-auto-backend-189 测试：TestPruneSpecBackups 三例适配设置项注入 + 新增「默认永不修剪」锁死用例，spec_workspace 相关测试全绿
变更：2026-10-12-spec-backup-keep-forever
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-keep-forever/requirements.md#FR-04
最近确认：94b977abe67ff46b0d4ec02bdbebec150d5beb19

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-backup-keep-forever:flow:测试绑定FR-04
  tests: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「TestPruneSpecBackups 全类 + 三个相关测试文件全量」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-backup-keep-forever
  status: active

## FR-auto-backend-190 跨平台兼容（Windows/Linux/macOS），不新增平台相关 API
变更：2026-10-12-spec-backup-keep-forever
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-keep-forever/requirements.md#FR-05
最近确认：94b977abe67ff46b0d4ec02bdbebec150d5beb19

## FR-auto-backend-191 回填服务按会话内 run 时间序重放 sillyspec 绑定命令游标：run 先按当前游标打锚（无锚才写），再用该 run 消息里的命令更新游标（最后一条生效），与线上运行时语义一致
变更：2026-10-12-backfill-run-change-context
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-backfill-run-change-context/requirements.md#FR-01
最近确认：f48221530edcc4242cce6f30c827420f5a5ffdbb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-backfill-run-change-context:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_backfill_replays_cursor_in_run_order_splitting_two_changes」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-backfill-run-change-context
  status: active

## FR-auto-backend-192 只回填 change_id 为 NULL 的 run，已锚 run（派发）跳过但命令照常推进游标；幂等可重跑
变更：2026-10-12-backfill-run-change-context
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-backfill-run-change-context/requirements.md#FR-02
最近确认：f48221530edcc4242cce6f30c827420f5a5ffdbb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-backfill-run-change-context:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_backfill_is_idempotent_second_run_stamps_zero + test_anchored_run_skipped_but_advances_cursor」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-backfill-run-change-context
  status: active

## FR-auto-backend-193 命令的 change_key 按（workspace_id, change_key）映射 Change 行，映射不到跳过计数；quicklog 链路与会话链接不改动
变更：2026-10-12-backfill-run-change-context
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-backfill-run-change-context/requirements.md#FR-03
最近确认：f48221530edcc4242cce6f30c827420f5a5ffdbb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-backfill-run-change-context:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_unknown_change_key_skipped_without_placeholder」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-backfill-run-change-context
  status: active

## FR-auto-backend-194 会话回填结束时把游标终值写 agent_sessions.current_change_id（仅当该会话解析出过命令）
变更：2026-10-12-backfill-run-change-context
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-backfill-run-change-context/requirements.md#FR-04
最近确认：f48221530edcc4242cce6f30c827420f5a5ffdbb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-backfill-run-change-context:flow:测试绑定FR-04
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_session_cursor_written_only_when_commands_found」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-backfill-run-change-context
  status: active

## FR-auto-backend-195 CLI 脚本默认 dry-run 输出计数，--apply 才落库；支持 --workspace 限定范围
变更：2026-10-12-backfill-run-change-context
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-backfill-run-change-context/requirements.md#FR-05
最近确认：f48221530edcc4242cce6f30c827420f5a5ffdbb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-backfill-run-change-context:flow:测试绑定FR-05
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_workspace_scope_filters_linked_sessions（服务层工作区编排：无链接会话不处理）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-backfill-run-change-context
  status: active

## FR-auto-backend-196 spec_backup_retention_days 配 0 或负数时启动期（Settings 构造）fail-fast 拒绝（ValidationError）
变更：2026-10-12-spec-backup-retention-validation
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-retention-validation/requirements.md#FR-01
最近确认：da47981a0f5360823b97253a1b0990b0ee91e462

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-backup-retention-validation:flow:测试绑定FR-01
  tests: backend/tests/test_config.py「test_spec_backup_retention_days_rejects_non_positive」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-backup-retention-validation
  status: active

## FR-auto-backend-197 None 与正整数仍合法，既有测试零回归
变更：2026-10-12-spec-backup-retention-validation
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-retention-validation/requirements.md#FR-02
最近确认：da47981a0f5360823b97253a1b0990b0ee91e462

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-backup-retention-validation:flow:测试绑定FR-02
  tests: backend/tests/test_config.py「test_spec_backup_retention_days_accepts_none_and_positive」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-backup-retention-validation
  status: active

## FR-auto-backend-198 新增用例：启用修剪（注入 30）时备份区根不存在 → 静默容错不抛（FileNotFoundError 分支恢复锁定）
变更：2026-10-12-spec-backup-retention-validation
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-retention-validation/requirements.md#FR-03
最近确认：da47981a0f5360823b97253a1b0990b0ee91e462

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-backup-retention-validation:flow:测试绑定FR-03
  tests: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「test_missing_backup_root_is_noop」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-backup-retention-validation
  status: active

## FR-auto-backend-199 相关测试全绿，ruff/mypy 过
变更：2026-10-12-spec-backup-retention-validation
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-spec-backup-retention-validation/requirements.md#FR-04
最近确认：da47981a0f5360823b97253a1b0990b0ee91e462

## FR-auto-backend-200 扫描模式列出工作区内「交互轮的已解析绑定命令全部一致指向变更 X、且轮锚 != X」的错配轮（run、当前锚、目标 X、命令数、未知 key 数），零写库
变更：2026-10-13-anchor-mismatch-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-anchor-mismatch-fix/requirements.md#FR-01
最近确认：2434a7500615f639e0283ced746a8586e8954de9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-anchor-mismatch-fix:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_scan_mismatch_reports_unanimous_run_targeting_single_change」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-anchor-mismatch-fix
  status: active

## FR-auto-backend-201 修复模式把一致错配的交互轮（spec_strategy=interactive）重锚到 X；正确锚定轮、混合命令轮（指向多个变更）、派发轮禁止触碰；幂等可重跑
变更：2026-10-13-anchor-mismatch-fix
状态：active
摘要：主路径；不触发
全文：.sillyspec/changes/archive/2026-10-13-anchor-mismatch-fix/requirements.md#FR-02
最近确认：2434a7500615f639e0283ced746a8586e8954de9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-anchor-mismatch-fix:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_fix_mismatch_reanchors_interactive_run + test_fix_mismatch_skips_mixed_and_dispatched + test_fix_mismatch_idempotent」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-anchor-mismatch-fix
  status: active

## FR-auto-backend-202 主导型信息项（指向多变更但最高占比 ≥80% 且 ≥5 条）单独列出仅报告，不自动修
变更：2026-10-13-anchor-mismatch-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-anchor-mismatch-fix/requirements.md#FR-03
最近确认：2434a7500615f639e0283ced746a8586e8954de9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-anchor-mismatch-fix:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_dominant_mixture_reported_but_not_fixed」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-anchor-mismatch-fix
  status: active

## FR-auto-backend-203 脚本 --mismatch 默认只报告，与 --apply 组合才落库；全工作区 --apply 沿用 --yes 门
变更：2026-10-13-anchor-mismatch-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-anchor-mismatch-fix/requirements.md#FR-04
最近确认：2434a7500615f639e0283ced746a8586e8954de9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-anchor-mismatch-fix:flow:测试绑定FR-04
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「test_scan_mismatch_is_read_only」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-anchor-mismatch-fix
  status: active

## FR-auto-backend-204 既有测试全过并新增用例绑定上述行为
变更：2026-10-13-anchor-mismatch-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-anchor-mismatch-fix/requirements.md#FR-05
最近确认：2434a7500615f639e0283ced746a8586e8954de9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-anchor-mismatch-fix:flow:测试绑定FR-05
  tests: backend/app/modules/change/tests/test_backfill_run_context.py「全量通过」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-anchor-mismatch-fix
  status: active

## FR-auto-backend-205 聊天会话的 interactive 轮保持 active，不再被 run.change_id 误收口
变更：2026-10-13-multiturn-changeid-misjudge
状态：active
摘要：聊天轮带归因 change_id 完成不收口；聊天轮失败不收口
全文：.sillyspec/changes/archive/2026-10-13-multiturn-changeid-misjudge/requirements.md#FR-01
最近确认：0bdf89c9040ff7158bb56931f0d243a251fd97ef

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-multiturn-changeid-misjudge:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_apply_session_terminal_status.py「TestChatTurnAttributionNotTerminal」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-multiturn-changeid-misjudge
  status: active

## FR-auto-backend-206 真绑定会话（session.change_id 非空）维持既有收口语义
变更：2026-10-13-multiturn-changeid-misjudge
状态：active
摘要：stage 会话完成收口；stage 会话可恢复失败豁免不变
全文：.sillyspec/changes/archive/2026-10-13-multiturn-changeid-misjudge/requirements.md#FR-02
最近确认：0bdf89c9040ff7158bb56931f0d243a251fd97ef

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-multiturn-changeid-misjudge:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_apply_session_terminal_status.py「test_interactive_with_change_completed_returns_edge_ended / TestRecoverableFailureKeepsSessionActive」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-multiturn-changeid-misjudge
  status: active

## FR-auto-backend-207 单轮任务收口语义零回归
变更：2026-10-13-multiturn-changeid-misjudge
状态：active
摘要：quick-chat 完成收口
全文：.sillyspec/changes/archive/2026-10-13-multiturn-changeid-misjudge/requirements.md#FR-03
最近确认：0bdf89c9040ff7158bb56931f0d243a251fd97ef

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-multiturn-changeid-misjudge:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_apply_session_terminal_status.py「test_quick_chat_completed_returns_ended / test_platform_managed_completed_returns_ended / test_sillyspec_completed_returns_ended / test_none_spec_strategy_completed_returns_ended」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-multiturn-changeid-misjudge
  status: active

## FR-auto-backend-208 D-005 幂等守卫零回归
变更：2026-10-13-multiturn-changeid-misjudge
状态：active
摘要：已终态会话不复活
全文：.sillyspec/changes/archive/2026-10-13-multiturn-changeid-misjudge/requirements.md#FR-04
最近确认：0bdf89c9040ff7158bb56931f0d243a251fd97ef

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-multiturn-changeid-misjudge:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_apply_session_terminal_status.py「test_idempotent_ended_even_for_multi_turn」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-multiturn-changeid-misjudge
  status: active
