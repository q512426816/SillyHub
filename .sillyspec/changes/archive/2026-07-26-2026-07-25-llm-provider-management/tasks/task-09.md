---
id: task-09
title: spawn-env layer-0 + redactEnv + daemon.ts gate
title_zh: spawn-env 加第 0 层 provider 注入（最高优先级）+ redactEnv 扩展 + daemon.ts interactive 门控独立化
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-08]
blocks: [task-10, task-13]
requirement_ids: [FR-04]
decision_ids: [D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/spawn-env.ts
  - sillyhub-daemon/src/daemon.ts
provides:
  - contract: buildSpawnEnv_layer0
    fields: [provider_config, agent_kind, toEnv, env]
  - contract: redactEnv
    fields: [SENSITIVE_KEY]
expects_from:
  task-08:
    - contract: CredentialInjector
      needs: [agentKind, toEnv]
    - contract: ProviderConfig
      needs: [agent_kind, base_url, api_key, auth_field, model, model_role_mappings, default_fallback_model, extra_env]
goal: >
  把 task-08 的 injector 接到 buildSpawnEnv 最顶层（第 0 层）：provider_config 存在
  时由 injector.toEnv 产出的 env 盖过现有三层（tool_config.env / credentials.json /
  process.env），让平台下发值生效；provider_config absent 时第 0 层跳过，三层合并
  行为零变化（D-007 零回归）。同步把 daemon.ts:2816 interactive 注入门控独立化
  （不依赖 credentialManager 存在），并确认 redactEnv 覆盖 provider_config 链路。
implementation:
  - spawn-env.ts buildSpawnEnv 签名扩展：SpawnEnvCtx 加 provider_config?: ProviderConfig（与 toolConfig 同级），opts 不变（保持 credential）
  - buildSpawnEnv 体内在层 3（process.env）之前先算第 0 层：provider_config 非空 + getInjector(agent_kind) 命中 → Object.assign(env, injector.toEnv(provider_config))（最先赋值，后续三层同名 key 自然被它盖过——因 buildSpawnEnv 现有写法是先低层后高层覆盖，第 0 层须最后写或显式最高优先）
  - provider_config absent / agent_kind 未注册 → 第 0 层整体跳过，env 与现状三层完全一致
  - redactEnv 扩展：确认注入后的 env key（ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）已被现有 SENSITIVE_KEY（/KEY\b|TOKEN\b|.../i, spawn-env.ts:81）覆盖；若 daemon 任何日志/调试可能直接打 provider_config 对象，新增 redactProviderConfig() helper 对 api_key 字段脱敏（不依赖 env key 名）
  - daemon.ts:2816 interactive 门控独立化：把 buildSpawnEnv 调用从 `if (this._credentialManager)` 块内提出或并列——provider_config 注入路径不依赖 credentialManager 存在（X-02）；credentialManager 仍用于第 2 层 token 读取（absent 时该层跳过，已兼容）
acceptance:
  - provider_config 存在 + agent_kind='claude'：buildSpawnEnv 返回 env 含 injector 产出的全部 key，且同名 key 盖过 tool_config.env / credentials.json / process.env（第 0 层最高优先级）
  - provider_config absent：buildSpawnEnv 返回与现状三层合并完全一致（零回归 D-007，task-10 单测断言）
  - redactEnv(buildSpawnEnv(...)) 对含 api_key 的 env（ANTHROPIC_AUTH_TOKEN/API_KEY）输出 ***REDACTED***（R-02 不泄漏铁律）
  - daemon.ts interactive 路径（:2817 buildSpawnEnv + :2944 env:interactiveEnv 透传）在未注入 credentialManager 但 lease 带 provider_config 时仍注入第 0 层（X-02 独立化）
  - pnpm typecheck + pnpm test -- spawn-env 全绿
verify:
  - cd sillyhub-daemon && pnpm typecheck && pnpm test -- spawn-env
constraints:
  - 第 0 层优先级最高（D-004）：provider_config → getInjector(agent_kind).toEnv → env，盖过 tool_config.env（层 1）/ credentials.json token（层 2）/ process.env（层 3）。实现方式：在现有三层写完后再 Object.assign(env, layer0Env)，或重构为先算第 0 层再让后续层只填未被第 0 层覆盖的 key——选其一，但必须保证第 0 层最终生效
  - provider_config absent（undefined / null）或 getInjector 返回 undefined（agent_kind 未注册）→ 第 0 层跳过，绝不抛异常，env 与原三层合并逐字一致（D-007 brownfield 零回归，task-10 专项断言）
  - buildSpawnEnv 签名扩展保持向后兼容：SpawnEnvCtx 加可选 provider_config 字段，现有 task-runner.ts:549（batch）和 daemon.ts:2817（interactive）调用点零改动即可继续工作（不传 provider_config → 第 0 层跳过）；agent_kind 取 provider_config.agent_kind（不读 ctx.provider，避免与 lease provider 字段混淆）
  - daemon.ts:2816 门控独立化（X-02）：现状 `if (this._credentialManager) { interactiveEnv = buildSpawnEnv(...) }` 把整个 buildSpawnEnv 包在 credentialManager 存在性判断内；改造为——provider_config 注入不依赖 credentialManager（平台下发值独立生效），credentialManager 仅服务于第 2 层 token 读取。两种实现二选一：(a) 把 buildSpawnEnv 调用提出门控外，credentialManager 缺失时传一个 no-op / undefined 的 SpawnCredentialManager（层 2 自然跳过）；(b) 确认生产 daemon 必注入 credentialManager（main.ts 范式）并注释锁死此假设。选 (a) 更稳，避免生产假设漂移
  - redactEnv 扩展（R-02 不泄漏）：主路径——injector 产出的认证 env key（ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）已被 SENSITIVE_KEY 正则覆盖（spawn-env.ts:81 `/KEY\b|TOKEN\b|.../i`），redactEnv(buildSpawnEnv(...)) 自动脱敏，无需改正则；若 daemon 任何日志路径（如 debug dump lease payload / interactiveEnv 调试输出）会直接打 provider_config 对象本身（含 api_key 明文字段），新增 `redactProviderConfig(config)` helper 递归把 api_key 字段值替换 ***REDACTED***——优先 grep 确认是否有此类直接打对象路径，无则 helper 留作防御性工具
  - 不改 task-runner.ts（batch 路径 buildSpawnEnv(ctx, { credential }) 签名不变，自动继承第 0 层能力，zero diff）
  - 不改 claude-sdk-driver.ts（env 经 SessionManager.create opts.env 透传到 driver，driver:317 `env: opts.env ?? { ...process.env }` 已支持，zero diff）
  - interactiveEnv 透传链路（daemon.ts:2944 `env: interactiveEnv`）不动，buildSpawnEnv 产出经此传到 SessionManager.create → driver
---

# task-09 — spawn-env 第 0 层 + redactEnv + daemon.ts 门控独立化

> 依据：design.md §5 架构（spawn-env 第0层注入最高优先级）、§7 buildSpawnEnv 改造、§9 兼容策略（未配兜底）、§10 X-02（interactive 门控）；plan.md Wave3 task-09。
> 决策：D-007@v1（未配则本机 env 兜底，零回归）。

## 接口契约（消费 task-08）

**expects_from task-08**：
- `CredentialInjector`（needs: agentKind, toEnv）——调 `getInjector(provider_config.agent_kind).toEnv(provider_config)` 拿第 0 层 env。
- `ProviderConfig`（needs: 8 字段）——types.ts 已统一导出，spawn-env.ts 的 SpawnEnvCtx 引用。

## 实现要点

### spawn-env.ts（buildSpawnEnv 加第 0 层）

现状（spawn-env.ts:91-123）：三层合并 process.env（层 3）< credentials.json token（层 2）< tool_config.env（层 1）。改造：

- `SpawnEnvCtx`（:39-41）加 `provider_config?: ProviderConfig`（import 自 types.ts，与 toolConfig 同级）。
- buildSpawnEnv 体内在三层合并后追加第 0 层：`if (ctx.provider_config) { const inj = getInjector(ctx.provider_config.agent_kind); if (inj) Object.assign(env, inj.toEnv(ctx.provider_config)); }`——放最后保证最高优先级（盖过层 1 tool_config.env 同名 key）。
- provider_config absent / getInjector 返回 undefined → 跳过，env 与现状逐字一致。

### redactEnv 扩展（R-02 不泄漏）

- 主路径已覆盖：injector 产出的认证 env key（ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）匹配 SENSITIVE_KEY 正则（:81），redactEnv(spawnEnv) 自动 ***REDACTED***。
- 防御性：grep daemon 日志路径（interactiveEnv 调试 / lease payload dump）是否直接打 provider_config 对象；有则新增 `redactProviderConfig(config)` helper 对 api_key 字段脱敏。

### daemon.ts（:2816 门控独立化，X-02）

现状（daemon.ts:2812-2821）：
```
let interactiveEnv: NodeJS.ProcessEnv | undefined;
if (this._credentialManager) {
  interactiveEnv = buildSpawnEnv({ toolConfig: execPayload.toolConfig ?? {} }, { credential: this._credentialManager });
}
```
问题：provider_config 注入被 credentialManager 存在性门控——若 daemon 未注入 credentialManager（某些部署形态），即使 lease 带 provider_config 也走不进 buildSpawnEnv，第 0 层失效。

改造（选 (a)）：把 buildSpawnEnv 调用提出门控外，provider_config 透传进去：
```
interactiveEnv = buildSpawnEnv(
  { toolConfig: execPayload.toolConfig ?? {}, provider_config: execPayload.provider_config },
  this._credentialManager ? { credential: this._credentialManager } : { credential: noopCredential },
);
```
credentialManager 缺失时用 noop credential（get→undefined, buildEnv→{}），层 2 自然跳过，第 0 层独立生效。

## 不做

- 不改 task-runner.ts:549（batch 路径，签名兼容自动继承第 0 层）。
- 不改 claude-sdk-driver.ts（env 透传已支持）。
- 不改 interactiveEnv 透传链路（daemon.ts:2944）。
- 不写新单测（task-10 范围）。
