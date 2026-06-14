---
schema_version: 1
doc_type: module-card
module_id: spawn-env
author: qinyi
created_at: 2026-06-14T20:57:20
---

# spawn-env

## 定位

claude 子进程环境变量构造器（task-09 / B1 引入）。把「工具配置 env」+「claude 凭据 token」+「进程 env」三层合并成单个 `Record<string,string>` 传给 `spawn({ env })`，并对外提供密钥脱敏守卫 `redactEnv`，确保 token 不泄漏到日志 / Redis publish payload / 前端。是 daemon 唯一确定 claude 子进程可见 env 的模块。

## 契约摘要

- `buildSpawnEnv(ctx: SpawnEnvCtx, opts?: BuildSpawnEnvOpts): Record<string, string>` — 构造子进程 env（三层合并，优先级从高到低）：
  1. `tool_config.env`（经 `SpawnCredentialManager.buildEnv` 渲染占位符后的工具自定义 env）
  2. claude token：`credentials.json` 的 `ANTHROPIC_API_KEY` / `CLAUDE_OAUTH_TOKEN`（缺失则 `process.env` 兜底）
  3. `process.env` 副本（基础环境）
- `redactEnv(env: Record<string, string>): Record<string, string>` — 密钥守卫：匹配疑似密钥的 key（大小写不敏感，**精确匹配** `ANTHROPIC_API_KEY` 不误伤如 `MONKEY_NAME`），值替换为 `***REDACTED***`
- 常量：`ANTHROPIC_API_KEY_FIELD = 'ANTHROPIC_API_KEY'`、`CLAUDE_OAUTH_TOKEN_FIELD = 'CLAUDE_OAUTH_TOKEN'`
- 接口：`SpawnCredentialManager`（鸭子类型，与 credential 模块的 CredentialManager 结构兼容）、`SpawnEnvCtx`、`BuildSpawnEnvOpts`

## 关键逻辑

```
buildSpawnEnv({ toolConfig, credentials }, opts)
  → base = { ...process.env }                         // 第 3 层：进程 env 副本
  → if toolConfig.env: Object.assign(base, cred.buildEnv(toolConfig))  // 第 1 层覆盖
  → claudeToken = credentials.ANTHROPIC_API_KEY || CLAUDE_OAUTH_TOKEN
  → if claudeToken: base[ANTHROPIC_API_KEY_FIELD] = token              // 第 2 层注入
  → return base                                        // 仅内存对象，禁止序列化

redactEnv(env)
  → for key in env: key 命中密钥模式 → env[key] = '***REDACTED***'
  → return env                                          // env 相关日志必先经此守卫
```

## 注意事项

- **泄漏面控制**：`buildSpawnEnv` 返回值**仅本地内存**，直接传 `spawn({ env })`；**禁止**序列化进 `submitMessages`、`complete_lease` payload、日志。token 不经任何上报通道回传。
- `redactEnv` 是 env 相关日志的**强制前置守卫**：任何 env dump 必须先经 `redactEnv` 才能写日志。
- 三层优先级链保证：工具显式配置 > claude 凭据 > 继承进程环境，避免凭据被工具配置意外覆盖或泄漏到子进程。
- 被模块：`task-runner`（`executeTask` step 5 spawn 前调用，替代原 `credentialManager.buildEnv` 直拼）。
- 依赖模块：`credential`（提供 token 与 `buildEnv` 渲染）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
