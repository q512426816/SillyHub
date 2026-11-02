---
author: flow-machine-draft
created_at: 2026-11-01T23:30:34.789Z
---
# 提案书（Proposal）— 2026-10-31-share-openai-chat-proxy-token

## 动机

任务原话转写：共享openai_chat供应商代理403修复

动机与背景：2026-10-30-provider-user-share 上线后，受赠者会话选用共享 openai_chat 供应商时，_provider_config_from_row 生成 usr-<属主uid>-<pid> 模型名（lease/context.py:243），daemon 子进程以 daemon 自身 apiKey 作 Bearer（credential-injector.ts:188），而 llm-proxy 归属断言要求模型名 uid == 认证主体即守护进程属主（gateway_misc.py:235），受赠者（无论自机还是借出机器）必然 403 model ownership mismatch；同因还会让「会话属主自有 openai_chat 供应商跑在借出守护进程」从旧版静默回落变成硬 403。测试 test_lease_context_provider_share.py 仅覆盖 anthropic 格式，该链路零覆盖。修复方案（用户未另行选型，采用审查报告推荐方案 A 限域代理令牌）：claim 时后端为受损链路签发短期 HMAC 令牌（含会话属主/属主/供应商 id/过期），daemon 子进程以令牌作 Bearer，llm-proxy 新增验签路径按令牌严格断言模型名；现有可用的 daemon apiKey 路径字节级零改动。

成功标准：
- 受赠者会话（共享 openai_chat 供应商）的 provider_config 含 litellm_proxy_token，模型名仍为 usr-<属主>-<pid>；llm-proxy 收到令牌 Bearer + 匹配模型名 → 放行转发（单测断言）
- 会话属主自有 openai_chat 供应商跑在借出守护进程（runtime ≠ 属主）的 claim 同样获得令牌；自有供应商跑自有守护进程（现状可用路径）不下发令牌、载荷字节不变
- llm-proxy 令牌路径安全语义：签名篡改/过期 → 401；令牌 + 非本令牌供应商模型名 → 403；既有 apiKey/JWT 鉴权与归属断言行为不变（既有 test_llm_proxy 用例零回归）
- daemon injector：litellm_proxy_token 存在时优先作 ANTHROPIC_AUTH_TOKEN，缺省回落 daemon apiKey（既有注入用例零回归）
- backend pytest + daemon 测试 + lint 全绿

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 受赠者会话（共享 openai_chat 供应商）的 provider_config 含 litellm_proxy_token，模型名仍为 usr-<属主>-<pid>；llm-proxy 收到令牌 Bearer + 匹配模型名 → 放行转发（单测断言）
2. 会话属主自有 openai_chat 供应商跑在借出守护进程（runtime ≠ 属主）的 claim 同样获得令牌；自有供应商跑自有守护进程（现状可用路径）不下发令牌、载荷字节不变
3. llm-proxy 令牌路径安全语义：签名篡改/过期 → 401；令牌 + 非本令牌供应商模型名 → 403；既有 apiKey/JWT 鉴权与归属断言行为不变（既有 test_llm_proxy 用例零回归）
4. daemon injector：litellm_proxy_token 存在时优先作 ANTHROPIC_AUTH_TOKEN，缺省回落 daemon apiKey（既有注入用例零回归）
5. backend pytest + daemon 测试 + lint 全绿

## 成功标准（可验证）

1. 受赠者会话（共享 openai_chat 供应商）的 provider_config 含 litellm_proxy_token，模型名仍为 usr-<属主>-<pid>；llm-proxy 收到令牌 Bearer + 匹配模型名 → 放行转发（单测断言）
2. 会话属主自有 openai_chat 供应商跑在借出守护进程（runtime ≠ 属主）的 claim 同样获得令牌；自有供应商跑自有守护进程（现状可用路径）不下发令牌、载荷字节不变
3. llm-proxy 令牌路径安全语义：签名篡改/过期 → 401；令牌 + 非本令牌供应商模型名 → 403；既有 apiKey/JWT 鉴权与归属断言行为不变（既有 test_llm_proxy 用例零回归）
4. daemon injector：litellm_proxy_token 存在时优先作 ANTHROPIC_AUTH_TOKEN，缺省回落 daemon apiKey（既有注入用例零回归）
5. backend pytest + daemon 测试 + lint 全绿
