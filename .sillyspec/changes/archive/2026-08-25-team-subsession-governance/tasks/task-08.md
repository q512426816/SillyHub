---
id: task-08
title: 'is_worker_complete + mission_derive_status（虚拟 run 映射 + workers_only + 优先级）'
title_zh: 'is_worker_complete + mission_derive_status（虚拟 run 映射 + workers_only + 优先级）'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-01']
blocks: [task-09, task-11, task-15]
requirement_ids: [FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/mission.py
  - backend/app/modules/agent/tests/
provides:
  - contract: worker_complete_truth
    fields: [is_worker_complete, mission_derive_status, workers_only]
    consumers: [task-09, task-11]
goal: >
  mission.py 落判据单一真相源双函数（FR-05 / D-005@v1）——is_worker_complete
  会话级完成判定（完成=worker_done_at 非空且无活跃 turn，终结=会话终态，
  存量 batch run=run 终态）与 mission_derive_status 虚拟 run 映射包装
  （run 级纯函数 derive_status 签名不动，workers_only 模式，done 优先于
  终态 failed），供 task-09 判据点替换与 task-11 治理口径消费。
implementation:
  - 'is_worker_complete 双形态（design §5.C.3）——子会话形态传 AgentSession——完成=worker_done_at IS NOT NULL 且该会话无活跃 turn（复用 _session_has_active_turn 同款 ACTIVE_RUN_STATUSES 词表，追问重开工期间自动回未完成）、失败/终结=会话终态 failed/ended；存量 batch 形态传 AgentRun——run 终态集合 completed/failed/killed；两形态并存即双判据兼容'
  - 'mission_derive_status(session, mission_id, *, workers_only=False)（design §5.C.4 虚拟 run 映射）——① 收集 mission 下非子会话 run（主控轮+存量 batch run）原样，workers_only=True 时排除 role=orchestrator（对齐 D-010 置位不依赖主控 run 与 schedule_loop 信号 1 现行收窄）；② mission_worker_sessions 枚举的每个分身子会话映射虚拟 run，优先级从高到低——worker_done_at 非空且无活跃 turn→completed（优先于终态映射，converge end_session 后 done 分身仍映射 done）、会话终态 failed→failed、其余（idle 未 done/追问重开工中）→running；③ 两组合并喂 derive_status（cancelled/converged/has_session/session_active_turn 由包装查明传入）；有分身时虚拟集合非空不误判 planning'
  - '测试——扩展 test_derive_status_matrix.py（虚拟映射优先级矩阵——done 优先 failed、idle→running、workers_only 排除主控轮、空集 planning 语义、纯函数零回归）＋新增 test_worker_subsession_status.py（is_worker_complete 双形态、追问重开工回未完成、再次置位回完成、重复完成周期）'
acceptance:
  - '分身 idle 未 done（无 worker_done_at 或有活跃 turn）→ is_worker_complete=False 且 mission_derive_status 映射 running，全 done 且无活跃 turn → 映射 completed——各状态源一致（FR-05 验收核心）'
  - 'converge end_session 后（会话 ended）done 分身仍优先映射 completed 而非 failed；workers_only=True 时主控在自己活跃轮内 derive 不恒 running'
  - 'derive_status run 级纯函数签名与存量调用方行为逐字节不变（D-005@v1）；存量 batch run（无子会话）判据路径零回归（FR-09）'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_derive_status_matrix.py app/modules/agent/tests/test_worker_subsession_status.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/mission.py && uv run mypy app
constraints:
  - 'derive_status 纯函数签名不动、判定不并入纯函数（D-005@v1）——mission_derive_status 只是包装；本卡不改任何判据消费点（五处判据点+两调用点替换归 task-09），只落函数+单测'
  - '消费 task-01 契约（mission_worker_sessions 一层枚举、resolve_mission_for_session）不自建树查询；子会话枚举只查一层（P1 深度 2，递归 CTE 留 P2）'
  - '活跃 turn 判定复用 agent.model.ACTIVE_RUN_STATUSES 单源词表（含 pending_approval），禁另抄状态集合'
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
