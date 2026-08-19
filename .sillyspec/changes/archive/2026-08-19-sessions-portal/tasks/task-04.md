---
id: task-04
title: _inject_provider_config 会话级供应商最高优先级分支 + 优先级单测（覆盖 FR-04, D-013@v1）
title_zh: 会话级供应商配置注入分支
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-04, FR-03]
decision_ids: [D-013@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/tests/test_lease_context_provider_priority.py
provides:
  - contract: SessionProviderInjection
    fields: [session_llm_provider_id]
expects_from: {}
goal: >
  在 _inject_provider_config 加会话级供应商最高优先级分支（两级优先级：会话选择大于全局默认），用独立 metadata key 不碰既有 bound/default 链实现零回归。
implementation:
  - context.py _inject_provider_config（:208-294）开头加分支：lease metadata 含 session_llm_provider_id 时解析该供应商构造 provider_config 并 return
  - 复用既有 resolve_bound_provider_config helper（:139-206 模式）按该 id 解析（校验属主与 agent_kind）
  - 分支异常时降级走原链（不阻断会话创建）
  - 新增单测覆盖矩阵：会话供应商>全局默认、未传走原链（bound/default 两分支）、会话供应商不存在时降级
acceptance:
  - 有 session_llm_provider_id 时 provider_config 来源于该供应商
  - 无该 key 时注入结果与现状逐字段一致（零回归）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -x -q -k provider
constraints:
  - 不引入 profile.model 派生（D-013 裁定移除）
  - metadata key 命名 session_llm_provider_id 与档案绑定 key llm_provider_id 严格区分
related_tests: []
---
