---
author: flow-machine-draft
created_at: 2026-11-01T23:30:34.789Z
---
# 设计记录（Design Record）— 2026-10-31-share-openai-chat-proxy-token

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因：llm-proxy 归属断言的认证主体是守护进程属主（子进程 Bearer=daemon apiKey），而共享 openai_chat 供应商的模型名 uid 是供应商属主，两值在受赠者/借出场景必然不等 → 403。代理层拿不到「真正选择供应商的会话属主」身份——是身份载体缺失，不是断言写错。

方案（限域代理令牌）：backend 在会话级解析链（resolve_session_provider_config）授权通过后，对 openai_chat 且（授权主体≠属主 或 守护进程属主≠属主）的场景，用 settings.secret_key 签发短期 HMAC 令牌（shlp_ 前缀，载荷 u=会话属主/o=供应商属主/p=供应商 id/exp），随 provider_config.litellm_proxy_token 下发；daemon 三引擎凭据构造优先该令牌作 Bearer；llm-proxy 新增验签分支——签名+exp 过 → 若有 usr 形态模型名则必须等于 usr-<o>-<p>，否则 403；验签不过 → 401。既有 apiKey/JWT 路径与自机自供应商链路一字不动（只在今天必然 403 的链路上发令牌，可用路径零风险）。

放弃的方案：①按受赠者注册 LiteLLM 别名（usr-<受赠者>-<pid> 同上游同 key）——只修自机场景，借出场景仍 403，且别名生命周期（共享/撤销/改密钥/删供应商）都要同步 LiteLLM 注册表，漂移面大；②共享排除 openai_chat——砍掉昨晚上线特性的主场景之一（GLM/LiteLLM 网关形态），且不修「自有供应商跑借出守护进程从静默回落变硬 403」的连带回归。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新模块 `backend/app/modules/llm_provider/proxy_token.py`：`PROXY_TOKEN_PREFIX = "shlp_"`、`PROXY_TOKEN_TTL_SECONDS = 24*3600`、`mint_llm_proxy_token(session_user_id, owner_user_id, provider_id) -> str`、`verify_llm_proxy_token(token) -> ProxyTokenGrant | None`（Grant 含 u/o/p/exp 与派生 `expected_model_name = usr-<o>-<p>`）；纯 stdlib（hmac/sha256/base64/json），常量时间比较。
- `resolve_session_provider_config`（backend lease/context.py）：授权通过且 api_format=openai_chat 且（actor_id≠provider.user_id 或 fallback_user_id 非 None 且≠provider.user_id）→ provider_config 增 `litellm_proxy_token` 键；其余情形返回值逐字不变。对外 HTTP API（openapi）零变化——provider_config 是 daemon 内部载荷，不进 openapi/api-types。
- `_llm_proxy_impl`（backend daemon/router/gateway_misc.py）：Bearer 解析前置——值带 shlp_ 前缀走验签分支（失败 401；成功则以 Grant 替代 principal 做模型名断言，无 model 语义放行）；非 shlp_ 形态走既有 `_authenticate_http_bearer` + uid==principal 断言（行为不变）。
- daemon `ProviderConfig`（sillyhub-daemon/src/types.ts）：增可选字段 `litellm_proxy_token?: string`（缺省=旧 payload 兼容）。三消费点取值链改为 `litellm_proxy_token ?? 现有取值`：credential-injector.ts（claude env ANTHROPIC_AUTH_TOKEN）、zcode-settings.ts（effectiveApiKey）、codex-settings.ts（resolveCodexForm openai_chat key）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。令牌只在 claim/切换时点随 provider_config 下发，代理端无状态验签（不查 DB），迟到/乱序请求各自独立验 exp——令牌过期后旧请求 401，与 anthropic 分支「撤销只影响后续 claim、在途 turn 继续用已下发凭证」语义一致。多令牌并存（会话多轮 claim 各自铸造）互不干扰，均独立可验。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无共享可变状态：backend 无令牌存储（签发即忘），daemon 不新增落盘面（zcode provider_config.json 会含 litellm_proxy_token 字段，随会话隔离目录清理，与现有 api_key 明文同盘同防护等级）。并发铸造幂等（同输入同签名，时间差内 exp 平移，无害）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。撤销共享 → 新 claim 不再铸令牌（provider_usable_by 拒绝 → None 回落默认链，既有 FR-05 语义）；已下发令牌存活至 exp（24h）——对齐 anthropic 分支在途行为，不引入新的吊销面。attachments.py 切换路径 fallback_user_id=None（runtime 未知）时按需要铸造（宁多铸不漏铸：令牌对该模型名恒可验，漏铸即残留 403）——切换与 claim 两条下发路径全覆盖。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。令牌与 (u,o,p) 三元组绑定且仅匹配单一模型名，不能跨供应商/跨用户使用；secret_key 为 backend 实例配置面（多实例部署需共享同一 secret_key——与既有 JWT/access token 同一约束，不新增部署前提）。daemon 侧令牌仅进子进程 env，遵守 R-02 不泄漏铁律（不进日志/序列化，与 api_key 同处置）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：llm-proxy 是 master key 唯一注入点（Grill 加固面），新增验签分支若实现有误可能影响生产 GLM 流量。缓解：分支按 Bearer 前缀短路隔离——shlp_ 前缀才进入新代码，生产存量流量（daemon apiKey/JWT）一行不差走旧路径；令牌分支任何失败都 fail-closed（401/403），不放行无主请求；新增用例覆盖篡改/过期/错配三条拒绝路径。次风险：zcode-settings 写盘新字段进入 provider_config.json（0600 会话隔离目录）——与现有明文 api_key 同盘同防护等级，不新增暴露面。死路（已试弃）：让代理改查 DB 做共享判定——Bearer 是 daemon 身份，DB 里没有「这次推理属于哪个会话」的信息，查无可查；这是身份载体问题，必须把会话属主身份随请求带下来。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/llm_provider/proxy_token.py | 令牌铸造/验签纯函数模块（shlp_ 前缀/HMAC-SHA256/TTL 常量） |
| 修改 | backend/app/modules/daemon/lease/context.py | resolve_session_provider_config 授权通过后按条件铸造 litellm_proxy_token 注入 provider_config |
| 修改 | backend/app/modules/daemon/router/gateway_misc.py | _llm_proxy_impl 新增 shlp_ Bearer 验签分支（401/403 语义与日志纪律） |
| 新增 | backend/app/modules/llm_provider/tests/test_proxy_token.py | 铸造/验签往返/篡改/过期/前缀识别单测 |
| 修改 | backend/app/modules/daemon/tests/test_llm_proxy.py | 令牌路径放行/403/401 用例 |
| 修改 | backend/app/modules/daemon/tests/test_lease_context_provider_share.py | openai_chat 共享含令牌/借出含令牌/自机零令牌用例 |
| 修改 | sillyhub-daemon/src/types.ts | ProviderConfig 增 litellm_proxy_token 可选字段 |
| 修改 | sillyhub-daemon/src/credential-injector.ts | litellm_proxy 分优先令牌作 ANTHROPIC_AUTH_TOKEN |
| 修改 | sillyhub-daemon/src/zcode-settings.ts | effectiveApiKey 令牌优先回落 |
| 修改 | sillyhub-daemon/src/codex-settings.ts | resolveCodexForm openai_chat key 令牌优先回落 |
| 修改 | sillyhub-daemon/tests/credential-injector.test.ts | 令牌优先/缺省回落用例 |
| 修改 | sillyhub-daemon/tests/zcode-settings.test.ts | 令牌优先/缺省回落用例 |
| 修改 | sillyhub-daemon/tests/codex-settings.test.ts | 令牌优先/缺省回落用例 |
