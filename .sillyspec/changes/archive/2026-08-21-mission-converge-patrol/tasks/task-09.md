---
id: task-09
title: main-py-lifespan-patrol-wiring
title_zh: main.py lifespan 接线巡检协程
author: qinyi
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: [task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: [task-10]
requirement_ids: [FR-04]
decision_ids: [D-001]
allowed_paths:
  - backend/app/main.py
  - backend/app/modules/agent/tests/test_patrol.py
goal: >
  把 task-02 的巡检循环（mission_patrol_loop）以 lifespan 常驻协程接进 main.py，
  完成 D-001 载体方案最后一环——bootstrap 后 create_task 启动、yield 后
  cancel+gather 严谨关停、enabled=False 时零巡检协程（NFR-02 零回归边界）。
implementation:
  - main.py lifespan 内 bootstrap 完成（redispatch 启动重派块之后）、mcp session_manager yield 之前，settings.mission_patrol_enabled 为真时 asyncio.create_task 创建巡检协程（patrol.py 的 mission_patrol_loop，task-02 产物），并打 mission_patrol_started 启动日志（interval_seconds 随带）
  - 关停放 yield 后 finally——patrol_task.cancel() 后 await asyncio.gather(patrol_task, return_exceptions=True)，须等取消落地（巡检轮内有 DB 写，比 watchdog 的 fire-and-forget cancel 严谨，design §4 / Grill P2-4）；enabled=False 时任务变量为 None 直接跳过
  - test_patrol.py 追加接线行为单测（Plan Review gap-2——conftest client 走 ASGITransport 不触发 lifespan，故不写 lifespan 冒烟，以 patrol 循环函数单测验证接线行为）——enabled=False 时循环直接退出；enabled=True 时循环执行且被 cancel 后干净收尾
  - 新增代码注释标注 2026-08-21-mission-converge-patrol task-09 并指回 design §2/§4
acceptance:
  - lifespan bootstrap 后、yield 前 create_task 巡检协程；mission_patrol_enabled=False 时不创建任何巡检任务
  - yield 后 finally 对巡检任务 cancel 并 await gather(return_exceptions=True)（非 fire-and-forget）
  - mission_patrol_started 启动日志携带 interval
  - enabled=False 路径与既有 lifespan 行为一致（零回归），既有启动路径测试不红
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_patrol.py -q --no-cov
  - cd backend && uv run ruff format --check app/main.py && uv run ruff check app/main.py
  - cd backend && uv run mypy app
constraints:
  - 巡检任务放 lifespan——bootstrap 后、yield 前 create_task（对齐 watchdog_task 模式但不复用其 fire-and-forget 关停）
  - yield 后 finally 里 task.cancel() + await asyncio.gather(task, return_exceptions=True)——须等取消落地（巡检轮内有 DB 写）
  - enabled=False 不 create_task（零巡检协程）
  - 启动日志用 mission_patrol_started 且 interval 随带
  - 接线行为以 patrol 循环函数单测验证，不依赖 lifespan 冒烟（conftest client 用 ASGITransport 不触发 lifespan）
  - 不改 patrol.py 本体（循环与三职责属 task-02~07；发现缺陷反馈重派，不在本卡顺手修）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
