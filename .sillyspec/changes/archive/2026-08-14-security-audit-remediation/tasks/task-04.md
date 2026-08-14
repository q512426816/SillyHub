---
id: task-04
title: "llm-proxy 端点 + master key 两处收窄"
title_zh: "LiteLLM master key 收窄 + /api/daemon/llm-proxy 透传端点"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/tests/test_llm_proxy.py
  - sillyhub-daemon/src/credential-injector.ts
  - sillyhub-daemon/src/spawn-env.ts
  - sillyhub-daemon/tests/credential-injector.test.ts
provides: {}
expects_from:
  - contract: ws_upgrade_auth_helper
    from: task-01
    expectation: Bearer 值分流解析（shk_live_ 前缀走 ApiKeyService 否则 JWT）的 helper 可在 llm-proxy 端点复用
goal: >
  master key 只存在于 backend 进程内：context.py 两处 openai_chat 分支不再下发明文 key，新增 llm-proxy 透传端点带 model 归属断言。
implementation:
  - 新建 backend tests/test_llm_proxy.py，先写失败用例（他人 uid 的 usr 模型名 403、本人放行转发、claim payload 无 master key 断言、context 两分支构造的 config 含 litellm_proxy 标记且不含 litellm_auth_token）
  - daemon/router.py 新增 ANY 方法 /llm-proxy/{path:path} 端点：鉴权复用 task-01 的凭据分流（X-API-Key 或 Bearer，Bearer 值先 shk_live_ 前缀短路走 ApiKeyService.authenticate 否则 JWT 解析），失败 401
  - 端点内从请求 body 的 model 字段或 path 中提取 usr-uid-pid 模式（litellm_model_name 单一真相源格式），断言 uid 等于认证 user.id，不匹配 403（堵借用他人上游 key，Grill UB-4b）
  - 用 httpx AsyncClient 流式转发 settings.litellm_base_url 拼接 path，注入 Authorization Bearer master key 后透传响应（含流式），master key 不得出现在日志与响应
  - context.py resolve_default_provider_config（:106-119）与 resolve_bound_provider_config（:179-190）两处 openai_chat 分支全部删 litellm_auth_token，改下发 litellm_proxy 布尔标记 + litellm_base_url 指向 hub 代理地址（从 settings 构造 daemon 可达的 hub origin 加 /api/daemon/llm-proxy 路径）
  - anthropic 分支 9 字段逐字不动（NFR-01 零回归）
  - sillyhub-daemon credential-injector.ts toEnv（:95-106 openai_chat 分支）：litellm_proxy 标记时 ANTHROPIC_BASE_URL 设为下发 litellm_base_url（代理地址）、ANTHROPIC_AUTH_TOKEN 设为 daemon 自身 apiKey（daemon config 已持有），4 档位 model 映射保持指向 litellm_model_name
  - spawn-env.ts 确认 provider_config 新增的 litellm_proxy 字段随第 0 层 Object.assign 整体透传到 injector（类型定义按需补可选字段）
  - daemon 侧测试补 injector env 断言（代理形态下 BASE_URL 指代理、AUTH_TOKEN 为 daemon apiKey、绝无 master key 值）
acceptance:
  - 任何用户带本人凭据经 proxy 请求他人 uid 的 usr 模型名返回 403
  - 本人 usr 模型名请求被流式转发到 LiteLLM 且上游收到 master key 鉴权
  - resolve_default 与 resolve_bound 两处产出的 provider_config 均不含 litellm_auth_token 字段，含 litellm_proxy true 与代理 base_url
  - injector 在 litellm_proxy 形态注入的 env 中 AUTH_TOKEN 为 daemon apiKey、BASE_URL 为代理地址
  - 无 openai_chat 供应商的既有路径（缺省/anthropic）payload 与 env 逐字回归不变
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_llm_proxy.py app/modules/daemon/tests/test_lease_context.py app/modules/daemon/tests/test_resolve_default_provider_config.py app/modules/daemon/tests/test_resolve_bound_provider_config.py -q --no-cov
  - cd sillyhub-daemon && npm test -- credential-injector.test.ts
constraints:
  - daemon/router.py 同 Wave 多 task 触及（task-01/task-03 也改本文件），execute 须串行提交
  - context.py 必须两处都改（design M-1 明确 :117 与 :188 两个下发点），漏一处即高危残留
  - master key 只在 backend 进程内注入转发，禁止进 payload、日志、错误信息
  - 代理端点写请求 body 需读流后再转发，注意大 body 场景不复述不落盘；超时与连接池对齐 R-02 应对策略
  - daemon 侧 apiKey 注入位置在 injector（Grill M-2 落点），不改 daemon.ts
related_tests:
  - path: backend/app/modules/daemon/tests/test_resolve_default_provider_config.py
    reason: 既有断言 openai_chat 分支含 litellm_auth_token 字段，字段删除后需改为断言 litellm_proxy 标记
  - path: backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py
    reason: 同上，bound 分支的 master key 下发断言需同步改造
  - path: sillyhub-daemon/tests/credential-injector.test.ts
    reason: 既有 openai_chat 用例断言 AUTH_TOKEN 为 litellm_auth_token（master key），改为断言代理形态注入 daemon apiKey
---
