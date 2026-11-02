---
author: flow-machine-draft
created_at: 2026-11-01T23:30:34.789Z
---
# 需求规格（Requirements）— 2026-10-31-share-openai-chat-proxy-token

## 功能需求

### FR-01: 受赠者会话（共享 openai_chat 供应商）的 provider_config 含 litellm_proxy_token，模型名仍为 usr-<属主>-<pid>；llm-proxy 收到令牌 Bearer + 匹配模型名 → 放行转发（单测断言）

- 会话级供应商解析链（resolve_session_provider_config）对 openai_chat 格式且授权主体≠供应商属主的场景，**必须**在 provider_config 中追加 `litellm_proxy_token` 字段（短期 HMAC 令牌，含会话属主/供应商属主/供应商 id/过期时刻，以 settings.secret_key 签名）；`litellm_model_name` **必须**保持 `usr-<属主uid>-<pid>` 不变（LiteLLM 路由键零改动）；anthropic 格式**禁止**出现该字段。

#### 场景：受赠者选用共享 openai_chat 供应商

- Given 属主 O 的 openai_chat 供应商 P 已共享给受赠者 G，G 的会话（任意守护进程）lease_meta 携带 session_llm_provider_id=P
- When claim 时 resolve_session_provider_config 解析（actor=G ≠ P.user_id=O）
- Then 返回的 provider_config 含 litellm_proxy_token（验签可得 u=G, o=O, p=P），litellm_model_name 仍为 usr-<O>-<P>

#### 场景：令牌本体安全语义

- Given 任一铸造出的令牌
- When 验签时签名被篡改 / 过期时刻已过 / 非 shlp_ 前缀形态
- Then 验签必须返回 None（无效），且验签用常量时间比较（hmac.compare_digest）

### FR-02: 会话属主自有 openai_chat 供应商跑在借出守护进程（runtime ≠ 属主）的 claim 同样获得令牌；自有供应商跑自有守护进程（现状可用路径）不下发令牌、载荷字节不变

- 会话属主自有 openai_chat 供应商跑在借出守护进程（runtime 属主≠会话属主）时，claim 解析**必须**同样下发 litellm_proxy_token；「会话属主=供应商属主=守护进程属主」的现状可用链路**禁止**下发令牌（provider_config 载荷与改造前逐字一致）。

#### 场景：自有供应商跑在借出的守护进程

- Given 会话属主 G 的自有 openai_chat 供应商 P，会话跑在属主 L 的守护进程（runtime=L，lease_meta.session_id 指向 G 的会话）
- When claim 解析（actor=G == P.user_id，但 fallback_user_id=L ≠ P.user_id）
- Then provider_config 含 litellm_proxy_token（u=G, o=G, p=P）

#### 场景：自机自供应商自守护进程（零改动锚）

- Given 会话属主 G 的自有 openai_chat 供应商 P，守护进程属主也是 G
- When claim 解析（actor=G == P.user_id，fallback_user_id=G == P.user_id）
- Then provider_config **不含** litellm_proxy_token，其余键值与改造前一致

### FR-03: llm-proxy 令牌路径安全语义：签名篡改/过期 → 401；令牌 + 非本令牌供应商模型名 → 403；既有 apiKey/JWT 鉴权与归属断言行为不变（既有 test_llm_proxy 用例零回归）

- llm-proxy **必须**新增令牌 Bearer 验签分支：Bearer 值带 shlp_ 前缀 → 验签（签名/过期任一不过 → 401，与既有无效凭据同语义）；验签通过时若 POST body 携带 usr-<uid>-<pid> 形态 model 名，**必须**与令牌内 (o,p) 组成的模型名完全一致，不一致 → 403（detail 固定短语，不回显内容）；无 model 语义请求（GET /models 类）放行转发。既有 apiKey/JWT 鉴权与 uid==principal 归属断言行为**禁止**变化（既有 test_llm_proxy 用例零回归）；日志**禁止**出现令牌本体。

#### 场景：令牌 + 匹配模型名放行

- Given 有效令牌（o=O, p=P），POST /v1/messages body.model = usr-<O>-<P>
- When 请求到达 llm-proxy
- Then 转发上游（注入 master key），不触达 apiKey/JWT 鉴权路径

#### 场景：令牌 + 非本令牌供应商模型名拒绝

- Given 有效令牌（o=O, p=P），POST body.model = usr-<他人uid>-<他人pid>
- When 请求到达 llm-proxy
- Then 403 "model ownership mismatch"

#### 场景：篡改/过期令牌拒绝

- Given 签名被篡改或 exp 已过的 shlp_ 令牌
- When 请求到达 llm-proxy
- Then 401 authentication required

### FR-04: daemon injector：litellm_proxy_token 存在时优先作 ANTHROPIC_AUTH_TOKEN，缺省回落 daemon apiKey（既有注入用例零回归）；zcode/codex 同口径

- daemon 侧 openai_chat + litellm_proxy 形态的凭据取值**必须**优先 provider_config.litellm_proxy_token，缺省回落现有 daemon 自身 apiKey 取值；claude（credential-injector）/ zcode（zcode-settings）/ codex（codex-settings）三条消费链**必须**同口径；字段缺省（undefined）时行为与现状逐字一致（向后兼容旧 payload）。

#### 场景：claude injector 优先令牌

- Given provider_config 含 litellm_proxy=true + litellm_proxy_token=T（daemon 进程级 apiKey=K）
- When claudeCredentialToEnv 构造子进程 env
- Then ANTHROPIC_AUTH_TOKEN = T（不是 K）

#### 场景：缺省回落（向后兼容）

- Given provider_config 含 litellm_proxy=true 但无 litellm_proxy_token（旧 backend 下发）
- When 各引擎构造凭据
- Then 与现状一致：claude/zcode/codex 均回落 daemon 自身 apiKey 取值

### FR-05: 回归伞——backend pytest + daemon 测试 + lint 全绿

- 本变更触及面（backend llm_provider/daemon 模块 + sillyhub-daemon injector/settings/types）的既有测试**必须**全部通过、零回归；ruff/eslint/tsc 触及文件零新增错误（local.yaml lint=unavailable，按惯例跑 ruff check backend 触及文件 + daemon pnpm typecheck 佐证）。

#### 场景：收口实测

- Given 全部实现合入
- When 收口实测（backend pytest 触及模块 + daemon 相关测试文件 + typecheck）
- Then 全绿，CLI 实测对账通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/backend/app/modules/llm_provider/tests/test_proxy_token.py「铸造→验签往返 / 篡改签名无效 / 过期无效 / 非 shlp_ 前缀不识别」
FR-01: test/backend/app/modules/daemon/tests/test_lease_context_provider_share.py「共享 openai_chat 供应商解析含令牌且模型名仍为属主 uid」
FR-02: test/backend/app/modules/daemon/tests/test_lease_context_provider_share.py「借出守护进程自有供应商获得令牌 / 自机自供应商零令牌零改动」
FR-03: test/backend/app/modules/daemon/tests/test_llm_proxy.py「令牌+匹配模型转发 / 令牌+错配模型 403 / 篡改与过期 401 / 既有 apiKey 用例零回归」
FR-04: test/sillyhub-daemon/tests/credential-injector.test.ts「litellm_proxy_token 优先 / 缺省回落 daemon apiKey」
FR-04: test/sillyhub-daemon/tests/zcode-settings.test.ts「effectiveApiKey 令牌优先回落」
FR-04: test/sillyhub-daemon/tests/codex-settings.test.ts「openai_chat key 令牌优先回落」
FR-05: 不适用：回归伞由 FR-01~04 各绑定用例 + 收口 CLI 实测对账覆盖（本条无独立测试文件）
