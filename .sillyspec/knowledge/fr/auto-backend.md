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
