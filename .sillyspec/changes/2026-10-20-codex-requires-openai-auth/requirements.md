---
author: flow-machine-draft
created_at: 2026-10-20T03:44:58.848Z
---
# 需求规格（Requirements）— 2026-10-20-codex-requires-openai-auth

## 功能需求

### FR-01: daemon 对有 api_key 的 anthropic 直连形态 codex 供应商，写出的 config.toml [model_providers.sillyhub] 段含 requires_openai_auth = true；端到端：平台 codex 会话选直连供应商真实对话跑通（不再 stream disconnected）

- daemon 必须在 anthropic 直连形态且 provider.api_key 非空时，于写出的 per-session config.toml `[model_providers.sillyhub]` 表内追加一行 `requires_openai_auth = true`，使 codex CLI 将 auth.json 的 OPENAI_API_KEY 作为 Authorization Bearer 头发出——上游（智谱 bigmodel 等直连端点）对无认证的流式请求会直接掐流（A/B 实验 2026-10-20 实锤：同 key 同端点，带该键成功回复、缺该键稳定 `stream disconnected before completion`）。

#### 场景：有 key 直连供应商

- Given 供应商 api_format=anthropic（或缺省）且 api_key 非空、base_url 指向支持 responses 协议的直连端点
- When daemon 为 codex 会话写 per-session CODEX_HOME/config.toml
- Then config.toml 的 `[model_providers.sillyhub]` 段在 wire_api 行后含 `requires_openai_auth = true`；codex 发出的流式请求带 Authorization Bearer，端到端对话跑通

### FR-02: keyless 供应商（api_key 缺省）行为不变：不写该键，产物与现状逐字一致（spike A3a keyless 语义零回归）

- api_key 缺省（keyless 自定义 provider，spike A3a 合法形态）时禁止写出 `requires_openai_auth` 行，产物必须与现状逐字一致（keyless 语义零回归）；openai_chat 形态（litellm 代理通道）本变更不动，产物同样与现状一致。

#### 场景：keyless 直连供应商

- Given 供应商 api_format=anthropic、api_key 缺省、base_url 非空（per-form 门槛经 base_url 满足）
- When daemon 写 config.toml
- Then 产物与现状逐字一致：不含 `requires_openai_auth` 行，auth.json 不写（key 缺省既有语义）

#### 场景：openai_chat 形态零回归

- Given 供应商 api_format=openai_chat（走 hub litellm 代理）
- When daemon 写 config.toml / auth.json
- Then 产物与本变更前逐字一致（本形态不在本变更修复面内）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/codex-settings.test.ts「全新目录写 config.toml：顶层 model/model_provider + [model_providers.sillyhub] 表，wire_api=responses」（golden 同步更新含新行）
FR-01: sillyhub-daemon/tests/codex-settings.test.ts「requires_openai_auth：anthropic 形态有 key 时写出该行（wire_api 行后）」（新增用例）
FR-02: sillyhub-daemon/tests/codex-settings.test.ts「key 缺省（仅 base_url）→ auth.json 不写（spike A3a keyless provider 合法），config.toml 照写且无 model 行（model 缺省）；keyless 不写 requires_openai_auth（产物与现状逐字一致，零回归）」（既有用例改名强化，逐字 toBe 守卫）
FR-02: sillyhub-daemon/tests/codex-settings.test.ts「key=daemonApiKey / base_url=litellm_base_url / model=litellm_model_name」（openai_chat golden 逐字 toBe 零回归守卫，含注释明示）
