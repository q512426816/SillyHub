---
author: flow-machine-draft
created_at: 2026-10-08T03:57:52.316Z
---
# 需求规格（Requirements）— 2026-10-08-backend-restart-fake-failed

## 功能需求

### FR-01: 后端重启清理时，近期仍有 daemon 上报的运行轮不再被判死，等真终态

- 启动清理（`_cleanup_stale_runs_impl`）在把 running 轮判为 failed 前**必须**先查该轮
  `agent_run_logs` 的最新 `timestamp`：若距今不超过活性宽限窗（10 分钟），**必须**跳过判死、
  保持 running，并安排一次延迟复扫（宽限期后再查，日志停止老化才判 failed），把误杀窗口从
  「后端重启瞬间」推迟到「daemon 真正停止上报超过宽限期」。

#### 场景：近期有上报的运行轮不判死

- Given 后端重启，DB 中有 running 轮且其最新日志距今 3 分钟（daemon 仍在执行并持续上报）
- When 启动清理执行
- Then 该轮保持 running（不写 failed / SERVICE_RESTART_INTERRUPTED），记录跳过日志，
  并安排延迟复扫；复扫时若日志已停止老化超宽限才判 failed

#### 场景：上报停滞性超过宽限的轮照常清理

- Given 后端重启，DB 中有 running 轮但其最新日志距今 30 分钟（daemon 实际已死）
- When 启动清理执行
- Then 沿用既有行为判 failed + SERVICE_RESTART_INTERRUPTED（防止永卡 running）

#### 场景：无日志行的运行轮照常清理

- Given 后端重启，DB 中有 running 轮且无任何 agent_run_logs 行（派发后未产出日志）
- When 启动清理执行
- Then 沿用既有行为判 failed（活性检测无信号时不得阻塞清理）

### FR-02: 被误标 SERVICE_RESTART_INTERRUPTED 的轮收到 daemon 迟到的成功结果后能回正为 completed

- `close_interactive_run` 的终态幂等守卫**必须**放行一种例外：run 已终态 failed 且
  `error_code=SERVICE_RESTART_INTERRUPTED`（重启误杀标记）、本次上报为成功
  （`status=success` 且 `is_error=false`）时，**必须**按正常收口流程重放终态把 run 回正为
  completed（清掉误杀的 error_code/error_detail/兜底文案，重发终态事件），UI 不再显示假失败。
  其余已终态情形**必须**维持现状 no-op 拒收（幂等安全不变）。

#### 场景：误杀轮收到迟到成功结果回正

- Given run 已被启动清理标 failed + SERVICE_RESTART_INTERRUPTED（daemon 实际仍在跑）
- When daemon 跑完后 POST 轮结果（status=success, is_error=false）
- Then run 回正为 completed、exit_code=0、error_code/error_detail 清空，
  会话/轮终态事件重发，前端轮徽标显示完成

#### 场景：其余终态重复上报仍拒收

- Given run 已终态（含 failed+interactive_failed、completed 等非误杀标记情形）
- When daemon 重试 POST 同一轮结果（任意 status）
- Then 维持既有 no-op 幂等返回，不重复触发收口钩子（回归保护）

### FR-03: 补充对应用例覆盖上述两条路径

- **必须**以 real-DB 用例覆盖 FR-01（近期上报跳过 / 停滞清理 / 无日志清理）与 FR-02
  （误杀回正 / 其余终态仍拒收）两条路径，随实现同仓提交。

#### 场景：主路径

- Given 实现合入
- When 跑本变更新增测试文件
- Then 全部用例绿，且不破坏既有相关测试

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/backend/tests/modules/agent/test_stale_run_cleanup_liveness.py「test_cleanup_skips_run_with_recent_daemon_activity」
FR-01: test/backend/tests/modules/agent/test_stale_run_cleanup_liveness.py「test_cleanup_fails_run_with_stale_activity」
FR-01: test/backend/tests/modules/agent/test_stale_run_cleanup_liveness.py「test_cleanup_fails_run_without_logs」
FR-02: test/backend/tests/modules/daemon/test_close_interactive_run_retroactive.py「test_late_success_result_rehabilates_service_restart_interrupted_run」
FR-02: test/backend/tests/modules/daemon/test_close_interactive_run_retroactive.py「test_other_terminal_results_stay_noop」
FR-03: test/backend/tests/modules/agent/test_stale_run_cleanup_liveness.py + test/backend/tests/modules/daemon/test_close_interactive_run_retroactive.py「全文件用例集」
