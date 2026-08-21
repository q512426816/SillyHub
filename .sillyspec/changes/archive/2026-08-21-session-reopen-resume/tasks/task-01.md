---
id: task-01
title: 'DS-1 增量回填——run_sync/service.py submit_messages 内 latest_session_id 块加 AgentSession.agent_session_id 最新值覆盖（batch FK 空跳过）；测试：回填、fork 覆盖、batch 跳过、同事务'
title_zh: 'DS-1 增量回填——run_sync/service.py submit_messages 内 latest_session_id 块加 AgentSession.agent_session_id 最新值覆盖（batch FK 空跳过）；测试：回填、fork 覆盖、batch 跳过、同事务'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/tests/test_run_sync_agent_session_id_backfill.py
goal: >
  让 agent_sessions 表真正持有 SDK resume key：submit_messages 消息落库时把
  daemon 上报的顶层 session_id（:556-558 提取的 latest_session_id）最新值覆盖写入
  AgentSession.agent_session_id，使 reopen（硬依赖该列，空则 409）生产可用。
implementation:
  - 'run_sync/service.py submit_messages 写回块：保留 :746-749 现有 AgentRun.session_id 仅空时写逻辑不动（D-001@v1），紧随其后并列新增会话覆盖逻辑。'
  - '覆盖入口守卫：latest_session_id 非空 且 agent_run.agent_session_id（会话 FK）非 None——batch run 该 FK 为 None 直接跳过，不触碰 agent_sessions 表。'
  - '取会话行：session_row = await self._session.get(AgentSession, agent_run.agent_session_id)，与 close_interactive_run :1109-1112 同模式（函数内局部 import AgentSession）；get 返回 None（理论不应发生）静默跳过。'
  - '覆盖写入：session_row.agent_session_id != latest_session_id 时赋值 + self._session.add(session_row)——无条件最新值覆盖（fork/reload 换新 id 后旧 key resume 会回到分叉前历史，语义错误，故不做仅空时写）；值相同则不写。'
  - '事务：与消息落库走同一 commit()（:771，含 IntegrityError 幂等回滚分支），无新增竞态；会话行在 create_session 的 commit（session/service.py:903）后必然已存在。'
  - '新建 backend/app/modules/daemon/tests/test_run_sync_agent_session_id_backfill.py：交互 run 首条带 session_id 消息回填、fork 换新 id 再上报覆盖为新值、batch run（FK None）不触碰会话表、AgentRun.session_id 仅空时写不回归，四组用例。'
acceptance:
  - 交互 run（agent_session_id FK 非空）上报带顶层 session_id 的消息后，AgentSession.agent_session_id 被写入该值。
  - 同一会话 SDK 换新 session_id（fork/reload）后再次上报，agent_session_id 覆盖为新值（最新值覆盖，非仅空时写）。
  - batch run（agent_session_id FK 为 None）消息上报后 agent_sessions 表无任何变化。
  - AgentRun.session_id 既有仅空时写语义不变（D-001@v1），既有 run_sync 测试回归全绿。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_run_sync_agent_session_id_backfill.py app/modules/daemon/tests/test_submit_messages_no_overwrite_terminal.py -v
  - cd backend && uv run ruff check app/modules/daemon/run_sync/service.py
  - cd backend && uv run mypy app
constraints:
  - '不改 :746-749 AgentRun.session_id 的仅空时写语义（D-001@v1）。'
  - '覆盖写仅在 latest_session_id 非空且 agent_run.agent_session_id 非 None 时执行；不引入去重/版本号机制（design DS-1 审查修订：最终一致，乱序迟到旧 id 的短暂回退由同会话下一次上报自愈，风险已登记）。'
  - 不新增端点/DTO/schema，不动 publish 链路（PublishIntent 保持纯标量）。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
