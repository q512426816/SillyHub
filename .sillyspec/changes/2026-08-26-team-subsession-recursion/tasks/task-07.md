---
id: task-07
title: 'patrol 职责⑥预算强收——budget_force_ended_at 原子标记 + 批量收口 + 计数键 + 孤儿/收口枚举换全树'
title_zh: 'patrol 职责⑥预算强收——budget_force_ended_at 原子标记 + 批量收口 + 计数键 + 孤儿/收口枚举换全树'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-05, FR-07]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/tests/test_worker_subsession_patrol_budget.py
expects_from:
  - 'task-03 mission_derive_status 虚拟映射增补规则——mission.constraints 带 budget_force_ended_at 标记时「会话 ended 且未 done」映射 failed（终态）而非 running，强收后 derive 出 degraded、mission 可正常 converge（Grill M2 / D-005@v1，本卡只置标记不改映射）'
  - 'task-01 mission_worker_sessions_tree(mission_id) 递归 CTE 全树枚举（含孙层）——职责⑤孤儿扫描与职责⑥强收名单的枚举来源'
goal: >
  patrol 新增职责⑥预算强收——独立扫描 budget_usd 非空的活跃 mission，cost_so_far
  触顶且存在未完成分身（含孙层）时先原子置位 constraints.budget_force_ended_at 再
  复用 P1 收口链批量 end_session，mission 经 task-03 映射规则可收敛 degraded（不强收
  卡死）；同卡把职责⑤孤儿扫描与强收枚举从一层换全树（FR-05 / design §5.D+§5.E）。
implementation:
  - '职责⑥挂载——run_once 追加独立 try/except（对齐既有五职责异常隔离互不阻断）；PATROL_COUNT_KEYS 追加 budget_force_ended 计数键，round_done 日志随之携带'
  - '候选查询——活跃 mission（未收敛未取消）budget_usd 非空，逐个经 MissionControlService.cost_so_far 判 cost >= budget_usd，再经 mission_worker_sessions_tree 枚举取未完成（is_worker_complete=False）且会话活跃（control._ACTIVE_SESSION_STATUSES）的分身名单；无未完成分身不强收（全完成待收敛归职责①兜底）'
  - '标记原子置位——converged_at 抢占同款 UPDATE...WHERE（id + converged_at IS NULL + cancelled_at IS NULL，finalizer.py R5 先例），新 dict 合成保留 zombie 等既有键（对齐 ZOMBIE_MARKED_AT_KEY 键复用模式），rowcount=0 视为并发抢占本轮跳过；置位成功且 commit 后才进收口（Grill M2 时序——先标记后收口，防 ended 未 done 映射 running 卡死）'
  - '批量收口——逐个 SessionService.end_session(分身 id, mission.created_by, reason=mission_budget_exceeded) 复用 P1 收口链（子会话 ended + interactive lease completed + SESSION_END best-effort），单个失败 log.warning 继续下一个；预取 id/属主标量防 MissingGreenlet（task-12 同款防护）'
  - '枚举换全树——_patrol_orphan_subsessions 的 mission_worker_sessions 换 mission_worker_sessions_tree（孙层孤儿同样补收口）；新增 test_worker_subsession_patrol_budget.py——触顶强收（标记落库+批量收口+derive degraded 可 converge）、未触顶/无分身零动作、并发抢占跳过、孤儿含孙'
acceptance:
  - '触顶命中——cost >= budget 且有未完成分身（含孙层）时标记落库、未完成分身全部被 end_session（reason=mission_budget_exceeded），mission_derive_status 经标记映射 derive degraded、converge 可正常置位'
  - '未触顶不误收——cost < budget / budget_usd 为空 / 分身已全完成的 mission 零动作零写入'
  - '原子与时序——converged/cancelled 并发抢占（rowcount=0）本轮不写不收；budget_force_ended_at 先于批量 end_session 落库'
  - '计数与隔离——budget_force_ended 进 round_done 计数；职责⑥抛错不阻断同轮其余职责；换全树后无孙场景与一层枚举等价（存量零回归）'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_patrol_budget.py app/modules/agent/tests/test_worker_subsession_patrol_orphan.py app/modules/agent/tests/test_patrol.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/patrol.py && uv run mypy app/modules/agent/patrol.py
constraints:
  - '收口复用 SessionService.end_session（P1 收口链），禁止直接翻 DB 会话状态或重造 kill 逻辑；标记置位复用原子 UPDATE WHERE 模式（不用 with_for_update）'
  - '成本判据不自写——经 MissionControlService.cost_so_far（孙层成本计入依赖 task-08 的 control 三口径换点）；完成判定经 is_worker_complete、枚举经 mission_worker_sessions_tree，均单一真相源不自造'
  - 'budget_force_ended_at 映射规则在 mission.py 归 task-03；本卡不碰 mission.py / mcp_tools.py / control.py（文件所有权）'
  - 'daemon 会话闸（task-04/06）与三端全量回归（task-09）不在本卡范围'
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
