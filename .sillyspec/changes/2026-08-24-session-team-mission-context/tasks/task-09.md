---
id: task-09
title: 'service.py create 路径预建+E2 解析——flush-only 预建+objective 直取首句+首 run 双标记+create 简报前缀+orchestrator_workspace_id（workspace_id/binding 钉定 422/cwd/默认配置）'
title_zh: 'service.py create 路径预建+E2 解析——flush-only 预建+objective 直取首句+首 run 双标记+create 简报前缀+orchestrator_workspace_id（workspace_id/binding 钉定 422/cwd/默认配置）'
author: 'qinyi'
created_at: 2026-08-24 19:01:09
priority: P0
depends_on: ['task-04', 'task-07', 'task-08']
blocks: [task-13]
requirement_ids: [FR-05, FR-06]
decision_ids: [D-009@v2, D-010@v1, D-014@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_session_team_mission.py
  - backend/app/modules/daemon/tests/test_change_session.py
provides:
  - contract: create_session_team_mission
    file: backend/app/modules/daemon/session/service.py
    fields: [team_mission, orchestrator_workspace_id]
    consumers: [task-13]
expects_from:
  task-04:
    - contract: precreate_mission_flush
      needs: [precreate_mission_flush]
  task-06:
    - contract: mission_context
      needs: [build_orchestrator_briefing]
  task-07:
    - contract: TeamMissionCreateBlock
      needs: [TeamMissionCreateBlock, validate_team_mission_block, team_mission]
goal: >
  create_session 请求携带 team_mission（task-07 DTO）时：session 行 flush 后、
  首 run 创建前用 task-04 flush-only helper 预建 mission（objective=block.objective
  ‖首句 prompt），首 run 补双标记（mission_id+role=orchestrator），首 prompt
  （:919 组装点）追加团队简报前缀（变更前导在前）；E2：orchestrator_workspace_id
  ∈scope 校验+(W,创建者) WorkspaceMemberRuntime binding 钉定（缺失 422）+
  session.workspace_id=W+cwd+默认智能体（显式优先）——预会话派团队的后端落地
  （FR-05/06），无 team_mission 的 create 行为逐字节不变。
implementation:
  - 'router.py create 端点（:2014-2025）透传 team_mission=data.team_mission（仅此一处路由改动）；service.create_session 增可选入参 team_mission: TeamMissionCreateBlock | None = None——事务开始前调 task-07 共享校验 validate_team_mission_block（scope 去重保序/项目维度 403/scope 越界 422/anchor backend-code 优先派生），不可满足直接 4xx、无半成品落库'
  - 'E2 解析（事务开始前，design §5.E2/D-010@v1）：team_mission.orchestrator_workspace_id=W 非空时——① W ∉ scope → 422；② 查 (W, user_id) 的 WorkspaceMemberRuntime binding 行：行缺失或 runtime_id 为空 → 422「该工作区未绑定你的机器」（D-014@v1，不借用他人 binding 钉定）；③ 命中 → workspace_id 覆写为 W（session.workspace_id=W）、cwd=W.root_path、binding.runtime_id 作 pinned_runtime_id 复用既有钉定链（placement.py:651 起属主+在线复查，失联转 4xx 不静默换机）；④ 用户未显式传 agent_profile_id/llm_provider_id/runtime_id 时 provider/model 落 W.default_agent/W.default_model（显式选择逐字节优先，R-09，后端不因不一致 422）'
  - 'create 主链（:868-1008 事务内）：session 行 add+flush（:884-885）后、首 run 构造（:890-906）前调 task-04 flush-only 预建 helper（session 模式：session_id=session.id、objective=block.objective 非空否则直取首句 prompt——create 路径不经 _inject_into_session 占位回填、scope/project_id/budget/worker_preset/main_agent_config 透传）——不 commit，共用 :1008 唯一 commit；中途任意环节异常走 :1011-1013 整体回滚，无孤儿 session/mission/run/lease（D-009@v2/R-04）'
  - '首 run 双标记：AgentRun 构造处补 mission_id=mission.id、role="orchestrator"（字面量对齐 _inject_into_session :1710-1711 既有口径与 orchestrator.py _ORCHESTRATOR_ROLE）'
  - '首 prompt 简报前缀：:919-920 组装点改为 变更前导（build_change_context_preamble 既有，在前）→ 团队简报（task-06 build_orchestrator_briefing(mission, session)）→ "\n\n---\n\n" → 用户消息；lease metadata 经 dispatch_prompt 携带前缀（既有机制），AgentRunLog(user_input)（:1000-1007）与首 turn SESSION_INJECT payload prompt（:1061）仍写干净用户原文（对齐变更前导先例，D-004@v1）'
  - '补测试（test_session_team_mission.py 为主，双前导叠加用例可落 test_change_session.py）：① create 携 team_mission → mission 行（planning、objective=block.objective‖首句）+ 首 run 双标记 + lease metadata prompt 含团队简报前缀 + user_input 干净断言 ② create 中途异常（如 placement 抛 NoOnlineDaemonError）→ 回滚后无 session/mission 行残留（flush-only 锚点）③ E2——W∉scope 422 / binding 缺失（无行或 runtime_id 空）422 / 命中例断言 workspace_id+cwd+pinned runtime+默认 provider·model+显式优先 ④ 无 team_mission 的 create 既有行为回归（test_session_create_config/test_session_router 不改断言）⑤ change_id+team_mission 同携——变更前导在前、团队简报在后、--- 、用户消息的顺序断言（R-06）'
acceptance:
  - 'create 携 team_mission → mission 行落库（planning）+ objective=block.objective 非空否则=首句 prompt + 首 run 双标记（mission_id+role=orchestrator）+ 首轮 dispatch prompt=变更前导（若有）+团队简报+"\n\n---\n\n"+用户消息（前缀顺序定死），AgentRunLog(user_input) 与 SESSION_INJECT payload prompt 保持干净用户原文'
  - 'create 中途异常整体回滚：无孤儿 session/mission/run/lease 行（flush-only 预建 + 共用 :1008 单 commit，D-009@v2）'
  - 'E2：orchestrator_workspace_id ∉ scope → 422；(W, 创建者) WorkspaceMemberRuntime binding 缺失（无行或 runtime_id 空）→ 422；命中 → session.workspace_id=W + binding.runtime_id 钉定（placement 在线复查失联转 4xx 不静默换机）+ cwd=W.root_path + 未显式选 agent_profile_id/llm_provider_id/runtime_id 时 provider/model=W.default_agent/W.default_model（显式选择优先，R-09）'
  - '无 team_mission 的 create 请求行为与落库字段逐字节不变（team_mission 缺省 None 零分支进入；orchestrator_workspace_id=null 时 E2 全段跳过）；既有 test_change_session / test_session_create_config / test_session_router 全绿'
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_team_mission.py -q --no-cov
  - cd backend && uv run pytest app/modules/daemon/tests/test_change_session.py app/modules/daemon/tests/test_session_create_config.py -q --no-cov
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
constraints:
  - '同文件 W3 在前：task-08 已改 _inject_into_session（:1682-1712 判定/:1953 prompt 组装），本卡 Edit 只动 create 段（:868-1090）与入口解析/新增入参，勿触碰 inject 锚点区'
  - '预建只走 task-04 flush-only helper，本卡不得在 create 事务内新增 commit/refresh；不建主控 run 以外的额外 run、不派 worker lease（首 run 即主控轮）；简报文本由 task-06 helper 产出，本卡只拼前缀'
  - 'E2 钉定不借用他人 binding（D-014@v1）；显式 runtime_id/agent_profile_id/llm_provider_id 优先于 W 默认配置（R-09）；router.py 仅 create 端点一处透传，不改其它行为'
  - '不加 alembic 迁移（零表结构变更，design §8——session.workspace_id 复用既有列）'
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
