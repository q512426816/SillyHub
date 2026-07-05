---
author: qinyi
created_at: 2026-07-05 16:33:00
---

# SillySpec Quick Log

> 上一轮（2026-06-19 ~ 2026-07-05，310 行）已归档到 `QUICKLOG-qinyi-2026-07-05.md`。
> 新记录从此处继续。命名约定：`## ql-YYYYMMDD-NNN-xxxx | <本地时间> | <一句话摘要>`。

## ql-20260705-001-7c4a | 2026-07-05 17:04:05 | 修 backend token 守卫治 input_tokens 永久 NULL（Claude cache 全命中 input=0 被 >0 守卫误杀）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/run_sync/service.py, backend/tests/modules/daemon/run_sync/
依据：daemon 四处字段对齐（stream-json.ts:1092 extractResultStats / daemon.ts:1315 onTurnResult / hub-client.ts:570 / backend _METADATA_FIELDS）均用 typeof/undefined 守卫不要求 >0；close_interactive_run:777 已用 is not None 正确；唯一病根是 submit_messages:337-348 的 >0 守卫。max 累积本身防御中间事件 0/0（0 不拉低已有值），去掉 >0 不引入回归。
修法：4 个守卫去掉 `and int(...) > 0`，保留 isinstance + max 累积；更新注释 225-228 说明 cache 全命中 input=0 合法。
测试：加 cache 全命中场景（input=0 + cache_read>0），断言 input_tokens 落 0 而非 NULL。

## ql-20260705-002-b8e1 | 2026-07-05 17:30:00 | 修前端 tool_kind 筛选守卫过严 + plan/ask/schedule 无按钮命中（C1+C2）
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log-viewer.tsx, frontend/src/components/__tests__/agent-log-viewer-tool-kind.test.tsx
依据：agent-log-viewer.tsx:712 守卫 `p.log.tool_kind != null && activeToolKindFilters.has(p.log.tool_kind)` 致 tool_kind=null 的 tool_call 行在第二层 active 时被隐藏（C1）；toolKindFilters(770-782) 只列 11 个、14 枚举漏 plan/ask/schedule，注释声称"归其他"但选中"其他"时只匹配 tool_kind==='other'，plan/ask/schedule 行不命中（C2）。
修法：守卫改为"其他桶"逻辑——定义 OTHER_BUCKET={plan,ask,schedule,other}，选中"其他"时 null + OTHER_BUCKET 都匹配；选中具体类型时 null 不显示（合理）。
测试：加用例——null/plan 在选中"其他"时显示；null 在选中"命令行"时不显示。

## ql-20260705-003-c2d9 | 2026-07-05 17:45:00 | 减小 turn 卡片密度治 98 turn 大量空白（B）
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log-viewer.tsx
依据：TurnBlock(540-615) 每个 turn 是 rounded-md border 卡片 + 头部 py-1.5 + 容器 space-y-2 p-2，98 turn 累积大量垂直空白（用户扫描 run 痛点：日志区"很多空白"）。
修法（用户 AskUserQuestion 选"减小卡片密度"）：去 turn 外边框（rounded-md border）改 border-b divider；头部 py-1.5→py-1；容器 space-y-2 p-2→space-y-0 p-1。不折叠内容，零交互风险。
测试：现有 agent-log-viewer 36 测试不回归（内容渲染不变，仅 class 调整）。

## ql-20260705-004-d73f | 2026-07-05 17:55:00 | 筛选标签加 count 数字（C6 增强）
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log-viewer.tsx, frontend/src/components/__tests__/agent-log-viewer-tool-kind.test.tsx
依据：用户抱怨侧栏标签"数据缺失没正确展示"——实际是按钮从不渲染 count（设计如此），用户期望看到每类日志数量。第一层 10 个 semantic 标签 + 第二层 11 个 tool_kind 标签都加计数。
修法：useMemo 算 semanticCounts（按 semanticCategory）+ toolKindCounts（tool_call 行按 tool_kind，其他桶=null+plan/ask/schedule+other 与 ql-002 守卫一致）；count>0 时 label 后显示灰色数字。
测试：加用例验证 count 数字渲染（如 3 条 bash tool_call → 命令行按钮显示 3）。

## ql-20260705-005-e5a2 | 2026-07-05 17:50:00 | 前端输入词元合并 cache_read 治标签对应不上（C4）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
依据：A(ql-001) 修 backend 让 input_tokens=0（Claude cache 全命中）能正确写入，但前端 page.tsx:708 守卫 `input_tokens > 0` 致 0 仍显示"执行中…"，与 output 数字不对称（用户"标签对应不上"抱怨的最后一环）。
修法：输入词元显示 input_tokens + cache_read_tokens 合并（总输入 token），total>0 显示数字否则 pendingMetric。cache 全命中时显示 cache_read 大数（直观，符合用户"总输入"直觉）。底部徽标仍分开显示 ↓input / ⚡cache_read 细节，互补。
测试：page.tsx 是 Next.js page 无直接单测；验证靠 typecheck + 部署后 curl/UI 手动看。

## ql-20260705-006-a1b7 | 2026-07-05 18:05:00 | classify 改主命令判定治 sillyspec 误归（C3 两端同步）
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/tool_kind.py, sillyhub-daemon/src/tool-kind.ts, backend/tests/modules/agent/test_tool_kind.py, sillyhub-daemon/tests/tool-kind.test.ts
依据：DB 实测 run be48ad3a 的 41 条 sillyspec 里 34 条（83%）是误归——都是 `python -c "..."` 生成 sillyspec 文档，脚本内容含 sillyspec 字样被 D-001"command 含子串即标"逻辑误判。D-001 基于"误标成本低"假设，实际误标率 83% 太高。
修法（推翻 D-001 子串语义，改主命令判定）：command 任一段（&&/;/|）的主命令是 sillyspec 才归 sillyspec；覆盖直接调用 + pnpm/npx/yarn/sudo/node 包装 + 复合命令。脚本内容/grep/cat 含 sillyspec 字样的不再误归。两端 PY+TS 同步 + 测试同步。
测试：改 SHARED_CASES + test_sillyspec_substring_semantics（cat sillyspec-note.md 从 sillyspec 改 bash）；加 python/grep 误归排除用例。

## ql-20260705-007-9f3c | 2026-07-05 18:55:00 | classifyLog 区分 tool_kind=ask 让 AskUserQuestion 进提问审批（C7）
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log/normalize.ts, frontend/src/components/__tests__/agent-log-viewer.test.tsx
依据：DB 实测 run 254e5e2a 的 AskUserQuestion 有记录（tool_call | ask | 2 条），但前端 normalize.classifyLog(channel, content) 不接收 tool_kind，所有 tool_call 一律归 tool_call semanticCategory。"提问审批"按钮筛 ask semanticCategory（只匹配 pending_input channel）→ AskUserQuestion 看不到（被归工具调用）。
修法：classifyLog 加 tool_kind 参数，tool_call + tool_kind=ask → ask semanticCategory（其他 tool_kind 仍归 tool_call）。AskUserQuestion 进提问审批，pending_input 也在提问审批。
测试：加用例 AskUserQuestion（tool_call + tool_kind=ask）→ 提问审批筛选可见。

## ql-20260705-008-4e2a | 2026-07-05 21:50:00 | 心跳/register 回填 PolicyCache 治写拦截 fail-closed deny（C8）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/daemon.ts
依据：Agent 调查——interactive scan run 写 spec 目录被拦（agent 自述"Runtime Policy 未配置"=CAUSE_POLICY_NOT_LOADED 逐字）。根因：cli.ts 注入 policyEngine 但 _syncAllowedRoots(1779-1795) 只写 config.allowed_roots，漏写 _policyCache；register(902-922) 也没回填。PolicyCache 唯一写入是 WS POLICY_UPDATE（未触发）→ PolicyEngine.canWrite cache miss → fail-closed deny。注释 1800-1802 承诺心跳回填 PolicyCache 但实现脱节。DB allowed_roots=[~/.sillyhub, C:\Users\qinyi\.sillyhub] 配置正确，问题是没进 PolicyCache。
修法：加 _syncPolicyCache(roots) helper（null 守卫 + 对每个 _registeredRuntimes values 调 _policyCache.set）；_syncAllowedRoots 末尾 + register 末尾都调 _syncPolicyCache（关闭启动窗口）。
测试：daemon vitest 加用例心跳/register 后 PolicyCache.get(rid) 非空。

## ql-20260706-001-a3f7 | 2026-07-06 02:32:59 | scan dispatch 失败路径去 rollback + provider 兜底改 claude 治 scan-generate 500（续 scan-generate-failure-chain，注释原误标 ql-20260705-005 撞前端词元修复，已改 ql-20260706-001）
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/service.py, backend/tests/modules/agent/test_scan_interactive_dispatch.py
依据：scan-generate 500 链（见 memory scan-generate-failure-chain）——d16e13c7 在 NoOnlineDaemonError 分支引入 rollback，但 prepare_scan_interactive_dispatch 抛 NoOnlineDaemonError 前（placement.py:489）无任何 DB 写（lease INSERT 在 :540 之后），事务里只有本函数上方 add+flush 的 AgentSession/AgentRun；rollback 把 AgentSession 冲掉，_mark_no_online_daemon 随后 commit 插 agent_runs 时 agent_session_id 外键违约（agent_runs_agent_session_id_fkey）→ 500。同函数 scan_provider 兜底误用 "claude_code"（那是 agent_type，daemon 实际 provider 是 claude/codex/...，daemon 上永不启用），default_agent=NULL 的 daemon-client scan-generate 新工作区 dispatch 永远匹配不到 daemon → NoOnlineDaemonError。AgentSession.provider NOT NULL（model.py:418），不能传 None。
修法：scan_provider 兜底改 "claude"（合法 provider 通行默认值，DB default_agent='claude' 工作区均成功）；NoOnlineDaemonError 分支删 rollback，保留 session+run 仅标 failed 由 _mark_no_online_daemon 整体提交。
测试：加 2 个回归——(1) 失败路径 mock_session.rollback.assert_not_called()；(2) default_agent=NULL 且不传 provider 时 dispatch provider=="claude" 且 AgentSession.provider=="claude"。agent 模块全量 190 passed / 6 skipped 零回归。
中断续作：本条更早一轮会话已写完代码+测试但未 commit/未记 quicklog 即中断（注释误标 ql-20260705-005），本轮收尾提交。

## ql-20260706-002-b5e8 | 2026-07-06 02:41:07 | tool_result 继承 tool_use 的 tool_kind 治命令输出在 SillySpec 筛选消失（续 d751a871）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/run_sync/service.py, backend/tests/modules/agent/test_agent_run_log_tool_kind.py
依据：d751a871 诊断——run be48ad3a 的 sillyspec 命令输出（✅ Step 1/11 … 共 10 条步骤进度）没打 tool_kind=sillyspec，只有命令调用打标。前端第二层 SillySpec 筛选把 10 条步骤进度全排除（用户"步骤只显示1个"抱怨根因）。病根：_extract_sdk_messages 的 tool_result 分支直接把命令输出落成 [TOOL_RESULT] stdout 行，既没 classify 也未继承配对 tool_use 的 tool_kind。难点：Anthropic 协议里 tool_use 在 assistant message、tool_result 在下一轮 user message，两条 SDK message 单次 _extract_sdk_messages 拿不到对应关系。
修法（纯 backend，daemon 无需改动）：(1) _extract_sdk_messages tool_use 分支 tool_call JSON flat record 顶层挂 tool_use_id（原仅在 tc_payload JSON 内）；(2) tool_result 分支从 block 自带 tool_use_id（Anthropic API 标准）提取挂 flat record 顶层；(3) submit_messages 循环维护 session 级 tool_use_id→tool_kind 缓存，tool_use 行登记、tool_result 行按 id 回查补 tool_kind。SDK 消息顺序恒 assistant→user 保证缓存先填后查；跨调用缺失 / 旧 daemon 缺 id 时保持 None（兼容不报错）。
测试：加 4 个用例——tool_result 提取 tool_use_id；tool_use tool_call 行顶层带 tool_use_id；端到端继承（tool_use+tool_result 同批→[TOOL_RESULT] 行落库 tool_kind=sillyspec + published_logs 透传）；缓存缺失兼容（孤立 tool_result 保持 None）。tool_kind 文件 19 passed；agent+daemon 全量 258 passed 零回归；ruff format + mypy 全过。
续作说明：本条续 d751a871 会话——上轮 sillyspec quick 走到 Step2 读代码阶段中断、无实现产出，本轮照其方案直接实现 + 测试 + 提交。

## ql-20260706-004-7c4a | 2026-07-06 03:30:53 | 变更详情页两个数据显示 bug——智能体执行日志串台 scan run + 变更文件结构树空（change.path 多 .sillyspec 前缀）
状态：已完成
关联变更：（无）
文件：backend/app/modules/change/router.py, backend/app/modules/change/parser.py, backend/tests/modules/change/test_dispatch.py, backend/tests/modules/change/test_parser.py
依据：DB + 容器双向核实。(1) 日志串台：归档变更 stages.last_dispatch 全空（DB 实测 5 条均空）触发 router.get_agent_status(L561-590)/manual_dispatch(L647-677) 的 fallback，fallback 仅 WHERE workspace_id ORDER BY started_at 取最近 AgentRun，未按 change_id 过滤；8 条 AgentRun.change_id 全 NULL（含 SillyHub scan run 254e5e2a，日志首条"请对项目目录…执行 sillyspec scan"），fallback 顶数把它当变更日志返回。AgentRun.change_id 列实存（model.py:166，带索引 ix_agent_runs_change_id），dispatch.py has_active_run(L348/374/463/513) 已按 change_id 过滤，fallback 本应一致却漏。(2) 文件树空：parser.py L93/112/141 三处 rel_prefix 硬编码 ".sillyspec/changes/..." 无视 platform_managed；daemon-client 平台镜像 spec_root 是扁平结构（changes/docs/knowledge 在根，无 .sillyspec 包裹层），change.path 被存成带 .sillyspec 前缀，_resolve_change_dir(spec_root/change.path) 拼出不存在路径，list_files 命中 is_dir()==False 返回空。容器实证 /data/spec-workspaces/ac52b5e7.../changes/archive/2026-07-05-workspace-config-card/ 下 proposal.md/design.md/plan.md/tasks.md 全套文件齐全，但 .sillyspec/ 子目录根本不存在。reparse(L996-999) 已正确传 platform_managed=is_daemon_client_path_source 给 parse_workspace，parser 内部 rel_prefix 却没用该标志。
修法：(1) router.py 两处 fallback 的 select 加 .where(AgentRun.change_id == change_id)，查不到则 last_dispatch 保持 None（前端不渲染日志面板），删掉 workspace 级回退（正是串台源）；(2) parser.py parse_workspace 按 platform_managed 算前缀（prefix = "" if platform_managed else ".sillyspec/"），三处 rel_prefix 改用前缀拼接；修完触发一次 reparse 刷新现有错误 change.path。
测试：test_dispatch.py 加 fallback 按 change_id 过滤用例（构造它变更的 run 不被本变更取到）；test_parser.py 加 platform_managed=True 扁平 rel_prefix 不带 .sillyspec 用例 + 包裹布局对照用例。实测 change 模块全量 124 passed + 2 skipped（propose stage 移除，正常 skip）零回归；test_parser 17 passed（新 2）；test_dispatch 28 passed（新 1）；ruff check + ruff format + mypy 全过。
部署：Bug2 需重建 backend 容器后触发一次 reparse（或 scan）刷新现有 change.path——当前生产 DB 所有归档 change.path 仍带错误 .sillyspec 前缀，reparse 后扁平工作区会刷新成 changes/... 直达真实目录。

## ql-20260706-003 | 2026-07-06 03:10:00 | spec 工作区导入(import)链路 4 处治 get_spec_bundle 导入必断（WS 1009 + tz 笔误 + SSE keepalive + close code 日志）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/router.py, backend/app/modules/spec_workspace/service.py, deploy/docker-compose.yml
依据：用户报 import "daemon disconnected mid-rpc"。加 backend WS close code 日志后抓到 close=1009 "frame exceeds limit of 16777216 bytes"——daemon get_spec_bundle 把 spec 目录（16MB/1545 文件）tar+base64 单帧回传，base64 膨胀 ~33% 达 21MB 超 uvicorn 默认 ws_max_size=16MiB，backend 主动断 WS（非网络 idle，keepalive 修复无效）。临时调 --ws-max-size 100MB 后暴露 service.py:719/723 datetime.min.replace(tz=UTC) 笔误（应 tzinfo=，同文件 718/722 正确，复制粘贴漏改），source_mtime=None 命中即 TypeError。再修后又暴露 import SSE applying/reparsing_docs/reparsing_changes 三阶段直接 await 慢函数（_write_spec_root 写 1545 文件 + _reparse_phase），SSE 静默超 Next.js rewrite 代理 undici bodyTimeout 被砍（CancelledError），前端"导入卡住"。packing 段有 keepalive（387-400）这三阶段 design 漏。
修法：① router.py WebSocketDisconnect as exc 补记 code=getattr(exc,'code')/reason；② service.py:719/723 tz=→tzinfo=；③ 三阶段包 asyncio.ensure_future+5s 周期 yield ': keepalive'（与 packing 同模式）；④ docker-compose --ws-max-size 104857600（100MB）兜底。
测试：端到端——用户触发 import 同步成功（无 1009/无 TypeError/无 CancelledError）。backend 容器 production 镜像无 pytest，靠端到端；现有 test_import.py 断言事件名（packing/packed/applying/done）keepalive 改动保持不变不破坏。
遗留：gzip 治本（daemon 压缩+backend gunzip）超 quick 范围作后续独立变更。另发现 init_synced_at 写入路径（workspace-config-flow task-07 init-lease complete）从未实现，前端"接入初始化状态"永远未初始化——独立接线遗漏，需单独排查。
坑：sillyspec --done step 2 自动 commit ql-003(59a53833) 但 baseline 边界排除 keepalive（service.py[tz=] 进 commit，keepalive 留工作区），单独 commit 37ccc3ee 补"ql-003 补"。






