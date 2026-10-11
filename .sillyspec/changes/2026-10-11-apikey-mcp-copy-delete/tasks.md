---
author: flow-machine-draft
created_at: 2026-10-11T07:00:52.199Z
---
# 任务注册表（Tasks）— 2026-10-11-apikey-mcp-copy-delete

- [x] task-01: 后端 model+迁移：api_keys 加 `encrypted_key`、mcp_tokens 加 `encrypted_token`（可空 TEXT），alembic 迁移落两列并本地 `alembic upgrade head` 验证
- [x] task-02: 后端 API key 侧：service create 落加密列（KEK 缺失降级置空）、`get_plaintext`/`hard_delete`；router 加 plaintext GET 端点、DELETE `hard` 参数；schema 加 `plaintext_recoverable`——tests/modules/auth 三件套新增用例跑绿
- [x] task-03: 后端 MCP token 侧：service/router 同 task-02 模式（WORKSPACE_WRITE 门 + webhook CASCADE 删除用例）——mcp_gateway/tests 新增用例跑绿
- [x] task-04: 前端 lib 层：api-keys.ts / mcp-tokens.ts 加 plaintext、hard 删除、`resolveDaemonApiKey`（无活跃 key 自动创建永不过期），`pnpm gen:types` 再生成并提交
- [x] task-05: 前端页面：runtimes CopyDaemonCommand 复制带真实密钥（渲染保持打码）、api-keys / mcp-tokens 列表加复制与删除按钮、不可恢复行降级禁用——对应 vitest 用例跑绿
- [x] task-06: 回归验证：后端 ruff/mypy + 相关 pytest 子集、前端 lint + 相关 vitest 子集；核对 FR-01~05 场景逐条通过
