---
id: task-07
title: lease 下发单测（有/无 provider 两路 + agent_kind 归一化 + 不入审计）
title_zh: lease 下发 provider_config 单测
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-06]
blocks: [task-13]
requirement_ids: [FR-03, FR-07]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - backend/tests/modules/daemon/lease/test_provider_config_payload.py
goal: >
  为 task-06 的 build_claim_payload 注入 provider_config 补 lease 下发单测，覆盖有默认
  provider→全字段 / 未配→absent 两路 + agent_kind 归一化 + provider_config 不落审计。
implementation:
  - 新建 test_provider_config_payload.py，参考 backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py 的 AsyncSession+lease+runtime 夹具范式（SQLite+aiosqlite）
  - 夹具：user_a + DaemonRuntime（user_id=user_a）+ interactive/batch lease（agent_run.agent_type=claude_code）+ user_a 默认 LlmProvider（agent_kind=claude，is_default=True）
  - 用例1 有 provider：build_claim_payload 断言 payload[provider_config] 含 task-06 provides 全字段且 api_key 是明文（interactive+batch 两路）
  - 用例2 未配：无默认 provider 用户断言 provider_config not in payload（D-007 零回归）
  - 用例3 归一化：agent_type=claude_code → 仍命中 agent_kind=claude provider（X-08）
  - 用例4 审计脱敏：查 AuditLog 表断言无明文 api_key / 无 provider_config 结构（R-02）
acceptance:
  - 有默认 provider → payload.provider_config 全字段就位、api_key 明文解密正确（两路 lease kind）
  - 未配 provider → provider_config 字段 absent，payload 行为与 task-06 前一致（零回归）
  - claude_code 经归一化命中 claude provider
  - AuditLog 不含明文 api_key / 不含 provider_config（R-02 脱敏成立）
verify:
  - cd backend && uv run pytest tests/modules/daemon/lease/test_provider_config_payload.py -q --no-cov
constraints:
  - 两路用例必须覆盖：有默认 provider（全字段）/ 未配（absent 非空 dict）
  - agent_kind 归一化用例：claude_code（adapter id）→ 查到 agent_kind=claude provider（X-08 复用 _normalize_lease_provider）
  - 断言 provider_config 不在审计日志（查 AuditLog 无明文 api_key / 无 provider_config，R-02）
  - 不真实调 daemon（不启进程 / 不发 WS），纯 backend 单测
  - 测试用 SQLite+aiosqlite（断言不绑死 PG 方言）
  - 不修改 task-06 的 context.py/schema.py 来凑通过（CLAUDE.md 规则9），发现缺陷回退 task-06 修
  - 模块级时间常量坑：时间断言用 test 内 datetime.now()，不在模块顶 NOW
---
