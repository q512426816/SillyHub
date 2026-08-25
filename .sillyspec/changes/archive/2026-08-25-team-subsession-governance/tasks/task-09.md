---
id: task-09
title: '判据点全面替换（_converge_core/converge_explicit/schedule_loop/_team_mission_summary/_mission_status_core/workers_all_terminal_with_stats/cleanup_mission）'
title_zh: '判据点全面替换（_converge_core/converge_explicit/schedule_loop/_team_mission_summary/_mission_status_core/workers_all_terminal_with_stats/cleanup_mission）'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-08']
blocks: [task-10, task-13, task-15]
requirement_ids: [FR-05, FR-09]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/finalizer.py
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/mission_context.py
  - backend/app/modules/daemon/router.py
expects_from:
  task-08:
    - contract: worker_complete_truth
      needs: [is_worker_complete, mission_derive_status, workers_only]
goal: >
  判据点全面替换（FR-05/FR-09）——七个判据/derive 消费点全部改调 task-08
  单一真相源（is_worker_complete / mission_derive_status），禁各自实现。
  分身 idle 未 done 不再被误判完成/触发超时收敛时钟/删 worktree；存量
  batch 分身双判据兼容零回归。
implementation:
  - 'mcp_tools.py 两点——_converge_core busy 前置（:1089-1113 non_orchestrator_runs+终态集合）改 mission_derive_status(workers_only=True) 派生非全终态即 busy（未完成计数文案口径保留）；_mission_status_core（:1750-1760 直查 runs+derive_status）改 mission_derive_status——子会话形态经虚拟映射不再被主控轮 run 状态遮蔽'
  - 'finalizer.py 两点——converge_mission_for_completed_run converge_explicit 分支（:644-649 derive_status(non_orchestrator_runs)）改 mission_derive_status(workers_only=True)（对齐 D-010 置位不依赖主控 run，should_converge 含 done/degraded/failed 语义不变）；cleanup_mission（:476-484 run 终态清理名单）改为只清已完成分身的 worktree 副本——未完成分身（idle 未 done/追问重开工中）cwd 不动，存量 run 形态名单不变'
  - 'orchestrator.py 一点——schedule_loop 信号 1（:841-845 _WORKER_TERMINAL run 终态判定）改 mission_derive_status(workers_only=True)（空 worker 集不算的全终态语义保留）；会话 mission 分流 no-op 段与 zombie 豁免不动'
  - 'daemon/router.py 一点——_team_mission_summary（:2800-2808 derive_status(worker_runs)）改 mission_derive_status——分身 idle 未 done 不再误显 awaiting_input（防止 patrol 超时收敛时钟误启动）；workers 列表数据源行化归 task-13 本卡只换 status 源'
  - 'mission_context.py 一点——workers_all_terminal_with_stats（:170-187 run 终态判定）判据换 is_worker_complete（子会话按会话判定、存量 run 形态按 run 终态、planning 空集=未全终态语义保留）——complete_lease / patrol 两调用点不再对子会话形态误发「全部终态请收敛」，worker_done 成为唯一正确唤醒源（task-07 端点触发）'
acceptance:
  - '分身 idle 未 done 时——converge 返 busy、mission_status/团队块状态源不进完成档、不触发 patrol 超时收敛时钟、cleanup 不删其 worktree 副本；全 done 后各状态源一致收敛（FR-05 验收）'
  - '存量 mission（batch run 形态、随机 session_id）收敛/超时/清理/通知行为逐字节不变（FR-09 双判据兼容）——五处判据点改调包装后对存量输入等价'
  - '七处消费点零私有判定残留（grep 无第二套完成词表）——全部经 task-08 两函数，design §7 风险表口径'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_mission_status.py app/modules/agent/tests/test_converge_mission_reentrant.py app/modules/agent/tests/test_patrol.py app/modules/daemon/tests/test_session_team_mission.py app/modules/daemon/tests/test_team_mission_create_block.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent app/modules/daemon && uv run mypy app
constraints:
  - 'derive_status run 纯函数签名不动（D-005@v1）；七处全部改调 task-08 契约函数，禁各自实现第三套判定；不动 mission.py（task-08 已落函数，避免并行互覆——plan 拓扑 task-09←08）'
  - 'related_tests 处置（二选一明确取 plan 路线）——判据替换会使 test_mission_status.py / test_converge_mission_reentrant.py / test_patrol.py / test_session_team_mission.py / test_team_mission_create_block.py 部分断言失效，按 plan 任务总表归 task-15 统一更新（task-15 行已列全），本卡 allowed_paths 忠实五文件、不改这些测试文件；本卡 verify 跑五个文件守护存量双判据路径全绿，新形态行为断言由 task-15 补'
  - 'cleanup_mission 只改清理名单判据（未完成分身不动），merge/冲突/回滚链路归既有；converge 沿树 end_session 收口归 task-10；list_workers 子会话行化归 task-13'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
