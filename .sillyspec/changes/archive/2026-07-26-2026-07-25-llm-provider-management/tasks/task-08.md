---
id: task-08
title: credential-injector.ts + types.ts ProviderConfig
title_zh: 新建 credential-injector（CredentialInjector + ClaudeCredentialInjector + 注册表）+ types.ts 加 ProviderConfig
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-06]
blocks: [task-09, task-10]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-004@v1, D-006@v1, D-010@v1, D-011@v1]
allowed_paths:
  - sillyhub-daemon/src/credential-injector.ts
  - sillyhub-daemon/src/types.ts
provides:
  - contract: CredentialInjector
    fields: [agentKind, toEnv]
  - contract: ClaudeCredentialInjector
    fields: [agentKind, toEnv, ROLE_ENV]
  - contract: ProviderConfig
    fields: [agent_kind, base_url, api_key, auth_field, model, model_role_mappings, default_fallback_model, extra_env]
expects_from:
  task-06:
    - contract: ProviderConfig
      needs: [agent_kind, base_url, api_key, auth_field, model, model_role_mappings, default_fallback_model, extra_env]
goal: >
  抽象 provider-neutral 的凭证注入器接口并实现 claude 专属注入器：把 task-06 下发的
  ProviderConfig 中性结构翻译成 claude code 认得的 ANTHROPIC_* env（base_url / 认证 token
  / 默认模型 / 4 角色映射 / 自定义 env）；types.ts 同步加 provider_config 字段供 task-09
  第 0 层消费。spike-01（Fable env 名 + [1m] 后缀）在此 task 顺手验证。
implementation:
  - 新建 credential-injector.ts 定义 CredentialInjector 接口（readonly agentKind + toEnv 返回 Record<string,string>）
  - 实现 ClaudeCredentialInjector（agentKind=claude），按 design §7 TS 块的 6 条映射规则产 env（base_url / auth_field 选择 / default_fallback / sonnet-opus-fable-haiku 角色映射 / one_m 后缀 / extra_env）
  - 导出 getInjector(agentKind) 注册表，第一版只认 claude，未知 agentKind 返回 undefined（task-09 据此判第 0 层跳过）
  - types.ts 新增 ProviderConfig 接口（8 字段 snake_case，与 task-06 provides 完全一致）；LeaseCtx 与 ExecutionContextPayload 各加 provider_config 可选字段
  - spike-01 顺手做：读 claude code 文档 + 本机起 claude 验 ANTHROPIC_DEFAULT_FABLE_MODEL 识别 + [1m] 后缀触发 1M，结论记实现注释
acceptance:
  - CredentialInjector 接口最小化（仅 agentKind + toEnv），加 CodexCredentialInjector 不动接口
  - ClaudeCredentialInjector 产出 env 满足 design §7 TS 块全部映射规则
  - getInjector(claude) 返回实例；未知 agentKind 返回 undefined 不抛异常
  - types.ts LeaseCtx + ExecutionContextPayload 各加 provider_config，pnpm typecheck 绿
  - spike-01 结论落地为实现注释（不通过则 Fable 降级走 default_fallback，不阻塞架构）
verify:
  - cd sillyhub-daemon && pnpm typecheck && pnpm test -- credential-injector
constraints:
  - CredentialInjector 接口最小化（仅 agentKind + toEnv），不得加 provider 专属字段（D-006 抽象边界，对齐 adapters/index.ts:52 协议抽象风格）
  - ClaudeCredentialInjector 映射规则严格按 design §7 TS 块（base_url / auth_field 选择 / default_fallback / 4 角色映射 / extra_env / one_m 后缀），具体实现见 implementation
  - ROLE_ENV 的 4 个 env 名 HAIKU/SONNET/OPUS 已在 deploy/.env.example 实证；FABLE 按命名规律推断（X-11，spike-01 实测确认）
  - 未知 agentKind getInjector 返回 undefined（task-09 据此判第 0 层跳过零回归），不抛异常打断 spawn
  - toEnv 纯函数（无 fs / 网络 / 全局态），便于单测（task-10）
  - types.ts ProviderConfig 字段必须与 task-06 provides 完全一致（8 字段 snake_case，对齐 ExecutionContextPayload 风格）
  - spike-01 不通过时 Fable 角色降级走 default_fallback_model（ANTHROPIC_MODEL），不阻塞 Wave3，Sonnet/Opus/Haiku 主链路已实证
  - 不改 spawn-env.ts / daemon.ts / task-runner.ts（属 task-09）；不真起 claude 进程（纯 TS 模块 + 单测）
---
