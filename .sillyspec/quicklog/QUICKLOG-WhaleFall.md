
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

## ql-20260730-001-04ac | 2026-07-30 08:34:29 | agent 会话气泡三层(思考/工具折叠+回复突出)
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/session-log-sanitize.ts（加 classifySessionLog 分类 + sanitize 剥 TOOL 前缀）+ frontend/src/components/daemon/interactive-session-panel.tsx（SessionTurnView 加 thinking/toolEvents + SessionToolEvent 类型 + onLog 分流 + 占位×3 + 渲染三层）+ frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 历史同步分流）+ frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts（改 tool_call 测试 + 加 classify 6 测试）+ frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（mock turn 加字段）
需求：agent 会话气泡里思考过程/工具调用/回复混排不直观，要按原型（思考+工具折叠默认收起，回复突出）。
根因：interactive-session-panel turn.output 把一回合所有日志（[THINKING]+[TOOL_USE]+[TOOL_RESULT]+[ASSISTANT]）拼成一串整段 MarkdownText 渲染；sanitize 只剥 [THINKING] 前缀但保留思考内容，导致思考混进正文。
方案：① sanitize 加 classifySessionLog（按 [THINKING]/[TOOL_USE]/[TOOL_RESULT] 标记 + channel 分 thinking/tool_use/tool_result/assistant/skip）+ 剥 TOOL 前缀（去 tool_call 🔧 分支，tool 走卡片自带图标）；② SessionTurnView 加 thinking（思考累积）+ toolEvents（SessionToolEvent 列表，raw/result/status）；onLog 按 classify 分流（thinking 累积 / tool_use push / tool_result 配对最近 running 的 ok/deny / assistant 进 output）；占位 turn×3 + newTurn 加字段；③ 渲染 agent 气泡三层（复用 agent-log CollapsibleSection：思考默认折叠 50 字摘要 / 工具默认折叠 N 个 + ✓✗⏳ 状态 + 命令+结果 / 回复 MarkdownText 突出，分隔线隔开）；④ logsToTurns 历史会话同步分流。
结果：tsc --noEmit 0 error；全量 118 文件 1152 passed（0 fail）。

## ql-20260730-002-2356 | 2026-07-30 09:05:00 | agent 会话工具卡片命令形式+复制按钮(优化 ql-001)
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/interactive-session-panel.tsx（加 parseToolRaw helper + 工具卡片渲染改命令形式+复制）
需求：工具调用卡片显示原始 JSON 对象（{"tool":"Bash","args":{...},...}），优化成命令形式 + 复制按钮。
根因：ql-001 的 toolEvents.raw 直接整段渲染（daemon 推的完整 JSON），未解析，难看。
方案：加 parseToolRaw helper（JSON.parse raw → 按工具类型提取：Bash→command / Write,Edit,Read→file_path+content / Agent→description / 通用→args JSON）；工具卡片渲染：工具名标签用解析的 tool 名（替代固定"工具"）、命令显示 primary（command/file_path 等，代码字体）、加"复制"按钮（navigator.clipboard.writeText copyText）。解析失败（非 JSON）原样显示 raw 兼容。
结果：tsc --noEmit 0 error。

## ql-20260730-003-4a35 | 2026-07-30 09:21:41 | 会话折叠样式对齐原型(灰底思考/蓝底工具)
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/interactive-session-panel.tsx（加 SessionCollapsible 组件 + 替换 CollapsibleSection + 删 import）
需求：思考/工具折叠样式和原型差别大，对齐原型（灰底思考 / 蓝底工具折叠条）。
根因：复用了 agent-log 的 CollapsibleSection（纯文字小箭头 text-zinc-500 + Chevron + 斜体摘要，无卡片视觉），与原型的灰底/蓝底折叠条不搭。
方案：加 SessionCollapsible 组件（对齐原型：思考 bg-zinc-100 border-zinc-200 text-zinc-600 / 工具 bg-blue-50 border-blue-200 text-blue-700；▶▼ 箭头 + 摘要 truncate；展开内容区白底带顶边框），替换两处 CollapsibleSection，删其 import。
结果：tsc --noEmit 0 error；interactive-session-panel 40 测试过。