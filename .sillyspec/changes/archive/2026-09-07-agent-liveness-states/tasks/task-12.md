---
id: task-12
title: 'list_workers 增 liveness 字段（spike-01 定汇入点；过重则 backend 直查落库状态）'
title_zh: 'list_workers 增 liveness 字段（spike-01 定汇入点；过重则 backend 直查落库状态）'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
provides:
  - contract: worker_liveness_field
    fields: [liveness.state, liveness.evidence, liveness.derived_at]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/mission_context.py
  - backend/app/modules/agent/tests/test_mcp_tools.py
target_files:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/tests/test_mcp_tools.py
goal: >
  list_workers 返回值 worker 增 liveness{state,evidence,derived_at}（running 期间
  附加）。spike-01 已实证（2026-09-07）：_list_workers_core 为纯 DB 函数、
  platform_agent_logs.agent_session_id 已建索引——backend 直查落库状态即正道
  （无需 daemon→mission 链路改造），为 task-13 派发模板 blocked 升级 / working
  再等决策供数（design §5.6/§7，FR-06）。
implementation:
  - 'spike-01 已完成（结论：直查即正道，详见 plan.md Spike 表）——orchestrator.py/mission_context.py 不改（allowed_paths 中两文件本 task 不动）'
  - 'schema.py：WorkerListItem（:269）增可选 liveness 字段（新 WorkerLiveness 模型 {state,evidence,derived_at}，None=非 running 或无数据）；存量 batch run 行 model_validate 路径（mcp_tools.py :1651）默认 None 兼容，MissionStatusResponse.workers（:321）同源受益零改动'
  - 'mcp_tools.py _list_workers_core：仅 row_status=running 的子会话行（:1640 WorkerListItem 构造处）填 liveness——直查 platform_agent_logs（AgentSessionLogORM.agent_session_id=worker 子会话 id，按 state_derived_at 取最新一行）组装（R-03 定稿路径：daemon 同机推导已落库，语义等价；批量 in 查询防 N+1）'
  - 'tests：test_mcp_tools.py 增断言——running worker 附 liveness 三字段；completed/failed 行 liveness 为 None；无日志行 worker liveness 为 None 不报错；直查路径 state 与落库行一致'
acceptance:
  - 'worker running 期间 GET /workspaces/{wid}/missions/{mid}/workers（list_workers :1536）该 worker 含 liveness.state（五态枚举）+ evidence + derived_at'
  - '非 running（completed/failed）与无状态数据的 worker liveness 为 None；WorkerListItem 既有消费方（daemon _team_mission_summary 同构口径）零回归'
  - 'worker 卡确认时 liveness.state=blocked；长任务持续 working 时不误报 blocked（FR-06 供数，task-13 模板消费）'
  - '若走降级路径：直查 platform_agent_logs 得到的 state 与 daemon 上报一致（同一落库行）'
verify:
  - 'cd backend && uv run pytest app/modules/agent/tests -n auto -k list_workers'
  - 'cd backend && uv run pytest app/modules/agent/tests/test_mcp_tools.py -n auto'
  - 'cd backend && uv run ruff check app/modules/agent/mcp_tools.py app/modules/agent/schema.py && uv run mypy app/modules/agent/mcp_tools.py app/modules/agent/schema.py'
constraints:
  - 'liveness 仅 running 期间附加（design §7.5 生命周期契约），不改 worker status 三值映射口径（is_worker_complete 判据不动）'
  - 'spike-01 结论先行，不硬编码链路假设；链路过重即走 R-03 既定降级（backend 直查落库状态），不推翻设计'
  - '不改 daemon 侧文件（daemon 推导与上报属 task-06 范围）；派发模板改写在 task-13（sillyspec 仓）；对 platform_agent_logs 只读不写（纯查询语义）'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
