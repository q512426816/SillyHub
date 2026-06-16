## ql-20260604-001-progress | 2026-06-04 10:43:13 | 清除 progress.json 残留引用

状态：已完成
文件：backend/app/core/spec_paths.py、backend/app/modules/runtime/service.py、backend/app/modules/runtime/schema.py、backend/app/modules/runtime/tests/test_router.py
摘要：删除 progress.json fallback 逻辑，改用 SQLite sillyspec.db。测试通过 4/4。

## ql-20260605-001-a3f2 | 2026-06-05 09:33:54 | 修复 bootstrap scan --dir 指向 source_root 并添加 preflight 检查
状态：已完成
文件：backend/app/modules/agent/context_builder.py、backend/app/modules/agent/adapters/claude_code.py、backend/app/modules/spec_workspace/bootstrap.py、backend/tests/modules/agent/test_context_builder.py
摘要：修改 4 文件：(1) context_builder.py --dir→root_path, allowed_paths 加入 root_path (2) claude_code.py scan fallback --dir→root_path (3) bootstrap.py 重写 bundle 为完整平台参数命令, lease_path→code_root, 新增 _run_preflight (4) test_context_builder.py 更新断言+5 个 preflight 测试。18/18 通过。

## ql-20260605-002-b7c1 | 2026-06-05 09:49:08 | 放宽 preflight 签名检查：支持递归子目录和更多项目特征
状态：已完成
文件：backend/app/modules/spec_workspace/bootstrap.py、backend/tests/modules/agent/test_context_builder.py
摘要：放宽 preflight 签名检查。_PLATFORM_ENTRIES 加入 README.md/.git，增加一层子目录递归检测。新增 4 个测试覆盖边界场景。21/21 通过。已重新部署。

## ql-20260605-003-c8e4 | 2026-06-05 10:42:58 | Agent 执行 Token/Cost 和上下文追踪
状态：已完成
文件：backend/app/modules/agent/base.py、backend/app/modules/agent/adapters/claude_code.py、backend/app/modules/agent/model.py、backend/app/modules/agent/service.py、backend/app/modules/agent/schema.py、backend/migrations/versions/202606240900_add_agent_usage_fields.py、backend/app/modules/agent/tests/test_adapter_isolation.py
依据：C:\Users\qinyi\.claude\plans\agent-token-moonlit-squid.md
摘要：AgentRunResult 新增 6 字段（total_cost_usd/duration_ms/duration_api_ms/num_turns/session_id/conversation_events），适配器解析 CLI result 事件元数据，3 个执行路径持久化，API 响应暴露 5 字段，新增迁移+4 个测试。14/14 通过。

## ql-20260605-004-d5a7 | 2026-06-05 11:10:21 | 前端展示 Agent Run Usage/Cost 数据
状态：已完成
文件：frontend/src/lib/agent.ts、frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
摘要：AgentRun type 新增 5 字段，Active Runs 卡片 Cost 用真实数据，Completed Runs 表新增 Cost/Turns 列，展开日志新增 Usage/Cost 摘要卡片。

## ql-20260605-005-f2b8 | 2026-06-05 15:48:09 | 修复 Agent Run metadata 持久化失败 + 参考 Multica 细化 token 采集
状态：已完成
文件：backend/app/modules/agent/adapters/claude_code.py、backend/app/modules/agent/service.py、backend/app/modules/agent/tests/test_adapter_isolation.py
摘要：3 项修复：(1) on_log 改用独立 session，隔离主 session 的 run 对象，避免 session.commit 干扰 metadata 赋值；(2) _extract_result_metadata 参考 Multica 新增 modelUsage 解析，三级优先：modelUsage → usage → assistant 累积；(3) 添加 extracted_metadata + scan_run_pre_commit 诊断日志追踪 metadata 提取和持久化。新增 3 个测试，26/26 通过。已部署。

## ql-20260611-001-c7a3 | 2026-06-11 08:48:19 | Quick Chat 多轮对话支持：session_id 持久化 + --resume 上下文延续
状态：已完成
摘要：Quick Chat 多轮对话：后端 prev_run_id → session_id 查询 → resume_session_id 传入 daemon → Claude CLI --resume；前端 lastRunId 状态跟踪；daemon stream_json backend 支持 --resume 参数；端到端测试通过。
文件：backend/app/main.py, backend/app/modules/daemon/, frontend/src/app/(dashboard)/runtimes/page.tsx, frontend/src/lib/daemon.ts, sillyhub-daemon/sillyhub_daemon/backends/stream_json.py, sillyhub-daemon/sillyhub_daemon/daemon.py, sillyhub-daemon/sillyhub_daemon/task_runner.py

## ql-20260614-001-7e9a | 2026-06-14 09:38:22 | 修复 StreamJsonAdapter 缺失 buildArgs/buildInput 导致 claude 裸启动 hang
状态：已完成
文件：sillyhub-daemon/src/adapters/stream-json.ts、sillyhub-daemon/tests/stream-json.test.ts
依据：sillyhub-daemon/sillyhub_daemon/backends/stream_json.py L281-303、src/adapters/protocol-adapter.ts L83/L101、src/task-runner.ts L314/L457
结果：在 StreamJsonAdapter 实现 buildArgs（返回 ['-p','--output-format','stream-json','--input-format','stream-json','--verbose','--permission-mode','bypassPermissions']，resumeSessionId 非空追加 --resume）和 buildInput（{type:user,message:{role:user,content:[{type:text,text:prompt}]}} JSON + \n），对照 Python _build_args/_build_input。补 7 个 buildArgs/buildInput 单测 + ProtocolAdapter 契约断言。验证：tsc --noEmit 零错误；vitest 536/536 通过（含新测试）。修复后 task-runner 走 stream-json 正确路径，claude 不再裸启动 hang。

## ql-20260615-001-a7c3 | 2026-06-15 00:58:59 | 补 agent_runs.error_code 列的 Alembic migration
状态：已完成
文件：backend/migrations/versions/202606290900_add_agent_runs_error_code.py
依据：backend/app/modules/agent/model.py L93-96 (error_code: str | None = Field(sa_column=Column(String(64), nullable=True)))；alembic head = 202606280900
结果：新建 migration 202606290900（down_revision=202606280900），upgrade ADD COLUMN error_code VARCHAR(64) nullable，downgrade DROP。验证：当前开发库 schema 已领先版本号（列已存在→upgrade 报 DuplicateColumnError），故 alembic stamp 202606290900 对齐后，downgrade -1（DROP 成功）+ upgrade head（ADD 成功）往返验证双向 DDL；current=202606290900(head)，heads 单 head 无分叉。路径纠正：真实目录是 backend/migrations/versions/（alembic.ini script_location=migrations），非 backend/alembic/versions/。模块文档未同步（migration 不命中模块 glob，且既往 agent_runs migration 亦不入 agent 模块变更索引）。

## ql-20260615-002-9b4f | 2026-06-15 17:11:20 | 修复 /runtimes 空状态错误的 pip 安装提示（daemon 已重写为 TS），新增 sillyhub-daemon README

状态：已完成
文件：frontend/src/app/(dashboard)/runtimes/page.tsx、sillyhub-daemon/README.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md、.sillyspec/docs/multi-agent-platform/modules/frontend.md
依据：sillyhub-daemon/package.json（type: module, bin: dist/cli.js, engines.node>=20, packageManager: pnpm@9.6.0）；sillyhub-daemon/src/cli.ts（npm i -g sillyhub-daemon 注释 L8）；runtimes/page.tsx EmptyState L654-661（错误的 `cd sillyhub-daemon && pip install -e .`）；用户机器残留 `C:\Users\qinyi\AppData\Local\Programs\Python\Python312\Scripts\sillyhub-daemon.exe`（旧 Python 实现 entry point）报 ModuleNotFoundError: No module named 'sillyhub_daemon.__main__'
结果：(1) runtimes/page.tsx EmptyState 改写为 4 步安装（cd / pnpm install+build / npm link / 复制命令运行）+ Node>=20 提示 + Python 旧版残留卸载提示 + 末尾引导"启动后去 workspace 详情页配置默认 agent"。(2) 新增 sillyhub-daemon/README.md 含前置要求、双路安装（pnpm/npm）、start 全部选项表、子命令列表、配置文件路径表、6 类故障排查、开发说明。(3) 本机执行：pip uninstall -y sillyhub-daemon 成功（自动清掉残留 exe）→ pnpm install（4.5s）→ pnpm build（dist/cli.js 生成）→ npm link → sillyhub-daemon --version=0.1.0、status 输出正常（Runtime ID 68c63051，Server URL http://127.0.0.1:8001）。模块文档 sillyhub-daemon.md 变更索引 + frontend.md Change Index 同步追加。

## ql-20260616-001-7f3a | 2026-06-16 20:35:00 | 修复 /runtimes 页 4 个串联错误：登录 401 / git identities 500 / 前端 trim undefined 崩溃 / quick chat spawn claude ENOENT

状态：已完成
文件：deploy/.env（gitignored，未入库）、sillyhub-daemon/src/agent-detector.ts、sillyhub-daemon/src/task-runner.ts、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md、frontend/src/lib/agent.ts、frontend/src/components/agent-log/normalize.ts、frontend/src/components/agent-log-viewer.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx
依据：deploy/.env SILLYSPEC_MASTER_KEY 用 token_urlsafe 输出 base64url 而非 hex（crypto.py:49 bytes.fromhex 抛 ValueError → /api/git/identities 500）；sillyhub-daemon/src/agent-detector.ts:195 WINDOWS_EXTS 含空字符串 ''，findOnPath 在 .exe/.cmd/.bat/.ps1 都不存在时返回 npm 生成的裸 sh wrapper（如 C:\nvm4w\nodejs\claude），task-runner.ts:527-533 正则 /\.(cmd|bat)$/i 不匹配无扩展名 → spawn 不带 shell CreateProcess ENOENT；前端 trim undefined 崩溃是 git identities 500 后 undefined 数据流入组件引发的二次故障
结果：(1) deploy/.env SILLYSPEC_MASTER_KEY 改为 v1:111921cda60ab8608015b80e5226babc46c11935fbdfd77b49af728f3951dec4（hex 格式），docker compose up -d --force-recreate backend 后容器内生效。(2) agent-detector.ts:195 WINDOWS_EXTS 移除 ''，仅保留 ['.exe', '.cmd', '.bat', '.ps1']。(3) task-runner.ts:527-534 isWindowsWrapper 正则扩展到 .ps1 + 新增 isWindowsBareSh 无扩展名兜底，两者满足其一即 shell:true。(4) TRUNCATE daemon_runtimes CASCADE 清掉 7 条旧记录（含 3 条裸路径 + 1 条 claude.exe 旧记录），daemon 重启后注册 3 条干净 .cmd 后缀：claude.cmd v2.1.150 / codex.cmd v0.131.0 / openclaw.cmd v2026.4.15。端到端验证：浏览器 /runtimes 页 0 console error、3 个 runtime 在线显示、UI quick chat 发送「用一句话回答:你好」15s 内收到「你好!有什么可以帮你的吗?」；/api/auth/login 200（之前 401 是浏览器密码框记忆成 admin12345）；/api/git/identities 返回 200 空列表。同步 sillyhub-daemon.md 模块文档注意事项 + 变更索引。(5) Bootstrap 点击触发 agent run 时，前端 AgentLogViewer/normalize/changes/tasks 页 5 处直接读 log.content_redacted（类型为 string），后端 schema 允许 null（stderr 等通道），null 流入 → trim/parse 崩 "Application error: client-side exception"。修复：agent.ts:52 content_redacted 改 string | null；normalize.ts parseToolCallContent 接受 null|undefined，normalizeLogs 加 ?? "" 兜底；agent-log-viewer.tsx 加 contentSafe 中间变量替换 7 处直接访问；changes/[cid]/page.tsx 和 tasks/[tid]/page.tsx 的本地 parseToolCallContent/toolCallDescription 同步签名 + safe guard。tsc --noEmit 零错误。

## ql-20260616-003-a2c7 | 2026-06-16 22:08:00 | 修复 Bootstrap 实时日志 "Invalid Date"：SSE 协议错位 + channel 缺失

状态：已完成
文件：backend/app/modules/daemon/service.py、frontend/src/lib/agent.ts、frontend/src/lib/agent-stream.ts
依据：用户反馈 Bootstrap 点击后实时日志区出现多条 "Invalid Date" INFO 行（首条历史 log 时间戳正常显示 21:56:17，后续 SSE 推送全 Invalid Date）。根因 2 处：(a) backend/app/modules/daemon/service.py:568 submit_messages 把 daemon 原始 messages 数组（仅含 event_type/content，无 channel/timestamp/log_id）直接 publish 到 Redis，前端 lib/agent.ts:118 onmessage 把这种聚合 payload 当 StreamLogEvent 解析 → parsed.timestamp=undefined → new Date(undefined)=Invalid Date；(b) daemon sillyhub-daemon/src/task-runner.ts:889 _eventToMessage 不发 channel 字段，backend 默认 channel='stdout'，tool_use/tool_result 事件也误归 stdout → 前端 TOOL 徽章失效。此外 redis 频道还推 status_changed / done / messages summary 等非 log 事件，前端没识别也会变 Invalid Date 行。
结果：(1) backend submit_messages 改为每条 AgentRunLog 写入后单独 publish 扁平 StreamLogEvent payload `{log_id, channel, content, timestamp}`（timestamp 用 .isoformat().replace("+00:00","Z") 转 JS 友好格式）；保留一条 `{event:"messages",count,agent_run_status}` summary 做计数/审计。(2) 新增 _channel_from_event_type(event_type) helper：tool_use/tool_result→tool_call，error→stderr，其他→stdout。(3) frontend lib/agent.ts streamAgentRunLogs onmessage + lib/agent-stream.ts _emitMessage 加 timestamp 字段守卫，跳过 status_changed / messages summary 等非 log 事件。Ruff 16/16 通过（test_wave5_integration.py submit_messages 全过）；前端 tsc --noEmit 零错误。端到端浏览器验证：Bootstrap 触发后实时日志时间戳正确显示 22:12:48 / 22:12:53，TOOL 徽章正确出现，全页 0 处 "Invalid Date"。

## ql-20260616-002-b8e5 | 2026-06-16 21:27:00 | 修复 Bootstrap dispatch 链路 3 处缺陷：execution-context 400 + provider mismatch + prompt 空

状态：已完成
文件：backend/app/modules/spec_workspace/bootstrap.py
依据：daemon log 显示 HTTP 400 "cannot determine run type for execution-context" → backend/app/modules/agent/router.py:58-72 _determine_run_type 仅识别 task/stage/scan；bootstrap 类 agent_run (task_id=None, agent_type='claude_code', spec_strategy='platform-managed') 不命中任何分支抛 ValueError → 400 → daemon task failed。修完 400 后又串出两个独立缺陷：(a) daemon adapters/index.ts:118 PROTOCOL_PROVIDERS 12 个注册名只含 'claude' 不含 'claude_code'，bootstrap 传 provider='claude_code' → daemon getBackend() 抛 Unknown provider；(b) daemon task-runner.ts:376 用 ctx.prompt ?? '' 作 spawn 的 stdin 初始输入，bootstrap 不传 prompt → claude 收空串不读 .claude/CLAUDE.md → exit_code=0 但 sillyspec scan 实际未执行。
结果：(1) bootstrap.py:266-298 dispatch_to_daemon 加 root_path/spec_root/runtime_root 3 个 kwarg，让 lease.metadata 落地，daemon 拉 execution-context 时 _determine_run_type 走 'scan' 分支不再 ValueError → 400 解决（_determine_run_type 检查 lease_meta.root_path/spec_root 即返回 'scan'，无需改 router.py）。(2) 同处 provider 'claude_code' → 'claude'（daemon 12-provider 注册表只认 'claude'；'claude_code' 仅作后端 AgentRun.agent_type adapter 标识，与 placement/context_builder 一致，DB 里不动）。(3) 同处加 prompt kwarg 引导 claude 按 .claude/CLAUDE.md 跑 sillyspec scan。3 处 ruff 都过；3 次重建后端逐步验证：1st 仍 failed (provider mismatch)、2nd completed 但 output 显示 claude 等指令 (prompt 空)、3rd completed 且 daemon log 显示 claude 进入 sillyspec scan step 1/10 真实执行（最终卡在 AskUserQuestion 因 workspace.root_path 指向 host stub 空目录，是另一个独立问题，不在 ql-002 范围）。
