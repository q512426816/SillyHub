---
id: task-06
title: 'mission_context helper 新文件——首主控轮判定（空 prompt 排除/failed 不烧断）+简报组装（inject/create 共用）'
title_zh: 'mission_context helper 新文件——首主控轮判定（空 prompt 排除/failed 不烧断）+简报组装（inject/create 共用）'
author: 'qinyi'
created_at: 2026-08-24 18:53:12
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-013@v1]
allowed_paths:
  - backend/app/modules/agent/mission_context.py
  - backend/app/modules/agent/tests/test_mission_context.py
provides:
  - contract: mission_context
    file: backend/app/modules/agent/mission_context.py
    fields: [should_inject_first_turn_briefing, build_orchestrator_briefing, resolve_first_turn_briefing]
    consumers: [task-08, task-09]
expects_from:
  - 'task-01 render_session_orchestrator_briefing（mission+session → 简报文本）与 collect_scope_workspace_statuses——简报组装复用其渲染与 scope 结构化查询，不重复造文案'
  - 'task-02 probe_workspace_git_mode——作探测回调接进简报 scope 条目的模式字段（git隔离|直通|未知，design §5.D 末行口径）'
goal: >
  新建 backend/app/modules/agent/mission_context.py（design §6 定名新文件）：首主控轮判定
  （活跃 mission ∧ prompt 非空 ∧ 该 mission 无已消耗 orchestrator run——已消耗 =
  status∈{pending,running,completed}，failed/killed 不烧断；懒建回填 run 天然短路）+
  简报组装（复用 task-01 渲染函数，inject/create 两路径共用），供 task-08/09 消费
  （FR-01 / D-013@v1 一次性语义的判定层落点）。
implementation:
  - '新建 mission_context.py（不并入 orchestrator.py——plan 已定独立文件）：模块 docstring 写明判定三条件与已消耗集合定义（引用 D-013/CC-12）'
  - 'should_inject_first_turn_briefing(db, mission, prompt)：三条件全真才命中——①mission 为 get_active_mission_for_session 口径的活跃 mission（mission 由调用方传入或组合入口内查）；②prompt 非空（strip 后非空——纯配置切换轮不注入不消耗，D-013/CC-12）；③该 mission 不存在 role=orchestrator 且 status∈{pending,running,completed} 的 AgentRun（failed/killed 落集合外不烧断——首轮派发失败后下一条带文本消息重新注入；懒建回填的 orchestrator run 为 pending → 判定天然短路，不补简报，D-003）'
  - 'build_orchestrator_briefing(db, mission) -> str：session.get(AgentSession, mission.session_id) 取会话，把 task-02 probe_workspace_git_mode 作探测回调接进简报渲染（scope 条目带模式字段），调 task-01 render_session_orchestrator_briefing 产出简报文本（design §7 简报格式：mission_id/目标/锚点工作区/派发范围/派发用法/mission_status 提示/禁越权约束）；session 缺失（防御分支）抛明确异常，不静默返空串'
  - '组合入口 resolve_first_turn_briefing(db, session_id, prompt) -> str | None：get_active_mission_for_session → 判定命中 → 返回简报文本；任一条件不命中/无活跃 mission → 返回 None（调用方零注入，task-08 inject 与 task-09 create 共用此契约）'
  - '新增 tests/test_mission_context.py：主干（活跃 mission+非空 prompt+无 orchestrator run → 命中）+ 三边界（空/纯空白 prompt 不注入不消耗、failed orchestrator run 后重注、懒建回填 pending run 短路）+ 一次性（存在 completed orchestrator run → 不再命中，D-002）+ 无活跃 mission → None'
acceptance:
  - '空 prompt（含纯空白 strip 后为空）→ 判定不命中且不消耗一次性名额：后续第一条带文本消息仍命中注入（D-013 边界一）'
  - 'failed（及 killed）orchestrator run 不烧断：mission 无 pending/running/completed 的 orchestrator run 时判定仍命中——失败轮后可重注（D-013 边界二）'
  - '懒建回填的 orchestrator run（pending）使判定短路——懒建轮不补简报（D-003 判定层锚点）'
  - '存在 status∈{pending,running,completed} 的 orchestrator run → 判定不命中（简报一次性，D-002@v1）'
  - 'build/resolve 产出的简报含 mission_id/锚点工作区/scope 条目（机器名+在线+模式）与 dispatch_worker 用法/mission_status 提示段（复用 task-01 渲染输出，本卡不重复实现文案）'
  - '无活跃 mission → resolve_first_turn_briefing 返回 None（无 mission 普通会话行为不变的判定层锚点）'
verify:
  - 'cd backend && uv run pytest app/modules/agent/tests/test_mission_context.py -q --no-cov'
  - 'cd backend && uv run pytest app/modules/agent -q --no-cov -n auto'
constraints:
  - '本卡只落 mission_context.py 判定+组装：不改 service.py inject/create 路径（task-08/09 消费）、不改 orchestrator.py 渲染本体（task-01 提供）、不改 daemon 侧'
  - '已消耗集合写死 {pending,running,completed}（简报一次性语义专用，勿与 mcp_tools._ACTIVE_RUN_STATUSES 活跃轮口径混用——后者含 interrupting 不含 completed）'
  - '纯查询语义：DB 访问经传入 AsyncSession，不自行开事务/不 commit/不写任何行'
  - '简报文案单一来源=task-01 渲染函数；本卡若发现 task-01 落地签名与本卡假设不符，以 task-01 实际契约为准适配调用方（不复制文案）'
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
