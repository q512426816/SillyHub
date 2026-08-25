---
id: task-04
title: parameterize-create-session-triple-and-worker-briefing
title_zh: create_session 三元组模式参数化复用并新增分身任务简报
author: qinyi
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/agent/mission_context.py
provides:
  - contract: SessionService.create_session 参数化三元组入口（分身子会话形态——AgentSession + interactive lease + 首 run 原子三元组）与 mission_context 分身简报渲染，task-05 dispatch_worker 换三元组派发时消费（design §5.B）
    fields: [parent_session_id, stage, first_run_mission_id, first_run_role, build_worker_briefing]
expects_from: [task-03]
goal: >
  把 create_session 的原子三元组模式（AgentSession + interactive lease + 首 run 单事务
  commit，无孤儿）参数化出分身子会话形态（parent/owner/stage/首 run 双标记），
  并在 mission_context 落分身任务简报渲染，供 task-05 派发链路复用而不另起炉灶。
implementation:
  - create_session 增可选参数 parent_session_id（写 AgentSession.parent_session_id）、stage（透传 prepare_interactive_dispatch 写 lease metadata）、first_run_mission_id 与 first_run_role（首 run 双标记——现 team_mission 分支硬编码 mission.id 与 role 为 orchestrator 字面量，改为参数驱动，缺省时保持原值不变）。
  - 分身形态的 owner 即 user_id 入参本身（task-05 传 mission.created_by，D-004 归属对齐）——不新增独立 owner 参数；新参数全缺省时 create_session 行为逐字节不变。
  - mission_context.py 新增 build_worker_briefing（分身任务简报渲染）——objective + worktree 约束（复用 render_worker_prompt 的 git/direct 双变体约束文案模式）+ worker_done 工具用法（干完即调、追问重开工后可再调），供 task-05 作子会话首 prompt。
acceptance:
  - 新参数全缺省时存量 quick-chat、变更会话、团队主控创建三路行为零回归（含首 run 双标记原值）。
  - 传参形态下 parent_session_id 落会话行、首 run 带 mission_id 与分身 role、stage 进 lease metadata，三元组仍单事务原子提交无孤儿。
  - 分身简报含 objective、worktree 或 direct 约束变体、worker_done 用法三段，git 模式未知时省略模式字段不抛。
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_session_team_mission.py app/modules/agent/tests/test_team_mission_create_block.py app/modules/agent/tests/test_mission_context.py
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_session_service.py
  - cd backend && uv run mypy app && uv run ruff check .
constraints:
  - 不动 create_session 既有分支顺序与唯一 commit 点——参数化只加形态不拆事务；wake 失败收敛与首 turn SESSION_INJECT 链路共用不动。
  - stage 形参依赖 task-03 的 prepare_interactive_dispatch 扩展——W2 内先 03 后 04 执行或合并后联调。
  - 本卡零回归设计下不修改既有测试断言——判据为测试不失败，related_tests 留空；预期行为变更的断言更新与新增单测归 task-15 统一负责。
  - 分身简报是纯渲染函数（objective 等入参传入），不查 DB 不写行，对齐 mission_context 既有风格。
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
