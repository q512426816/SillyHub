---
id: task-07
title: 'SessionCreateRequest.team_mission DTO——TeamMissionCreateBlock（含 orchestrator_workspace_id）+trigger 校验抽共享函数'
title_zh: 'SessionCreateRequest.team_mission DTO——TeamMissionCreateBlock（含 orchestrator_workspace_id）+trigger 校验抽共享函数'
author: 'qinyi'
created_at: 2026-08-24 18:49:24
priority: P0
depends_on: []
blocks: [task-09, task-12]
requirement_ids: [FR-05, FR-06]
decision_ids: [D-010@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_session_team_mission.py
  - backend/app/modules/daemon/tests/
goal: >
  新增 TeamMissionCreateBlock DTO 挂到 SessionCreateRequest.team_mission，并把 trigger 端点的 scope/项目维度校验抽为共享函数供 task-09 的 create 路径复用——预会话派团队（FR-05/06）的后端入口契约。
provides:
  - contract: TeamMissionCreateBlock
    fields: [TeamMissionCreateBlock, team_mission, validate_team_mission_block, orchestrator_workspace_id]
implementation:
  - daemon/schema.py 新增 TeamMissionCreateBlock——objective/scope_workspace_ids/project_id/budget_usd/worker_preset/main_agent_config 六字段形态逐字对齐 TeamMissionTriggerRequest（schema.py:713-730，list[dict]/dict/UUID 口径，不新造 WorkerPresetItem 等类），新增 orchestrator_workspace_id（UUID|None，主 agent 工作区 ∈ scope，null=当前会话默认）
  - SessionCreateRequest（schema.py:86-116）加可选 team_mission（TeamMissionCreateBlock | None，默认 None，不影响既有 runtime_id/provider 二选一校验）
  - daemon/router.py 把 trigger_session_team_mission（:2428-2563）内 scope 去重保序解析/项目经理 403/scope 越界 422/anchor backend-code 优先派生段（:2466-2533）抽为共享校验函数（如 validate_team_mission_block），trigger 端点改调用
  - 补测试——DTO 字段透传（orchestrator_workspace_id）、共享函数单测、旧请求体回归
acceptance:
  - 旧请求体（不带 team_mission）经 SessionCreateRequest 校验与 create 流程行为逐字节不变（team_mission 缺省 None）
  - trigger 端点重构后既有行为不变——scope 去重保序/项目维度 403/scope 越界 422/anchor 派生口径逐字保留，test_session_team_mission.py 全绿
  - TeamMissionCreateBlock 七字段齐全且 openapi 产出具名 schema（供 pnpm gen:types 与 task-09/12/13 消费）
  - 校验逻辑单一实现——trigger 与 create（task-09）共用同一共享函数，无复制粘贴
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run mypy app
constraints:
  - 校验逻辑抽共享函数复用，禁止复制粘贴；trigger 端点对既有调用方零回归
  - 本卡仅 DTO+校验抽取——create_session 消费逻辑、E2 的 orchestrator_workspace_id ∈ scope 校验与 (W,创建者) binding 钉定均归 task-09
  - orchestrator_workspace_id 在本卡只透传不校验语义（校验在消费侧 task-09）
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
