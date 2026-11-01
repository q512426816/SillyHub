---
author: flow-machine-draft
created_at: 2026-11-01T23:30:34.789Z
---
# 任务注册表（Tasks）— 2026-10-31-share-openai-chat-proxy-token

- [x] task-01: 新增 backend/app/modules/llm_provider/proxy_token.py（shlp_ 前缀/HMAC-SHA256/TTL 24h，mint+verify+Grant.expected_model_name）+ test_proxy_token.py 单测（往返/篡改/过期/前缀）——pytest 该文件全绿即验证
- [x] task-02: lease/context.py resolve_session_provider_config 按（openai_chat 且 actor≠属主 或 runtime≠属主）铸造 litellm_proxy_token；test_lease_context_provider_share.py 补三用例（共享含令牌且模型名仍属主 uid/借出自有含令牌/自机自供应商零令牌）——pytest 该文件全绿
- [x] task-03: gateway_misc.py _llm_proxy_impl 增 shlp_ 验签分支（401 签名过期/403 错配模型名/无 model 放行，日志无令牌本体）；test_llm_proxy.py 补令牌用例且既有用例零回归——pytest 该文件全绿
- [ ] task-04: daemon 侧 types.ts 增 litellm_proxy_token 字段 + credential-injector/zcode-settings/codex-settings 三消费点令牌优先回落，三个测试文件补优先/回落用例——daemon 测试全绿
- [ ] task-05: 总回归：backend 触及模块 pytest（llm_provider + daemon 关联面）+ sillyhub-daemon 全量测试 + daemon pnpm typecheck + backend 触及文件 ruff check——全绿零新增
