---
id: task-10
title: "后端测试 backend/app/modules/llm_provider/tests/test_usage.py：mock httpx 覆盖每家（DeepSeek/硅基/OpenRouter balance 正常 + Kimi/Kimi For Coding/智谱/MiniMax token_plan 多 tier 正常）+ 错误分类（401→success:false is_valid:false / 404→不支持 / 超时→raise 5xx / SSRF 拒私网+IPv6）+ detect_provider 路由（Kimi vs Kimi For Coding 同 api.kimi.com / 智谱个人版）+ api_key 明文不入响应/日志断言。覆盖 AC-02/03/04/07, NFR-01/02/03。依赖 task-01~04。"
title_zh: 后端用量查询测试（mock httpx + detect + SSRF + 安全断言）
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: [task-01, task-02, task-03, task-04]
blocks: []
requirement_ids: [FR-03, FR-04, FR-08]
decision_ids: [D-004@v1, D-005@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/llm_provider/tests/test_usage.py
provides: []
expects_from: []
goal: >
  mock httpx 覆盖 7 家用量查询正常解析、错误两态分类、SSRF 拒绝、detect 路由、
  api_key 不泄漏断言；照 test_fetch_models.py 的 patch httpx.AsyncClient + AsyncMock 范式。
implementation:
  - balance 3 家正常：mock httpx 返回 DeepSeek /user/balance（balance_infos[].total_balance）、硅基 /v1/user/info、OpenRouter /api/v1/credits，断言解析出 remaining/total/unit 正确（USD/CNY/%）。
  - token_plan 4 家多 tier：mock Kimi /coding/v1/usages、Kimi-For-Coding、智谱 /api/paas/v4/coding-plan/quota（按 unit 分 5h 窗/周窗）、MiniMax /v1/api/openplatform/coding_plan/remains，断言 list[UsageData] 多 tier 逐条解析。
  - 错误两态(D-005)：401/403 → UsageResult{success:false} + data[].is_valid=false（确定性不 raise）；超时(httpx.TimeoutException)/5xx/429/ConnectError → raise AppError 5xx（瞬时，断言 http_status 5xx）。
  - 不支持分支：404/上游空体/未知供应商（detect 不到）→ UsageResult{success:false}（不 raise，区别于鉴权失败）。
  - SSRF：照 test_fetch_models._SSRF_PRIVATE_CASES 范式 patch getaddrinfo，私网 IPv4(10/127/192.168/172.16/169.254/0.0.0.0)+IPv6(::1/fc00/fd00/fe80)+DNS gaierror → raise LlmProviderSsrfBlocked，httpx 永不被调。
  - detect_provider 路由：断言 Kimi(base_url 含 api.kimi.com 非 /coding) vs Kimi-For-Coding(api.kimi.com/coding) 分流到同 token_plan handler；智谱 bigmodel.cn → 个人版；未知 base_url → success:false。
  - api_key 安全(NFR-02)：provider_id 形态用真实 cipher 落库，断言 UsageResult.model_dump_json() 不含明文 key；mock logger 断言日志无明文；client.get headers 用解密明文（证明真解密）。
  - 用 pytest-asyncio + _wire_async_client/_make_response helper（复用 test_fetch_models 范式）；所有 case patch getaddrinfo 防真实 DNS（hermetic）。
acceptance:
  - 7 家正常解析（3 balance + 4 token_plan）返回 success:true + data 多 tier 字段正确。
  - 错误两态分类正确：401/403→success:false+is_valid:false；404/未知→success:false；超时/5xx/429→raise AppError 5xx。
  - SSRF 拒私网 IPv4+IPv6+DNS 失败，httpx 永不被调；15s 超时生效（NFR-01）。
  - detect_provider 路由正确：Kimi vs Kimi-For-Coding 同 api.kimi.com 分流、智谱个人版、未知→不支持。
  - api_key 明文不入 UsageResult 响应 / 不入日志（NFR-02），仅局部变量用于鉴权头。
  - 新增测试全绿，既有 test_fetch_models/test_llm_provider 零回归。
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/llm_provider/tests/test_usage.py -q --no-cov
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/llm_provider -q --no-cov
constraints:
  - 用现有 venv python（backend/.venv/Scripts/python.exe）；SQLite+aiosqlite 测试库。
  - mock httpx 不打真实网络（项目无 respx/httpx_mock，照 test_fetch_models.py 的 patch httpx.AsyncClient + AsyncMock）。
  - 断言不绑死 PG 专有 SQL 函数名（memory backend-test-sqlite-vs-pg）；时间断言用 test 内 datetime.now()。
  - 遵循现有 test 风格：照 test_fetch_models.py 的 _wire_async_client/_make_response/_PUBLIC_GAI helper + pytest.mark.asyncio + db_session fixture。
  - brownfield：不改既有 test_fetch_models.py / test_llm_provider.py，新建独立 test_usage.py。
---
