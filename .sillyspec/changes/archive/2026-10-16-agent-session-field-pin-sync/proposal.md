---
author: flow-machine-draft
created_at: 2026-10-16T11:14:00.159Z
---
# 提案书（Proposal）— 2026-10-16-agent-session-field-pin-sync

## 动机

任务原话转写：清偿跨变更存量债：2026-10-16-backend-mem-polling task-08 给 agent_sessions 加 title_fallback 列后漏更 AgentSession 字段钉测试（期望 34 实际 35，实测在 2026-10-16-fix-auth-random-logout verify 质量扫描拦截，local.yaml 已留窄锚豁免与归因）。

成功标准：
- backend/app/modules/agent/tests/test_agent_session_model.py 期望字段集补 title_fallback（含来源注释），字段数断言 34→35
- 该测试单跑通过；删除 .sillyspec/local.yaml 中 '^E\s+AssertionError: AgentSession field mismatch' 豁免行后质量扫描不再依赖豁免
- 不改任何模型/业务代码，仅测试与配置

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. backend/app/modules/agent/tests/test_agent_session_model.py 期望字段集补 title_fallback（含来源注释），字段数断言 34→35
2. 该测试单跑通过；删除 .sillyspec/local.yaml 中 '^E\s+AssertionError: AgentSession field mismatch' 豁免行后质量扫描不再依赖豁免
3. 不改任何模型/业务代码，仅测试与配置

## 成功标准（可验证）

1. backend/app/modules/agent/tests/test_agent_session_model.py 期望字段集补 title_fallback（含来源注释），字段数断言 34→35
2. 该测试单跑通过；删除 .sillyspec/local.yaml 中 '^E\s+AssertionError: AgentSession field mismatch' 豁免行后质量扫描不再依赖豁免
3. 不改任何模型/业务代码，仅测试与配置
