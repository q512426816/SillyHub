---
id: task-05
title: 后端单测（CRUD+加密落盘+权限隔离+is_default 互斥+masked 不回明文）
title_zh: 后端供应商模块单测
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-04]
blocks: [task-13]
requirement_ids: [FR-01, FR-02, FR-07]
decision_ids: [D-001@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/llm_provider/tests/test_llm_provider.py
goal: >
  为 llm_provider 模块（task-01~04 产出）补后端单测，覆盖 CRUD 全链路 + CredentialCipher
  加密落盘 + owner 权限隔离 + (user_id,agent_kind) is_default 互斥 + masked 不回明文。
implementation:
  - 新建 test_llm_provider.py，SQLite + aiosqlite + async fixture（参考 app/modules/daemon/tests/test_lease_service.py）
  - 构造 user_a/user_b + 各自 provider 夹具，注入真实 SILLYSPEC_MASTER_KEY（参考 git_identity 测试或 conftest crypto fixture）
  - CRUD 用例：create→get→list→patch（api_key=None 不改原密钥）→delete→get 404
  - 加密落盘用例：create 后查 ORM encrypted_api_key 非空且 ≠ 明文（D-001）
  - owner 隔离用例：user_a 看不到/改不到 user_b 的 provider（404，D-008）
  - is_default 互斥用例：同 agent_kind 先设 A 再设 B → A 被清（R-05）；不同 agent_kind 互不影响
  - masked 用例：所有 Read 响应 api_key 字段 absent 且 api_key_masked ≠ 明文（X-09）
acceptance:
  - create 后 ORM encrypted_api_key 非空且 ≠ 明文（加密落盘成立）
  - 用户 A 全程不能 list/get/patch/delete 用户 B 的 provider（owner 隔离）
  - 同 (user_id, agent_kind) 至多 1 条 is_default=True（互斥事务正确）
  - 所有 Read 响应 api_key_masked 存在且永不回明文 api_key
  - 全量用例绿（SQLite 方言兼容，不绑死 PG 函数）
verify:
  - cd backend && uv run pytest app/modules/llm_provider/tests/ -q --no-cov
constraints:
  - 测试用 SQLite + aiosqlite（backend 基线，断言不绑死 PG 专有函数如 date_trunc）
  - 不真实调远端 LLM provider，只验后端加密/权限/互斥/masked 行为
  - create 必须断言落盘的是 encrypted_api_key（LargeBinary）非明文（D-001）
  - owner 隔离：用户 A 不能查/改/删用户 B 的 provider（D-008，service WHERE user_id 过滤）
  - set_default 互斥：同 agent_kind 下旧默认被清（R-05 事务先清后置）
  - api_key_masked 规则由 task-02 落地（X-09），本测试只断言不回明文+非空，不重定义格式
  - 不修改 task-01~04 实现代码来凑通过（CLAUDE.md 规则9），发现缺陷回退对应 task 修
---
