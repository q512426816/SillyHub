---
author: flow-machine-draft
created_at: 2026-10-11T03:36:49.940Z
---
# 需求规格（Requirements）— 2026-10-11-task-sweep-liveness-guard

## 功能需求

### FR-01: 清扫只收「最近无心跳」的任务（心跳宽限 + is_async 豁免）

- `finalize_running_tasks_for_run` 与 `sweep_orphan_running_tasks` 的收口条件必须收紧为：status 非终态 **且** `is_async=false` **且** `updated_at` 距清扫时刻超过 `TASK_SWEEP_GRACE`（5 分钟）；宽限窗内心跳活跃的任务（含跨轮次存活的后台子代理任务——主代理开轮派发后轮结束、任务继续跑、跑完发 [后台任务通知] 唤醒新轮继续回复）不得被误收。

#### 场景：后台任务跨轮存活不被误收

- Given 一个 run 收口时，其名下有一个 3 分钟前刚心跳过的后台任务（running）
- When run 收口清扫 / 启动兜底清扫执行
- Then 该任务保持 running（宽限窗内），不被标「已停止」

### FR-02: 清扫收口行可被 running 心跳复活（误收自愈）；真实终态行维持吸收

- 清扫收口必须写可识别标记（`message=RUN_CLOSE_SWEEP_REASON`）；`upsert_agent_task` 对携带该标记的 stopped 行收到 running 事件时必须复活（status 回 running、`finished_at` 清空、标记清除、事件字段照常累积）；事件驱动的真实终态行（message 非该标记）必须维持终态吸收（迟到 running 不复活）。

#### 场景：误收自愈

- Given 一个被清扫收口（stopped+标记）但其实仍在跑的后台任务
- When 它的下一个 running/progress 心跳到达
- Then 行复活为 running（finished_at 空、标记清除、progress 累积）

#### 场景：真实终态不复活

- Given 事件驱动写入的 stopped 行（message=用户停止等）
- When 迟到 running 心跳到达
- Then 维持 stopped 不复活（既有语义②零回归）

### FR-03: run 收口安排延迟复扫（孤儿不靠重启兜底）

- run 收口时必须恒排一个延迟复扫后台任务（宽限窗 + 60s 缓冲后对该 run 重跑 finalize）：收口时点宽限内活跃、此后再无心跳的任务在窗后收敛；复扫幂等（已终态/仍新鲜行 no-op），失败仅记日志不影响已提交终态。

#### 场景：新鲜后沉默的孤儿

- Given 收口时任务 1 分钟前刚心跳（未收口），此后再无任何心跳
- When 宽限+缓冲后的延迟复扫执行
- Then 该任务被收口为 stopped（带标记，仍可被复活分支自愈）

### FR-04: 既有行为回归

- 既有 `agent_session_tasks` 全部测试必须通过（upsert 语义/快照端点/上报旁路/级联）；close 链路回归通过；ruff/mypy 零错。

#### 场景：回归

- Given 本变更合入
- When 运行上述测试与静态检查
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_finalize_sweeps_only_stale_sync」
FR-02: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_stopped_row_revives_on_running_heartbeat」
FR-03: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_delayed_resweep_catches_now_silent」
FR-04: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_genuine_stopped_absorbs_running_heartbeat」
