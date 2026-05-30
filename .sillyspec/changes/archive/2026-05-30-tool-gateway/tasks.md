---
author: qinyi
created_at: 2026-05-30T20:50:00
---

# Tasks — Tool Gateway 通用化

细节在 plan 阶段展开。

## 任务列表

1. **tool_policies 数据模型 + 迁移** — `app/modules/tool_gateway/tool_policy.py`, `migrations/versions/xxx_add_tool_policies.py`
2. **AgentRun 关联 ToolPolicy** — `app/modules/agent/model.py` 新增 FK
3. **ToolPolicyService 策略引擎** — `app/modules/tool_gateway/tool_policy.py` 校验逻辑
4. **Policy CRUD schemas** — `app/modules/tool_gateway/policy_schema.py`
5. **Policy CRUD router** — `app/modules/tool_gateway/policy_router.py`, `app/main.py` 注册
6. **run_tests handler** — `app/modules/tool_gateway/service.py` 新增 `_handle_run_tests`
7. **http_get handler** — `app/modules/tool_gateway/service.py` 新增 `_handle_http_get`
8. **策略集成到 execute 流程** — `app/modules/tool_gateway/service.py` 集成 policy check + 审计双写
9. **schema 扩展** — `app/modules/tool_gateway/schema.py` 新增 tool_type
10. **完整测试** — `tests/modules/tool_gateway/` 所有单元测试 + 集成测试
