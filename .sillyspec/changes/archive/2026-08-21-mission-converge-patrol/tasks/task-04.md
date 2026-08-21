---
id: task-04
title: '离线重派接线（调 redispatch_pending_main_runs，redispatched 计数透传）(depends_on: task-02)'
title_zh: '离线重派接线（调 redispatch_pending_main_runs，redispatched 计数透传）(depends_on: task-02)'
author: qinyi
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/tests/test_patrol.py
provides: []
expects_from: []
goal: >
  在 MissionPatrolService 骨架上接线职责②离线重派（design §2.2）：每轮巡检直接调用既有
  OrchestratorService.redispatch_pending_main_runs()（ql-20260821-002/BE-P1-6 已建，把
  启动时的一次性兜底常驻化），返回的 redispatched 计数透传 round_done 日志——覆盖
  「daemon 离线期间建的 mission 主 run pending+no_online_daemon，daemon 恢复后自动启动」场景。
implementation:
  - 巡检轮内实现职责②方法（如 _patrol_redispatch(session) -> int）：直接调 OrchestratorService(session).redispatch_pending_main_runs()（orchestrator.py:355，内部过滤 role=orchestrator + status=pending + error_code=no_online_daemon 并跳过已取消/已收敛 mission），返回值即成功重派的 run 数。
  - redispatched 计数并入 round_done 日志字段（与 task-03 的 converged 并列），观测走结构化日志。
  - redispatch 整体异常隔离：try/except → log.warning，不中断同轮其它职责（design §2 异常隔离口径，粒度为整职责）。
  - test_patrol.py 追加用例（design §7 离线重派组 + Grill P2-6 计数透传）：mock redispatch_pending_main_runs 断言每轮被调一次；返回值透传（返回 2 → redispatched=2）；抛异常不中断巡检轮。
acceptance:
  - 每轮巡检调用一次 redispatch_pending_main_runs（mock 断言），返回计数透传进 round_done 日志（Grill P2-6）。
  - redispatch 异常被隔离，不影响同轮其它职责（异常隔离用例绿）。
  - daemon 恢复场景由 service 级调用链覆盖（mock 验证调用与计数，不依赖真 daemon 连接）。
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_patrol.py -q --no-cov
constraints:
  - 直接复用既有 redispatch_pending_main_runs（orchestrator.py:355），零改动 orchestrator.py；不在 patrol.py 重复实现重派/派发/渲染逻辑。
  - 重派频控不在本任务范围（dispatch 频控评估留后续变更，orchestrator.py:363 注释口径；巡检周期默认 60s 即自然节流）。
  - 只动 patrol.py + test_patrol.py，不触 placement / lease / run_sync 模块。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
