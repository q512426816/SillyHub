---
schema_version: 1
doc_type: module-card
module_id: spawn-env
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 子进程 env 构造器（spawn-env）

## 定位
agent 子进程 env 构造器（`src/spawn-env.ts`，task-09 / B1）。四层合并（优先级
高→低）：第 0 层平台下发 provider_config（injector.toEnv 产 ANTHROPIC_* env）→
第 1 层 tool_config.env → 第 2 层 claude token（credentials.json）→ 第 3 层
process.env 副本。附 redactEnv / redactProviderConfig 脱敏守卫。是 daemon 唯一
确定 agent 子进程可见 env 的模块，承载 R-09 / R-02 不泄漏铁律。

## 契约摘要
- `buildSpawnEnv(ctx: SpawnEnvCtx, opts: BuildSpawnEnvOpts): NodeJS.ProcessEnv`——
  ctx `{ toolConfig?, provider_config? }`；opts `{ credential: SpawnCredentialManager,
  daemonApiKey? }`。
- `SpawnCredentialManager` 本地接口（get / buildEnv 两方法，鸭子类型对齐
  CredentialManager，避免 task-runner 注入 RunnerCredentialManager 的类型耦合 G-04）。
- 常量：`ANTHROPIC_API_KEY_FIELD` / `CLAUDE_OAUTH_TOKEN_FIELD`（两模式并存都注入，
  优先级由 claude CLI 自身决定；token 绝不写空串）。
- `redactEnv(env)`：key 命中 `SENSITIVE_KEY` 正则（词边界 `KEY\b|TOKEN\b|SECRET\b|
  PASSWORD\b|PAT\b|CREDENTIAL\b`，大小写不敏感）→ value 替换 `***REDACTED***`，
  返回新对象不改入参。
- `redactProviderConfig(config)`：遮蔽 api_key 字段（防御直接打 provider_config
  对象的场景——那条路径不经 env key，redactEnv 抓不到）。
- 依赖 config（CLAUDE_CONFIG_DIR）、credential-injector（getInjector /
  setDaemonApiKey）、types；被 daemon / task-runner / interactive 使用。

## 关键逻辑
```
buildSpawnEnv:
  env = { ...process.env }                                  # 层 3
  token: credential.get(field) || process.env[field]        # 层 2，credentials 优先
  toolEnv = credential.buildEnv(toolConfig) 覆盖赋值         # 层 1（系统键覆盖仅 warn）
  provider_config 存在且 injector 注册 → Object.assign(env,
    injector.toEnv(provider_config))                        # 层 0 最后赋值最高优先
  provider_config 有 → env.CLAUDE_CONFIG_DIR 隔离；无 → delete 残留值
redactEnv: for [k,v]: SENSITIVE_KEY.test(k) → '***REDACTED***'
```

## 注意事项
- **不泄漏铁律（R-09 / R-02）**：buildSpawnEnv 返回值仅本地内存传 `spawn({ env })`，
  禁止序列化到日志 / Redis publish / HTTP 回传 / 磁盘 / lease.metadata；任何 env
  相关日志必须先经 redactEnv，禁止直接 console.log(buildSpawnEnv(...))；token
  不入 submitMessages、不入 complete_lease payload。
- 词边界设计：`PAT\b` 不误伤 PATH、`KEY\b` 匹配 ANTHROPIC_API_KEY 不误伤
  MONKEY_NAME；PATH/HOME/SHELL 等系统键保留原值供日志可读。
- 第 0 层零回归保证（D-007）：provider_config absent / null / agent_kind 未注册
  injector（getInjector 返 undefined）→ 整层跳过不抛异常，env 与原三层逐字一致。
- daemonApiKey 显式传值时同步 injector 进程级状态（litellm_proxy 形态由此产
  ANTHROPIC_AUTH_TOKEN）；空串不注入。
- CLAUDE_CONFIG_DIR 双向语义（ql-20260726-002 / ql-20260729-002）：有平台注入才
  隔离（防宿主机 ~/.claude/cc-switch 污染）；未配供应商时清残留值回退默认
  ~/.claude（防「隔离空目录 → Not logged in」）。
- tool_config.env 覆盖系统键（PATH/HOME/USER/SHELL/LANG/LC_ALL/PWD 集合）仅
  warning key 名（不含 value）不阻断（dispatch 侧应避免下发）。
- credential.buildEnv 渲染 `{{USER_*}}` 占位符 + key 大写 + 过滤未解析项；
  API key 与 OAuth token 两键并存时都注入不做选择（实测 claude CLI API key 优先）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
