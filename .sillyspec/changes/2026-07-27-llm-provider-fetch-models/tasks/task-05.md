---
id: task-05
title: "sillyhub-daemon/src/credential-injector.ts：`ProviderConfig` 类型（`types.ts`）加 `settings_config?: { env?: Record<string,string>; attribution?: ...; enabledPlugins?: ...; model?: string; skipDangerousModePermissionPrompt?: boolean }`；`toEnv(c)` 在现有 `Object.assign(env, c.extra_env ?? {})`（credential-injector.ts:98）**之后**追加 `Object.assign(env, c.settings_config?.env ?? {})`（settings_config.env 覆盖优先级最高）。api_key 永不从 settings_config 取。（覆盖：FR-10 中段, D-007）"
title_zh: daemon toEnv 合并 settings_config.env（覆盖优先级最高）
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P0
depends_on: []
blocks: [task-06, task-07, task-13]
requirement_ids: [FR-10]
decision_ids: [D-007]
allowed_paths:
  - sillyhub-daemon/src/credential-injector.ts
  - sillyhub-daemon/src/types.ts
provides:
  - contract: ProviderConfig (TS)
    fields: [settings_config]
expects_from:
  task-04:
    - contract: provider_config (lease payload)
      needs: [settings_config]
goal: |
  daemon toEnv 合并 settings_config.env，覆盖优先级最高（盖过 extra_env），让 env 类高级开关
  （Teammates / Tool Search / 最大强度思考 / 禁用自动升级）真正下发生效（D-007）。
implementation:
  - types.ts ProviderConfig（line 199-224）末尾加可选字段 `settings_config?: { env?: Record<string,string>; attribution?: { commit?: string; pr?: string }; enabledPlugins?: Record<string, unknown>; model?: string; skipDangerousModePermissionPrompt?: boolean }`
  - credential-injector.ts toEnv 在 line 98 `Object.assign(env, c.extra_env ?? {})` 之后追加 `Object.assign(env, c.settings_config?.env ?? {})`（settings_config.env 最后合并，覆盖最高，D-007）
  - api_key 永不从 settings_config 取（只走 `c.api_key` + `c.auth_field`，line 78-81 不动）
  - attribution / enabledPlugins / model / skipDangerousModePermissionPrompt 等顶层键不在 toEnv 处理（归 task-06 settings.json 生成处）
acceptance:
  - settings_config.env 存在时其键覆盖 extra_env 同名键（合并顺序：extra_env 先、settings_config.env 最后）
  - settings_config 缺失或其 env 缺失时 toEnv 返回值与现状逐字一致（零回归，brownfield task-04 透传 None 安全）
  - ProviderConfig 类型已加 settings_config 可选字段（含 env/attribution/enabledPlugins/model/skipDangerousModePermissionPrompt 子键）
  - api_key 仍只从 c.api_key + c.auth_field 注入；settings_config.api_key 即使存在也不读
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test
constraints:
  - toEnv 保持纯函数（无 fs / 网络 / 全局态），相同输入相同输出（单测前提）
  - 合并顺序铁律（D-007）：extra_env 先、settings_config.env 最后（覆盖优先级最高）
  - api_key 只走 provider_config.api_key + auth_field，永不从 settings_config 取（安全）
  - 不在此处理 attribution/enabledPlugins/model/skipDangerousModePermissionPrompt 顶层键（归 task-06）
  - brownfield 兼容：settings_config 为 undefined/None 时 `c.settings_config?.env ?? {}` 安全跳过
---
