---
author: qinyi
created_at: 2026-09-10 21:21:00
---

# 任务清单（Tasks）

- [x] task-01: PI driver 轮终 assistant 全文进 success result（turnFinalText 截获 + 轮重置 + error 轮不带）
- [x] task-02: hub-client workerDone 增加一次性 sessionId 覆盖参数
- [x] task-03: daemon onTurnResult mission_worker（caps.mcp=false）成功终态代报 worker_done（notifyRunResult 之后、fire-and-forget warn 容错）(depends_on: task-01,02)
- [x] task-04: backend llm_provider schema 放开 agent_kind=pi + auth_field 泛化 env 名 pattern（Create/Update/FetchModels 三处 auth_field）
- [x] task-05: daemon PiCredentialInjector + REGISTRY 注册（api_key→env[auth_field 缺省 ANTHROPIC_API_KEY]、extra_env 透传、其余不映射；连带更新 credential-injector.test.ts 注册表用例）
- [x] task-06: get_daemon_status 增 default_agent/effective_agent/daemons[].providers
- [x] task-07: 前端 llm-provider-form 启用 pi 选项 + pi 时 auth_field 泛化输入 (depends_on: task-08)
- [x] task-08: openapi + frontend/daemon api-types 再生成（gen:types）(depends_on: task-04)
- [x] task-09: 相关测试与类型门禁全量收口（定向测试 + typecheck + 零漂移门禁）(depends_on: task-01,02,03,04,05,06,07,08)
- [x] ql-20260910-018-d305 dispatch 平台侧三问题修复（worker artifacts 承接 / pi 独立配额池 / 生效执行器暴露）
