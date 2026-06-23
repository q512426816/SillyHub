---
schema_version: 1
doc_type: module-card
module_id: spawn-env
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# spawn-env

## 定位
agent 子进程 env 构造器（task-09 / B1）。把「工具配置 env」+「claude 凭据 token」+「进程 env」三层合并成单个 `Record<string,string>` 传给 `spawn({ env })`，并对外提供密钥脱敏守卫 `redactEnv`，确保 token 不泄漏到日志/上报通道。是 daemon 唯一确定 agent 子进程可见 env 的模块（design §4.2.3、requirements FR-05、铁律 R-09）。

## 契约摘要
- `buildSpawnEnv(ctx: SpawnEnvCtx, opts?: BuildSpawnEnvOpts): Record<string, string>`：三层合并（优先级从高到低）：
  1. `tool_config.env`（经 `SpawnCredentialManager.buildEnv` 渲染占位符后的工具自定义 env）。
  2. claude token：credentials.json 的 `ANTHROPIC_API_KEY` / `CLAUDE_OAUTH_TOKEN`（缺失则 `process.env` 兜底）。
  3. `process.env` 副本（基础环境）。
- `redactEnv(env: NodeJS.ProcessEnv): Record<string, string|undefined>`：命中 `SENSITIVE_KEY` 正则的 key 值替换为 `***REDACTED***`。
- 常量：`ANTHROPIC_API_KEY_FIELD`、`CLAUDE_OAUTH_TOKEN_FIELD`。
- 接口：`SpawnCredentialManager`（鸭子类型，与 credential 模块兼容，避免类型耦合）、`SpawnEnvCtx`、`BuildSpawnEnvOpts`。

## 关键逻辑
```
buildSpawnEnv({ toolConfig, ... }, opts):
  base = { ...process.env }                                    // 第 3 层
  if toolConfig.env: Object.assign(base, cred.buildEnv(toolConfig))  // 第 1 层覆盖
  claudeToken = creds.get(ANTHROPIC_API_KEY) || creds.get(CLAUDE_OAUTH_TOKEN)
                || process.env[...]                            // 第 2 层兜底
  if claudeToken: base[ANTHROPIC_API_KEY_FIELD] = token
  return base                                                  // 仅内存，禁止序列化

redactEnv(env): for [k,v] of env: SENSITIVE_KEY.test(k) → '***REDACTED***'
```

## 注意事项
- **泄漏面控制（R-09）**：`buildSpawnEnv` 返回值仅本地内存，直接传 `spawn({ env })`；禁止序列化进 submitMessages、complete_lease payload、日志、磁盘。token 不经任何上报通道回传。
- `redactEnv` 是 env 相关日志的强制前置守卫：任何 env dump 必须先经此才能写日志。
- 三层优先级链：工具显式配置 > claude 凭据 > 继承进程环境，避免凭据被意外覆盖或泄漏。
- 用本地 `SpawnCredentialManager` 接口而非直接 import CredentialManager 类，便于 task-runner 注入 RunnerCredentialManager（鸭子类型，G-04）。
- 被 task-runner 使用（_spawnAndStream 前）；依赖 credential。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
