---
schema_version: 1
doc_type: module-card
module_id: credential-injector
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 凭证注入器（credential-injector）

## 定位

provider-neutral 凭证注入器：把后端 lease 下发的 ProviderConfig（中性 snake_case
结构）翻译成各 agent 认得的 env 字典。spawn-env 的第 0 层注入（最高优先级）。
第一版仅实现 claude（ClaudeCredentialInjector），接口最小化预留 codex / gemini / pi
扩展（D-006 抽象边界）。管的是「平台下发的 provider 凭证」；用户自有密钥归
credential 模块。

## 契约摘要

- `CredentialInjector` 接口：`agentKind: string` + `toEnv(config: ProviderConfig):
  Record<string, string>`——纯函数，无 fs/网络/全局态，相同输入相同输出。
- `ClaudeCredentialInjector`：agentKind='claude'，产出 ANTHROPIC_* env。
  `ROLE_ENV` 静态表：sonnet/opus/fable/haiku 四角色 →
  ANTHROPIC_DEFAULT_{ROLE}_MODEL（Fable 5 经官方文档实证收录）。
- `getInjector(agentKind)`：注册表查表；未知/空 agentKind 返回 undefined 不抛
  （spawn-env 第 0 层据此跳过，零回归）。
- `setDaemonApiKey(apiKey)`：cli 启动时（凭证校验后）注入 daemon 自身 apiKey 一次；
  null/空串按未注入。`_resetDaemonApiKeyForTest` 仅供测试。

## 关键逻辑

```
toEnv(c):
  if c.api_format === 'openai_chat':        # openai 形态经 LiteLLM 网关，早返回
    BASE_URL = litellm_base_url
    litellm_proxy ? AUTH_TOKEN = _daemonApiKey            # proxy 形态：daemon 自身 key
                  : AUTH_TOKEN = litellm_auth_token       # 老直连形态向后兼容
    MODEL + 四档位 DEFAULT_*_MODEL 全 = litellm_model_name # gap-D：副通道请求同路由
  else:                                      # 缺省 / anthropic，7 条映射规则
    base_url→BASE_URL; api_key→env[auth_field??AUTH_TOKEN]; model→ANTHROPIC_MODEL;
    角色映射→DEFAULT_{ROLE}_MODEL（one_m 追加 [1m]）; extra_env; settings_config.env 最后覆盖
```

## 注意事项

- **master key 不下发原则（security-audit-remediation D-003@v1）**：litellm_proxy 形态
  下 backend 不下发 LiteLLM master key 明文（litellm_auth_token 已删），改下发
  litellm_proxy 标记 + hub 代理地址（litellm_base_url = `<hub>/api/daemon/llm-proxy`）。
  注入器只注 daemon 自身 apiKey 成 ANTHROPIC_AUTH_TOKEN，子进程 Bearer 打 hub 代理，
  backend 校验 usr-uid-pid 归属后注入 master key 转发 LiteLLM——master key 不出
  backend 进程。
- apiKey 未注入时**不写 AUTH_TOKEN 键**（写空值会发空 Bearer 恒 401；不写则子进程
  回退本机凭证，行为可诊断）。
- openai_chat 形态不注入上游 api_key（上游 key 只在 backend 注册 LiteLLM 时使用，
  provider_config 本就不含）；不走 extra_env / settings_config（单模型）。
- 四档位全指向 litellm_model_name 是 live 会话实测结论（gap-D）：Claude Code 会发
  标题生成/摘要等副通道请求，档位缺省名在 LiteLLM 无 deployment → 失败。
- R-02 不泄漏铁律：toEnv 产物仅进 spawn env，绝不入日志/序列化/磁盘。
- api_key 永不从 settings_config 取（安全）；settings.json 顶层键归 claude-settings。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
