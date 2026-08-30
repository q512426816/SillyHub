---
id: task-12
title: "后端测试 `backend/app/modules/llm_provider/tests/`：fetch-models mock httpx（正常/401→AUTH_FAILED/404→候选兜底/全失败→ALL_FAILED/超时→TIMEOUT/SSRF 拒私网+IPv6/双形态）；migration `alembic upgrade head` 单头 `202607270900`；context.py 透传 settings_config。（覆盖：AC-06, AC-07, NFR-01/02）— 依赖 task-01/02/03/04"
title_zh: 后端测试（fetch-models mock httpx + SSRF + 双形态 + migration 单头 + context 透传）
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P0
depends_on: [task-01, task-02, task-03, task-04]
blocks: []
requirement_ids: [NFR-01, NFR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/llm_provider/tests/
goal: >
  后端覆盖 fetch-models 各错误分支 + SSRF 拒私网 IPv4/IPv6 + 双形态 + migration 单头 + context.py 透传 settings_config（design §7 测试策略 / §5.1 错误分类）。
implementation:
  - 新建 backend/app/modules/llm_provider/tests/test_fetch_models.py：patch httpx.AsyncClient（不打真实网络），测正常拉 /v1/models 返回 [{id,owned_by}]；401/403→LLM_PROVIDER_AUTH_FAILED；404/405→候选 URL 剥离 /anthropic/compatibility/api 兜底成功；候选全失败→LLM_PROVIDER_MODELS_ALL_FAILED；超时→LLM_PROVIDER_MODELS_TIMEOUT
  - 双形态覆盖：provider_id 形态（seed 加密行 + get_cipher 真解密拉取）+ base_url+api_key 直传形态（断言不写库）；额外断言 api_key 明文永不入 fetch 响应/不进日志（design §8 安全）
  - SSRF 断言「拒绝」（照 tool_gateway/tests/test_policy.py:127-154 patch socket.getaddrinfo 范式）：返回 10.x/192.168.x/127.0.0.1/0.0.0.0 IPv4 + ::1/fc00::/7/fe80::/10 IPv6 全部断言抛错，不放过私网；含 task-03 的 getaddrinfo 包 asyncio.to_thread 不阻塞验证
  - migration 单头断言：alembic heads 单头 202607270900；alembic upgrade head 成功（settings_config 列已加）；alembic downgrade -1 可回滚不报错
  - context 透传断言：daemon/lease/context.py:139-148 产出的 provider_config dict 含 settings_config 键且值等于 provider.settings_config（透传不解密不加工）；settings_config=None 时键值为 None（不省略键）
acceptance:
  - 7 类 fetch-models 场景断言通过（正常 / 401→AUTH_FAILED / 404 候选兜底 / 全候选失败→ALL_FAILED / 超时→TIMEOUT / SSRF 拒私网 IPv4+IPv6 / 双形态 provider_id 解密 + base_url+key 直传）
  - migration `alembic upgrade head` 单头 202607270900 断言通过（防多 head 分叉）
  - context.py provider_config 含 settings_config 透传断言通过
  - 全量 `pytest app/modules/llm_provider` 绿（含既有 task-05 CRUD 用例零回归）
verify:
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov
  - cd backend && uv run alembic upgrade head && alembic heads
constraints:
  - mock httpx 不打真实网络（避免 flaky，照 test_policy.py patch socket.getaddrinfo 范式）
  - SSRF 测试断言「拒绝」而非「允许」（断言抛错不放过私网，含 IPv6）
  - SQLite 测试库（backend 本地测试 env；conftest.py 已注入 SILLYSPEC_MASTER_KEY，crypto 走真实加解密）
  - 不为通过而改测试逻辑（CLAUDE.md 规则9）；测试逻辑本身有误才改被测代码，断言不绑死 PG 专有函数
---
