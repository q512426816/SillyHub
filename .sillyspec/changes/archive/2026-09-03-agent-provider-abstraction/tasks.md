---
author: qinyi
created_at: 2026-09-03 23:47:00
---

# 任务清单（Tasks）

> plan 已展开（plan_level=full，14 任务 6 Wave）；Wave 分组与依赖见 plan.md，任务名唯一真相在本文件。

- [x] task-01: AgentEvent v2 类型扩展与 zod schema（types.ts + agent-event-schema.ts）
- [x] task-02: ProviderCaps 三端镜像表与守护测试（providers.ts caps + provider_caps.py + provider-caps.ts）
- [x] task-03: ClaudeEventNormalizer 归一化器（完整展开/partial+override/depth 状态机/status 事件化）
- [x] task-04: CodexAppServerDriver flat message → AgentEvent 映射
- [x] task-05: providers.ts 注册表与 InteractiveProvider 推导（_getDriver 改读注册表）
- [x] task-06: driver.ts 契约演进（TurnMessageEnvelope）与 ClaudeSdkDriver 接入归一化器
- [x] task-07: backend _persist_agent_event 分支与 SSE agent_event 透传（兼容轨保留）
- [x] task-08: SessionManager status 分发改造与瘦身 + cli.ts 类型接线（raw 依赖清零）
- [x] task-09: daemon.ts 接线 + hub-client agent_event 载荷 + SILLYHUB_LEGACY_TEXT_EVENTS 回退开关
- [x] task-10: 前端 normalize.ts 双轨（agent_event 优先/文本协议回退）
- [x] task-11: 三端 provider 门控收敛查表（session-panel + daemon/session/service.py，行为不变）
- [x] task-12: golden 三源对照测试收口（normalizer ≡ 三处现状实现联合语义）
- [x] task-13: 双路径渲染等价 fixture 测试（Claude 零回归判据）
- [x] task-14: docs/agent-provider-onboarding.md 三档接入清单
