---
id: task-04
title: 'team_mission_entry flush-only 重构——抽预建 helper（add+flush 不 commit），本体=helper+commit 零回归'
title_zh: 'team_mission_entry flush-only 重构——抽预建 helper（add+flush 不 commit），本体=helper+commit 零回归'
author: 'qinyi'
created_at: 2026-08-24 18:53:12
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-009@v2]
allowed_paths:
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/tests/test_orchestrator.py
provides:
  - contract: precreate_mission_flush
    file: backend/app/modules/agent/orchestrator.py
    fields: [precreate_mission_flush]
    consumers: [task-09]
goal: >
  从 team_mission_entry（orchestrator.py:244-428，内部 commit+refresh 在 :330-332）抽出
  flush-only 预建 helper（add+flush，不 commit），本体改为 helper+commit——为 task-09
  create 路径共用 create_session 唯一 commit（service.py:1008 commit / :1011 rollback）
  消除孤儿 session/mission 做准备（Grill UB-1）；既有 team/external/session 三模式调用方
  零回归。
implementation:
  - '抽 helper（如 _precreate_mission_flush，orchestrator.py 模块级或 OrchestratorService 方法）：承载 team_mission_entry :293-330 的校验与构造——session 模式必传 session_id 的 ValueError、external 模式 constraints 合并 orchestration_mode、objective 空落 SESSION_OBJECTIVE_PLACEHOLDER、scope_workspace_ids uuid→str——+ AgentMission 构造 + add + await flush()，不 commit 不 refresh，返回 mission（flush 后 PK 已可用）'
  - 'team_mission_entry 本体改为：调 helper → await self._session.commit() → await self._session.refresh(mission) → 原有 orchestration_mode 分支全保留（session early-return :338-347 / external early-return :353-360 / team 继续 spawn main_run :362-428）'
  - 'team 模式事务净效果核查：原 mission commit（:331）+ main_run commit（:378）两段变为主_run 处单 commit 覆盖两者——中间态无对外可观察契约（API 层返回前必有 commit/回滚），NoOnlineDaemonError 捕获路径 :400-405 的 commit 不动'
  - '既有调用方零回归核查：trigger 端点（daemon/router.py）、懒建（mcp_tools._resolve_session_mission :474）、external（SillySpec execute 链路）——team_mission_entry 公开签名与 (mission, main_run|None) 返回契约不变，调用方零改动'
  - 'test_orchestrator.py 增用例：helper 不 commit（调用后同事务 rollback 无 mission 行残留）/ helper+commit 后 mission 可读（id、scope uuid→str、constraints 合并、空 objective 落占位）/ team 模式端到端仍建 mission+main_run、no_online_daemon 兜底语义不变'
acceptance:
  - 'helper 内无 commit/refresh：单测调 helper 后 db.rollback()，无 mission 行残留（flush-only 语义锚点，供 task-09 复用）'
  - '既有 team/external/session 模式测试不改断言全绿（trigger 端点/懒建/external 调用方零回归）'
  - 'session 模式预建行为不变：objective 空落 SESSION_OBJECTIVE_PLACEHOLDER、scope_workspace_ids uuid→str、session_id 落列、返回 (mission, None)'
  - 'team 模式仍返回 (mission, main_run)，daemon 离线时 run 标 pending+error_code=no_online_daemon、mission 存活（重派兜底不变）'
verify:
  - 'cd backend && uv run pytest app/modules/agent/tests/test_orchestrator.py -q --no-cov'
  - 'cd backend && uv run pytest app/modules/agent -q --no-cov -n auto'
constraints:
  - '与 task-01 同文件（orchestrator.py）但分属 W1/W2：execute 顺序在 task-01 之后合入，Edit 以当时文件现状为准（task-01 新增 render_* 函数不触碰 team_mission_entry :244-428 区域，两卡锚点不重叠）'
  - '不改 team_mission_entry 公开签名与返回契约；不改 mission.py / mcp_tools.py（懒建调用方零改动即零回归）'
  - 'helper 只做预建（不建主控 run、不派 lease、不渲染 prompt）——orchestration_mode 分支逻辑留在本体'
  - '不加 alembic 迁移（零表结构变更，design §8）'
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
