---
author: qinyi
created_at: 2026-09-10 21:07:00
---

# 任务清单（Tasks）

- [ ] task-01: PI driver 轮终 assistant 全文进 success result（turnFinalText 截获 + 轮重置 + error 轮不带）
- [ ] task-02: hub-client workerDone 增加一次性 sessionId 覆盖参数
- [ ] task-03: daemon onTurnResult mission_worker（caps.mcp=false）成功终态代报 worker_done（notifyRunResult 之后、fire-and-forget warn 容错）
- [ ] task-04: backend llm_provider schema 放开 agent_kind=pi + auth_field 泛化 env 名 pattern（Create/Update/FetchModels 三处 auth_field）
- [ ] task-05: daemon PiCredentialInjector + REGISTRY 注册（api_key→env[auth_field 缺省 ANTHROPIC_API_KEY]、extra_env 透传、其余不映射）
- [ ] task-06: get_daemon_status 增 default_agent/effective_agent/daemons[].providers
- [ ] task-07: 前端 llm-provider-form 启用 pi 选项 + pi 时 auth_field 泛化输入
- [ ] task-08: openapi + frontend/daemon api-types 再生成（gen:types）
- [ ] task-09: 单测补齐（pi driver result / daemon 代报门控时序容错 / pi injector / backend pi kind schema / get_daemon_status 新字段 / 前端表单）
