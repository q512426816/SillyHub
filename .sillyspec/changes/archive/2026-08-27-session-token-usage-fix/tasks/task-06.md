---
id: task-06
title: 'backend pytest for ctx_tokens contract'
title_zh: 'backend pytest——提取与写回守卫 / SSE payload / SessionRunRead / close 不覆盖 ctx_tokens'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  - backend/app/modules/daemon/tests/test_session_runs_endpoint.py
expects_from:
  task-05:
    - contract: submit_messages ctx_tokens 提取与写回
      needs: [usage.ctx_tokens 提取, AgentRun.ctx_tokens last-write-wins 赋值, 缺键跳过]
    - contract: SSE 两路 payload 与 SessionRunRead.ctx_tokens
      needs: [messages summary ctx_tokens, tokens 事件 ctx_tokens, None 不带键, SessionRunRead 序列化]
    - contract: close_interactive_run 不写 ctx_tokens
      needs: [终态后 ctx_tokens 保留实时值, input/output 终态照旧覆盖]
goal: >
  新增/扩展 pytest 锁定 task-05 的四类行为——提取与 last-write-wins 写回、SSE 两路 payload 透传、SessionRunRead 序列化、close 不覆盖 ctx_tokens——并覆盖 FR-03 兼容面（老 daemon 缺键、历史行 NULL 不报错）。
implementation:
  - 新建 backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py，复用 test_run_sync_cache_parse.py 的范式（db_session + mocked_redis fixture、DaemonService facade、_create_user/_create_runtime 辅助构造 run/lease/session）
  - 提取用例：usage 含 ctx_tokens → AgentRun.ctx_tokens 写入；缺键（老 daemon）→ 保持 None 不报错
  - last-write-wins 用例：同批 ctx 100→50 落库 50（后值更小也覆盖，与 input 的 max 守卫形成行为差异对照）；跨批第二次上报更小值同样覆盖
  - SSE 用例：publish_submitted_messages 后 run channel messages summary 与 session channel tokens 事件均含 ctx_tokens；ctx 为 None 时两路 payload 无该键
  - close 用例：submit 写入 ctx 后调 close_interactive_run（带终态 input/output）——断言 input/output 被终态覆盖而 AgentRun.ctx_tokens 等于实时写入值
  - test_session_runs_endpoint.py 增用例：seed run 行 ctx_tokens=12345 → GET /api/daemon/sessions/{id}/runs 响应项含该值；未写值 run（老数据）→ null
acceptance:
  - 新用例全过，四类行为各有至少一条断言（提取 / last-write-wins / SSE 两路 / SessionRunRead / close 不覆盖）
  - close 用例显式断言终态后 AgentRun.ctx_tokens == 实时写入值（不依赖间接推断）
  - 不修改既有测试断言迁就实现（CLAUDE.md 规则 9）；扩展前先跑一遍 test_session_runs_endpoint.py 确认基线绿
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_run_sync_ctx_tokens.py app/modules/daemon/tests/test_session_runs_endpoint.py
  - cd backend && uv run ruff check .
constraints:
  - 只新增 test_run_sync_ctx_tokens.py 与扩展 test_session_runs_endpoint.py，不动其它测试
  - 不改产品代码；测出实现缺陷回报修复，不改测试迁就（规则 9）
  - 只跑相关测试，不跑全量（规则 0，全量留给 CI）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
