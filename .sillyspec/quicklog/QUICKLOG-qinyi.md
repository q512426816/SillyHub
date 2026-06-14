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
