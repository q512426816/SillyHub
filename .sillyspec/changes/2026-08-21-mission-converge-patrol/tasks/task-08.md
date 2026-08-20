---
id: task-08
title: 'schedule_loop 信号 1 zombie 豁免（窗口内 return None；信号 3 不豁免；既有调用方零回归）(depends_on: task-05)'
title_zh: 'schedule_loop 信号 1 zombie 豁免（窗口内 return None；信号 3 不豁免；既有调用方零回归）(depends_on: task-05)'
author: 'qinyi'
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-03.2]
decision_ids: [D-004, D-006]
allowed_paths:
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/tests/test_orchestrator.py
goal: >
  orchestrator.py schedule_loop 新增信号 1 zombie 豁免分支——主 run
  error_code=orchestrator_zombie 且复活窗口未耗尽时 return None 不收敛（等 patrol
  复活）；信号 3 预算触顶不豁免；豁免判定纯 DB 时间窗（D-006），既有调用方零回归。
implementation:
  - schedule_loop（orchestrator.py，all_workers_terminal 判定后、强制终态标记前）
    插入豁免分支——main_run.error_code==orchestrator_zombie AND mission.constraints
    的 zombie_marked_at 距今 < settings.mission_patrol_revive_window_minutes AND 非
    forced_degraded → log debug + return None（不收敛、不 merge worker 产物，等
    patrol 职责③复活）
  - 豁免判定纯 DB（error_code + zombie_marked_at 时间窗），不查 daemon 在线（D-006，
    schedule_loop 保持纯 DB 判断；daemon 恢复的复活由 patrol 清 error_code，豁免
    条件自然失谐）
  - 信号 3（forced_degraded 预算触顶）不豁免——治理强收优先级高于复活等待，豁免
    分支必须排除 forced_degraded 场景
  - zombie_marked_at 缺失/非法（含 constraints 为 None）→ 豁免不成立（不猜时间，
    对齐判死链路断链跳过语义），走原逻辑
  - 既有调用方零回归核查——run_sync 的 _handle_team_run_completion 与既有
    test_orchestrator.py schedule_loop 用例零改动通过（orchestrator_zombie 为全库
    新引入 error_code 值，只有 patrol 判死（task-05）才写，既有路径不触发豁免分支）
  - test_orchestrator.py 追加用例——zombie+窗口内+worker 全终态 → return None 且
    run/mission 状态不变；zombie+窗口耗尽 → 原信号 1 收敛（main_run 标 completed +
    converge）；zombie+窗口内+预算触顶 → 信号 3 照常强收 degraded；非 zombie 的
    error_code（如 no_online_daemon）→ 原逻辑不变
acceptance:
  - 主 run error_code=orchestrator_zombie 且 now-zombie_marked_at<revive_window 且
    worker 全终态——schedule_loop 返回 None，mission.converged_at 仍为空、run 状态
    不变
  - 同上但 zombie_marked_at 距今 >= revive_window——豁免不成立，信号 1 原逻辑照常
    收敛
  - zombie 窗口内 + 预算触顶——信号 3 强收照常（返回 degraded），不被豁免挡住
  - 既有 schedule_loop 用例（三重收敛状态机/cancelled 跳过/budget 强收等）零改动
    全绿，_handle_team_run_completion 调用路径语义不变
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_orchestrator.py app/modules/agent/tests/test_patrol.py -q
constraints:
  - 豁免只挡信号 1（worker 全终态收敛）；信号 3 预算触顶不豁免
  - 豁免判定纯 DB 时间窗——error_code==orchestrator_zombie AND now-zombie_marked_at<
    revive_window，不查 daemon 在线（D-006，复活由 patrol 职责③清标记解除）
  - 既有调用方（run_sync._handle_team_run_completion / 既有测试）零回归——error_code
    值 orchestrator_zombie 为全库新引入，仅 patrol 判死写入，既有路径不触发豁免
  - 只改 orchestrator.py + test_orchestrator.py；zombie 为新值不破坏既有断言，
    related_tests 无需登记
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
