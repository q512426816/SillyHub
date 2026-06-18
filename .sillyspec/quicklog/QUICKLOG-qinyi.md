## ql-20260618-011-a8d3 | 2026-06-18 16:05:00 | Workspace 创建：路径规范化 + 默认 daemon 路径 + server-local 需 admin

状态：已完成
文件：frontend/src/lib/client-path.ts、frontend/src/components/daemon-dir-browser.tsx、frontend/src/components/workspace-scan-dialog.tsx、backend/app/modules/workspace/router.py
结果：Windows 路径统一反斜杠；添加 Workspace 默认 daemon-client；server-local 仅 workspace:admin 可见且后端校验；去掉 D-001 内部术语文案。

## ql-20260618-010-e7c4 | 2026-06-18 15:43:18 | 修复 daemon WS 用 config.runtime_id 导致 list_dir RPC 504 offline

状态：已完成
文件：sillyhub-daemon/src/daemon.ts、sillyhub-daemon/tests/daemon-multi-runtime.test.ts、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
依据：用户报添加 daemon-client workspace 时 `HTTP_504_DAEMON_RPC_GATEWAY: daemon runtime '8fda3323-...' offline`；HTTP 心跳用 register 返回的 server runtime id，WS 却连 config.runtime_id，hub 无对应连接。
结果：daemon `_wsLoop` 改为对每个 `_registeredRuntimes` server id 各建一条 WsClient（`_wsClients` Map）；stop 时 `_closeAllWsClients`；新增单测 `ws_uses_server_assigned_runtime_ids`；模块文档补充 WS 须与 heartbeat 一致。
验证：vitest daemon.test.ts + daemon-multi-runtime.test.ts 37/37 通过；tsc --noEmit 零错误。

## ql-20260618-009-f3a2 | 2026-06-18 11:45:40 | 修复 agent per-run model 代码 review 发现的 5 个小问题

状态：已完成
文件：backend/app/main.py、backend/app/modules/daemon/service.py、backend/app/modules/agent/router.py、backend/app/modules/change/router.py、frontend/src/lib/changes.ts
依据：代码 review ql-20260617-006（Daemon per-run model selection）发现 5 个问题：(1) quick_chat 的 `agent_type=provider` 与全项目 `agent_type="claude_code"` 约定不一致，导致 DB agent_type 字段语义混乱；(2) execution-context payload 中 provider/model 同时从 AgentRun 与 lease_meta 取，lease_meta 会覆盖 AgentRun 快照（违反 source of truth 原则）；(3) `/changes/{id}/dispatch` 路由的 provider/model Query 参数没限制 max_length，schema 限制了但路由没限制；(4) 前端 executeChange 用 `if (model)` 而 transitionChange 用 `if (model !== undefined)`，判断风格不一致；(5) workspace-scan-dialog 的 AgentModelInput placeholder 固定，不展示 workspace.default_model 提示。
结果：实际修复 4 项（#5 review 误判跳过）——
  1. **#1 backend/app/main.py:167-171, 207-212**：quick_chat 的 INSERT SQL 和 return dict 中 agent_type 从 `provider` 改为 `"claude_code"`，与 service.py / bootstrap.py / dispatch.py / 30+ 测试约定一致；provider 走独立列。
  2. **#2 backend/app/modules/daemon/service.py:420-425 + backend/app/modules/agent/router.py:237-240**：把"lease_meta 覆盖 AgentRun"改为"AgentRun 优先 + lease_meta 兜底"——`run.provider or lease_meta.get("provider")`。AgentRun 是持久化快照作 source of truth，避免重 dispatch 时 transport 与快照不一致。daemon 真正消费的 execution-context 端点在 agent/router.py（不是 daemon/service.py 的 _build_claim_payload），两处同步修。
  3. **#3 backend/app/modules/change/router.py:551-553**：manual_dispatch 的 provider/model Query 加 `max_length=64/128`，与 schema.py TransitionRequest 对齐。
  4. **#4 frontend/src/lib/changes.ts:287-292**：transitionChange 的 provider/model 判断从 `!== undefined` 改为 truthy（`if (provider)` / `if (model)`），与 executeChange 风格统一。后端 schema default=None，行为等价。
  5. **#5 跳过**：WorkspaceScanDialog 是新建 workspace 流程，那时 workspace 尚不存在，没有 default_model 可显示。default_model 的编辑入口已经在 workspace 详情页（workspaces/[id]/page.tsx:488）有独立 UI。
验证：backend pytest 57/57 通过（test_execution_context / test_lease_service / test_bootstrap_provider_model / test_router）；ruff 通过；frontend tsc --noEmit 零错误。

## ql-20260618-008-b2e1 | 2026-06-18 10:25:00 | 修复 daemon Windows .cmd 包装 spawn 失败导致 codex quick-chat 卡住

状态：已完成
文件：sillyhub-daemon/src/cmd-shim.ts、sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/tests/cmd-shim.test.ts
依据：用户报 codex quick-chat daemon 日志只到 `[task xxx] [running]` 后卡住，没继续推 delta（"还是卡了"）。直接 probe `spawn(codex.cmd, [..], {shell:true})` 在 git-bash 下报 ENOENT，PowerShell 下虽能启动但行为不稳定；claude.cmd 是原生 exe 没问题，对比 "claude code 的就没问题"。
根因：npm/cmd-shim 生成的 codex.cmd 用 `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "...codex.js" %*` 单行混合模式（goto trick），Node `child_process.spawn(cmd.cmd, args, {shell:true})` 在不同 shell 环境下行为不一致。claude.cmd 是原生 exe 模式 (`"...claude.exe" %*`) 不受影响。
结果：
  1. 新增 `sillyhub-daemon/src/cmd-shim.ts` `resolveWindowsCmdShim()`：read .cmd 文件，全局 regex 匹配两种模式——node+js 模式返回 `{exe: node.exe, prependArgs: [js_path]}`；原生 exe 模式返回 `{exe, prependArgs: []}`。%dp0% 宏展开到 .cmd 所在目录，node.exe 优先用 `%dp0%\node.exe`（nvm4w 全局目录通常带）fallback `process.execPath`。
  2. `task-runner.ts` spawn 前先调 resolver，成功则不带 shell；失败回退原 `shell:true`（兼容非 cmd-shim 生成的 .bat/.ps1）。codex → `spawn(node.exe, [codex.js, app-server, --listen, stdio://])`；claude → `spawn(claude.exe, [...])`，均无 shell。
  3. `tests/cmd-shim.test.ts` 5 个用例：codex.cmd 格式 / claude.cmd 格式 / %dp0% 宏展开 / 读失败→null / 非 .cmd 内容→null。全 5 通过。
验证：probe 用 daemon 完全相同的 spawn 逻辑跑 codex "hi" → 10 秒内拿到完整事件流（initialize reply / thread:start reply / turn/started / item/started reasoning @ +8.4s / item/agentMessage/delta @ +9.8s / item/completed / turn/completed）。tsc --noEmit 零错误；vitest cmd-shim 5/5 通过。

## ql-20260618-007-d9c0 | 2026-06-18 10:04:45 | 修复 Daemon runtime 掉线后刷新仍在线并补 Agent 禁用操作

状态：已完成
文件：backend/app/modules/daemon/service.py、backend/app/modules/daemon/router.py、backend/app/modules/daemon/tests/test_lease_service.py、frontend/src/lib/daemon.ts、frontend/src/app/(dashboard)/runtimes/page.tsx、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/hub-client.ts、sillyhub-daemon/tests/daemon.test.ts、sillyhub-daemon/tests/hub-client.test.ts、.sillyspec/docs/multi-agent-platform/modules/backend.md、.sillyspec/docs/multi-agent-platform/modules/frontend.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
依据：.claude/CLAUDE.md；.sillyspec/local.yaml；.sillyspec/docs/multi-agent-platform/modules/backend.md；.sillyspec/docs/multi-agent-platform/modules/frontend.md；.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md；memory: cleanup_stale_runtimes / /api/daemon/runtimes runtime truth
根因：runtime 列表刷新只依赖 heartbeat 超时清理；daemon 正常退出没有把已注册的 server runtime id 上报 offline；同时后端没有 `disabled` 状态的一等语义，heartbeat 或重新 register 会把禁用项恢复为 online。
结果：
  1. 后端新增 runtime `disable` / `enable` / `offline` 操作；`disabled` 状态不会被 heartbeat、重新注册、offline 标记或 stale cleanup 改回 online；启用时按 45s heartbeat 新鲜度恢复为 online/offline。
  2. `/api/daemon/runtimes` 仍在刷新时执行 stale cleanup，默认阈值从历史 120s 收紧为 45s，且会处理 `last_heartbeat_at IS NULL` 的 online 脏数据。
  3. daemon stop 路径在停止 heartbeat/poll/ws 循环后，使用 server 分配的各 provider runtime id 批量 POST `/api/daemon/runtimes/{id}/offline`，正常 Ctrl+C/SIGTERM 后刷新即可看到离线；崩溃/强杀由 stale cleanup 兜底。
  4. `/runtimes` 列表新增 disabled 状态、禁用统计和每个 runtime 的禁用/启用按钮；禁用项不会进入 quick-chat online provider 选择。
验证：`python -m pytest backend/app/modules/daemon/tests/test_lease_service.py -q`（33 passed）；`pnpm -C sillyhub-daemon test -- tests/daemon.test.ts tests/hub-client.test.ts`（56 passed）。

## ql-20260618-006-a3f1 | 2026-06-18 09:25:00 | codex quick-chat SSE 扁平 payload + delta 缓冲节流（解决"几个字几个字蹦"）

状态：已完成
文件：sillyhub-daemon/src/adapters/json-rpc.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/src/task-runner.ts、frontend/src/lib/daemon.ts、frontend/src/app/(dashboard)/runtimes/page.tsx
依据：用户报 daemon 日志显示 delta 在推但 UI 仍卡住，且「SSE 注意要速度，之前几个字几个字输出慢死了」。两类问题：
  1. **UI 卡住**：backend Redis pub/sub 推扁平 StreamLogEvent `{log_id, channel, content, timestamp}`，前端 streamQuickChat 解析时按聚合 `QuickChatStreamMessage {messages:[]}` 找字段，所有扁平 payload 被丢弃 → SSE 收到日志但 onMessage 不触发。
  2. **慢**：daemon json-rpc adapter 每个 codex agentMessage/delta（1-5 字符/token）都立即产 AgentEvent → TaskRunner 串行 await submitMessages（HTTP POST + DB commit + Redis publish + SSE push），长 message 累积十几秒延迟。
结果：
  1. **daemon.ts SSE 解析**：识别两种 payload 格式（扁平 + 聚合），扁平按 channel 反推 event_type（stdout→text / stderr→error / tool_call→tool_use），统一包装成聚合 messages 单元素传 onMessage。
  2. **runtimes/page.tsx renderStreamMessage**：跳过 `[SYSTEM:..]`/`[RESULT:..]` 系统消息，剥掉 `[ASSISTANT]`/`[THINKING]`/`[LOG:..]` 前缀，让 chat 面板只显示纯文本。
  3. **task-runner.ts _eventToMessages**：codex 流式 delta（metadata.streaming=true）不加 `[ASSISTANT]` 前缀，直接发原始 delta 文本，前端 chat 面板 append 拼"打字效果"（原 [ASSISTANT] 每条带前缀会变成 "[ASSISTANT] 我[ASSISTANT] Cod"）。
  4. **json-rpc.ts delta 缓冲节流**（对齐 stream-json.ts thinking buffer 模式 ql-20260617-012）：
     - 加 `_agentMessageBuf` / `_agentMessageBufItemId` / `_agentMessageBufStartedAt` 字段 + 阈值常量 `AGENT_MESSAGE_FLUSH_CHARS=80` / `AGENT_MESSAGE_FLUSH_MS=120`
     - parseAgentMessageDelta：itemId 切换先 flush 旧 buffer，累积到 80 字符或 120ms 才 emit；否则返回 null（TaskRunner 不调 submitMessages）
     - parseItemCompleted(agentMessage)：先 flush 残留 buffer（尾部不丢），再按 _streamedAgentMessageIds 跳过 completed 重复文本
     - parseTurnCompleted：先 flush 残留 buffer（异常退出兜底），再产 complete 事件
     - 新增 resetAccumulator() 清状态（TaskRunner 跨 lease / 重试调用）
测试：json-rpc 53/53 通过（新增 6 用例覆盖：小 delta 暂存 / 字符阈值 flush / 时间阈值 flush / itemId 切换 flush / completed flush 残留 / turn_completed flush 兜底）。
预期效果：codex 生成阶段从"每 token 一次 HTTP POST（慢且卡）"变成"每 80 字符或 120ms 一次（流畅）"，UI 实时显示打字效果不再卡顿。

## ql-20260618-005-c4d2 | 2026-06-18 09:15:49 | 修复 spec-bootstrap 未应用 workspace 默认 Agent provider/model

状态：已完成
文件：backend/app/modules/spec_workspace/bootstrap.py、backend/app/modules/spec_workspace/tests/test_bootstrap_provider_model.py、AGENTS.md、.sillyspec/docs/multi-agent-platform/modules/backend.md
依据：.claude/CLAUDE.md；.sillyspec/docs/multi-agent-platform/modules/backend.md；.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md；.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/tasks/task-03.md
结果：Bootstrap launch 阶段按 workspace.default_agent/default_model 固化 AgentRun.provider/model；后台 daemon 派发阶段复用该快照写入 lease metadata，未配置默认 provider 时保留 claude fallback；AGENTS.md 改为读取 .claude/CLAUDE.md；backend 模块文档追加本次变更索引。验证：`cd backend; uv run pytest -q app/modules/spec_workspace/tests/test_bootstrap_provider_model.py` 通过，2 passed。

## ql-20260618-004-9f81 | 2026-06-18 08:50:00 | codex quick-chat 流式输出 reasoning + agentMessage/delta（消除"等 2 分钟"静默）

状态：已完成
文件：sillyhub-daemon/src/adapters/json-rpc.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/fixtures/json-rpc/codex/notification-item-started-reasoning.json、sillyhub-daemon/tests/fixtures/json-rpc/codex/notification-item-agentMessage-delta.json
依据：用户报"等两分钟才响应"。DB 查询最近 codex quick-chat 实际都成功，但耗时 96-121 秒（00:36:25→00:38:21 / 00:38:59→00:41:00）。日志只有 3 条：[SYSTEM:thread_started] 间隔近 2 分钟才出 [ASSISTANT]+[RESULT:success]，中间完全静默。原因：codex 默认用推理模型（gpt-5）思考阶段长（reasoning），且生成阶段是逐字流式 delta，但 daemon json-rpc adapter 不处理这两类事件，等 item/completed(agentMessage) 一次性拿到完整文本才 submit，用户体感"卡死"。
结果：json-rpc adapter 补三类事件处理：
  1. **item/started reasoning** → 产 `text + metadata.thinking=true + source='reasoning_started'`；item.summary 数组提取 summary_text 拼接成 content（开启 reasoning_summary 时显示思考摘要，未开启时 content 空仅标记 thinking，前端可显示"思考中..."）。
  2. **item/agentMessage/delta**（method 直匹配）→ 产 `text + content=delta + metadata.streaming=true + source='agent_message_delta'`，让 UI 实时显示 codex 逐字打字。
  3. **item/completed(agentMessage) 去重**：adapter 新增 `_streamedAgentMessageIds: Set<string>`，delta 处理时记录 itemId；item/completed 命中此集合时跳过（避免与 delta 重复展示完整文本），命中后删除让下一条 message 正常走。
测试：新增 4 个用例（reasoning summary 提取 / delta 流式 / delta 后 completed 跳过 / 未走 delta 时 completed 正常），全 49/49 通过。
预期效果：codex 思考期间 UI 显示 thinking，生成期间逐字流式，总耗时不变（受推理模型限制）但体感从"静默 2 分钟"变成"实时进度"。

## ql-20260618-003-a1b2 | 2026-06-18 01:35:00 | 修复 codex quick-chat "无输出"：_looksLikeResult 误命中 thread/start response 提前关 stdin

状态：已完成
文件：sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/src/adapters/json-rpc.ts
依据：用户报「快速对话 codex 还是提示无输出」。daemon 日志显示 handshake 三条全部写入成功，stdout 收到 initialize response（id=1）+ remoteControl/status/changed 通知后 codex 立即 exit=0；thread/start response（id=2）从未到达。standalone probe（同 cwd/env/300ms 间隔）则可正常完成 turn，拿到 "hi"。
根因（3 个互相叠加的 bug）：
  1. **task-runner.ts `_looksLikeResult` 太宽**：原 `line.includes('"result"')` 兜底分支会命中 codex 的 `{"id":2,"result":{"thread":{...}}}`（thread/start response 也含 "result" key），被误判为 claude 的终结 result 事件 → 提前 `stdin.end()`。
  2. **codex 是被动 server，单 turn 完成后不会自动 exit**：daemon 唯一的 stdin 关闭路径是 _looksLikeResult，结果在中途错误触发，导致 codex 收到 stdin 关闭也跟着 exit=0；turn/start（id=3）从未写出（write after end 异常）。
  3. **json-rpc.ts `parseResponse` 把 thread/start response 标为 `complete` 事件**：thread/start response 只是会话创建，不是任务完成；产出 'complete' 让前端误显示 [complete]，且触发 stats 收集逻辑（无 stats 但语义错）。
结果：
  1. `_looksLikeResult` 改正则 `/"type"\s*:\s*"result"/`，只匹配 claude stream-json 的 result 事件（容忍冒号两侧空格）。
  2. 新增 `_looksLikeTurnCompleted` 检测 codex 的 `"method":"turn/completed"` notification；`_handleLine` 命中后 `stdin.end()`，作为 json-rpc 协议的单次 lease 收尾点（与 claude result 等价）。
  3. `parseResponse` 把 thread/start response 改为 `type:'text' + status:'system' + subtype:'thread_started'`，仅承载 session_id；usage response 改 `status:'usage_update'`。task 真正完成由 `turn/completed` notification 走 `parseTurnCompleted` 产 `complete` 事件。
  4. 清掉临时 debug 日志（spawn_debug / child_error / child_exit_raw / child_close_raw / hs_start / hs_write_cb / turn_check / turn_start_writing），仅保留 300ms handshake 间隔和有意义的 warn。
验证：sillyhub-daemon tsc build OK；codex quick-chat 端到端跑通（GET /api/daemon-chat/{id} 返回 status=completed output="Hi"，3 条日志 [SYSTEM:thread_started]/[ASSISTANT] Hi/[RESULT:success]）；claude quick-chat 回归通过（output="OK"，新正则仍命中 `"type":"result"`）。

## ql-20260618-001-7c3a | 2026-06-18 00:30:00 | Agent 控制台浅色化 + Thinking 默认展开 + Quick chat 接入日志与新建会话 + 清理 codex 调试日志

状态：已完成
文件：frontend/src/components/agent-log-viewer.tsx、frontend/src/components/agent-log/tool-renderers.tsx、frontend/src/app/(dashboard)/runtimes/page.tsx、frontend/src/lib/daemon.ts、backend/app/main.py、sillyhub-daemon/src/task-runner.ts
依据：用户报「Agent 控制台黑色风格突兀；thinking 应默认展开；快速对话要能查看日志且支持新建会话；改完提交推送」。同时清理上一轮排查 codex 时留下的 hs_write/hs_cb/stdout_line 调试 console.log。
结果：
1. AgentLogViewer 整体浅色化（bg-zinc-950→bg-zinc-50、semanticLineClass 浅色、按钮边框/spinner 浅色）。
2. CollapsibleSection 默认展开（defaultOpen=false→true），Thinking 段落首次渲染即展开。
3. 后端新增 `GET /api/daemon-chat/{run_id}/logs`：复用 AgentService.get_run_logs，仅放行 spec_strategy='quick-chat'，避免越权读其他 run。
4. 前端 QuickChatPanel 加 activeRunId + runLogs 状态，发送即激活并 1.5s 轮询拉日志（终态自动停）；UI 嵌入 AgentLogViewer，"查看日志"/"隐藏日志"切换；"新建会话"按钮同时清空 messages/activeRunId/runLogs/lastRunId。
5. 清理 task-runner.ts 的 hs_write/hs_cb/stdout_line 临时 console.log，保留 100ms handshake 间隔（codex 实测需要）。
验证：sillyhub-daemon task-runner/provider-dispatch/json-rpc 三组共 117/117 通过；frontend tsc --noEmit EXIT=0；后端 ast.parse OK。


状态：已完成
文件：sillyhub-daemon/src/adapters/json-rpc.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts
依据：用户报「codex 提示 agent process exited with exit code 1: Error: stdin is not a terminal」。根因：task-runner.ts:394 调 adapter.buildArgs 但 JsonRpcAdapter 未实现该方法 → codex spawn 无参数 → 进入交互式 TUI → 检测到 stdin 非 terminal 立即退出。文档 .sillyspec/changes/2026-06-09-daemon-agent-detection/tasks/task-05.md:67 明确 codex 需要 `app-server --listen stdio://` 子命令；archive/2026-06-14.../task-07.md:461 指出此差异由 spawn 层（task-19）处理。修复：JsonRpcAdapter 实现 buildArgs，codex 返回 ['app-server','--listen','stdio://']，其他 provider 返回 []。新增 6 个测试用例，全 35 通过。

## ql-20260617-005-c1d2 | 2026-06-17 01:35:00 | 恢复 /input 端点 + token 0/0 防御 + cancel 立即 killed + 数据库脏 0 清理

状态：已完成
文件：backend/app/modules/agent/router.py、backend/app/modules/agent/service.py、backend/app/modules/agent/tests/test_run_input.py、backend/app/modules/agent/tests/test_kill_and_state_mapping.py、backend/app/modules/daemon/lease_service.py、backend/app/modules/daemon/service.py、backend/app/modules/daemon/tests/test_quick_chat_kill.py、backend/app/modules/daemon/tests/test_wave5_integration.py、frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
依据：用户反馈「输入词元 0 输出词元 0 这两个还是不行，现在能显示 0 了，但是不对，应该会变化的才对」+ Stop hook 反馈原始 goal 要求系统性修复 daemon-SERVER parity 缺口（含 /input 端点 cf71836 误删）。直接捕获 claude.cmd stream-json 实测确认：中间 assistant 事件 `message.usage = {input_tokens:0, output_tokens:0}`（CLI 协议限制，只在最终 result 事件才有真实值）。
结果：
  1. **submit_run_input 端点恢复**：cf71836 误删的 `POST /workspaces/{ws}/agent/runs/{run}/input` 端点 + service 函数全恢复（service.py 加 AgentRunNotRunning 导入修复 NameError）。test_run_input.py 7 个测试覆盖 happy path / 404 / 422 空 / 422 超长 / 409 终态 / 401 无 auth / Redis 故障不阻塞。
  2. **token 0/0 防御**：service.py submit_messages 把 daemon 透传的 0/0 usage 当作"无数据"不覆盖 AgentRun 已有非零值（避免 CLI 协议限制导致的伪 0 写回）。
  3. **cancel 立即 killed**：lease_service.py cancel_lease 无论 pending/claimed 都立即把 AgentRun 标 killed + finished_at（用户即时反馈）；daemon complete_lease(cancelled) 会被 priority 守卫拦下（killed > cancelled）。test_kill_and_state_mapping.py + test_quick_chat_kill.py 两个旧 "defers" 测试改为 "marks_killed_immediately"。
  4. **前端文案**：page.tsx pendingMetric 从 "等待用量" 改 "执行中…"（明确告知 CLI 协议限制，不显示伪 0）；input_tokens/output_tokens 显示加 `> 0` 守卫，0/null 一律走 pendingMetric。
  5. **数据库脏 0 清理**：UPDATE agent_runs SET input_tokens=NULL,output_tokens=NULL WHERE input_tokens=0 AND output_tokens=0（3 行历史 0/0 数据，现统一显示 "—"）。
验证：backend pytest 223/223 通过（agent + daemon 全量）。

## ql-20260617-007-3f8a | 2026-06-17 21:07:25 | Runtime model control visibility

状态：已完成
文件：frontend/src/app/(dashboard)/runtimes/page.tsx, .sillyspec/docs/multi-agent-platform/modules/frontend.md
依据：runtime quick chat 的 model 输入不能只在存在在线 provider 时才出现，否则用户在 Daemon 运行时页看不到可配置 model 的位置。
结果：Quick Chat 面板头部始终显示 Agent provider / Agent model；无在线 daemon 时 provider 和发送禁用，但 model 输入保持可见，可先填写本次对话的 model override。

## ql-20260617-006-9b2d | 2026-06-17 17:20:00 | Daemon per-run model selection

状态：已完成
文件：backend/app/modules/agent/model.py, backend/app/modules/agent/service.py, backend/app/modules/agent/placement.py, backend/app/modules/agent/router.py, backend/app/modules/daemon/service.py, backend/app/modules/workspace/model.py, backend/app/modules/workspace/service.py, backend/app/modules/change/dispatch.py, backend/app/modules/change/router.py, backend/app/modules/change_writer/router.py, backend/app/main.py, backend/migrations/versions/202607020900_add_agent_run_model_fields.py, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/types.ts, sillyhub-daemon/src/adapters/stream-json.ts, frontend/src/components/AgentModelInput.tsx, frontend/src/lib/{agent,daemon,workspaces,changes,workflow}.ts, frontend workspace/change/task/runtime pages
依据：同一个 daemon 可以并发运行多个 agent；provider/model 必须是每个 AgentRun/lease 的独立执行快照，而不是 daemon 进程级全局设置。
结果：
1. AgentRun 增加 provider/model 快照字段；Workspace 增加 default_model；新增 Alembic migration。
2. task/stage/scan/quick-chat/change-writer execute 等入口都支持显式 model，未指定时按 workspace.default_model 回落。
3. daemon claim/execution-context/LeaseCtx 透传 model；stream-json adapter 将非空 model 转为 `--model <name>`。
4. 前端 workspace 默认设置、scan-generate、change dispatch、task run、runtime quick chat 均增加 model 输入；空值保持 provider/CLI 默认。
5. 补充 backend/daemon 单测与模块文档备注。

## ql-20260617-001-7a3e | 2026-06-17 00:45:00 | 修复 token 用量不实时累计 + Agent 页面 UI 优化

状态：已完成
文件：backend/app/modules/daemon/service.py、backend/app/modules/daemon/tests/test_wave5_integration.py、frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
依据：用户反馈 /workspaces/<id>/agent 页面"输入词元/输出词元"在执行过程中一直停留在"等待用量"（不再像之前 SERVER 模式那样逐步累积）；同时表格宽度溢出被隐藏、数据排序混乱、没有分页。
根因：
1. backend submit_messages 仅在 `content == ""` 时提取 usage（旧 ql-20260616-004 设计假设 daemon 发空 content 的 usage-only message），但 daemon _eventToMessages 实际把 usage 透传到首条带 content 的 message（task-runner.ts:1142-1155），后端永远走不到提取分支。
2. 前端 `<table class="min-w-[1140px]">` 强制最小宽度，外层 overflow-hidden 导致溢出部分被裁剪。
3. 后端按 started_at desc 排序，但 SQLite/Postgres 对 null 处理不一致，前端无兜底；活跃/历史两列都没分页。
结果：
- service.py: submit_messages 对所有 message 都提取 usage（取 max 防御乱序）+ session_id 实时写回（first non-empty）。
- test_wave5_integration.py: 新增 2 个测试（test_submit_messages_extracts_usage_from_content_message / test_submit_messages_usage_takes_max_across_batches），74/74 通过。
- page.tsx:
  (1) 移除 `min-w-[1140px]`，改用 `w-full` + 自适应列宽 + `overflow-x-auto` 仅在表格内滚动。
  (2) 加状态过滤（全部/已完成/失败/已终止）。
  (3) 加分页（10/页）+ 上下文安全的页码 clamp。
  (4) 历史按 finished_at desc（fallback started_at → created_at），活跃按 started_at asc。
  (5) 给 thead 加边框/背景，td 加 padding & whitespace-nowrap 防止错位。
验证：tsc --noEmit 零错误；backend pytest 74/74 通过。

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

## ql-20260616-004-7d2e | 2026-06-16 22:34:00 | Agent Run token 用量实时计算（不再等执行完成）

状态：已完成
文件：sillyhub-daemon/src/adapters/stream-json.ts、sillyhub-daemon/src/task-runner.ts、backend/app/modules/daemon/service.py
依据：用户反馈 Bootstrap 触发的 Agent Run UI 上 "输入词元 / 输出词元" 显示 "等待用量" 直到执行结束才出值。根因：sillyhub-daemon/src/adapters/stream-json.ts:244-250 parseAssistant 每次 assistant 事件累加 _accumulatedUsage 到 adapter 内部状态，但只在 parseResult（最终事件）通过 extractResultStats 输出到 metadata.stats；task-runner.ts:889-917 _eventToMessage 不透传 metadata.usage；backend submit_messages 不知道中间过程 token，只在 completeLease 时一次性更新 AgentRun.input_tokens/output_tokens。
结果：(1) stream-json.ts parseAssistant 累加 _accumulatedUsage 后，在 return events 前给每个 event.metadata.usage 注入 snapshot（深拷贝避免 mutable 污染）。(2) task-runner.ts _eventToMessage 透传 metadata.usage 到 message.usage（typeof object + 非 array 校验 + spread 副本）。(3) backend submit_messages 在循环里提取每条 message.usage 取 max 累积值 latest_input_tokens/latest_output_tokens，agent_run 写回时仅在数值增大时覆盖（防御乱序），让前端 5s 轮询拿到中间过程 token。验证：stream-json + task-runner vitest 79/79 通过；test_wave5_integration.py 16/16 通过；tsc --noEmit 零错误；ruff 通过。backend 镜像重建 + daemon TS 重 build + npm link + sillyhub-daemon start 重启，3 个 runtime（claude/codex/openclaw）全部 online。

## ql-20260616-005-f4a1 | 2026-06-16 23:05:00 | 修复 Bootstrap 实时日志格式退化（1:1 复现老 SERVER 路径渲染）

状态：已完成
文件：sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/tests/task-runner.test.ts、sillyhub-daemon/tests/daemon-parity.test.ts、sillyhub-daemon/tests/task-runner-provider-dispatch.test.ts
依据：用户反馈 Bootstrap 触发的 Agent Run UI 实时日志区"什么玩意"，并给出参考日志 C:\Users\qinyi\Downloads\agent-run-cd83dfff.log，老格式 `[ISO_TS] [channel] [TAG] content`（[ASSISTANT] / [TOOL_USE] Bash: / [TOOL_RESULT] / [SYSTEM:init] / [RESULT:success] 等 TAG）。根因：commit be5448b 删除 SERVER 路径 _format_conversation_log（原 backend/app/modules/agent/adapters/claude_code.py:306-388）后，daemon task-runner.ts _eventToMessage 只产 `{event_type, content: raw_text, tool_name, call_id}` 扁平结构，content 直接是 raw assistant text/tool input JSON，前端 normalize.ts 期待的 [ASSISTANT]/[TOOL_USE] 前缀全部失效。
结果：task-runner.ts 重写 `_eventToMessage` → `_eventToMessages`（1:N 渲染），1:1 复现老 SERVER 路径规则：(1) text + status=running → `[SYSTEM:init] session started` (stdout)；(2) text + thinking → `[THINKING] <preview 2000>` (stdout)；(3) text 其他 → `[ASSISTANT] <content>` (stdout)；(4) text 空 content + 非 system/thinking → 丢弃（保留老空 content 过滤语义）；(5) tool_use → 2 条 message：`[TOOL_USE] Name: <command-or-json>` (stdout) + tool_call channel JSON `{tool, args, timestamp, status:'allowed', success:true}`（前端 parseToolCallContent 解析为 ToolCallCard）；(6) tool_result → `[TOOL_RESULT] <preview 3000>` (stdout)；(7) error → `[LEVEL] <content>` (stderr, 默认 [ERROR])；(8) complete → `[RESULT:success] <text> duration=Xms turns=N` (stdout)；业务字段（session_id/call_id/usage）注入首条 message。task-runner.test.ts 删 3 个旧 _eventToMessage 单测 + 加 10 个新 _eventToMessages 测试覆盖 8 个分支 + 边界；daemon-parity.test.ts 4 测试 + task-runner-provider-dispatch.test.ts 1 测试 同步更新断言为新签名（[ASSISTANT]/[TOOL_USE] 前缀 + tool_use 2 messages + tool_result `[TOOL_RESULT] file.txt\nother.txt`）；FIXTURE_TOOL_USE input 从 `{"cmd":"ls -la"}` 改 `{"command":"ls -la"}` 对齐真实 claude Bash tool。验证：vitest 104/104 通过（stream-json + task-runner + daemon-parity + provider-dispatch）；tsc --noEmit 零错误。其他 baseline failure（agent-detector 3 / cli.test.ts 2 / terminal-observer 1）与本次改动无关。

## ql-20260616-006-7e2b | 2026-06-16 23:24:31 | 系统性修复 daemon-SERVER parity 缺口（cancel/hang/multi-fixes）

状态：已完成
文件：sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/hub-client.ts、sillyhub-daemon/src/config.ts、sillyhub-daemon/tests/task-runner.test.ts、sillyhub-daemon/tests/config.test.ts、sillyhub-daemon/tests/daemon.test.ts、backend/app/modules/daemon/lease_service.py、backend/app/modules/daemon/service.py、backend/app/modules/agent/service.py、backend/app/main.py、backend/app/modules/daemon/tests/test_lease_service.py、backend/app/modules/daemon/tests/test_quick_chat_kill.py、backend/app/modules/daemon/tests/test_wave5_integration.py
依据：用户反馈 daemon 路径多个功能与老 SERVER 不对齐：(1) 终止 agent run 不生效；(2) agent 卡住；(3) 还有其他 SERVER 已有功能缺失。
结果：5 个 parity 缺口定位并修复——
  1. **cancel 链路**：backend cancel_lease 是 WS 桩，daemon 无心跳检测。新增 daemon `_runLeaseHeartbeatLoop`（5s 间隔，可配 `lease_heartbeat_interval`）轮询 leaseHeartbeat 拉取 status；命中 'cancelled' → `syncStatus('killed')` + `this.cancel()` SIGTERM 子进程。
  2. **pending cancel bug**：daemon 从未 claim 的 lease（status='pending'）不会触发心跳检测，agent_run 永久 pending。修复 `cancel_lease` 增 `_mark_agent_run_killed_if_pending` 兜底，pending/no-lease 场景立即把 agent_run 标 killed。
  3. **quick-chat 无 kill endpoint**：原有 `/workspaces/{id}/agent/runs/{id}/kill` 是 workspace-scoped，quick-chat 类型 run（无 workspace 关联）无法 kill。新增 `POST /api/daemon-chat/{run_id}/kill`，复用 `AgentService.kill_run`。
  4. **WS payload snake/camelCase 不匹配**：backend WS 发 `{lease_id, runtime_id, task_id}`（snake），daemon 读 `{leaseId, runtimeId}`（camel），导致全部 task_available 走 `task_no_lease_id` 丢任务。daemon `_handleWsMessage` 入口加归一化层。
  5. **claim response snake/camelCase 不匹配 + cmdPath 永远空**：同上问题，backend `_build_claim_payload` 全 snake_case；daemon 直接 cast 为 LeasePayload 失败。`_runLeaseStateMachine` 重写 execPayload 构造，逐字段做 snake→camel 归一化；同时 daemon 维护 `_agentPaths`（provider → 本机 CLI 路径），spawn 前注入 ctx.cmdPath（server 不知 daemon 本机路径）。
  6. **killed 被 cancelled 覆盖**：daemon cancel 后先 syncStatus('killed') 再 complete_lease(status='cancelled')，后者覆盖前者。`complete_lease` 加终态优先级护栏：killed > failed > cancelled > completed，低优先级不覆盖高优先级。
测试：backend 213/213 通过（新增 6 cancel 测试 + 1 killed 保留测试）；daemon 27/27 + 95/95（task-runner/config/daemon-parity/provider-dispatch）通过。E2E 验证：pending-kill / running-kill / 正常完成 三条链路均跑通。

