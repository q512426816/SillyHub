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

## ql-20260706-005 | 2026-07-06 03:50:00 | init lease 完整链路适配 daemon-entity-binding + 三态展示 bug（续 ql-003 遗留 init_synced_at 未实现）
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/service.py, backend/app/modules/daemon/lease/context.py, backend/app/modules/daemon/lease/service.py, frontend/src/components/workspace-config-card.tsx
依据：ql-003 遗留"init_synced_at 写入路径从未实现"。剥洋葱诊断 init 流程在 daemon-entity-binding + workspace-config-flow 多版本变更后从未端到端跑通，逐层补 6 处接线遗漏：① complete_lease 不写 init_synced_at（lease/service.py，task-07 接线遗漏）；② start_init_dispatch runtime_id.hex None（binding.runtime_id None，daemon-entity-binding 后退化）；③ start_init_dispatch runtime_id 没 resolve 有效值（claim_lease 写 daemon_local_id FK 违约 daemon_runtimes，scan 行因 runtime_id 已有效不触发）；④ lease kind=interactive（daemon 端 init 分支在 batch runLease 探测 mode='init'，interactive 被 interactive handler 拒因缺 session_id/run_id/prompt → interactive_missing_fields）；⑤ build_claim_payload batch 分支要求 agent_run_id（init 不启 agent，422 NO_AGENT_RUN）；⑥ 前端 init 按钮只 platform-managed（repo-native/daemon-client 没入口，DB 实证从未跑过 init lease）。另修三态展示 bug：card 用 componentCount（项目组件数）判断"无扫描文档"是字段误用，DB 实际 1562 ScanDocument 但 componentCount=0（无 projects/*.yaml）误报；改用 specWs.last_synced_at。
修法：① complete_lease 加 init 分支（meta.mode=='init' 回写 WorkspaceMemberRuntime.init_synced_at + spec_version）；② runtime_id.hex None 守卫；③ runtime_id None 时从 daemon_runtimes（daemon_instance_id）resolve claude；④ lease kind 改 'batch'；⑤ build_claim_payload 加 init 分支（构建 daemon _runInitLease 期望的 workspaceId/rootPath/platform_config/latestSpecVersion payload）；⑥ 前端 init 按钮去 strategy==='platform-managed' 限制；⑦ 三态判断改用 specWs.last_synced_at。
测试：端到端——用户点初始化 → init_synced_at 写入 → 前端显示已初始化 + 工作区已就绪。backend 容器无 pytest 靠端到端；前端 workspace-config-card.test.tsx makeSpecWs 默认 last_synced_at 有值 + 无三态断言，改动不破坏。
坑：init bug 链 6 层（每修一层 rebuild 验证暴露下一层），最终手动 git commit + push（b5dda23f）。daemon 端 _runInitLease（task-runner.ts）早已实现，但 backend 多处没按它的契约（kind=batch / mode=init / payload 字段）下发——是 backend 侧的系统性接线遗漏，非 daemon 问题。

## ql-20260706-006-0b32 | 2026-07-06 09:21:14 | daemon-client 模式 change dispatch 静默失败（backend 容器 stat 宿主 root_path 恒失败）
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_service_provider.py, backend/tests/modules/agent/test_work_dir_strategy.py, backend/app/modules/agent/tests/test_start_init_dispatch.py
依据：用户报"变更中心 dispatch 200 OK 但看不到日志"。诊断 backend 日志：`stage_dispatch_failed warning "Workspace root does not exist: C:\Users\qinyi\IdeaProjects\cs\SillyHub"`。DB：workspace.root_path 存 Windows 宿主路径、path_source=daemon-client；该 change 的 agent_runs 0 条（活儿压根没派出去）；绑定 daemon 在线。根因在 resolve_work_dir(service.py:257-262) 直接 `Path(workspace_root).exists()`——daemon-client 模式 root_path 在绑定 daemon 宿主上、backend Linux 容器内不可达，stat 恒 False → 抛 AgentRunError → 被 change dispatch 层 catch 成 warning、HTTP 仍 200、前端无 SSE 日志流可订阅。Workspace.path_source 注释(model.py:64-68)本就声明 daemon-client 的 root_path 在 daemon 上，backend 不该 stat。
修法：① resolve_work_dir 加 path_source kw 参数（默认 None），daemon-client 时跳过本地 stat、路径透传给 daemon 校验，server-local/None 保留校验（向后兼容）；② _get_workspace_root 改返回 (root_path, path_source) tuple；③ _start_stage_dispatch 解包并透传 path_source 给 resolve_work_dir。3 文件 6 处改动。
测试：backend 本地 .venv 跑——直接相关 3 文件 25 passed（含新增 test_resolve_work_dir_daemon_client_skips_stat / _change_path_fallback + 向后兼容 6 旧测试 + test_start_stage_dispatch_transport D1-D7/F1 daemon-client 真实路径不破坏 + test_service_provider mock 改 tuple）；agent+change 全套 536 passed / 7 skipped / 1 FAILED（test_start_init_dispatch::test_start_init_dispatch_creates_spec_workspace_and_lease 期望 lease.kind==interactive 实际 batch——ql-005 b5dda23f 把 init lease kind 改 batch 时漏更新该测试断言，git show 铁证 ql-005 改 service.py 未改此测试，预存债与本变更无关）。
遗留：① test_start_init_dispatch.py:142 断言 interactive→batch（ql-005 遗留测试债，本批次顺带修复，init dispatch 全套 4 passed）；② 端到端部署验证待 rebuild backend 后用户在 UI 重触发 dispatch 确认日志回流。
坑：无。resolve_work_dir 本就是 keyword-only 函数，加带默认值 kw 参数向后兼容；测试侧只需 test_service_provider 一处 mock 的 return_value 改 tuple。

## ql-20260706-007-7f3a | 2026-07-06 10:27:50 | 修复 generate_projects 的 depends_on 聚合作用域 bug（“万物依赖万物”垃圾关系 + 自环）
状态：已完成
关联变更：（无）
文件：backend/app/modules/workspace/service.py（all_relations 移入分组循环体）；backend/tests/modules/workspace/test_generate_projects.py（新建，2 回归测试）
依据：调研 SillyHub /components 页“无子组件”时发现 workspace_relations 表 446 条边全是 depends_on、两端 workspace 全 deleted；读 projects/*.yaml 见每个组件都 depends_on 几乎所有其他组件 + 自环（auth→auth）。根因在 generate_projects（service.py:606-744）：all_relations 声明在 for prefix,members 循环【外】（原 :668），循环内各分组往共享列表 append 依赖（:690-699），写 yaml 时各分组用“累积至今”的全部（:716-725）→ 第 N 分组背上前 N-1 个累积依赖；前面分组塞过 {target:auth} 残留致 auth.yaml 自环。源头 _module-map.yaml 数据干净（backend 28 模块/101 依赖/0 自环，core/models 依赖为空，health→[core] 等合理），垃圾 100% 来自聚合作用域。
结果：service.py 把 all_relations 初始化移入 for 循环体内（每分组独立置空）+ 中文注释。新增 test_generate_projects.py 2 测试：①跨分组不污染（core/models 无依赖、frontend 只依赖 backend、backend 依赖 core/models/auth、auth 依赖 core）②无自环。反向验证：还原 bug 后 2 测试 fail（core.yaml 出现 core/core,auth 自环），改回 pass。tests/modules/workspace/ 全量 96 passed 1 skipped（SQLite FOR UPDATE 限制，无关）零回归。
不含（留给后续乙路变更）：DB 446 条垃圾 relations 清理、36 个 soft-deleted component workspace 清理、components/topology 页改造、reparse 重建。
坑：quick CLI 未自动写 ql 条目（quick-guard.json 无 ql-ID、QUICKLOG 无匹配），手动补 ql-20260706-007 已完成条目；实际生效 QUICKLOG 是源码 .sillyspec/quicklog/QUICKLOG-qinyi.md（git 跟踪），daemon spec 目录那份滞后未同步（平台模式 quicklog 写源码目录是事实）。

## ql-20260706-008-fe27 | 2026-07-06 10:45:11 | daemon 拼 claude permission 含过时 MultiEdit 工具致 cli 2.1.193 启动 exit 1（change dispatch 卡 init 没下文）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/permission-rules.ts, sillyhub-daemon/tests/permission-rules.test.ts
依据：用户报 dispatch 后"init 没下文"。DB agent_run c4574163 status=failed（6 秒），daemon runs/92d3fd65/terminal.log 实证两条独立错误：① done status=failed exit=1 error="Permission deny rule MultiEdit(**) matches no known tool — check for typos"——daemon permission-rules.ts:17 WRITE_TOOLS 含 'MultiEdit'，buildWritePermissionRules 给 claude --settings 生成 deny MultiEdit(**)，但 claude code cli 2.1.193 早无 MultiEdit 工具（早期版本有，现废弃改 Edit 多次），启动校验 deny 规则匹配不到已知工具直接 exit 1；② attempt=1/2 http=529 error=overloaded（inference gateway 127.0.0.1:15721 临时过载，非代码 bug）。terminal.log cmd 完整 settings 实证 deny:["Write(**)","Edit(**)","MultiEdit(**)"]。
修法：permission-rules.ts WRITE_TOOLS 去 MultiEdit 只留 Write/Edit；docstring 注释同步；test permission-rules.test.ts 去 MultiEdit allow/deny 断言。session-manager.ts:981 interactive canUseTool 的 MultiEdit 分支保留（claude 不再调，死代码无害，独立路径不在本次范围）。
测试：sillyhub-daemon vitest 跑 permission-rules(7) + tool-kind(43) + session-manager-allowed-roots(20) 共 70 passed 零回归。
遗留：① API 529 overloaded 是 inference gateway 临时容量问题（非代码），用户重试 dispatch 即可，持续则查 gateway 127.0.0.1:15721 / API quota；② 部署：daemon 改动需 build + 重启本机 daemon 进程才生效；③ session-manager.ts MultiEdit 死代码后续可清理。
坑：诊断要分清两条独立错误——exit=1 的 Permission deny 是致命代码 bug（必现），529 是临时容量（偶发）；claude cli 版本演进废弃工具时，permission settings 生成器要同步。

## ql-20260706-009-a68c | 2026-07-06 11:34:16 | daemon stderr 错误不 forward + backend run failed 不写 error log 致前端看不到 529/失败原因（两端修）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/task-runner.ts, backend/app/modules/daemon/lease/service.py
依据：用户报 dispatch 失败"前端只看 init 没下文，看不到 529"。诊断：claude 的 529 attempt / API Error 输出在 stderr（不进 stdout stream-json）；daemon task-runner.ts:1124 readline 只读 child.stdout，:985-999 child.stderr 只累积 stderrBuf + observer.writeRawStderr 落盘 terminal.log，**不 forward 到 backend**；stderrBuf 仅失败时写入 run.output_redacted（lease/service.py:328）。前端 SSE 只看 agent_run_logs（stdout forward），stderr 完全不可见——DB output_redacted 有 529（用户看不到）+ terminal.log 有（用户看不到）。
修法（两端）：① daemon task-runner.ts:985-999 child.stderr.on('data') for 循环里，每行 fire-and-forget this.client.submitMessages(leaseId, claimToken, ctx.agentRunId, [{event_type:'stderr', content, channel:'stderr'}])，MAX_STDERR_FORWARD=50 防风暴（同 stdout submitMessages 非阻塞策略）；② backend lease/service.py complete_lease failed 路径（output_redacted 写完后）兜底写一条 AgentRunLog(channel='stderr', content=output_redacted) + redis publish log_payload 到 agent_run:{run_id}（复用 run_sync submit_messages 的 payload 格式），前端 SSE 实时收 + DB 持久化（双保险）。leaseId/claimToken 是 runLease 局部变量(:359/:364) stderr 闭包可访问；AgentRunLog id/timestamp 默认(model.py:317/328) 构造只需 run_id/channel/content_redacted。
测试：daemon typecheck(tsc --noEmit) 过 + 全套 vitest 1756 passed/8 skipped 零回归；backend daemon 模块 471 passed 零回归。
遗留：① 端到端部署验证（daemon bundle + backend rebuild + 重启 daemon，用户重触发 dispatch 看 stderr/529 是否回流前端"错误警告"筛）；② daemon 新增 stderr forward 无专门单测（fire-and-forget 简单，靠 typecheck + 全套回归守护），后续可补 mock client 断言。
坑：stderr forward 用 fire-and-forget 不阻塞 readline；防风暴 MAX_STDERR_FORWARD=50（claude stderr 通常 <10 行）；backend 兜底用局部 import（json/get_redis/AgentRunLog）避免改文件顶部 import。

## ql-20260706-010-a076 | 2026-07-06 13:29:41 | daemon fire-and-forget forward 在 claude exit 后丢尾部消息（429 attempt/API Error/最后 tool_result 全丢）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/task-runner.ts
依据：用户报 dispatch 失败"429 attempt 看不到"。诊断 agent_run_logs c76562cd：stdout 1(init)+tool_call 1(Bash)+stderr 3(思考)，0 条含 429/attempt/rate_limit；terminal.log 有完整 10 条 429 attempt + API Error。根因：429 attempt 是 claude stdout api_retry system event，_eventToMessage forward（[SYSTEM:api_retry]）走 fire-and-forget（void submitMessages.catch）；claude 429 重试 10 次后秒退 exit 1，daemon 在 child.exit 后直接收尾（清 watchdog→返回 result），不等在飞 forward HTTP 完成 → 尾部消息（429 attempt + API Error + 最后 tool_result）全丢。前面的 init/tool_use 有时间发完所以能看到。ql-009 的 stderr forward 只覆盖 stderr，429 在 stdout 没覆盖到。
修法：task-runner.ts 6 处改——① runLease 加 pendingForwards: Promise<unknown>[] 收集 forward promise；② stderr forward 由 void .catch 改 pendingForwards.push；③ _handleLine 调用 env 传 pendingForwards 引用；④ _handleLine env 类型加 pendingForwards 字段；⑤ _handleLine submitMessages（resilience + client 两分支）由 void .catch 改 env.pendingForwards.push；⑥ child exit awaited 后加 await Promise.allSettled(pendingForwards)（清 watchdog 前），确保尾部消息发完再返回。
测试：daemon typecheck（tsc --noEmit）过 + 全套 vitest 1756 passed/8 skipped 零回归（stderr forward + submitMessages 改 push 不破坏现有 mock 计数断言）。
遗留：① 端到端部署验证（daemon bundle + backend rebuild + 重启 daemon，用户重触发 dispatch 看 429 attempt 是否回流前端）；② pendingForwards 在 sillyhub-daemon 单测无专门覆盖（靠 typecheck + 全套回归守护）。
坑：pendingForwards 类型 Promise<void>[] 报 TS2345（submitMessages 返回 Promise<unknown>），改 Promise<unknown>[] 过；catch 后的 promise 永远 resolve（allSettled 不 reject，吞掉 forward 失败仅 warn 不阻塞）。

## ql-20260707-001-a3e7 | 2026-07-07 14:20:38 | 修 pytest 2 处失败：allowed_roots PUT version 派生取错对象（bug）+ init lease kind 测试陈旧断言 interactive
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/router.py, backend/app/modules/daemon/tests/test_allowed_roots_policy_push.py, backend/app/modules/workspace/tests/test_router.py, backend/app/modules/agent/service.py
依据：
- 根因1（实现 bug）：router.py:567 PUT allowed-roots version 派生取 instance.updated_at，但 per-runtime 设计下 service update_allowed_roots(runtime/service.py:606-607) 只 bump runtime.allowed_roots + runtime.updated_at 不碰 instance → instance.updated_at 永不递增 → version 不单调（test_put_allowed_roots_version_monotonic_across_writes 必挂）。归档 design 2026-07-06-allowed-roots-per-runtime §3（L88/L148/L199）+ 测试 docstring（L9-10）+ router docstring（L539）均要求 runtime.updated_at；router 代码与自身 docstring 矛盾，笔误 bug。
- 根因2（测试陈旧）：test_init_endpoint_returns_lease（a691e393）断言 lease.kind=='interactive'；b5dda23f8（ql-20260706-005）按 daemon 端约束改 kind='batch'（task-runner.ts:378 init lease 走 batch runLease 探测 mode='init'；daemon.ts:2685 interactive_missing_fields 拒缺 session_id/run_id/prompt 的 init lease）并端到端验证通过，漏改测试 + service docstring。
修法：
- router.py：version 统一 _derive_policy_version(runtime.updated_at)；合并 if/else（roots+version 都从 runtime，daemon_id 路由键仍按 instance.id / 兜底 runtime.id）；更新过时注释。
- test_allowed_roots_policy_push.py：断言 instance.allowed_roots → rt.allowed_roots；更新注释/docstring（L148-150/L204-206）。
- test_init_endpoint_returns_lease：断言 interactive → batch + 更新 docstring/注释。
- service.py start_init_dispatch：同步过时 docstring（interactive → batch）。
测试：4 直测通过（allowed_roots 3 + init 1）；daemon+workspace 模块 633 passed 零回归。未重跑全量（改动局部 + 上次全量 2381 项确认仅此 2 失败均已修 + grep 确认无其他测试依赖 instance.updated_at version 派生 / interactive init kind）。
关联 [[component-readonly-split-change]] 预存 init 债 + [[scan-stage-interactive-dispatch]]。

## ql-20260709-001-7e3a | 2026-07-09 10:36:28 | tool_result 命令输出被硬截断 3000 字符致 scan/构建/测试日志尾部丢失（interactive+batch 双路径 + 前端兜底）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/run_sync/service.py, sillyhub-daemon/src/task-runner.ts, frontend/src/components/agent-log/tool-renderers.tsx, sillyhub-daemon/tests/task-runner.test.ts, backend/app/modules/daemon/tests/test_extract_sdk_attribution.py
依据：用户报 scan(Bash 工具) 实时日志标"输出 (59 行)"但实际只显示到"4. 对比 `C:\U"就断、后面全丢。scan 走 interactive，daemon 透传完整 raw SDK message 不截断，截断点在落库侧：① backend run_sync/service.py:1356 `_extract_sdk_messages` tool_result 分支 `f"[TOOL_RESULT] {text[:3000]}"`；② daemon task-runner.ts:1894 batch 路径 `rawContent.slice(0, 3000)`。旁证 task-runner.ts:1928 result summary 已在 ql-20260626-001 放宽到 50000，但普通命令输出(1894)和 interactive(service.py:1356)仍 3000——之前只修一半。sillyspec scan 59 行含大量长路径行，3000 字符只够前几行，尾部 50+ 行永久丢失。
修法（用户拍板上限 100000 字符 ≈ 2000 行）：① backend interactive 截断 3000→TOOL_RESULT_MAX_CHARS=100000 + 超长追加 `\n...(输出过长，已截断，共 N 字符)` + docstring 注释同步；② daemon batch 同 100000 常量 TOOL_RESULT_PREVIEW_MAX + 标注（两端对齐）；③ 前端 BashToolPreview 加 TOOL_RESULT_DISPLAY_MAX=100000 展示兜底（displayResult 截断+标注，标题行数与正文同源，复制按钮保留完整原文，双保险防 OOM）；④ daemon 截断断言 3000→100000；⑤ backend 新增 2 截断用例。thinking 的 [:2000] 不动（中间推理保留现状）。
测试：backend pytest test_extract_sdk_attribution + test_run_sync_cache_parse 21 passed（含新增 2）零回归；frontend vitest agent-log 63 passed（normalize 37 + tool-kind-meta 7 + agent-log-viewer 19）零回归；daemon vitest task-runner 62 passed（改的截断断言过），另 3 failed（submitMessages 次数：空 stdout / 坏行跳过）经 git stash 验证为预存债（clean baseline 仍 3 failed/62 passed，与本次 tool_result 截断改动无关）。
遗留：① 端到端部署验证（backend rebuild + daemon bundle + 重启 daemon，重跑 scan 看 59 行是否完整回流前端）；② daemon task-runner.test.ts 的 3 个预存 submitMessages 失败建议单独 quick 修（与本次正交）；③ 历史 agent_run_logs 已被 3000 截断的旧数据无法恢复（只影响新 run）。
坑：诊断时"输出(N行)"标题与残缺内容不一致易误判前端 bug，实际截断在后端落库（daemon 透传不截）；interactive(backend)+batch(daemon) 两截断点要一起改否则只修一半；预存测试失败用 git stash 对照 clean baseline 是最快判债手段。关联 [[agent-log-display-fix-change]]（D-008 normalize 治重复/折叠，本次治截断丢失，同一日志回显链路）。

## ql-20260709-002-1b8c | 2026-07-09 11:02:00 | 日志回显链路其余截断点放宽（A 类 8 处源码：命令行/思考/run输出/前端预览，B 类防刷屏保留）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/task-runner.ts, backend/app/modules/daemon/run_sync/service.py, frontend/src/components/agent-log/tool-renderers.tsx, sillyhub-daemon/tests/task-runner.test.ts, backend/app/modules/daemon/tests/test_wave5_integration.py
依据：用户看 ql-001 改动上下文发现 task-runner.ts 还有 MAX_OUTPUT=10000/MAX_ERROR=5000 等一堆字符限制，担心同样砍输出。全面 grep 三端日志链路截断点，分三类：A 类（日志回显、影响体验，该放宽）、B 类（防刷屏/防 OOM，改大反而坏事，保留）、C 类（git/文件读取等无关，不动）。用户拍板 A 类全放宽。
修法（A 类 8 处源码点 + 测试同步）：daemon task-runner.ts MAX_OUTPUT 1万→5万(run最终输出 output_redacted)、thinking preview 2000→2万、[TOOL_USE] 命令行 slice 2000→2万 + 2 docstring；backend service.py thinking [:2000]→[:2万]、[TOOL_USE] stdout_content [:2000]→[:2万]、result_summary 兜底 [:4000]→[:5万] + docstring；前端 tool-renderers.tsx Write content 预览 slice(5千)→(5万)、Agent prompt 预览 slice(3千)→(2万)。发现并补了 daemon thinking 漏改（task-runner.ts:1782，ql-001 只改了 backend:1247）。B 类保留：MAX_STDERR_FORWARD=50行(stderr风暴防淹没)、ECHO_MAX_LEN=2千(单行echo防刷屏)、stderr/SYSTEM/LOG/APPROVAL 单行 5千/2千、prompt[:5000]+MAX_USER_INPUT_CHARS=4000(用户输入上限防粘贴巨量)。
测试：backend 59 passed(test_wave5_integration+extract+run_sync，含改的 thinking 断言) + frontend 63 passed(agent-log 全套) + daemon 62 passed(MAX_OUTPUT/thinking/TOOL_USE/tool_result 4 处改的断言全过)，daemon 3 预存 submitMessages 失败与 ql-001 完全一致(379/734 已知债，stash 验证过)。
遗留：① 端到端部署验证(同 ql-001，rebuild backend+daemon bundle+重启)；② daemon 3 预存 submitMessages 债(同 ql-001，建议单独 quick 修)；③ git status 发现 change-file-tree.tsx/.test.tsx 两个非本次改动的脏文件(linter/其他进程留)，已确认不属本次、未暂存。
坑：grep 截断点要三端全覆盖(thinking 漏改 daemon 1782 是改完 backend 才发现，说明先列清单再动手)；预存测试失败跨 quick 一致(stash 验证一次即可，不必每轮重验)；quick 期间 linter 可能动无关文件(change-file-tree)，step3 git add 只挑本次文件避免误纳入。关联 [[agent-log-display-fix-change]] + ql-20260709-001（同一日志回显链路截断治理系列）。

## ql-20260709-003-a2f5 | 2026-07-09 11:17:00 | thinking 被 [SYSTEM:thinking_tokens] 穿插截断成碎片 + thinking_tokens 默认不显示（前端 normalize 治）
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log/normalize.ts, frontend/src/components/agent-log/__tests__/normalize.test.ts
依据：用户报实时日志里 thinking 思路被多条 [SYSTEM:thinking_tokens] 穿插切成多节碎片(显示效果差，应该一起显示)，且 thinking_tokens(token 估算)意义不大不该显示。根因: interactive 路径 session-manager.ts:2466 主动产 [SYSTEM:thinking_tokens] 发 backend(batch 路径 stream-json adapter :851 早 return null 丢弃, 两路径不一致); 前端 normalize 主循环遇非 thinking-only stdout 行(含 thinking_tokens)即重置 lastThinkingIdx(:504), 把 thinking 合并指针打断 → thinking 被切成多块。D-002@v2 之前是"保留折叠显示", 用户反馈推翻为"默认不显示"。
修法(前端 normalize.ts 最小风险, 不动 daemon 契约): stdout 分支识别 `[SYSTEM:thinking_tokens]` 开头行 → hidden + continue(不重置 lastThinkingIdx), 让 thinking 跨越它连续合并成一段; 普通 [SYSTEM:status] 等仍打断(不影响 normalize.test.ts:111)。同步更新 normalizeLogsImpl 注释(D-002@v2 折叠→ql-003 隐藏)。加 normalize.test.ts 新测试: thinking_tokens 穿插时 thinking 合并 + 自身 hidden。
测试：frontend 64 passed(normalize 38 含新增 1 + tool-kind-meta 7 + agent-log-viewer 19)零回归。
遗留：① 端到端部署验证(前端 rebuild, 重跑 scan 看 thinking 是否连续一段 + 无 thinking_tokens 行); ② 源头 session-manager.ts:2466 interactive 仍产 thinking_tokens(本次前端 hidden 治标, 用户默认看不到但 DB/WS 仍传输), 可选后续源头停产出对齐 batch; ③ 历史 agent_run_logs 里已落库的 thinking_tokens 旧数据前端现已隐藏(只影响展示不影响数据)。
坑：normalize 的 thinking 合并靠 lastThinkingIdx 连续性, 任何"穿插"行(SYSTEM/ASSISTANT/TOOL)都会打断——治"碎片"要么源头不产穿插行, 要么前端让穿插行透明(hidden+不重置); D-002@v2 折叠显示是过度保留(用户不需要 token 估算), 用户反馈是最佳决策来源。关联 ql-20260709-001/002 + [[agent-log-display-fix-change]]（日志回显链路治理系列）。

## ql-20260709-004-f0a1 | 2026-07-09 11:14:00 | 变更详情页变更文件区：html 渲染预览 + 交互反转（默认预览/点编辑才编辑，纯文本统一默认只读源码）
状态：已完成
关联变更：（无）
文件：frontend/src/components/change-file-tree.tsx, frontend/src/components/__tests__/change-file-tree.test.tsx
依据：用户反馈 /workspaces/[id]/changes/[cid] 的"变更文件"区——后端 _TEXT_SUFFIXES(service.py:211) 已含 .html/.htm 故 is_text=true 能编辑源码，但缺渲染预览；且要内容区默认展示预览、点编辑才进文本编辑。AskUserQuestion 确认纯文本(.yaml/.json/.py 等)也统一默认预览(=只读源码)。
修法：① 抽 FilePreview 组件按类型渲染——.md→MarkdownPreview、.html/.htm→iframe srcDoc sandbox(allow-scripts allow-popups，不设 allow-same-origin→iframe 唯一源，脚本能跑但读不到父页面 cookie/storage/DOM，安全)、其他纯文本→只读 <pre> 源码；② 新增 mode state(preview|edit) 默认 preview，handleSelect 每次选文件重置 preview；③ 工具条 preview 模式只显「编辑」按钮，edit 模式显「预览/放弃修改/保存」；④ 模式切换保留 content+dirty 不丢改动，预览用最新 content 渲染(含未保存改动)；⑤ 删除旧 textarea 下方折叠预览面板。
测试：change-file-tree.test.tsx 重写 6 用例（默认预览+点编辑保存 / pending 徽标 / html iframe sandbox+srcdoc 断言 / 纯文本只读源码+点编辑 / 编辑↔预览切换保留改动 / 文件树渲染），6 passed。
遗留：端到端部署验证（rebuild frontend 镜像后人工确认 iframe 真实渲染，jsdom 不实际渲染网页）。
坑：多并行 quick 会话共享 .runtime/sillyspec.db 的 quick 阶段状态（quick-guard.json 不存在），本会话启动时继承了 ql-002(日志截断)会话遗留的 step1，致本改动未建独立 ql 且被 ql-002 遗留③误判为"无关脏文件"；手动补建 ql-004 认领。






