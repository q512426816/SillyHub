---
id: task-11
title: daemon ProviderConfig type + injector openai branch
title_zh: daemon ProviderConfig 类型 + injector openai 分支
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-10]
blocks: [task-12]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/sillyhub-daemon/src/types.ts
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/sillyhub-daemon/src/credential-injector.ts
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/sillyhub-daemon/tests/credential-injector.test.ts
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/sillyhub-daemon/tests/credential-injector.test.ts
goal: >
  types.ts ProviderConfig（L216）加 api_format + litellm_base_url/litellm_model_name/litellm_auth_token 三字段；credential-injector.ts ClaudeCredentialInjector.toEnv（L72）加 openai 分支（ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL 指向 LiteLLM，不注入上游 key）；补 openai 分支单测。
implementation:
  - types.ts ProviderConfig（:216）加四字段（均 optional，零回归）：api_format?: 'anthropic' | 'openai_chat'、litellm_base_url?: string、litellm_model_name?: string、litellm_auth_token?: string。JSDoc 注明 openai 形态仅此 + agent_kind + model 共 6 字段，不含上游 api_key（D-003）。
  - credential-injector.ts ClaudeCredentialInjector.toEnv（:72）方法体最前加 openai 早返回分支：
    ```
    if (c.api_format === 'openai_chat') {
      if (c.litellm_base_url) env.ANTHROPIC_BASE_URL = c.litellm_base_url;
      if (c.litellm_auth_token) env.ANTHROPIC_AUTH_TOKEN = c.litellm_auth_token;
      if (c.litellm_model_name) env.ANTHROPIC_MODEL = c.litellm_model_name;
      return env;   // 不注入上游 key，不走角色映射，不走 extra_env/settings_config
    }
    ```
    后续 anthropic 6 条映射规则逐字保留。ClaudeCredentialInjector 仍只注册 'claude'（openai 挂在 agent_kind=claude 下经 LiteLLM，N2/D-006，不新增 injector 类）。
  - credential-injector.test.ts 补 openai 分支用例（新 describe block）：openai → env 恰 {ANTHROPIC_BASE_URL=litellm_base_url, ANTHROPIC_AUTH_TOKEN=litellm_auth_token, ANTHROPIC_MODEL=litellm_model_name}；openai 即便 c.api_key / c.base_url / c.model_role_mappings 存在也不注入上游字段（断言 ANTHROPIC_API_KEY undefined、无 ANTHROPIC_DEFAULT_*_MODEL）；openai litellm_* 缺省 → 不写该 key（不抛）；api_format='anthropic' 与 api_format 缺省 → 与现状逐字一致（零回归，复用现有端到端用例）。
  - 不动 REGISTRY（:119）/ getInjector（:130）—— openai 不引入新 agentKind（D-006/N2）。
acceptance:
  - ProviderConfig 类型含 api_format + litellm_base_url/litellm_model_name/litellm_auth_token（4 字段 optional）
  - openai 分支：env = {ANTHROPIC_BASE_URL=litellm_base_url, ANTHROPIC_AUTH_TOKEN=litellm_auth_token, ANTHROPIC_MODEL=litellm_model_name}，不注入上游 api_key，不走角色映射 / extra_env / settings_config
  - anthropic 分支（api_format='anthropic' / 缺省）逐字不变，现有 credential-injector.test.ts 全部用例绿（零回归 NFR-02）
verify:
  - cd sillyhub-daemon && pnpm test（credential-injector.test.ts 全绿，含 openai 新用例 + anthropic 现有用例）
  - 类型检查：cd sillyhub-daemon && pnpm exec tsc --noEmit（ProviderConfig 新字段类型正确）
constraints:
  - openai 分支不注入上游 api_key（NFR-01/D-003；即便 c.api_key 字段存在也忽略，因 openai 形态 provider_config 本就不含上游 key）
  - anthropic 分支逐字不变（NFR-02 零回归；openai 分支必须是最前 if 早返回，不影响 anthropic 路径）
  - daemon 不起本地代理子进程（N6；转换交服务器 LiteLLM，daemon 仅改 injector env 映射）
  - 不新增 CredentialInjector 实现类（openai 挂 claude agent_kind，复用 ClaudeCredentialInjector，D-006/N2）
provides:
  - ProviderConfig 类型加 api_format + litellm_base_url/litellm_model_name/litellm_auth_token（4 optional 字段）
  - ClaudeCredentialInjector.toEnv openai 分支（ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL 指向 LiteLLM，不注入上游 key）
expects_from:
  task-10:
    - contract: backend 下发的 provider_config openai 形态 6 字段契约已定，daemon 类型字段名与之逐字对齐
      needs: [provider_config openai 形态 {agent_kind, api_format:"openai_chat", litellm_base_url, litellm_model_name, litellm_auth_token, model}]
---

# task-11 实现笔记

design 锚点：§5.1 数据流（daemon injector openai 分支 → ANTHROPIC_* 指向 LiteLLM）、§7.4 daemon injector（TS 块 openai 分支逐字定义）、§7.5 生命周期契约表「session 端到端（openai）」事件（ANTHROPIC_MODEL=litellm_model_name → LiteLLM 路由）、§3 N2/N6（openai 挂 claude agent_kind / daemon 不起代理子进程）。

上下游衔接：
- 上游 task-10：backend provider_config openai 形态 6 字段是本任务类型字段名 + injector 映射的唯一来源。字段名逐字对齐（snake_case，对齐既有 ProviderConfig 风格 / Python 原名）。
- 下游 task-12：端到端联调时 daemon spawn-env 第 0 层调 getInjector('claude').toEnv(openai_config) 产 ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL → Claude Code 发 Anthropic /v1/messages → LiteLLM 按 litellm_model_name 路由 → 转 OpenAI → 上游。本任务 injector 是这条链的 daemon 侧终点。
- D-006 抽象边界：openai 不新加 injector 类，而是 ClaudeCredentialInjector 内按 api_format 分流——因 openai 仍喂给 Claude Code（只是 base 指向 LiteLLM），agent_kind 仍是 claude。加 codex/gemini 才是新 injector 类。

N6 约束：daemon 不起本地代理子进程（区别于 cc-switch 自带 Rust forwarder）。转换完全交服务器 LiteLLM，daemon 这层只做 env 映射，零额外进程生命周期管理。injector 纯函数性质（task-10 铁律）保留——openai 分支仍是相同输入相同输出，无 fs/网络/全局态。
