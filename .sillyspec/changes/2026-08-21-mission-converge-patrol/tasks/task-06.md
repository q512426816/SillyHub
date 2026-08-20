---
id: task-06
title: '僵尸复活（窗口内 daemon 恢复→running+清标记+重渲染 prompt 重派；重派失败回滚 zombie 态）(depends_on: task-05)'
title_zh: '僵尸复活（窗口内 daemon 恢复→running+清标记+重渲染 prompt 重派；重派失败回滚 zombie 态）(depends_on: task-05)'
author: 'qinyi'
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-03.3]
decision_ids: [D-004]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/tests/test_patrol.py
goal: >
  patrol.py 职责③复活段——豁免窗口内 daemon 恢复 online 的 zombie 主 run 翻回
  running + 清 zombie 标记 + 重渲染 prompt 重派 lease（D-004 两阶段可复活的后半段）；
  重派失败回滚 zombie 态，标记不丢。
implementation:
  - patrol.py MissionPatrolService 僵尸段新增复活扫描，候选 = 主 run error_code 为
    orchestrator_zombie（判死标记由 task-05 写入），按 design §2.3 判死链路取最新
    lease → runtime → daemon_instance（daemon_task_leases.agent_run_id 按 updated_at
    倒序取 1）
  - 复活条件三合一，任一不满足即跳过（链路断链同样跳过，对齐 task-05 判死跳过语义）：
    error_code==orchestrator_zombie AND now-zombie_marked_at<
    settings.mission_patrol_revive_window_minutes AND daemon.status==online
  - 复活动作——run.status=running、error_code=None、finished_at=None，mission.
    constraints 移除 zombie_marked_at；随后 render_orchestrator_prompt(mission,
    run, session) 重渲染 + RunPlacementService.dispatch_to_daemon 重派，传参对齐
    orchestrator.redispatch_pending_main_runs（run.id、mission.created_by、
    workspace_id=mission.workspace_id、provider/model/agent_profile_id 走
    _resolve_main_agent_config(mission.main_agent_config)、stage=orchestrator、
    read_only=False）
  - dispatch_to_daemon 抛 NoOnlineDaemonError → 回滚 zombie 态并 commit，log warning：
    status 回 failed、error_code 回 orchestrator_zombie、finished_at 恢复、
    zombie_marked_at 写回 constraints——不出现"既非 zombie 又未重派"的中间态
  - 复活成功 log info（mission_id/run_id/新 lease_id），zombie_revived 计数汇入
    round_done 结构化日志（FR-04.2，字段由 task-02 骨架预留）
  - test_patrol.py 追加用例——窗口内+daemon 恢复 online → running+标记清+重派（mock
    dispatch_to_daemon，断言 prompt 为重渲染产物）；窗口耗尽不复活；daemon 仍离线
    不复活；重派抛 NoOnlineDaemonError → zombie 态四字段完整回滚
acceptance:
  - zombie 主 run 在窗口内且 daemon 恢复 online——status=running、error_code=None、
    finished_at=None、constraints 无 zombie_marked_at，且 dispatch_to_daemon 以重渲染
    的 orchestrator prompt 被调用、产生新 lease
  - 重派抛 NoOnlineDaemonError——run 保持 failed + error_code=orchestrator_zombie +
    zombie_marked_at 保留（回滚完整，无中间态）
  - 窗口耗尽或 daemon 仍离线的 zombie run 不被复活（耗尽归 task-07，未恢复归等待窗口）
  - test_patrol.py 新增用例全绿，既有 patrol 用例（task-02~05 建）零回归
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_patrol.py -q
constraints:
  - 复活条件严格 = error_code==orchestrator_zombie AND now-zombie_marked_at<
    mission_patrol_revive_window_minutes AND daemon 恢复 online（在线判定走判死同款
    lease→runtime→daemon_instance 链路实时查询）
  - 复活动作 = status→running + 清 error_code/finished_at + 移除 zombie_marked_at +
    render_orchestrator_prompt 重渲染 + dispatch_to_daemon 重派
  - 重派抛 NoOnlineDaemonError → 回滚 zombie 态（failed + error_code 恢复 +
    zombie_marked_at 写回），标记不丢
  - 旧 claimed interactive lease 残留为 R-06 known 边界不处理（claim 侧 lease 归属
    校验保安全，新 lease 优先）
  - 只改 patrol.py + test_patrol.py；不碰 orchestrator.py（豁免归 task-08）、无
    schema 变更（zombie 标记复用 constraints JSON，NFR-03）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
