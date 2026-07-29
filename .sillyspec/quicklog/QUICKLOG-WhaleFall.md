
## ql-20260729-001-b3af | 2026-07-29 09:25:52 | 修 GET /api/llm-providers 500——deploy/.env 主密钥配成非 hex 标识串致 crypto.get_cipher() 崩溃，换合法 hex 密钥重建容器
状态：已完成
关联变更：（无）
文件：deploy/.env（第5行 SILLYSPEC_MASTER_KEY 由非十六进制标识串 msk-sillyhub-dev-90d223fd-... 替换为 v1:a3d891895cfe95451180d825586e01b9fec5bf57f349296b9e029821e5664894 合法主密钥；该文件 .gitignore 不入 git，仅本地部署生效，改动靠重建容器重读 env 落地）
需求：修复 GET /api/llm-providers 返回 500 Internal Server Error。
根因：deploy/.env 的 SILLYSPEC_MASTER_KEY 被配成非十六进制标识串 msk-sillyhub-dev-...，而 backend/app/core/crypto.py 的 _load_master_key() 用 bytes.fromhex() 解析，在 get_cipher() 阶段于位置0直接抛 ValueError，导致 list_providers 构造 LlmProviderService 时崩溃，所有走 CredentialCipher 的接口全部 500。
方案：用 secrets.token_hex(32) 生成合法主密钥 v1:a3d891...e5664894（v1:前缀+64位hex），替换 deploy/.env 第5行；docker compose up -d --force-recreate backend 重建容器重读 env（启动含 alembic upgrade head && uvicorn）。
结果：容器 healthy；新密钥已注入（v1:前缀/67字符）；GET /api/llm-providers 由 500 变为 401（get_cipher 不再崩溃、链路恢复），前端代理 3000 同为 401；未改代码无测试受影响；换密钥零数据风险（llm_providers/git_identities 表均空、api_keys 为 hash 存储不依赖 master key）。

## ql-20260729-002-4791 | 2026-07-29 11:11:12 | daemon 未配供应商时用宿主机 ~/.claude 配置(有启用才隔离)
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/spawn-env.ts（buildSpawnEnv 的 CLAUDE_CONFIG_DIR 条件化）+ sillyhub-daemon/tests/spawn-env.test.ts（+4 新测试 / 修 1 旧测试）
需求：没配置供应商、或配置了但没启用时，daemon spawn 的 claude 直接用宿主机 ~/.claude/settings.json（cc-switch/手配）；有启用的供应商才隔离运行。
根因：spawn-env.ts:155 无脑 `env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR`（强制隔离），未配供应商时 lease 不带 provider_config（层0 跳过）+ 隔离目录空（无 settings.json/credentials.json）→ claude CLI 无凭证 → 报 "Not logged in · Please run /login"。
方案：CLAUDE_CONFIG_DIR 条件化——仅 ctx.provider_config 存在（启用供应商，平台下发）时才设隔离目录（避免 cc-switch 污染平台注入）；否则不设 + 清 process.env 可能残留的 CLAUDE_CONFIG_DIR，claude CLI 回退读默认 ~/.claude/settings.json（cc-switch/手配生效）。加 4 个新测试覆盖（有 provider_config→隔离 / 无→不隔离 / null→不隔离 / 残留清理）；修 1 个旧测试（codex provider_config 存在但 injector 未注册 → 仍隔离，不再 toEqual absent）。
结果：spawn-env 27/27 passed；daemon 全量 2033 passed（5 failed 均为预存的 spy/路径失败，与本次无关）；tsc 0 error；bundle + dist 编译完成，npm 全局目录=项目目录已含新逻辑，daemon 已重启（registered+started）。