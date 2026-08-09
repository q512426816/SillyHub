---
id: task-02
title: schema + service/probe passthrough api_format, auth/url helpers per format
title_zh: schema/service/probe 按 api_format 透传 + 鉴权头/候选URL/剥路径 helper
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-01]
blocks: [task-03, task-04]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/schema.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/service.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/probe.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/router.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_fetch_models.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_probe.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_llm_provider.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_router.py
goal: >
  schema（Create/Update/Read/FetchModelsRequest）加 api_format 字段；service/probe 按 api_format 产鉴权头 + 候选 URL，新增 _strip_openai_suffix 归一完整端点 URL；fetch_models / probe_provider / router 全链路透传 format（FR-02/03/04, D-002@v1）。
implementation:
  - schema.py：LlmProviderCreate / LlmProviderUpdate / LlmProviderRead 加 api_format: Literal["anthropic","openai_chat"]（Create/Update default "anthropic"；Read 从行读）；FetchModelsRequest 内联形态加 api_format: Literal[...]|None（编辑态从 provider 行读，新建态可选，缺省 anthropic）
  - schema.py：FetchModelsRequest._enforce_dual_form 兼容 api_format（不破坏既有 provider_id vs base_url+api_key 互斥校验；api_format 可随任一形态传入）
  - service.py：_build_auth_headers 加 api_format 参数——openai_chat 恒 {"Authorization": f"Bearer {api_key}"}；anthropic 沿用现有逻辑（ANTHROPIC_API_KEY→x-api-key+anthropic-version / ANTHROPIC_AUTH_TOKEN→Bearer），逐字照 design §7.2
  - service.py：新增 _strip_openai_suffix(base_url)->str 类方法（@classmethod）：剥尾部 /chat/completions（兼容尾斜杠）→ 得 OpenAI base；非标准 URL 原样返回（R-06 兜底）
  - service.py：_candidate_urls 加 api_format 参数——openai_chat 走 _strip_openai_suffix 后产 [base/models, base/v1/models]（兼容 base 是否含 /v1）；anthropic 沿用现有 _candidate_urls 逐字不变
  - service.py：fetch_models / _resolve_fetch_credentials / _detect（若存在）透传 api_format：编辑态从 provider 行读 api_format，新建态从 FetchModelsRequest 读；按 format 调 _build_auth_headers + _candidate_urls
  - service.py：create/update 写入时持久化 api_format（task-01 列已就绪）；_to_read 出参带 api_format
  - probe.py：probe_provider 加 api_format 参数，按 format 产鉴权头 + 候选 URL（复用 service 的 helper 或同名逻辑，避免双份实现漂移）
  - router.py：无新端点；fetch-models / probe / CRUD 端点的请求体与响应按 schema 新字段透传（Pydantic 自动，确认 router 未硬编码剥字段）
acceptance:
  - LlmProviderCreate/Update/Read/FetchModelsRequest 均含 api_format 字段（Literal anthropic|openai_chat）
  - openai_chat 格式 _build_auth_headers 恒返回纯 Bearer 头（D-002@v1）
  - anthropic 格式 _build_auth_headers / _candidate_urls 输出与改动前逐字一致（NFR-02 零回归）
  - _strip_openai_suffix("https://x/v1/chat/completions") == "https://x/v1"；_candidate_urls(openai) 产 [base/models, base/v1/models]
  - fetch_models 编辑态用 provider 行的 api_format；新建态用请求体 api_format（缺省 anthropic）
verify:
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov（既有用例零回归 + task-03 新用例覆盖双格式）
  - grep -n "_build_auth_headers\|_candidate_urls\|_strip_openai_suffix" backend/app/modules/llm_provider/service.py（签名均带 api_format）
constraints:
  - anthropic 分支逐字不变（NFR-02）；openai 分支忽略 auth_field（D-002@v1，auth_field 列与枚举不动）
  - 完整 URL 一律算法归一，不读 is_full_url（D-001@v1，本任务不碰 model）
  - 明文 api_key 永不进响应/日志（R-02/R-04 既有铁律延续）；helper 只产请求头，不落 key
  - 不在本任务写新测试文件（task-03 负责），但本任务改完既有 test_fetch_models/test_probe 若因签名变化失败须同步修调用方（非测试逻辑误判）
provides:
  - schema api_format 字段：LlmProviderCreate/Update/Read.api_format（Literal anthropic|openai_chat）+ FetchModelsRequest.api_format（内联形态可选）
  - service helper 契约：_build_auth_headers(api_key, auth_field, api_format) / _candidate_urls(base_url, api_format) / _strip_openai_suffix(base_url)
  - 全链路 format 透传：create/update 持久化 api_format、_to_read 出参、fetch_models（双形态）、probe_provider、router 端点
  - OpenAPI 自动暴露 api_format（供 task-04 gen:types 抓取）
expects_from:
  task-01: [LlmProvider.api_format 列（NOT NULL default 'anthropic'），迁移已可 upgrade head]
---

# task-02 实现笔记

design 锚点：§6 文件清单第 3~6 行 / §7.1 schema / §7.2 鉴权头+候选URL / §11 D-001@v1·D-002@v1。

本任务是 Wave1 中枢：上游消费 task-01 的列，下游 task-03 测 helper、task-04 抓 OpenAPI 字段都依赖本任务的 schema + helper 契约落地。provides 列出的字段/函数签名是跨任务契约，plan-postcheck 会逐字校验，勿擅自改名。

helper 实现尽量单一来源（service 定义，probe 复用），避免双份 anthropic/openai 分支逻辑漂移。明文 key 处理沿用既有 cipher.decrypt + 不入日志（service.py 已有铁律）。
