---
id: task-08
title: '全树换点其余 + 非叶简报——control 三口径 / finalizer cleanup 与收口遍历 / mission_context workers_all_terminal_with_stats+简报 / daemon-router 摘要含孙折叠计数'
title_zh: '全树换点其余 + 非叶简报——control 三口径 / finalizer cleanup 与收口遍历 / mission_context workers_all_terminal_with_stats+简报 / daemon-router 摘要含孙折叠计数'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: ['task-01', 'task-03']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/agent/control.py
  - backend/app/modules/agent/finalizer.py
  - backend/app/modules/agent/mission_context.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
expects_from:
  - 'task-01 mission_worker_sessions_tree(mission_id) 递归 CTE 全树枚举（UNION 去重 + MAX_TREE_DEPTH=4 截断，含孙层）——七处换点剩余四处的枚举来源换源'
provides:
  - contract: build_worker_briefing 可选参数（如 can_dispatch，默认 False）
    file: backend/app/modules/agent/mission_context.py
    fields: [can_dispatch]
goal: >
  七处全树换点的剩余四处落地——control 治理三口径（并发计数/成本 union/cancel
  kill 名单）、finalizer 两处（cleanup_mission 孙层副本清理 + converge 收口遍历）、
  mission_context.workers_all_terminal_with_stats（防对孙层误发全部终态唤醒）、
  daemon/router 摘要含孙折叠计数（展示保持一层直查）；并为非叶分身简报加
  「可派工到下一层」指引（FR-07 / design §5.E / Grill minor）。
implementation:
  - 'control 三口径——_split_worker_forms 的 mission_worker_sessions 换 mission_worker_sessions_tree 单点换源：running/active 计数（MAX_WORKERS 全树计数）、cost_so_far union（孙层轮次 run 计入）、cancel kill 名单（孙层活跃子会话经 _cancel_target_run_for_session 进 cancel_lease）三处共用，其余判据与 NULL role 守卫零改动'
  - 'finalizer 两处——_end_mission_worker_subsessions 收口遍历换全树（converge 后孙层分身同样 end_session，best-effort 语义不变）；cleanup_mission 的 worker_sessions_by_id 换全树（已完成孙分身 worktree 副本同样清理，未完成孙不动）'
  - 'mission_context——workers_all_terminal_with_stats 的 worker_sessions 换全树：孙层未完成时不误发「全部终态」唤醒主控（design §5.E），成败统计含孙层；legacy 剔除口径（agent_session_id ∈ 分身集合剔首 run）随枚举自动覆盖孙层轮次 run'
  - 'daemon/router._team_mission_summary——workers 行化保持一层直查（展示细节留 P3），TeamMissionWorkerSummary 增可选计数字段 sub_workers_count（int，默认 None/0 存量零变化），router 按全树枚举的 parent 关系聚合一层分身的孙后代数填入；schema 改动后跑 pnpm gen:types 同步 openapi.json + api-types.ts（CLAUDE.md 规则 21）'
  - '非叶简报——build_worker_briefing 增可选参数 can_dispatch（默认 False 不渲染新段，叶与存量简报逐字节不变）；True 时追加「可派工到下一层」段（dispatch_worker/list_workers/get_worker_result/mission_status/worker_done 五件用法提示，对齐 D-002@v1 非叶工具集）；mcp_tools 派发路径按调用会话 tree_depth 传参的接线归 task-02 文件所有权'
acceptance:
  - '孙层计入治理——含孙 mission 的 MAX_WORKERS 计数 / cost_so_far / cancel kill 名单 / converge 收口遍历 / cleanup 副本清理 / 全完成唤醒判定均含孙层分身'
  - '孙 worker_done 可用且全分身（含孙）完成才迁移唤醒主控（workers_all_terminal_with_stats 不被孙层遗漏误判）'
  - '摘要——一层 workers 行内容不变，sub_workers_count 反映孙后代计数；存量/无孙 mission 字段保持默认（FR-08 零回归）'
  - '非叶简报——can_dispatch=True 渲染派工指引段，默认路径输出与改动前逐字节一致'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_control.py app/modules/agent/tests/test_worker_subsession_converge_close.py app/modules/agent/tests/test_worker_subsession_status.py app/modules/agent/tests/test_worker_subsession_list_workers.py app/modules/daemon/tests/test_session_team_mission.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/control.py app/modules/agent/finalizer.py app/modules/agent/mission_context.py app/modules/daemon/router.py && uv run mypy app/modules/agent/control.py app/modules/agent/finalizer.py app/modules/agent/mission_context.py app/modules/daemon/router.py
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - '七处换点中 mission.py（task-03）/ mcp_tools 的 _worker_done_core 与 _converge_core busy（task-02）/ patrol 枚举（task-07）不在本卡——本卡只做剩余四处，不碰 mcp_tools.py / patrol.py / mission.py（文件所有权）'
  - '展示保持一层直查 + 孙折叠计数——workers 行化不展开孙层明细（门户分组等 UI 留 P3），本变更仅保证状态正确含孙层（status 已由 task-03 全树 derive）'
  - 'schema.py 只加可选计数字段（默认值存量零变化）；api-types.ts 经 pnpm gen:types 生成禁止手写（规则 21）'
  - '无孙存量 mission 全树与一层枚举等价——既有测试断言不得因本卡失效；失效即实现缺陷回本卡修，不进 task-09'
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
