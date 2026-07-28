---
id: task-03
title: "backend/app/modules/llm_provider/service.py 加 query_usage(provider_id, user_id)：解密 api_key（复用 _resolve_fetch_credentials 范式取 base_url+key+auth_field）+ detect_provider(base_url)（按 base_url 子串路由 balance/token_plan，照 cc-switch balance.rs:26/coding_plan.rs:25）+ 调 task-02 handler + 错误两态（瞬时网络/5xx/429/超时→raise AppError 5xx；确定性 401/403/空 key/未知供应商→UsageResult{success:false}）+ SSRF 复用 tool_policy.ToolPolicyService.assert_public_hostname。15s 超时。覆盖 FR-03/04/08, D-004/005/009。依赖 task-02。"
title_zh: service 用量查询+detect_provider+错误两态+SSRF
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: [task-02]
blocks: [task-04]
requirement_ids: [FR-03, FR-04, FR-08]
decision_ids: [D-004@v1, D-005@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/llm_provider/service.py
provides: [{contract: UsageResult, fields: [success, data, error]}]
expects_from:
  task-01:
    - {contract: UsageResult, needs: [success, data, error]}
    - {contract: UsageData, needs: [plan_name, is_valid, total, used, remaining, unit]}
goal: >
  在 service 层组装用量查询——解密凭证、detect 供应商、调 handler、SSRF 防护、错误两态分流，返回统一 UsageResult。
implementation:
  - owner 校验复用 self.get(provider_id, user_id)（跨用户 404/403 不泄漏，同既有端点范式）
  - 解密：row→self._cipher.decrypt(encrypted_api_key, key_id) 取明文+row.base_url+row.auth_field（照 _resolve_fetch_credentials provider_id 分支范式，因 query_usage 仅 provider_id 形态不直接调它）；空 base_url/空 key→UsageResult{success:false}
  - detect_provider(base_url) 按 base_url 子串路由 balance/token_plan（照 cc-switch balance.rs:26/coding_plan.rs:25）；Kimi-For-Coding 命中 /coding 分支区别 Kimi（plan.md 风险1）；未知供应商→UsageResult{success:false}
  - SSRF：发请求前 await ToolPolicyService.assert_public_hostname(host)（同 fetch_models task-03 范式，IPv4+IPv6+to_thread）；SsrfBlocked 翻译回 llm_provider 自身错误类
  - 调 task-02 handler（_USAGE_TIMEOUT=15.0，httpx.AsyncClient）传 base_url+api_key_plain+auth_field→list[UsageData]
  - 错误两态(D-005)：httpx.TimeoutException/ConnectError/5xx/429→raise AppError 5xx（瞬时，前端保留上次成功值）；401/403→UsageResult{success:false}（确定性，前端翻红）
  - 组装返回 UsageResult{success:true,data:tiers,error:None}；api_key 明文仅局部变量，永不入日志/响应
acceptance:
  - 跨用户访问 404/403 不泄漏存在性（复用 self.get）
  - SSRF 拒私网 IPv4+IPv6+DNS 解析失败（复用 assert_public_hostname，不自己写 DNS）
  - 瞬时(超时/5xx/429/ConnectError)→raise AppError 5xx；确定性(401/403/空key/未知供应商)→UsageResult{success:false}；15s 超时生效
  - detect_provider 正确区分 Kimi vs Kimi-For-Coding(/coding 子路径)；api_key 明文不入日志/响应
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/llm_provider/tests/test_usage.py -q --no-cov （task-10 覆盖）
  - cd backend && .venv/Scripts/python.exe -c "from app.modules.llm_provider.service import LlmProviderService"
constraints:
  - 复用 assert_public_hostname 不自己写 DNS 解析；detect 不加 DB 字段靠 base_url 子串（D-004）
  - 错误两态严格按 D-005；api_key 明文仅局部变量永不入响应/日志（NFR-02，同 fetch-models）
  - brownfield：不改现有 fetch_models/_resolve_fetch_credentials/_build_auth_headers/_candidate_urls
---
