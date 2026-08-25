---
id: task-10
title: 'converge 沿树批量 end_session（merge 成功后收口，冲突不收口）'
title_zh: 'converge 沿树批量 end_session（merge 成功后收口，冲突不收口）'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/finalizer.py
  - backend/app/modules/agent/tests/test_worker_subsession_converge_close.py
expects_from:
  - 'task-01 mission_worker_sessions(mission_id) 按 mission.session_id 一层枚举分身子会话（P1 深度 2 只查一层）——收口名单来源'
  - 'task-08 mission_derive_status（虚拟 run 映射 + workers_only 模式）——converge_explicit 分支判据已由 task-09 接线，本卡只在其成功路径之后追加沿树收口'
goal: >
  converge 成功路径（converged_at 原子抢占置位且 merge 无 pending_conflicts）沿会话树
  逐个 end_session 收口分身子会话——子会话 ended + interactive lease completed +
  SESSION_END WS，全部复用 SessionService.end_session 既有链；冲突回滚
  （converged_at 还原 NULL）与 needs_manual 路径不收口，子会话保持活跃供解冲突
  参考（FR-06 / design §5.D 生命周期契约表 converge 行）。
implementation:
  - 'finalizer.py 新增沿树收口 helper——mission_worker_sessions(mission_id) 枚举分身子会话，逐个 SessionService(session).end_session(子会话 id, user_id=子会话属主即 mission.created_by, reason=mission_converged)；end_session 自带幂等（已 ended/failed 早退）与 P0-2 SESSION_END best-effort 链，直接复用不重造'
  - '接线点 converge_mission_for_completed_run 的 should_converge 成功段——置位 commit 后、execute 无冲突分支（含 BE-P1-4b cleanup 后）与 bootstrap 分支（finalize_bootstrap_mission 后）都调收口 helper；best-effort 逐个执行，单个失败 log.warning 继续不抛（孤儿由 task-12 patrol 兜底）'
  - '不收口路径保持零调用——converge_explicit 冲突回滚分支（pending_conflicts 非空还原 converged_at）、finalize 异常回滚分支（BE-P1-3 还原置位）均不进收口；needs_manual 发生在 mcp_tools 冲突状态机（置位已被回滚）天然不收口'
  - '时序契约——end_session 在 converged_at 与 merge 结果已落库之后执行，收口失败不影响置位与 merge 返回值；MCP converge 重入第二次成功同样经此入口收口'
  - '新增 test_worker_subsession_converge_close.py——merge 成功全分身收口（断言子会话 ended + lease completed + SESSION_END 下发）、pending_conflicts 不收口、异常回滚不收口、单个子会话 end 失败不影响其余与 converge 返回'
acceptance:
  - 'converge 返回 converged 后 mission 下无活跃分身子会话（status 全 ended、interactive lease 全 completed、SESSION_END 已发）'
  - '冲突路径（pending_conflicts 非空回滚置位）与 needs_manual 路径子会话全部保持活跃可访问'
  - 'MCP converge 重入流——第一次 conflict 不收口、主 agent 解决后重入成功即收口'
  - '存量 mission（无子会话）converge 行为零回归——收口 helper 枚举空集 no-op，test_converge_mission_reentrant 不改断言全绿'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_converge_close.py app/modules/agent/tests/test_converge_mission_reentrant.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/finalizer.py && uv run mypy app/modules/agent/finalizer.py
constraints:
  - 'converge 冲突 / needs_manual / finalize 异常回滚路径绝不 end_session（design §5.D 铁律——子会话保持活跃供解冲突参考）'
  - '收口复用 SessionService.end_session 既有链（含 P0-2 修好的 SESSION_END），禁止重造 kill 逻辑、禁止直接翻 DB 会话状态'
  - '不改 mcp_tools.py（_converge_core 属 task-05 同 Wave 并行文件；置位与判据已由 task-09 完成），不改 cleanup_mission 清理时机语义'
  - 'best-effort 逐个收口不抛出阻断 converge 返回；部分失败交 task-12 patrol 孤儿扫描兜底'
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
