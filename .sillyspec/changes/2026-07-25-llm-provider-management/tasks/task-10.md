---
id: task-10
title: daemon unit tests (credential-injector + spawn-env)
title_zh: daemon 单测（injector 角色映射 + 第 0 层优先级 + 脱敏 + 未配兜底零回归）
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-09]
blocks: [task-13]
requirement_ids: [FR-04, FR-07]
decision_ids: [D-004@v1, D-007@v1]
allowed_paths:
  - sillyhub-daemon/tests/credential-injector.test.ts
  - sillyhub-daemon/tests/spawn-env.test.ts
provides: []
expects_from:
  task-08:
    - contract: CredentialInjector
      needs: [agentKind, toEnv]
    - contract: ClaudeCredentialInjector
      needs: [ROLE_ENV]
  task-09:
    - contract: buildSpawnEnv_layer0
      needs: [provider_config, agent_kind, toEnv, env]
    - contract: redactEnv
      needs: [SENSITIVE_KEY]
goal: >
  用单测锁死 injector 映射正确性 + 第 0 层优先级 + redactEnv 脱敏 + 未配 provider
  零回归四条不变量；不真起 claude 进程，纯断言 toEnv / buildSpawnEnv / redactEnv
  的输入输出契约（FR-04 注入正确 + FR-07 不泄漏）。
implementation:
  - 新建 tests/credential-injector.test.ts：覆盖 ClaudeCredentialInjector.toEnv 全部分支 + getInjector 注册表
  - 扩展 tests/spawn-env.test.ts：在现有三层合并测试基础上加第 0 层用例（优先级 / 兜底 / 脱敏）
  - 全部用现有测试范式（jest/vitest 看 sillyhub-daemon 既有 spawn-env.test.ts 风格），不引入新测试框架
acceptance:
  - injector 单测全绿：4 角色映射→对应 ANTHROPIC_DEFAULT_*_MODEL / auth_field 选择写对 key（不写两个）/ extra_env 注入 / one_m 追加 [1m] / base_url + default_fallback_model 各自落对应 env
  - spawn-env 第 0 层单测全绿：provider_config 存在时第 0 层盖过 tool_config.env 同名 key + credentials.json token + process.env；provider_config absent 时 env 与原三层合并逐字一致（零回归）
  - redactEnv 单测全绿：含 api_key 的 env（ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）→ ***REDACTED***；ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 等非敏感 key 保留原值
  - pnpm test 全绿（含既有测试零回归）
verify:
  - cd sillyhub-daemon && pnpm test
constraints:
  - 不真实 spawn claude（不起子进程，不联网）；只测纯函数 toEnv / buildSpawnEnv / redactEnv 的输入输出（注入器是纯函数，task-08 constraints 已保证无 fs/网络/全局态）
  - injector 单测（credential-injector.test.ts）覆盖：
      1) base_url 非空 → ANTHROPIC_BASE_URL；空 → 不写该 key
      2) api_key + auth_field='ANTHROPIC_AUTH_TOKEN' → env.ANTHROPIC_AUTH_TOKEN 有值且 ANTHROPIC_API_KEY 不存在（反之 auth_field='ANTHROPIC_API_KEY'）；auth_field 缺省 → 落 ANTHROPIC_AUTH_TOKEN（D-010 不再两个都写）
      3) default_fallback_model 优先于 model 落 ANTHROPIC_MODEL；两者皆空 → 不写 ANTHROPIC_MODEL
      4) model_role_mappings 4 角色（sonnet/opus/fable/haiku）→ 对应 ANTHROPIC_DEFAULT_{ROLE}_MODEL；model 空的角色不注入；未知角色（如 subagent）忽略不抛
      5) one_m=true → 模型名带 '[1m]' 后缀；one_m=false / undefined → 原值
      6) extra_env 注入（Object.assign）；与角色映射同名时 extra_env 在后覆盖（按 design §7 Object.assign 顺序）
      7) getInjector('claude') 返回实例；未知 agentKind 返回 undefined（不抛）
  - spawn-env 第 0 层单测（spawn-env.test.ts 扩展）覆盖：
      1) provider_config 存在 + agent_kind='claude'：env 含 injector 全部产出 + 同名 key 盖过 tool_config.env（层 1）/ credentials.json token（层 2）/ process.env（层 3）——至少 1 个断言第 0 层值覆盖三层同名 key
      2) provider_config absent（undefined / null）：env 与不传 provider_config 时逐字一致（零回归，D-007 专项）——建议先跑一次记录三层合并 snapshot，再断言 absent 时匹配
      3) provider_config 存在但 agent_kind 未注册（如 'codex'）：第 0 层跳过，env 与 absent 一致（getInjector 返回 undefined 不抛）
      4) tool_config.env + provider_config 共存：tool_config.env 仍渲染（占位符 / 大写），provider_config 第 0 层盖同名 key
  - redactEnv 单测覆盖：spawnEnv 含 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY → redactEnv 输出对应 ***REDACTED***（验证 SENSITIVE_KEY 正则覆盖注入后的认证 key，R-02）；ANTHROPIC_BASE_URL / ANTHROPIC_MODEL / CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC 等非敏感 key 保留
  - 不改源码（只新增 / 扩展测试文件）；若测试暴露 task-08/09 实现 bug，回退到对应 task 修，不在本 task 改实现（除非是实现 bug 且本 task 是发现方——按 sillyspec 流程标记并回退）
  - 测试范式对齐既有 spawn-env.test.ts（mock SpawnCredentialManager 的 get/buildEnv，断言 env 字段），不引入新 mock 工具
---

# task-10 — daemon 单测（credential-injector + spawn-env）

> 依据：design.md §7 注入器映射规则、§9 兼容策略（未配兜底零回归）、§10 R-02（不泄漏）；plan.md Wave3 task-10 + 全局验收标准「daemon 单测通过」「brownfield 零回归」。
> 决策：D-004@v1（env 注入正确性）、D-007@v1（未配兜底零回归专项断言）。

## 接口契约（消费 task-08 + task-09）

**expects_from task-08**：`CredentialInjector`（agentKind/toEnv）+ `ClaudeCredentialInjector`（ROLE_ENV 4 角色常量，断言内部映射时可读）。
**expects_from task-09**：`buildSpawnEnv_layer0`（provider_config 透传 + 第 0 层注入）+ `redactEnv`（SENSITIVE_KEY 覆盖认证 env key）。

## 测试矩阵

### credential-injector.test.ts（新建）

| 用例 | 输入要点 | 断言 |
|---|---|---|
| base_url | base_url 非空 / 空 | 非空→env.ANTHROPIC_BASE_URL；空→key 不存在 |
| auth_field 选择 | api_key + auth_field=AUTH_TOKEN / API_KEY / 缺省 | 落对应 key，**另一个 key 不存在**（D-010 不再双写） |
| default_fallback | default_fallback_model vs model | fallback 优先落 ANTHROPIC_MODEL；皆空→不写 |
| 4 角色映射 | model_role_mappings 全角色 | sonnet/opus/fable/haiku→对应 ANTHROPIC_DEFAULT_{ROLE}_MODEL；model 空→不注入；未知角色→忽略 |
| one_m 后缀 | one_m=true / false | true→`${model}[1m]`；false→原值 |
| extra_env | extra_env={K:V} | env.K=V；与角色 env 同名时 extra_env 覆盖 |
| getInjector | 'claude' / 未知 | claude→实例；未知→undefined（不抛） |

### spawn-env.test.ts（扩展）

| 用例 | 输入要点 | 断言 |
|---|---|---|
| 第 0 层优先级 | provider_config + tool_config.env + credentials token + process.env 同名 key | 第 0 层值盖过三层（D-004） |
| 未配兜底（D-007） | provider_config absent | env 与不传时逐字一致（零回归专项） |
| agent_kind 未注册 | provider_config.agent_kind='codex' | 第 0 层跳过，env 与 absent 一致（不抛） |
| tool_config 共存 | tool_config.env + provider_config | tool_config 仍渲染，provider_config 盖同名 |
| redactEnv 脱敏 | spawnEnv 含 ANTHROPIC_AUTH_TOKEN / API_KEY | redactEnv→***REDACTED***；BASE_URL/MODEL 保留（R-02） |

## 不做

- 不真实 spawn claude（不起子进程 / 不联网 / 不读 credentials.json 真文件——mock SpawnCredentialManager）。
- 不改源码（只动 tests/ 下两文件）；发现 bug 回退 task-08/09 修。
- 不引入新测试框架（对齐既有 spawn-env.test.ts 范式）。
