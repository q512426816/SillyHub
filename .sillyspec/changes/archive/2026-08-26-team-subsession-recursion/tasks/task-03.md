---
id: task-03
title: 'mission-judgement-whole-tree-and-budget-mapping'
title_zh: 'mission 判据换全树分身集合与 budget_force_ended_at 映射增补'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: ['task-01']
blocks: [task-02, task-07, task-08]
requirement_ids: [FR-05, FR-07]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/mission.py
  - backend/app/modules/agent/tests/test_worker_subsession_status.py
provides:
  - contract: mission_judgement_whole_tree
    fields: ['budget_force_ended_at 映射规则', '全树分身集合']
expects_from:
  - 'task-01 mission_worker_sessions_tree 全树枚举与 tree_depth 列——mission_derive_status 分身集合换树的数据源（孙层计入判据，无孙时与一层等价）'
goal: >
  mission.py 判据层换全树口径并补预算强收可收敛语义（design §5.E / D-005@v1）
  ——mission_derive_status 的分身子会话集合从 mission_worker_sessions（一层）
  换 mission_worker_sessions_tree（含孙），虚拟映射增补规则「mission
  constraints 带 budget_force_ended_at 标记时会话 ended 且未 done 映射 failed
  终态而非 running」，保证预算强收后 mission 可收敛出 degraded 不卡死。
implementation:
  - 'mission_derive_status 内 mission_worker_sessions 调用点换 mission_worker_sessions_tree（分身集合含孙层）；分身首 run 剔除口径同步按全树 id 集合执行（防孙首 run 与虚拟映射双计）'
  - '_virtual_status 增补映射——查明 mission.constraints 是否带 budget_force_ended_at 键（constraints 为 None 安全），标记存在且会话 status=ended 且 worker_done_at 为空 → 映射 failed（终态）；标记不存在时 ended 未 done 仍映射 running（P1 语义不变）；done 无活跃 turn → completed、failed → failed 的既有优先级不变'
  - 'is_worker_complete 双形态判据零改动（按单 worker 对象判定，与集合来源无关）；扩展 test_worker_subsession_status.py——三层树 derive 孙层计入、无孙树等价回归、budget 标记映射矩阵（有/无标记 × ended/done 组合 → degraded/running）'
acceptance:
  - '分身+孙混合树——孙未完成时 mission_derive_status 返回 running；孙与分身全部到达终态后按 P1 矩阵派生 done/degraded/failed（孙层计入，不漏不双计）'
  - '无孙存量树——换全树前后 mission_derive_status 返回值等价（FR-08 零回归，test_worker_subsession_status.py 既有断言不破）'
  - 'constraints 带 budget_force_ended_at——ended 未 done 分身映射 failed，derive 出 degraded（可收敛收尾不圆满）；无标记时同输入仍映射 running'
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_worker_subsession_status.py app/modules/agent/tests/test_derive_status_matrix.py
  - cd backend && uv run ruff check app/modules/agent/mission.py && uv run mypy app/modules/agent/mission.py
constraints:
  - '不动 derive_status 纯函数签名与判定矩阵——映射增补只发生在 mission_derive_status 包装层 _virtual_status（D-005@v1 包装层职责）'
  - '不动 is_worker_complete 判据与 _WORKER_SESSION_TERMINAL 词表单源——本卡只换集合来源'
  - 'budget_force_ended_at 只读不写——置位与批量强收归 task-07 patrol，本卡仅消费该标记做映射'
  - 'mission.py 唯一 owner=本卡（plan 拓扑铁律）——control/finalizer/patrol/mission_context 全树换点归 task-07/08，mcp_tools 消费点归 task-02'
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
