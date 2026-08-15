---
id: task-07
title: 供应商额度端点 GET /api/llm-providers/{id}/quota（一期 GLM，覆盖 FR-08, D-009@v1）
title_zh: 供应商额度查询端点
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P2
depends_on: []
blocks: [task-15]
requirement_ids: [FR-08]
decision_ids: [D-009@v1]
allowed_paths:
  - backend/app/modules/llm_provider/router.py
  - backend/app/modules/llm_provider/schema.py
  - backend/app/modules/llm_provider/usage_handlers.py
  - backend/app/modules/llm_provider/tests/
provides:
  - contract: LlmProviderQuotaResponse
    fields: [quota]
expects_from: {}
goal: >
  新增供应商额度查询端点，一期仅 GLM（智谱）返回 5 小时/周窗口剩余与重置时间，其余供应商或失败返回 quota=null，前端有则显示（D-009）。
implementation:
  - 复用 usage_handlers 既有 _classify_zhipu_window（:318）与 _parse_zhipu_tiers（:333）及其数据源，不新建上游调用
  - schema.py 加 LlmProviderQuotaResponse（quota 为 null 或含 model/windows 数组，window 含 label/left/reset）
  - router.py 加 GET /llm-providers/{id}/quota，鉴权与既有供应商端点一致，限本人供应商
  - 非 GLM（按 base_url/配置判定）或上游失败返回 quota=null，不抛错不阻塞
  - 单测覆盖 GLM 解析复用与非 GLM 返回 null 两路径
acceptance:
  - GLM 供应商返回 windows（5 小时/周，含剩余与重置时间）
  - 非 GLM 与失败场景 HTTP 200 且 quota=null
verify:
  - cd backend && uv run pytest app/modules/llm_provider/tests -x -q -k quota
constraints:
  - 弱依赖：上游接口不可达时降级 null，绝不抛 5xx
  - 不做额度缓存（每次实时查，前端低频调用）
related_tests: []
---
