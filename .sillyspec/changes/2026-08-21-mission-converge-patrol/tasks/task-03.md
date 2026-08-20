---
id: task-03
title: '收敛兜底接线（每轮对活跃 mission 调 schedule_loop，converged 计数）(depends_on: task-02)'
title_zh: '收敛兜底接线（每轮对活跃 mission 调 schedule_loop，converged 计数）(depends_on: task-02)'
author: qinyi
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-002]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/tests/test_patrol.py
provides: []
expects_from: []
goal: >
  在 task-02 的 MissionPatrolService 骨架上接线职责①收敛兜底（design §2.1）：每轮巡检对
  活跃 mission（converged_at/cancelled_at 均 NULL，limit 100）逐个调
  OrchestratorService.schedule_loop，按返回值统计 converged 计数并透传 round_done 日志——
  补上项目维度 mission 的事件缺口（run_sync 对 change_id IS NULL 短路，schedule_loop
  此前无任何触发点，主 agent 不收敛时 mission 挂死）。
implementation:
  - 巡检轮内（task-02 的每轮独立短 session 中）实现职责①方法（如 _patrol_converge(session) -> int）：select(AgentMission.id).where(converged_at IS NULL, cancelled_at IS NULL).order_by(AgentMission.created_at).limit(100)（design §2.1 活跃查询；R-05 老 mission 先巡检）。
  - 逐 mission 调 OrchestratorService(session).schedule_loop(mid)（orchestrator.py:416）：返回 str=收敛后 mission status（done/degraded/...）、None=本轮未触发收敛（orchestrator.py:441-443 返回值语义）；非 None 时 converged 计数 +1。
  - 单 mission 异常隔离：try/except 捕获 schedule_loop 异常 → log.warning（带 mission_id + error），继续巡检下一个（design §2 全程单 mission 异常隔离）。
  - converged 计数并入 task-02 的 round_done 日志字段（converged=N），观测走结构化日志（本变更不做管理端点）。
  - external/single 模式 mission 无主 run → schedule_loop 内部自跳过返回 None（orchestrator.py:466-473），本任务零额外过滤、零改动。
  - test_patrol.py 追加用例（design §7 收敛兜底组）：活跃 mission 每个 schedule_loop 恰被调一次（mock 断言调用列表）；cancelled/converged mission 不进查询不被调；schedule_loop 抛异常不影响其余 mission；返回 done 计 1 / 返回 None 计 0（计数透传断言）。
acceptance:
  - 活跃 mission（未收敛未取消，limit 100）逐个被 schedule_loop 巡检一次（mock 调用断言）；cancelled_at/converged_at 非空的 mission 被排除。
  - schedule_loop 返回非 None 计入 converged、None 不计，converged 计数透传进 round_done 日志（断言日志字段或返回计数结构）。
  - 单个 mission 的 schedule_loop 异常不中断同轮其它 mission 的巡检（异常隔离用例绿）。
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_patrol.py -q --no-cov
constraints:
  - 只在 patrol.py 追加职责①实现 + test_patrol.py 追加用例；不改 orchestrator.py（schedule_loop 既有签名/返回值语义零改动，zombie 豁免分支属 task-08）。
  - 复用 task-02 骨架的每轮短 session 与单 mission 异常隔离结构，不新建长连接、不另起循环。
  - 活跃查询保持 limit 100 + created_at 序不加新过滤（R-05）：收敛兜底不按 change_id/模式过滤——项目维度限定是 task-05 判死候选的约束，不作用于本职责；external/single 靠 schedule_loop 自跳过。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
