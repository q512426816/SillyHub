---
id: task-07
title: 'backend worker_done 端点（worker_done_at + summary 挂首 run + SETNX DEL 重开工 + 迟到 409）'
title_zh: 'backend worker_done 端点（worker_done_at + summary 挂首 run + SETNX DEL 重开工 + 迟到 409）'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-01']
blocks: [task-15]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/mission_context.py
  - backend/app/modules/agent/tests/test_worker_subsession_done.py
expects_from:
  task-01:
    - contract: agent_session_worker_columns
      needs: [worker_done_at, parent_session_id, mission_id]
provides:
  - contract: worker_done_endpoint
    fields: [端点路径, workspace_id, mission_id, summary, X-Session-Id 会话定位]
goal: >
  新增分身显式完成信号端点 worker_done（FR-04 / D-002@v1）——分身受限
  MCP server 的唯一写入落点。写本会话 worker_done_at、summary 落
  AgentArtifact 挂首 run、全分身完成迁移时先 DEL 再 SETNX 唤醒主控
  （支持重复完成周期）、mission 已终态的迟到调用 409 不写状态。
implementation:
  - 'mcp_tools.py 新增 POST 会话路由族端点 worker_done——会话定位同 report_progress 模式（X-Session-Id → 子会话行 → resolve_mission_for_session 沿 parent 链爬根校验锚，mission_id/workspace_id 显式参数仅作越权校验锚）；DTO WorkerDoneRequest/WorkerDoneResponse 内联定义（同 ProgressRequest :226 先例）'
  - '置位写入——UPDATE 本会话 worker_done_at=now()（可重复置位取最新，追问后再干活再置位）；summary 落 AgentArtifact（kind=summary）挂首 run——首 run=该子会话下 mission_id=本 mission 且带 role 双标记的最早 run，_worker_artifacts / get_worker_result / Finalizer 合并链经既有 mission_id join 全部可见（design §5.C.2）'
  - '全分身完成迁移唤醒——置位后按 mission_worker_sessions 枚举做全完成判定（语义同 design §5.C.3——完成=worker_done_at 非空且无活跃 turn，终结=会话终态 failed/ended，存量 batch 分身=run 终态），false→true 时先 DEL mission_context._WORKERS_DONE_NOTIFY_KEY 再调 notify_orchestrator_workers_done（内部 SETNX），重复完成周期可再次唤醒；DEL helper 落 mission_context.py（key 常量单源防格式漂移），Redis 不可用退化不阻断（既有语义）'
  - '迟到调用 409——活跃 resolve miss 时按根会话直查含终态 mission 行（converged_at/cancelled_at 非空）——命中记 warning 返 409 不写状态不唤醒；task-01 的 resolve_mission_for_session 若已带 include_terminal 参数则直接用，本卡不回改 model.py'
  - '新增测试 test_worker_subsession_done.py——置位+summary 挂首 run 经 get_worker_result 可读 / 追问重开工后再次置位（重复完成周期+DEL 后再唤醒）/ 迟到 409 零写入 / 存量形态回归'
acceptance:
  - '分身调 worker_done 后——worker_done_at 非空、summary artifact 挂首 run（get_worker_result 可读）、最后完成分身触发恰好一次主控唤醒通知'
  - '追问重开工（新轮 run 无 mission_id）后再次 worker_done——worker_done_at 刷新、唤醒通知经 DEL 后 SETNX 可再次触发；mission 已 converged/cancelled 的迟到调用 409 且零状态变更'
  - '存量 mission（batch run 形态）既有端点与收敛行为逐字节不变（FR-09 双判据兼容）'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_done.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/mcp_tools.py app/modules/agent/mission_context.py && uv run mypy app
constraints:
  - '端点内全完成判定语义唯一源为 design §5.C.3（与 task-08 is_worker_complete 同词表同优先级），仅为触发唤醒的迁移检查、禁再造第三套口径；workers_all_terminal_with_stats 判据替换归 task-09'
  - 'summary 只挂首 run（追问轮 run 不写 mission_id）、不自建新 artifact 查询路径；mission_context.py 仅加 DEL helper 不动 notify_orchestrator_workers_done 既有 SETNX/TTL/降级语义'
  - '不动 model.py（两列与解析函数归 task-01）；daemon 侧受限 server 工具注册归 task-06，本卡只落 backend 端点契约'
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
