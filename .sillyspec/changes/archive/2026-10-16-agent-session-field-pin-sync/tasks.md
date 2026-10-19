---
author: flow-machine-draft
created_at: 2026-10-16T11:14:00.159Z
---
# 任务注册表（Tasks）— 2026-10-16-agent-session-field-pin-sync

- [x] task-01: backend/app/modules/agent/tests/test_agent_session_model.py 期望字段集补 title_fallback（含来源注释），字段数断言 34→35
- [x] task-02: 该测试单跑通过；删除 .sillyspec/local.yaml 中 '^E\s+AssertionError: AgentSession field mismatch' 豁免行后质量扫描不再依赖豁免
- [x] task-03: 不改任何模型/业务代码，仅测试与配置
