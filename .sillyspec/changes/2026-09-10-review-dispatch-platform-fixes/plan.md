---
plan_level: full
author: qinyi
created_at: 2026-09-10 21:20:00
---

# 实现计划（Plan）— review-dispatch 平台侧三问题修复

## Spike 前置验证

不需要——三 Wave 的技术断言已在 brainstorm 探查与独立 Grill 中逐条用源码 file:line 核验（worker_done 语义、pi env 约定、三级解析链、caps 门控），无剩余不确定性。

## Wave 1（并行，无依赖）

- task-01
- task-02
- task-04
- task-05
- task-06

## Wave 2（依赖 Wave 1）

- task-03
- task-08

## Wave 3（依赖 Wave 2）

- task-07

## Wave 4（依赖 Wave 3）

- task-09

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | PI driver 轮终 assistant 全文进 success result | W1 | P0 | — | FR-02, D-001@v1 | turnFinalText 截获（override text 事件、轮重置区同点清空）+ success result 补 result 字段；单测 NEW:tests/interactive/pi-rpc-driver-turn-result.test.ts |
| task-02 | hub-client workerDone 增 sessionId 覆盖参数 | W1 | P0 | — | FR-01, D-001@v1 | 第 4 参 opts.sessionId 合并 X-Session-Id 头（与实例级 _sessionIdHeaders 同 key 覆盖）；单测进 NEW:tests/hub-client-worker-done-session.test.ts |
| task-03 | daemon onTurnResult mission_worker 代报 worker_done | W2 | P0 | task-01,02 | FR-01, D-001@v1 | 门控 stage + caps.mcp===false + 非 error + 全文非空；置于 await notifyRunResult 之后；fire-and-forget catch warn（含 HubHttpError）；单测 NEW:tests/daemon-mission-worker-artifact.test.ts |
| task-04 | backend llm_provider schema 放开 pi + auth_field 泛化 | W1 | P0 | — | FR-03, D-002@v1 | agent_kind Literal+pi（仅 Create）；auth_field 三处（Create/Update/FetchModels）改 str+pattern ^[A-Z][A-Z0-9_]*$ 缺省不变；单测 NEW:tests/test_llm_provider_pi_kind.py |
| task-05 | daemon PiCredentialInjector + REGISTRY 注册 | W1 | P0 | — | FR-03, D-002@v1 | api_key→env[auth_field 缺省 ANTHROPIC_API_KEY]（空跳过）、extra_env 透传（空串跳过）、litellm_proxy/base_url/model 不映射；单测 NEW:tests/credential-injector-pi.test.ts；连带债：更新 tests/credential-injector.test.ts 注册表用例（pi 移出「未知 kind 返回 undefined」断言，保留 codex/gemini/未知项） |
| task-06 | get_daemon_status 暴露生效执行器 | W1 | P1 | — | FR-04, D-003@v1 | 顶层 default_agent/effective_agent + daemons[].providers（DaemonRuntime 一条 in 查询按 daemon 分组，online 过滤）；改 tests/test_tools_new.py 断言 |
| task-07 | 前端表单启用 pi + auth_field 泛化输入 | W3 | P1 | task-08 | FR-03, D-002@v1 | agentKind state 可变、启用 pi 预留项；pi 时 auth_field 输入泛化（pattern 同 backend）；改 __tests__/llm-provider-form.test.tsx；execute 期扩：lib/api/llm-providers.ts formToCreate 撤 agent_kind 硬编码 + 别名放宽（否则 UI 建 pi 端到端不通） |
| task-08 | openapi + api-types 再生成 | W2 | P0 | task-04 | FR-03 | frontend `pnpm gen:types`（自带 dump backend/openapi.json）→ daemon `pnpm gen:types`；daemon `gen:types:check` 零漂移；产物含工作树内并行的 avatar 变更 schema 增量（R-05 已登记） |
| task-09 | 相关测试与类型门禁全量收口 | W4 | P0 | task-01~08 | 全部 FR | 跑本变更全部新增/受影响测试（daemon vitest 定向、backend pytest 定向、frontend vitest 定向）+ daemon `pnpm typecheck` + frontend tsc 无新错；不跑全量（CLAUDE.md 规则 0） |

## 关键路径

task-01 → task-03 → task-09（P0-1 主链最长）；task-04 → task-08 → task-07 → task-09（P0-2 支链）。

## 全局验收标准

1. 全部新增/受影响单测通过（daemon vitest / backend pytest / frontend vitest 定向集）。
2. daemon `pnpm typecheck` 零错；daemon `gen:types:check` 零漂移；frontend `pnpm gen:types` 后 tsc 无新错。
3. brownfield 兼容：未建 pi 凭证时 pi 会话 spawn env 与现状逐字一致（injector 缺省跳过）；claude worker 自报路径与 artifacts 零变化（caps 门控）；get_daemon_status 旧键零破坏。
4. 活体回归（用户远端执行，不阻塞本仓收口）：review-dispatch 真派发 completed 且 artifacts 非空可提取 review JSON；本地配额耗尽时段平台派发仍能跑。
