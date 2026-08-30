---
id: task-05
title: 'backend ctx_tokens extraction + SSE passthrough + SessionRunRead'
title_zh: 'backend submit_messages 提取 ctx_tokens（last-write-wins）+ SSE 两路 payload 透传 + SessionRunRead 加字段（close 不加不覆盖）'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P0
depends_on: ['task-01', 'task-04']
blocks: [task-06, task-07]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v2, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/router.py
provides:
  - consumer: task-06
    contract: submit_messages ctx_tokens 提取与写回
    fields: [usage.ctx_tokens 提取, AgentRun.ctx_tokens last-write-wins 赋值, 缺键跳过]
  - consumer: task-06
    contract: SSE 两路 payload 与 SessionRunRead.ctx_tokens
    fields: [messages summary ctx_tokens, tokens 事件 ctx_tokens, None 不带键, SessionRunRead 序列化]
  - consumer: task-06
    contract: close_interactive_run 不写 ctx_tokens
    fields: [终态后 ctx_tokens 保留实时值, input/output 终态照旧覆盖]
expects_from:
  task-04:
    - contract: AgentRun.ctx_tokens 列
      needs:
        - nullable INT 可写
  task-02:
    - contract: daemon flush 消息顶层 usage dict
      needs:
        - ctx_tokens 仅 main 桶携带
        - 老 daemon 缺键兼容
goal: >
  打通 ctx_tokens 的 backend 全链路（D-005@v1 复用 usage 附带管线）——submit_messages 提取并 last-write-wins 写回、SSE 两路 payload 透传、SessionRunRead 加字段；close_interactive_run 不加字段不覆盖 ctx_tokens（SDK result 无 per-call 拆分，保留实时最后写入值）。
implementation:
  - service.py submit_messages usage 提取循环（~:786-810）加 ctx_tok = usage.get("ctx_tokens")，isinstance 守卫下 latest_ctx_tokens = int(ctx_tok) 直接赋值（批内最后出现值胜出；缺键跳过 = 老 daemon 兼容）
  - service.py 实时写回块（~:1135-1164）加 if latest_ctx_tokens is not None 分支直接 agent_run.ctx_tokens 赋值 + session.add —— 刻意不做仅增不减（ctx 是瞬时量可上可下，design §7 守卫差异）；input/output/cache 四列 max 守卫不动
  - service.py publish 侧三处同步：标量提取（~:1227-1234）加 publish_ctx_tokens；PublishIntent dataclass（~:131-141）加字段 ctx_tokens；构造点（~:1266-1278）传入
  - service.py publish_submitted_messages 两路 payload：run channel summary（~:191-208）与 session channel tokens 事件（~:259-275）各加 if intent.ctx_tokens is not None 时写 payload["ctx_tokens"]（None 不带键，老前端/老 daemon 兼容 §9）
  - router.py SessionRunRead（~:1883-1916）加 ctx_tokens（int | None，from_attributes 直映列），runs 查询零改动
  - close 路径不加字段：InteractiveRunResultRequest（router ~:1202）与 close_interactive_run（service ~:1418）均不新增 ctx_tokens，终态不触碰 AgentRun.ctx_tokens
  - R-09 备选步骤——若 task-01 spike 结论偏差 >5%，close 终态 input/output 改守卫式覆盖（仅 result > 实时写入值才覆盖，service.py ~:1622-1625 处），结论记 QUICKLOG；spike 通过则维持权威覆盖，不加 fallback 代码
acceptance:
  - submit_messages 批内多条 usage.ctx_tokens 落库取最后出现值（允许变小，非 max）；缺键不写不报错
  - ctx 非 None 时 SSE 两路 payload 均含 ctx_tokens；None 时两路 payload 无该键
  - SessionRunRead 序列化输出 ctx_tokens（历史行 None 如实输出）
  - close_interactive_run 终态后 AgentRun.ctx_tokens 仍等于实时写入值（input/output 照旧终态覆盖）——由 task-06 测试断言
  - 既有相关测试（test_run_sync_cache_parse / test_session_sse / test_close_interactive_run_model_error / test_session_runs_endpoint）零回归
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_run_sync_cache_parse.py app/modules/daemon/tests/test_session_sse.py app/modules/daemon/tests/test_close_interactive_run_model_error.py app/modules/daemon/tests/test_session_runs_endpoint.py
  - cd backend && uv run ruff check . && uv run mypy app
constraints:
  - close 请求 DTO（InteractiveRunResultRequest）不加字段；close_interactive_run 不写 ctx_tokens
  - ctx_tokens 写回 last-write-wins 不用 max；input/output/cache_* 仅增不减守卫维持现状（§7 守卫差异）
  - SSE/REST payload 仅增 nullable 字段且 None 不带键（§9 兼容）；路由路径与既有列语义不变
  - 本卡不写/不改测试（归 task-06）；既有测试若有断言失效先回报再处理，不私自改断言
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
