---
id: task-13
title: 'TeamMissionWorkerSummary 加 sub_session_id/first_run_id + _team_mission_summary 子会话行化 + gen:types 同步'
title_zh: 'TeamMissionWorkerSummary 加 sub_session_id/first_run_id + _team_mission_summary 子会话行化 + gen:types 同步'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-09']
blocks: [task-14, task-15]
requirement_ids: [FR-08, FR-09]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: TeamMissionWorkerSummary
    file: backend/app/modules/daemon/schema.py
    fields: [sub_session_id, first_run_id]
    consumers: [task-14]
expects_from:
  task-05:
    - contract: mission_worker_sessions 分身行数据源
      needs: [sub_session_id, first_run_id, role, objective, status]
goal: >
  前端团队任务块要能按分身子会话打开面板，摘要行先得带上子会话标识——
  TeamMissionWorkerSummary 加 sub_session_id（避开与 AgentSession.agent_session_id
  同名异义，design §5.E）与 first_run_id（供 get_worker_result 连续消费），
  _team_mission_summary 的 workers 数据源对新形态换子会话行（存量 mission 回落
  batch run 行），并跑 pnpm gen:types 同步 openapi 与 api-types 不留类型债。
implementation:
  - schema.py TeamMissionWorkerSummary 加两个可选字段——sub_session_id 与 first_run_id（均 uuid 可缺省 None），存量响应字段零变化
  - router.py _team_mission_summary workers 组装行化——新形态经 mission_worker_sessions（task-01 单一真相源枚举）取子会话行与首 run；sub_session_id 取子会话 id、first_run_id 取首 run id、role 与 objective 取首 run 双标记、status 按 is_worker_complete 与 mission_derive_status 单一真相源口径映射；存量 mission 无子会话行时回落现 run 行组装
  - 轮次 run 不混入——追问轮次 run（无 mission_id）不进 workers 列表，主控轮照旧不进（role=orchestrator 过滤语义保留）
  - pnpm gen:types 再生成——backend/openapi.json 与 frontend/src/lib/api-types.ts 同一提交内更新，TeamMissionWorkerSummary 新字段进前端类型
  - 既有测试断言不动——test_session_team_mission 与 test_team_mission_create_block 的预期行为变更更新归 task-15
acceptance:
  - 新形态 mission 摘要 workers 每行含 sub_session_id 与 first_run_id，分身数量等于子会话数（轮次 run 不混入、主控轮不进）
  - 存量 batch 分身 mission 摘要与改动前逐字节一致（两新字段为 None，行内容不变）
  - openapi.json 与 api-types.ts 含 sub_session_id 与 first_run_id，前端类型可引用
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_team_mission.py -q --no-cov
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - gen:types 前先确认前端 node_modules 健康（CLAUDE.md 规则 21）——pnpm exec tsc --version 能跑且 .bin 有 shim；半坏会报假的 CSSProperties 与 Cannot find module 错，修复用 pnpm install --force 而不是改代码
  - 字段定名 sub_session_id 与 first_run_id 不用别的名（design §5.E Grill P2⑨ 同名异义坑与 §6 实现级备注），与 task-05 契约字段两边对齐
  - mission_derive_status 状态口径替换归 task-09，本卡只动 workers 行数据源与字段
  - list_workers MCP 侧行化归 task-05（FR-09 分工），本卡不碰 mcp_tools.py
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
