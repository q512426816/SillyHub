---
id: task-01
title: 凭证探测 probe.py 轻量请求验 key/base_url 落地 spike-01 结论
title_zh: 凭证探测 probe.py
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on: []
blocks:
  - task-03
requirement_ids:
  - FR-01
  - FR-08
decision_ids:
  - D-003
allowed_paths:
  - backend/app/modules/llm_provider/probe.py
goal: >
  新增凭证探测函数用轻量请求验证 GLM/kimi 等供应商的 key/base_url 有效性,供 set_default 切换前校验,探测形态由 spike-01 实测确定
implementation:
  - spike-01 实测确定探测形态,优先 GET /v1/models 列模型,次选极简 messages completion 二选一
  - 新增 probe.py 实现 probe_provider 函数接收 base_url api_key auth_field model 返回 ProviderProbeResult
  - 复用 service.py 的 _build_auth_headers 与 _candidate_urls 及 SSRF 防护范式构造请求,超时 10 秒
  - 401/403 与网络异常归类为失败并返回 error 原因,不抛异常破坏会话
acceptance:
  - 有效凭证返回 ok 为 true
  - 无效 key 返回 ok 为 false 并附带原因
  - 网络错误不抛异常返回 ok 为 false
verify:
  - cd backend && pytest app/modules/llm_provider/tests/test_probe.py
constraints:
  - 明文 api_key 绝不入日志 R-02
  - 仅 claude agent_kind
  - spike-01 结论回填探测形态
provides:
  - contract: ProviderProbeResult
    fields:
      - ok
      - error
---
