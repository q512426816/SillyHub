---
id: task-02
title: scaffold-mission-patrol-service
title_zh: patrol.py 巡检骨架（循环 + 活跃查询 limit100 + 异常隔离 + round_done 日志 + 每轮短 session + enabled=False 退出）
author: qinyi
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: []
blocks: [task-03, task-04, task-05, task-09]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-001, D-002]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/tests/test_patrol.py
goal: >
  新建 MissionPatrolService 巡检骨架：常驻循环（watchdog 协程模式）+ 活跃 mission
  查询 + 异常隔离 + round_done 日志 + 每轮独立短 session，为 Wave 2 三职责提供统一挂载点。
implementation:
  - 新建 backend/app/modules/agent/patrol.py：模块级 async def mission_patrol_loop() -> None（lifespan 接线入口，task-09 消费，对齐 monitoring.start_event_loop_watchdog 常驻协程模式，内部调 MissionPatrolService().loop()）
  - class MissionPatrolService（构造不持 session）：async def run_once(self) -> dict[str, int] 单轮——async with get_session_factory()() as session 开独立短 session，顺序执行三职责挂载点后返回计数 dict；async def loop(self) -> None——while get_settings().mission_patrol_enabled: 计时调 run_once + await asyncio.sleep(get_settings().mission_patrol_interval_seconds)，enabled=False 时循环体一次不进直接返回
  - async def _active_mission_ids(self, session) -> list[uuid.UUID]：select(AgentMission.id).where(converged_at.is_(None), cancelled_at.is_(None)).order_by(AgentMission.created_at).limit(100)（FR-01.3，created_at 序老 mission 先巡）
  - 三职责挂载点为私有 no-op 占位（_patrol_convergence/_patrol_redispatch/_patrol_zombie，返回计数 0，TODO 注明 task-03/04/05 填充）；异常隔离框架就位：职责①占位内"查活跃 → 逐 mission try/except"（单 mission 抛错记 mission_patrol_mission_failed warning 后继续，FR-01.2），三职责间各自 try/except 互不阻断
  - 每轮结束打 mission_patrol_round_done 结构化日志：checked/converged/redispatched/zombie_marked/zombie_revived 五计数 + duration_ms（FR-04.2）
  - 新建 backend/app/modules/agent/tests/test_patrol.py（照 test_orchestrator.py 惯例：db_session fixture + pytest.mark.asyncio）：enabled=False 退出、活跃查询过滤/排序/limit、异常隔离、round_done 日志断言
acceptance:
  - enabled=False 时 loop() 立即返回且 run_once 未被调用；enabled=True 时按 interval 循环
  - _active_mission_ids 只返回 converged_at/cancelled_at 均 NULL 的 mission id，created_at 升序，至多 100 条
  - 单 mission 处理抛异常仅记 warning，同轮其余 mission 不受影响
  - run_once 返回五计数 dict 且每轮打 mission_patrol_round_done 日志；骨架阶段 converged/redispatched/zombie_* 恒 0、checked 为真实活跃数
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_patrol.py -q --no-cov
  - cd backend && uv run ruff check app/modules/agent/patrol.py app/modules/agent/tests/test_patrol.py && uv run mypy app/modules/agent/patrol.py
constraints:
  - 每轮独立短 session：run_once 内 get_session_factory()() async with，轮间不长期持连接（对齐 complete_lease 请求路径生命周期），三职责共用该轮 session
  - enabled=False 循环退出（零回归）；开关/间隔读 task-01 四字段（同 Wave 并行，执行本任务前确认 task-01 字段已就位）
  - 单 mission try/except 异常隔离 + 活跃查询 limit 100 严格不变；只做骨架：三职责真实逻辑归 task-03/04/05，schedule_loop 不改（task-08），main.py 不接线（task-09）
provides:
  - contract: MissionPatrolService（run_once 返回五计数 dict：checked/converged/redispatched/zombie_marked/zombie_revived）
    fields: [run_once, loop, _active_mission_ids]
  - contract: mission_patrol_loop（模块级 lifespan 入口，task-09 接线）
    fields: [mission_patrol_loop]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
