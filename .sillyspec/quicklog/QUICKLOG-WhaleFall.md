
## ql-20260818-003-14d3 | 2026-08-18 09:52:53 | 切档案后人格实际不生效
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：切档案后人格实际不生效。
根因：SDK systemPrompt 选项 resume 时被 CLI 忽略（jsonl 固化，人格热切换从未生效过）；另有等值+空 prompt 落普通 inject 致 run 卡 pending 堵死会话。
方案：带人格 reload 走 forkSession=true（fork 新会话使 system prompt 生效+历史复制）；forkedInitPending 标记让 init 新 session_id 更新 state；driver 透传 forkSession/extraArgs；后端等值+空 prompt 409 拒绝；reload 吞错补日志。
结果：E2E 实证模型自报「当前会话角色：智能体档案设计师」；daemon 21+43 用例过、全量 2364（2 失败=既有基线+抖动）；后端 802 过。backend+daemon 已在运行环境生效，待 commit+push。

## ql-20260818-008-637c | 2026-08-18 13:40:32 | 档案可切不可取消
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：档案可切不可取消，不对称。
根因：inject 契约仅非空 agent_profile_id，「不指定」纯展示。
方案：空串=取消（与供应商对称）——后端取消分支（列/run NULL+快照 None+metadata 三键删+空载荷）；daemon 空提示词归一 null（preset-only 无人格）+档案切换（含取消）fork；前端「不指定（无人格）」可点。
结果：后端 804/daemon 43/前端 1613 全绿；E2E 取消后模型自报无人格。backend+daemon 已部署，待 commit+push+rebuild frontend。

## ql-20260818-010-90db | 2026-08-18 22:47:48 | 左侧会话列表加单条删除和批量删除
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/sessions/page.tsx, frontend/src/components/sessions/session-list-panel.tsx
需求：左侧会话列表加单条删除和批量删除。
根因：纯新增，后端 DELETE /sessions/{id} 软删端点已有，纯前端 UI。
方案：SessionListPanel 加批量管理模式（批量管理按钮→条目变勾选框→全选/删除选中）+ hover 单条删除按钮；page.tsx onDeleteSessions 回调调 deleteAgentSession 软删后 invalidate 列表+清选中态。
结果：列表组件 13 用例全过，前端全量 1632 全绿，eslint 0 error。待 commit+push+rebuild frontend。

## ql-20260819-001-b742 | 2026-08-19 16:35:01 | 会话列表和面板头部增加工作区信息显示
状态：已完成
关联变更：2026-08-19-sessions-workspace-selector
文件：
- frontend/src/components/sessions/session-list-panel.tsx（新增 workspaceIdToName map + 工作区 Tag chip）
- frontend/src/app/(dashboard)/sessions/page.tsx（新增 workspaceName 派生 + 头部工作区显示）
需求：会话列表和面板头部增加工作区信息显示。
根因：workspace-session-selector 变更已为新建会话增加了工作区选择器，但已有会话列表和会话面板未展示工作区归属。
方案：session-list-panel.tsx 左栏 chips 区新增工作区 Tag（workspace_id 解析名称）；sessions/page.tsx 右栏面板头部 badge 区显示工作区名称。两个组件通过 listWorkspaces() 获取工作区列表做 id→name 映射。
结果：tsc 类型检查通过（仅 file-preview 预存错误），lint 通过（无新增 warning），162 测试通过（2 预存失败与本次无关）。

## ql-20260819-002-9167 | 2026-08-19 21:18:43 | /sessions 页移除「结束会话」按钮及前端逻辑
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/sessions/page.tsx（删除结束会话按钮与 handleEnd/endDisabled 及相关导入）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（断言翻转 结束会话按钮不存在）
- .sillyspec/docs/SillyHub/modules/frontend_app.md（变更索引追加 ql 条目）
需求：/sessions 页移除「结束会话」按钮及前端逻辑
根因：用户要求去掉手动结束入口（误操作终结会话不可逆），会话仍可自然结束且 runtimes 弹窗保留该功能
方案：page.tsx 删除结束会话 Button/handleEnd/endDisabled 及 Square、endSession 导入（已结束横幅与重新开启保留），page.test.tsx 断言由存在翻转为不存在
结果：tsc 零错误 + sessions page 测试 11/11 全绿，已 git add 暂存三文件

## ql-20260820-006-9e18 | 2026-08-20 09:40:49 | /sessions 已成智能体会话新入口（会话级选供应商）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/llm-providers/llm-provider-list.tsx（删启动/停止按钮、handlers、已启动徽标、默认行高亮、Power 导入；说明文案改会话级选择）
- frontend/src/components/llm-providers/llm-provider-form.tsx（删「保存后立即启动」勾选框与 isDefault 状态、提交值 is_default）
- frontend/src/lib/api/llm-providers.ts（删 setDefaultProvider/unsetDefaultProvider/SetDefaultResult/components 导入；表单值与 Create/Update 删 is_default）
- frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx（删 set-default 三个 toast 用例与两 openai 启动用例；新增「无启动/停止按钮」回归断言）
- frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx（删 values.is_default 两处断言）
- frontend/src/lib/api/__tests__/llm-providers.test.ts（删 set/unset-default 两个 API 用例与 is_default 断言/固件字段）
- .sillyspec/docs/SillyHub/modules/frontend_app.md（变更索引追加 ql 条目）
需求：/sessions 已成智能体会话新入口（会话级选供应商），「我的供应商」页的启动/停止（set-default）状态不再被依赖，要求去掉该页启动相关功能
根因：供应商生效方式已从「全局启动/停止互斥（is_default）」转为 /sessions 会话级选择（session_llm_provider_id），设置页启动入口冗余且误导
方案：llm-provider-list.tsx 删启动/停止按钮、handleSetDefault/handleUnsetDefault、已启动徽标与默认行高亮、说明文案改会话级选择；llm-provider-form.tsx 删「保存后立即启动」勾选框与 isDefault 状态；lib/api/llm-providers.ts 删 setDefaultProvider/unsetDefaultProvider/SetDefaultResult/表单值与 Create/Update 的 is_default 字段（后端 Create 缺省 False、PATCH 不传不动，行为安全）；测试同步删 set-default 用例并新增「无启动/停止按钮」回归断言
结果：tsc 零错误、前端全量 166 文件 1763 测试全绿、eslint 无新增 warning（form.tsx values 为 HEAD 预存）；后端 set-default/unset-default 端点保留（LiteLLM 注册与 lease 默认回退链仍依赖，待独立变更清理）

## ql-20260820-007-0cda | 2026-08-20 10:22:16 | /sessions 会话运行中却显示「第 1 轮 · 已完成」、TurnStatusBar（执行中|工具 N）不渲染
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/sessions/page.tsx（新增 currentRunIdRef 镜像 detail.current_run_id；历史 logs 装回时重放 attach 修正；upsertTurn log 分支终态自愈翻 running）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（新增两顺序竞态回归用例：detail先到/logs后到装回重放修正+状态条恢复；logs先到/detail后到 effect 兜底）
- .sillyspec/docs/SillyHub/modules/frontend_app.md（变更索引追加 ql 条目）
需求：/sessions 会话运行中却显示「第 1 轮 · 已完成」、TurnStatusBar（执行中|工具 N）不渲染，多次刷新有概率正常
根因：attach 恢复时序竞态——logsToTurns 把历史轮一律标 completed，唯一修正在 detail.current_run_id 到达的 effect（page.tsx），其 currentRunId 守卫一次性短路：detail 先到时对空 turns 扫空只记 currentRunId，历史 logs 后到装回全 completed，effect 不重跑（deps=[session]），轮永久卡「已完成」；SSE log 分支只追加内容不修状态。刷新时序抽奖故有概率正常。
方案：page.tsx 三处——①新增 currentRunIdRef 镜像最新 detail.current_run_id（含 active 判定与 ?? null 归一，sessionId 切换清空）；②历史 logs 装回时按 ref 重放同一修正（realRunId 命中且 completed→running），两种到达顺序结果一致；③upsertTurn log 分支自愈：prev.currentRunId===run_id 且 apply 后仍终态→翻回 running（真完成 run 的 currentRunId 已被 onTurnCompleted 清空，不误翻）。测试补 detail先到/logs后到 与 logs先到/detail后到 两顺序回归用例（可控 Promise 控序，打断按钮启用锚定 detail 已生效）。
结果：sessions 页测试 13/13 全绿（含 2 新增竞态用例）；前端全量 166 文件 1765 测试全绿；tsc 零错误；eslint 改动文件干净。已 git add 暂存三文件

## ql-20260820-008-f5c3 | 2026-08-20 11:07:02 | /sessions 会话流里 Grep/Glob 等工具卡片显示半截 JSON
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-assembler.ts（extractPrimaryArg 通用兜底链补 pattern??query??url）
- frontend/src/components/daemon/turn-timeline.tsx（parseToolRaw 第二份副本同步补 pattern 系键）
- frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（新增主参数提取 describe 四用例）
需求：/sessions 会话流里 Grep/Glob 等工具卡片显示半截 JSON
根因：extractPrimaryArg 通用兜底链缺 pattern/query/url；turn-timeline parseToolRaw 第二份副本同缺
方案：两处通用兜底链同步补 pattern??query??url；新增 4 用例
结果：装配器 35/35 + 段视图 33 全绿；已 git add 暂存三文件

## ql-20260820-009-ee9d | 2026-08-20 11:15:11 | /sessions 会话直播视图断连后永久卡死（缺内容/卡运行中
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/daemon.ts（streamSession 重构：fetchSse 连接可变句柄 + onerror 指数退避重连；resyncAndReconnect 三段式恢复——运行中 run 合成 turn_started/logs 全量回放/终态 run 合成 turn_completed；订阅后 5s 延迟复核；token 每次重连现取；session_ended 置 closed 停止重连）
- frontend/src/lib/__tests__/daemon-session.test.ts（FakeSseStream 补 close；新增路由 fetch mock 与重连 describe 四用例）
需求：/sessions 会话直播视图断连后永久卡死（缺内容/卡运行中，重进才恢复）
根因：SSE 链路三层缺口叠加——backend Redis Pub/Sub 无补发、fetch-sse 有意不自动重连、streamSession onerror 为空且调用方无兜底
方案：streamSession 内建重连——onerror 指数退避；resync：runs 快照→运行中 run 合成 turn_started→logs 全量回放（调用方去重）→终态 run 合成 turn_completed→重建 SSE（token 现取）；订阅后 5s 延迟复核；close/session_ended 停止重连；页面零改动
结果：daemon-session 23/23 全绿（含 4 新增）；全量 1773 测试全绿；tsc 零错误；eslint 无新增。已 git add 暂存两文件

## ql-20260820-010-2223 | 2026-08-20 12:08:14 | 直播中 turn_completed 与 token 实时到达但最终答复文本不渲染
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/daemon.ts（dispatch turn_completed 分支挂 schedulePostTurnReconcile：1.5s 后 replayLogsFromDb 回放；提取 replayLogsFromDb 与 009 断连恢复共用；close 清 postTurnTimer）
- frontend/src/lib/__tests__/daemon-session.test.ts（新增轮后对账用例：连接未断补回丢失文本、无重连无重复合成 turn 事件）
需求：直播中 turn_completed 与 token 实时到达但最终答复文本不渲染，重进才显示
根因：submit_messages 两段式（commit 后才 publish）且 publish 吞错——发布丢失时 DB 有真相、订阅者永不可见；009 重连只覆盖断连不覆盖发布丢失
方案：turn_completed 后 1.5s 重拉日志回放（replayLogsFromDb 与 009 同源）；终态轮收 log 幂等 + seenLogIds 去重
结果：daemon-session 24/24 全绿（新增对账用例）；全量 1774 全绿；tsc 零错误。已暂存

## ql-20260820-011-f230 | 2026-08-20 13:45:32 | 长文本回复直播视图消失（短文本正常、重进正常）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-assembler.ts（text/thinking 段携带派生源 segId（仅 partial 带键）；appendStreamText merge 按派生源对齐——完整行只 merge 进普通段、partial 只续接同源派生段）
- frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（新增隔离 describe 3 用例；streaming 置位两个既有用例期望随行为变更同步）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（010 页面级对账回放用例，随 011 一并暂存）
需求：长文本回复直播视图消失（短文本正常、重进正常）
根因：daemon 完整 assistant message 先转发、override 撤回信号后异步 emit；装配器无 segmentId 的完整行 merge 进 partial 派生段，override 按 segmentId 连坐撤回把全文一并移除
方案：text/thinking 段携带派生源 segId（仅 partial 带键）；merge 按派生源对齐——完整行只 merge 进普通段、partial 只续接同源派生段，完整行独立成段不被连坐
结果：装配器 38/38、全量 166 文件 1777 测试全绿；tsc 零错误；部署后浏览器 E2E 复验长回复完整渲染 ✓。已暂存

## ql-20260821-001-9238 | 2026-08-21 08:41:39 | 会话 reopen 409 NO_AGENT_SESSION——resume key 列生产链路从未写入的双修
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/run_sync/service.py（ql-20260821-001 回填点在 latest_session_id 写 run 之后）
- backend/app/modules/daemon/session/service.py（_heal_agent_session_id_from_runs 新增 + reopen 前置检查改兜底）
- backend/app/modules/daemon/tests/test_session_reopen_resume_key.py（新增 4 用例）
需求：会话 reopen 409 NO_AGENT_SESSION——resume key 列生产链路从未写入的双修
根因：SDK session id 只落 run 级列 AgentRun.session_id（消息流写入），session 级列 AgentSession.agent_session_id 恒 NULL，reopen 前置检查必拒；旧测试夹具直接写列掩盖缺口
方案：submit_messages 定向 UPDATE 回填 session 级列（防并发终态互踩 + fork last-write-wins）；reopen_session 经 _heal_agent_session_id_from_runs 从最新非空 run session_id 兜底治愈存量会话，无 id 才 409（文案中文化）
结果：新增 4 用例全过；相邻回归 138 过 + submit_messages 相关 62 过；ruff check 过；session/service.py format 差异系 2026-08-20 既有遗留未触碰

## ql-20260821-002-cb75 | 2026-08-21 10:54:07 | 发送带附件消息自己气泡缺 chips
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/sessions/page.tsx（pendingAttachments 状态改 AttachmentRead[]；handleSend 合成标记行 displayPrompt 进占位轮；handleResend 剥离标记行）
- frontend/src/components/daemon/session-input-bar.tsx（onAttachmentsChange 回传完整对象）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（接线契约用例）
需求：发送带附件消息自己气泡缺 chips
根因：占位轮 prompt 纯文本无标记行
方案：合成标记行进 displayPrompt + resend 剥离
结果：1783 全绿+build 过+部署复验

## ql-20260821-003-1cb1 | 2026-08-21 11:26:37 | 发图后 daemon 下载恒 401 图片无法给智能体
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/session_attachment/router.py（content 端点 get_current_user → get_current_principal 双通道鉴权）
需求：发图后 daemon 下载恒 401 图片无法给智能体
根因：content 端点 get_current_user 仅认 JWT；daemon 走 X-API-Key（config-63767aa5）
方案：改 get_current_principal 双通道；归属校验不变
结果：daemon key 实测 200 全量字节；端到端 agent 真实读出图内容；已部署提交

## ql-20260821-016-c607 | 2026-08-21 14:22:05 | 本机默认会话切换供应商后约 1 秒会话即 ended（/sessions 复现）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/session-manager.ts（resolveResumeConfigDir 探测 helper + _reloadSession/restoreAndReconnect 按 jsonl 位置选目录 + resumeDirResolver 测试注入点）
- sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts（新增 7 用例（helper 单测 4 + reload/restore 集成 3））
需求：本机默认会话切换供应商后约 1 秒会话即 ended（/sessions 复现）
根因：本机默认创建的会话 jsonl 写用户 ~/.claude（ql-20260729-002 不隔离设计），而 daemon reload/restore 无条件强制隔离目录 resume（ql-20260807-002），跨目录找不到 jsonl → claude 启动失败 → onError → fail → 上报 end
方案：新增 resolveResumeConfigDir 按 jsonl 实际所在目录选 CLAUDE_CONFIG_DIR（隔离优先、home 次之、都无 fallback 隔离保持既有报错路径），_reloadSession 与 restoreAndReconnect 两处接入，SessionManagerOptions.resumeDirResolver 供测试注入
结果：新增 7 用例全过（helper 4 + reload/restore 集成 3），config-switch 全文件 28 过；daemon 全量 2461 过、仅 3 个存量失败（git stash 干净树复现无关）；typecheck 过

## ql-20260821-017-cf72 | 2026-08-21 14:38:26 | 清理 daemon 3 个存量测试失败（干净树复现
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/tests/daemon-session-switch-config.test.ts（inject 断言补第4/5参）
- sillyhub-daemon/tests/daemon-kind-dispatch.test.ts（同款断言补参）
- sillyhub-daemon/tests/policy/allowed-roots-temp-paths.test.ts（WORKSPACE_ROOT 按平台形态）
需求：清理 daemon 3 个存量测试失败（干净树复现，与 ql-20260821-016 无关）
根因：两处 SESSION_INJECT spy 断言缺第4/5参（daemon.ts inject 已带 attachments/downloadAttachment，无附件时 undefined）；policy 测试 Windows 上工作区 root 用 POSIX 形态与 target 盘符形态不匹配（跨平台提交即坏）
方案：两处断言补 undefined, undefined；WORKSPACE_ROOT 常量按平台取形态
结果：3 文件 44 用例全过，零产品代码改动

## ql-20260822-001-port | 2026-08-23 14:55:00 | home 会话切供应商流量串本机网关——jsonl 迁移隔离（移植主线）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/claude-transcript-dir.ts（新增 findClaudeTranscriptPath / migrateClaudeTranscriptToIsolated；locateClaudeTranscript/applyTranscriptConfigDir 增可选 dirs 参数）
- sillyhub-daemon/src/interactive/session-manager.ts（SessionManagerOptions.resumeDirs 注入点 + reload/restore 双路径迁移门控）
- sillyhub-daemon/tests/interactive/claude-transcript-dir.test.ts（find/migrate 单测 6 用例）
- sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts（MIG-5/6/7/8 集成 4 用例）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（关键逻辑 + 人工备注同步）
需求：home 会话切供应商流量串本机网关（本地分支 0cc03698 已有 E2E 实锤修复，main 上远端 ql-20260822-009 已用不同架构修了同源问题，需移植合并）
根因：回本机 ~/.claude resume 后，用户 settings.json 的 env 块（cc-switch 指向本机网关）优先于进程注入的供应商 env，切了 Kimi 流量串到 BigModel（400[1214] modelCode 不存在）
方案：home 会话 + 生效供应商非空 → migrateClaudeTranscriptToIsolated 复制 jsonl 进隔离目录再回隔离 env（reload/restore 双路径，restore 顺带自愈存量）；落在 009 的 claude-transcript-dir 模块上（探测/迁移单一来源）。语义差异：本地版「isolated 已有旧副本覆盖重写」改为「跳过防回灌」（isolated 是新真相源，回灌 home 旧副本会丢增量）。本地 ql-20260821-016 的 resolveResumeConfigDir 探测语义已由远端 009 覆盖，不重复移植
结果：claude-transcript-dir 12 用例 + config-switch 30 用例全过（合计 42）；typecheck 零错误。daemon 全量套件在部署前回归

## ql-20260824-003-b1b1 | 2026-08-24 08:54:58 | (quick 任务)
状态：进行中
关联变更：（无）
文件：frontend/src/components/daemon/session-panel.tsx, frontend/src/components/daemon/__tests__/session-panel-prompt.test.tsx

## ql-20260824-004-9783 | 2026-08-24 08:55:08 | 修复 /sessions 会话页 live 发送的用户消息气泡上方出现空行
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（两处 displayPrompt 拼接改走 joinAttachmentMarkers（sendFromQueue 占位轮 + handleSend 队列条目））
- frontend/src/components/daemon/runtime-session-helpers.tsx（新增 joinAttachmentMarkers 导出（parseAttachmentMarkers 逆操作））
- frontend/src/components/daemon/__tests__/session-panel-prompt.test.tsx（回归测试：纯函数三态 + page 模式占位轮气泡无前导换行）
需求：修复 /sessions 会话页 live 发送的用户消息气泡上方出现空行。
根因：61a1b709（2026-08-21-session-message-queue）在 page 模式 sendFromQueue 与 handleSend 两处把占位轮 displayPrompt 拼成标记行+换行+正文，无附件时 markerLines 为空串产出前导换行，气泡 whitespace-pre-wrap 原样渲染成空行；后端落库无此前缀且 SSE user_input 不回填，空行只存在于 live 占位轮、刷新即消失。
方案：runtime-session-helpers 新增 joinAttachmentMarkers（parseAttachmentMarkers 逆操作，无附件原样返回正文，语义对齐 backend inject），两处拼接改走该函数。
结果：新增 session-panel-prompt.test.tsx 4 例（纯函数 3 + page 模式组件 1）红绿对照验证——旧代码组件断言失败 expected ['\nsecond'] to include 'second'，新代码全绿；定向回归 session-panel 5 文件 81 例 + 队列/helper 4 文件 48 例全绿，tsc 零错，lint 仅存量 cn 未使用警告（非本次引入）。

## ql-20260824-cc-upgrade | 2026-08-24 11:11:00 | backend 镜像内 Claude Code CLI 升级 2.1.158 → 2.1.241
状态：已完成
关联变更：（无）
文件：
- deploy/docker-compose.yml（CLAUDE_CODE_VERSION 默认 pin 2.1.158 → 2.1.241，npm 最新）
需求：升级 backend 容器内 agent 运行用的 Claude Code CLI
根因：（无缺陷，例行版本升级；2.1.158 为旧 pin）
方案：改 compose build arg 默认值；node-tools 层 cache-miss 重装（npmmirror 源，~2 分钟）；重建 backend 容器
结果：容器内 claude --version = 2.1.241 (Claude Code)；/api/health ok；daemon WS 已重连（心跳 200）。deploy/.env 无覆盖项，改默认即生效

## ql-20260824-005-bom | 2026-08-24 11:37:00 | install.ps1 双 BOM 修复——两个 BOM 修复提交叠加出的新 bug
状态：已完成
关联变更：远端 3c0c7914 + 5b377fcf
文件：
- sillyhub-daemon/scripts/install.ps1（去源文件 BOM）
需求：irm install.ps1 | iex 可能因双 U+FEFF 报错，另一台机器装不了 daemon
根因：3c0c7914 给源文件加了 BOM，5b377fcf 又让 Dockerfile 构建时 printf 无条件再打一个 → 容器内 EF BB BF ×2（实测 od 证实）；另发现 dist_router read_text universal newlines 把 CRLF 归一成 LF 再吐（对 iex 字符串解析无影响，不修）
方案：源文件去 BOM 保持仓库干净，BOM 单一来源 = Dockerfile 构建时打（与 CRLF 转换同层，唯一分发出口）
结果：容器内 + LAN 端点 od 实测单 BOM；/api/health ok；daemon 心跳 200。顺手把 CC pin 2.1.158→2.1.241 一并验证（容器内 claude --version = 2.1.241）

## ql-20260824-018-ecf9 | 2026-08-24 13:50:02 | 会话级供应商热切换「切回本机默认」不生效——DB 已切回本机但 cc 进程仍跑旧供应商（实测切回后 /model 显示 glm-5.1、流量烧旧供应商 key）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（SESSION_SWITCH_CONFIG 路由 providerConfig 改 !== undefined 判键存在，保留缺席/显式 null 区别）
- sillyhub-daemon/src/interactive/session-manager.ts（reloadWithConfig null=切回本机 + _reloadSession 挂 migrateClaudeTranscriptToHost 反向迁移）
- sillyhub-daemon/src/interactive/claude-transcript-dir.ts（新增 migrateClaudeTranscriptToHost（覆盖回迁+删 isolated 原件））
- sillyhub-daemon/src/interactive/types.ts（SessionSwitchConfigPayload.providerConfig 改可选 + 注释新语义）
- sillyhub-daemon/tests/daemon-session-switch-config.test.ts（null 透传用例改新契约 + 缺席透传 undefined 新用例）
- sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts（CFG-2 重写 + CFG-2b/MIG-9 新增）
- sillyhub-daemon/tests/interactive/claude-transcript-dir.test.ts（MIG-H1~H5 新增）
- sillyhub-daemon/tests/interactive/session-manager-resume-config-dir.test.ts（模块 mock 补 migrateClaudeTranscriptToHost 导出）
需求：会话级供应商热切换「切回本机默认」不生效——DB 已切回本机但 cc 进程仍跑旧供应商（实测切回后 /model 显示 glm-5.1、流量烧旧供应商 key）。
根因：providerConfig null 语义前后端冲突 + daemon 两层 ?? 塌缩。后端切回本机时 SESSION_SWITCH_CONFIG 下发 providerConfig:null（=切本机），daemon.ts 路由层 ?? null 把字段缺席也归一成 null（销毁缺席/显式 null 的区别），reloadWithConfig 里 payload.providerConfig ?? state.providerConfig 再把 null 塌缩成沿用旧供应商。连带第二根因：曾用平台供应商的会话 transcript 落在 daemon 隔离目录，即使清掉供应商 env，applyTranscriptConfigDir 按 jsonl 实际位置仍强制隔离 CLAUDE_CONFIG_DIR，cc 读不到宿主机 ~/.claude/settings.json（本机 OpenCode Go 等配置）。
方案：① daemon.ts 路由 providerConfig 用 !== undefined 判键存在（snake 键含显式 null 优先，缺席保持 undefined）；② reloadWithConfig 改 payload.providerConfig !== undefined ? payload.providerConfig : (state.providerConfig ?? null)，null=切回本机；③ 新增 migrateClaudeTranscriptToHost（isolated jsonl 覆盖回宿主机旧副本并删 isolated 原件，自门控，失败降级 isolated 不破坏会话）；④ _reloadSession 在 providerConfig==null 分支挂反向迁移，与既有正向 migrateClaudeTranscriptToIsolated 对称；⑤ interactive/types.ts payload 类型改可选并同步注释。
结果：daemon typecheck 通过；vitest 全量 152 文件/2650 测试全绿（9 skipped 同基线）。新增测试锁死新契约：CFG-2 重写（null=切回本机）、CFG-2b（缺席=不切）、MIG-9（隔离 jsonl 切回本机回迁宿主机+env 不隔离）、MIG-H1~H5（反向迁移单测）、路由缺席透传 undefined 用例。daemon.md 契约摘要+变更索引已同步。注意：存量带病会话（daemon sessions.json 已持久化旧供应商 config）需重新切换一次供应商或重启后重新切换才自愈。

## ql-20260824-006-bom-fix | 2026-08-24 16:34:00 | install.ps1 零 BOM 修复——两个 agent 各修一半互相抵消
状态：已完成
关联变更：远端 09b43b3a（删 Dockerfile printf）+ 本地22808178（删源 BOM）
文件：
- backend/Dockerfile（补回 printf BOM 行）
需求：另一台机器 irm install.ps1 | iex 因缺 BOM 致 PS5 解析报错
根因：两个 agent 各修了双 BOM bug 的一半（一方删源 BOM，另一方删 Dockerfile printf），叠加后镜像里零 BOM
方案：补回 Dockerfile printf BOM 行（源文件无 BOM 保持仓库干净，Dockerfile 为唯一分发点打 BOM）
结果：容器内 + LAN 端点 od 实测单 BOM（EF BB BF）；/api/health ok；CC 2.1.241；daemon bundle 最新

## ql-20260825-001-f076 | 2026-08-25 13:50:27 | 预会话首句附件丢失修复——createSession 补 attachment_ids 契约
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：预会话首句附件丢失修复——createSession 补 attachment_ids 契约
根因：createSession 契约无 attachment_ids 而 UI 允许上传，首句附件发送时被静默丢弃（无回显且智能体收不到），后续消息走 inject 正常
方案：后端 SessionCreateRequest 补 attachment_ids（D-7 对齐允许空 prompt 看图说话）+ create_session 复用 inject 附件逻辑（校验/标记行回显/回填/SESSION_INJECT attachments）+ facade/router 透传；前端 createSession 上送 + 预会话放开纯附件首句；gen:types 成对更新
结果：新增 9 后端测试全绿 + 既有 create 15 用例零回归 + 前端全量 2169 绿 + ruff/mypy 通过；已提交 ac43cd50；Docker 待重新部署

## ql-20260825-002-b479 | 2026-08-25 15:05:00 | 首句双提交修复——deferred first prompt + 前端存量显示归并
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts（deferred first prompt：create 挂起 firstPrompt 等 SESSION_INJECT 消费、10s fallback 兜底、end/fail 清 timer）、sillyhub-daemon/src/daemon.ts（删 user_input 重复上报）、frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 按剥标记行主体归组、marker 版优先）
根因：daemon create 即把 lease metadata 的 firstPrompt 入队提交并上报一条 user_input，backend create_session 又落一条 user_input 并 SESSION_INJECT 再提交同句——长期既有 bug（旧纯文本会话库中也是两条相同 user_input），agent 实际收到两次首句；带附件后一条 marker 版一条裸文本版，前端渲染两个气泡才暴露（[74b5531e / e6900bc2 会话实测]）。
方案：deferred first prompt（create 不入队，挂起等权威 SESSION_INJECT）+ 删 daemon 侧重复上报 + 前端存量双日志归并显示。
结果：daemon 新增 4 用例 + 全量 2711 绿（并发 inject 33/33 零回归）；frontend 新增 4 用例 + 全量 2173 绿；已提交 7cbcc362；daemon bundle 已重新构建。注：sillyspec CLI 3.27.5 的 quick --done 因 complete-handlers.js 引用 shared.js 不存在的导出 collectOtherQuickSessionDeclarations 而崩溃（工具缺陷，本条目由人工补写）。

## ql-20260825-003 | 2026-08-25 18:03:00 | multiSelect 提问历史回看崩页修复——answer 数组归一
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/session-log-sanitize.ts（extractDialogQA answer 归一 string|string[]）、frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts（+4 用例）
根因：AskUserQuestion 多选提问的 answer 真实形态是 string[]（multiSelect: true），extractDialogQA 旧代码只按 string 处理——(answers[i]?.answer ?? "").trim() 在数组上抛「(intermediate value)….trim is not a function」，整页被 error boundary 拦截。触发条件为回看含已答多选提问卡的会话（e6900bc2 首次触达）。排查路径：DB 数据核对（全 text 无异常）→ 真实日志组件级复现（logsToTurns/TurnTimeline/SessionPanel 均不崩）→ 差异定位到 dialog_history（mock 空所以测试不崩）→ session_dialog_requests 表实数据 answer 为数组 → extractDialogQA 源码定位 → 红绿验证（stash 修复复现同款 TypeError）。
方案：answer 归一——数组过滤非字符串成员、trim 后顿号 join 展示（answerText）；selected 判定改 label ∈ 选中列表。
结果：新增 4 用例 + 既有 38 用例全绿；前端全量 2177 绿；tsc 0 错；红绿验证通过；已提交 83975883。注：sillyspec CLI quick --done 仍崩（ql-20260825-002 已记工具坑），本条目人工补写。

## ql-20260825-004 | 2026-08-25 22:16:00 | .xls 旧格式在线预览支持（SheetJS BIFF 兼容）
状态：已完成
关联变更：2026-08-25-session-attachment-preview（非目标条款更新 + docHash 重算）
文件：frontend/src/components/files/preview-registry.ts（xls 扩展名 + application/vnd.ms-excel MIME → xlsx 渲染器）、previewers/xlsx-previewer.tsx（注释）、__tests__/preview-registry.test.ts（+用例）
根因：设计期把所有旧格式 Office 一刀切进 fallback，但 SheetJS 的 read 本就支持 BIFF5/7/8（.xls）——用户发 .doc 时顺带问到 .xls，发现该格式零成本可支持（写读往返实测：OLE2 魔数 D0CF 的真实 .xls 二进制解析、sheet_to_html 输出含数据）。
方案：registry 归一映射，渲染器零改动。.doc/.ppt 维持 fallback（纯前端无保真方案，保持 D-001 纯前端路线）。
结果：registry 测试 21/21 绿、files 域 42/42 绿、tsc 0 错；已提交 32a45b16。

## ql-20260825-005 | 2026-08-25 22:32:00 | 预览器三处渲染问题修复（docx 永久 loading / PDF 高度 / 表格观感）
状态：已完成
关联变更：2026-08-25-session-attachment-preview（Wave2 渲染器缺陷修复）
文件：previewers/docx-previewer.tsx（容器常驻+loading 覆盖层）、pdf-previewer.tsx（h-[70vh]）、xlsx-previewer.tsx（表格样式）、previewers-office.test.tsx（+锚点）
根因：①docx 容器 div 仅 status=ok 渲染，effect 首帧 ref 为 null 被 `!containerRef.current` 短路，Promise 完成也无容器渲染→永久 loading；②PDF iframe height:100% 在 Modal overflow-auto（高度 auto）父链解析为 0/默认 150px；③SheetJS sheet_to_html 全输出 td（无 th），表头无区分+数值不右对齐+窄表强拉变形（xls/xlsx 同源，非 xls 特有）。
方案：容器常驻挂载；固定视口高；首行表头样式+数值右对齐+w-fit min-w-full。
结果：files 域 43/43、全量 2179 绿、tsc 0 错；提交（见 git log）。

## ql-20260825-006 | 2026-08-25 22:50:00 | Excel 长文本单元格撑爆表格修正
状态：已完成
关联变更：2026-08-25-session-attachment-preview
文件：frontend/src/components/files/previewers/xlsx-previewer.tsx（表格 CSS）
根因：ql-20260825-005 引入的全局 whitespace-nowrap 在含大段汇报文字的报表 xls 上把单元格撑到数千像素宽（用户实测「员工月度绩效考核汇报表.xls」），其余列全部挤变形。
方案：文本单元格恢复换行（max-w-[420px] + break-words），仅数值单元格不折行右对齐，表宽 w-full。注：SheetJS sheet_to_html 为纯数据投影，不含原文件的合并居中/列宽/字号/颜色样式——完整样式还原超出纯前端路线范围（design D-001 非目标），当前定位为「内容完整、结构正确、不炸版」的数据级预览。
结果：files 域 43/43 绿、tsc 0 错；已提交并部署。

## ql-20260826-001 | 2026-08-26 13:23:00 | backend-ci 修复——0bd08e88 批量推送积压的 ruff/mypy 债清零
状态：已完成
关联变更：2026-08-26-onlyoffice-preview（其 task-01/03 提交引入 I001 + 未格式化新文件）
文件：backend/app/main.py（I001：preview_office import 与 file import 间补空行）、backend/app/core/config.py、app/modules/preview_office/service.py、app/modules/preview_office/tests/test_service.py、app/modules/daemon/session/service.py、app/modules/daemon/tests/test_session_create_attachments.py（ruff format 归位；test_service.py 另修 mocked_redis.delete_key 的 set.discard 当返回值用，mypy func-returns-value）
根因：0bd08e88（OnlyOffice）与其后打包推送的 11e712fc（预会话附件修复）各带 lint 债——02:30 的 backend-ci 死在 ruff check（I001）这步，format check / mypy 从未执行，I001 身后还压着 5 个未格式化文件 + 1 个 mypy 错误，逐层修完才能真绿。
方案：I001 手工补空行（ruff --diff 建议项）+ ruff format 5 文件 + delete_key 改显式 if 分支（语义不变：key 在 set 中返回 1 否则 0）。
结果：ruff check / ruff format --check 全绿、mypy 737 文件 0 错、受影响测试 29/29 绿（preview_office + create_attachments + session_optimize_round2）；CI 失败史梳理：8/22-8/25 的 10 次 backend-ci 失败均为「提交引入→后续提交修复」的确定性破坏（合并冲突 page_context / alembic 双头 / mypy / ruff format），非不稳定测试；--reruns 2 兜底的已知 flaky 见 backend-ci.yml 注释。已提交（见 git log）。注：sillyspec CLI quick 仍崩（docs/sillyspec 已记），本条目人工补写。

## ql-20260827-004-0f84 | 2026-08-27 10:26:05 | 直播会话重复渲染段+流式光标常闪修复（会话 e87622aa）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/run_sync/service.py, backend/app/modules/daemon/tests/test_run_sync_assistant_override.py, backend/app/modules/daemon/tests/test_wave5_integration.py, frontend/src/components/daemon/__tests__/session-log-assembler-perf.test.ts, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts, frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx, frontend/src/components/daemon/session-log-assembler.ts
需求：直播会话重复渲染段+流式光标常闪修复（会话 e87622aa）
根因：三道防御同时失效：daemon partial 行 Redis 发布丢失未实时送达；backend 完整行 segmentId 旧格式 <mid>:<idx> 与 partial 格式 main:<mid>:text 永不匹配致去重清理空转、partial 行滞留 DB（daemon override 信号生产从未到达）；turn_completed 后轮后对账重放 partial 到终态轮，装配器只有正向收编（full 后到吸收 partial）无反向，partial 落成 streaming=true 新段且 finishTurn 已跑过永不再清
方案：装配器加反向收编 bucketCoveredByFullText（迟到 partial 是在场完整行前缀则跳过落段）与 SUPERSEDED_SEG_IDS 封存（正向吸收/override/反向收编统一封存，同 segId 重放窗口免疫）；session-panel 两处 onLog 对终态轮非活跃 run 迟到 log 补跑 finishTurn；backend _extract_sdk_messages segmentId 对齐 daemon 格式 parent:mid:type 且完整行落库时 _revoke_committed_partials 跨调用 DELETE 已 commit 同 segmentId partial（不再依赖 override 信号）
结果：前端装配器 65 + perf 7 + dialog 55 + helpers 29 + 面板族/页面 57 全绿，tsc 0 / eslint 0 err；backend override 14 + wave5 45 + extract/run_sync 34 全绿，ruff 0；存量无关红 1 例（test_run_sync_gate_enqueue close 立即返回，干净 HEAD 同样红非本次引入）；未部署（本地 Docker 环境需重建镜像生效）

## ql-20260827-005-a660 | 2026-08-27 11:14:56 | /sessions 页整页滚动条修复（门户容器高度与 TopBar 不符）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/sessions-portal.tsx（门户容器 calc(100vh-56px)→calc(100vh-64px) 对齐 TopBar h-16）
需求：/sessions 页整页滚动条修复（门户容器高度与 TopBar 不符）
根因：sessions-portal 门户容器 h-[calc(100vh-56px)] 假设顶栏 56px，实际 TopBar 为 h-16=64px，容器多出 8px 撑爆 min-h-screen 出整页滚动条（浏览器实测 728>720）
方案：改为 h-[calc(100vh-64px)] 并加注释锚定依据，与 explorer/page.tsx 既有惯例一致；重建 Docker 前端镜像部署
结果：54 单测全绿（sessions-portal + sessions/page）、tsc 0 错误；部署后浏览器实测门户高 656=100vh-64、页高 720=视口 720、hasVerticalOverflow=false，滚动条消失

## ql-20260827-006-f892 | 2026-08-27 12:06:22 | 直播乱序重复渲染修复续（会话 0ef651b6 窗口丢失胶水段与并发竞态）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/run_sync/service.py, backend/app/modules/daemon/tests/test_run_sync_assistant_override.py, backend/app/modules/daemon/tests/test_wave5_integration.py, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts, frontend/src/components/daemon/session-log-assembler.ts
需求：直播乱序重复渲染修复续（会话 0ef651b6 窗口丢失胶水段与并发竞态）
根因：窗口发布丢失拼出非前缀胶水段致前缀收编失效，且 partial 与完整行并发提交竞态致 partial 滞留数据库
方案：backend 完整行落库点合成 override 令箭（标记行堵竞态加重放补投，信封实时治愈胶水段），前端 override 去重键含 segmentId 保刷新路径多标记生效
结果：backend override 19 与 wave5 39 绿 ruff 0，daemon 域 150 绿（1 存量无关红），前端装配器 67 perf 7 dialog 54 绿 tsc 0，文档同步 daemon.md 与 frontend_components.md，未部署待重建

## ql-20260827-007-67b4 | 2026-08-27 13:21:26 | 已完成 quick 任务在变更页仍显示进行中的合并修复
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：已完成 quick 任务在变更页仍显示进行中的合并修复
根因：推送经 spec-sync 网络中止丢失致 PG 只留开始时快照而文件已终态，合并层无条件 PG 优先钉死陈旧行
方案：merge_entries 同 ql_id 按状态成熟度选优加同级 PG 优先
结果：quicklog 21 测试绿 ruff 0，已提交 4d6eae34，backend 待重建部署

## ql-20260827-008-70cf | 2026-08-27 14:05:21 | 工作区会话页 2K 屏宽度撑满——sessions 路由放开 1440 帽子
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx（sessions 路由 isFullWidth → main max-w-none，其余子页维持 max-w-[1440px]）
需求：工作区会话页 2K 屏宽度撑满——sessions 路由放开 1440 帽子
根因：workspaces/[id]/layout.tsx 的 main 统一 max-w-[1440px]，2K 屏下会话门户页不撑满；参照 /agent-profiles（AppShell 无帽 + PageContainer size=full）应占满
方案：layout 按 pathname startsWith 判 sessions 子路由时 main 用 max-w-none，其余子页维持 1440；注释标 FRONTEND_PAGE_STYLE.md 列表页占满规范，模块文档变更索引同步登记
结果：dashboard 路由组 vitest 36 文件 335 测试全过，eslint 单文件 0 告警；模块文档 frontend_app.md 已同步

## ql-20260827-010-e472 | 2026-08-27 14:24:18 | 会话附件 daemon 落盘改内容寻址命名——attachments/{sha256}.{ext}
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/session-manager.ts（_writeAttachmentFile 内容寻址重写 + 注入拼装去重与文案）
- sillyhub-daemon/src/protocol.ts（展示名字段注释同步）
- sillyhub-daemon/tests/interactive/session-manager-inject-attachment.test.ts（新增 6 个 disk 落盘用例）
- .sillyspec/docs/SillyHub/modules/daemon.md（注意事项补内容寻址约定）
- .sillyspec/docs/SillyHub/modules/daemon.changelog.md（新建变更索引 sidecar）
需求：会话附件 daemon 落盘改内容寻址命名——attachments/{sha256}.{ext}，消灭同名 (n) 序号
根因：旧落盘用展示名+同名加序号，attachments/ 跨会话堆积 server.log/server(1).log 等歧义路径，agent 无法从名字判断哪份是本次发送的，只能把目录里所有同名文件读一遍比对内容
方案：_writeAttachmentFile 改为 sha256 内容寻址（node:crypto，扩展名白名单对齐 backend _EXT_RE 回退 bin，wx 探测 EEXIST 即跳过复用）；注入拼装改 Map<rel,展示名[]> 同轮同内容去重一行、原文件名并列注记，prompt 头部明确无需浏览比对其他文件；protocol.ts 注释同步
结果：目标测试 12/12 绿（含 6 个新 disk 用例），相邻回归 31/31 绿，tests/interactive 全量 662/662 绿，tsc --noEmit 0 错误
审计：⚖️ 归属切分：3 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx, sillyhub-daemon/src/protocol.ts, sillyhub-daemon/tests/interactive/session-manager-inject-attachment.test.ts

## ql-20260827-011-6dd8 | 2026-08-27 14:29:47 | 工作区全部子页宽度撑满——彻底移除 layout main 的 1440 帽子
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx（删 isFullWidth 分支，main 类名去掉 max-w-[1440px] 帽与 mx-auto，全子页撑满）
需求：工作区全部子页宽度撑满——彻底移除 layout main 的 1440 帽子
根因：ql-20260827-008 仅放开 sessions 路由后用户定案所有子页统一撑满；已核实子页 13 处 PageContainer 全为 size=full、其余页面无页面级宽度帽，1440 帽是唯一全局限制
方案：layout.tsx 删除 isFullWidth 条件分支与三元宽度类，main 去掉 max-w-[1440px] 及配套 mx-auto；旧注释引用 1440 帽的表述同步修正
结果：eslint 0 告警、tsc --noEmit 通过、dashboard 路由组 vitest 335 测试全过；模块文档已同步

## ql-20260827-013-4418 | 2026-08-27 14:53:34 | 工作区剩余 12 子页宽度撑满——PageContainer 补 size=full 撤 1400 内帽
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx（PageContainer 补 size=full）
- frontend/src/app/(dashboard)/workspaces/[id]/files/page.tsx（同）
- frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx（同）
- frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx（同）
- frontend/src/app/(dashboard)/workspaces/[id]/releases/page.tsx（同）
- frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx（同）
- frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx（同）
- frontend/src/app/(dashboard)/workspaces/[id]/incidents/page.tsx（同）
- frontend/src/app/(dashboard)/workspaces/[id]/incidents/[iid]/page.tsx（3 处（加载/错误/主体））
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx（3 处）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/page.tsx（3 处）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx（3 处）
需求：工作区剩余 12 子页宽度撑满——PageContainer 补 size=full 撤 1400 内帽
根因：ql-011 放开 layout main 后用户实测 components/runtime/skills/mcp/mcp-tokens/files 六页仍 1400 居中——上轮核实用单行 grep 统计 size 用法，这批未传 size 的写法被漏掉，PageContainer 默认 default 即 1400 帽
方案：PCRE2 多行正则复查全 workspaces/[id] 路由共 12 文件 20 处未传 size 的 PageContainer，sed 批量统一补 size=full 复查 0 残留；顺带补装远端新依赖 react-qr-code 修 tsc 红
结果：eslint 0 error（5 个预存 warning 无关）、tsc --noEmit 通过、dashboard 路由组 335 测试全过；模块文档已同步

## ql-20260827-014-b9f5 | 2026-08-27 15:18:28 | 平台级页面宽度撑满——选择器与 settings 四管理页、PPM 里程碑明细补 size=full
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/page.tsx（选择器页 PageContainer 补 size=full）
- frontend/src/app/(dashboard)/settings/providers/page.tsx（同）
- frontend/src/app/(dashboard)/settings/skills/page.tsx（同）
- frontend/src/app/(dashboard)/settings/mcp/page.tsx（同）
- frontend/src/app/(dashboard)/settings/api-keys/page.tsx（同）
- frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（同（PPM 已上线，纯样式））
- .sillyspec/docs/SillyHub/modules/ppm.changelog.md（新建 ppm 变更索引 sidecar）
需求：平台级页面宽度撑满——选择器与 settings 四管理页、PPM 里程碑明细补 size=full
根因：用户逐页验收后点名 /workspaces 选择器页仍 1400 居中；dashboard 全路由复查共 6 处 PageContainer 未传 size 走默认帽，均为列表/管理形态，符合「列表页 full」规范
方案：6 文件 PageContainer 统一补 size=full（/workspaces + settings providers/skills/mcp/api-keys + ppm/milestone-details），PCRE2 复查 0 残留；frontend_app 与 ppm（新建 sidecar）两模块文档登记
结果：eslint 0 error（26 个预存 warning 无关）、tsc 通过、dashboard 路由组 335 测试全过

## ql-20260827-015-4cdb | 2026-08-27 16:42:16 | 升级 daemon claude-agent-sdk 0.3.181→0.3.247
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/package.json（主依赖+8 平台 overrides 0.3.181→0.3.247）
- sillyhub-daemon/pnpm-lock.yaml（依赖解析与平台二进制重锁）
需求：升级 daemon claude-agent-sdk 0.3.181→0.3.247
根因：agent-sdk 版本尾数与捆绑 Claude Code 内核对齐，0.3.181 落后 66 个 patch 约 2 个月，错过上游修复与增强；用户确认升级到 npm latest
方案：package.json 主依赖与 8 个平台 overrides 同步改 0.3.247，pnpm install 更新 lock，tsc build 重建 dist，daemon 进程原参数重启加载新 SDK
结果：typecheck 0 错；vitest 全量 2917 passed/9 skipped 零回归；build 成功；daemon 新进程 WS 重连成功并在处理真实 lease 派发消息流（运行时实证）

## ql-20260827-016-2b4c | 2026-08-27 16:51:11 | agent 日志 hub 会话归属加时间重叠过滤——旧日志不再被整批挂接
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/platform_sync/service.py（hub 分支时间过滤 + _entry_last_seen_gte 辅助 + docstring）
- backend/app/modules/platform_sync/tests/test_agent_log_push.py（4 用例固定 HUB_CREATED_AT + 新增 stale 过滤专测）
- .sillyspec/docs/SillyHub/modules/platform_sync.md（POST /agent-logs 契约行同步）
需求：agent 日志 hub 会话归属加时间重叠过滤——旧日志不再被整批挂接
根因：CLI 上报是全量重推，hub_session_id 命中后整批 entries 全部改写归属到当前平台会话，早于会话创建就停止活跃的历史旧日志也被挂上（33fd100d 会话挂 4 条上午旧 zcode 日志）且覆盖原归属，会话尾部「本地 Agent 日志」卡片失真并抢走别家归属
方案：service.py hub 分支仅挂 last_seen_at ≥ 会话 created_at 的条目（_entry_last_seen_gte，naive 按 UTC 对齐，解析失败/缺失按不挂 best-effort），被跳过条目保持原归属且不落 ctx 绑定；既有 4 个 hub 命中测试改用固定 HUB_CREATED_AT，新增 stale 过滤专测；模块文档契约行同步
结果：test_agent_log_push.py 27 passed、daemon hub 分支零发布用例 1 passed、ruff 两文件 All checks passed；现网 Postgres 存量错误挂接待部署后一次性 detach（另附 SQL）

## ql-20260828-006-e5af | 2026-08-28 09:33:20 | 工作区详情页默认智能体提供方卡片文案修正——对齐阶段流转自动派发退役后的真实消费点
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx（默认智能体提供方卡片说明段 + 下拉未设置项两处文案）
需求：工作区详情页默认智能体提供方卡片文案修正——对齐阶段流转自动派发退役后的真实消费点
根因：原文案『自动派发（阶段流转、scan-generate）且未显式指定 provider 时使用』中阶段流转自动派发已于 2026-08-14 change-center-conversation-driven（D-004）退役，审批通过/打回不再派发 agent，文案与现状脱节
方案：page.tsx 两处纯文案改动——卡片说明段改为『扫描生成（scan-generate）以及未显式指定提供方的智能体派发时使用；守护进程上多个提供方同时在线时，此处用于固定选用哪一个。留空则自动选用最近在线的提供方』，下拉未设置项『由守护进程默认决定』改『自动选最近在线的提供方』（对齐 queries.py 按 last_heartbeat_at DESC 取任意在线 runtime 的实际行为）
结果：全库 grep 确认无其它引用处（含移动端/测试）；pnpm vitest run page.test.tsx 10 个测试全部通过（210s）；纯 JSX 字符串改动无逻辑变更

## ql-20260828-007-7dcf | 2026-08-28 10:05:30 | 派团队弹层及会话团队卡片配色迁主题统一
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/team-trigger-popover.tsx（派团队弹层 violet→brand 同档 + 注释）
- frontend/src/components/daemon/session-input-bar.tsx（＋菜单派团队项图标）
- frontend/src/components/daemon/session-panel.tsx（团队进行中 chip）
- frontend/src/components/daemon/team-task-block.tsx（会话团队任务卡）
- frontend/src/components/daemon/turn-segment-views.tsx（分身段块折叠卡）
需求：派团队弹层及会话团队卡片配色迁主题统一
根因：派团队链路视觉用 violet Tailwind 固定阶作团队身份色，违反主题铁律 brand-* 语义阶随 data-theme 换肤——ai-native 下碰巧一致，blue 主题变蓝后紫色突兀、dark 主题 violet-50/100 亮紫在 zinc 黑底刺眼
方案：5 组件 violet-N→brand-N 同档替换（team-trigger-popover 弹层/session-input-bar ＋菜单派团队项/session-panel 团队 chip/team-task-block 任务卡/turn-segment-views 分身段卡）+ 6 处身份色注释同步；PROVIDER_TONES.claude 厂商外部标识色不动
结果：vitest 5 个相关测试文件 139/139 通过，grep 确认类名零 violet 残留
审计：📝 文档欠账（D-8）：5 个源码文件改动未同步任何模块文档（涉及模块：frontend_components）

## ql-20260828-008-7bd5 | 2026-08-28 10:19:22 | 团队进度卡 team-progress 配色补迁主题统一
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/team-progress.tsx（团队 mission 进度卡 violet→brand 同档 + 注释）
需求：团队进度卡 team-progress 配色补迁主题统一
根因：ql-007 派团队视觉迁 brand 时漏了 team-progress.tsx（变更详情页 agent 运行日志与会话共用的 mission 进度卡），violet 固定阶在 blue/dark 主题下同样与主题割裂
方案：4 处类名 violet-N→brand-N 同档替换（mission 容器卡/决策日志块/worker 列表标题两处/状态色）+ 头注释身份色说明同步
结果：vitest team-progress.test.tsx + page-team-toggle.test.tsx 25/25 通过

## ql-20260828-009-4a13 | 2026-08-28 10:35:15 | 派团队状态标签四问题修复（不显示/删除不生效/不可更新/图标色）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（hook 轮询条件+TeamTriggerRow+双模式 handler/消费点）
- frontend/src/components/daemon/team-trigger-popover.tsx（hasActiveMission 提示行）
- frontend/src/components/daemon/session-input-bar.tsx（图标灰黑）
- frontend/src/components/daemon/__tests__/session-panel-team.test.tsx（重写收起为真取消+新增重派用例）
- frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx（提示行用例）
- frontend/src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx（补 cancel mock+修＋菜单路径测试债）
需求：派团队状态标签四问题修复（不显示/删除不生效/不可更新/图标色）
根因：DB 实证用户会话首 run 与 mission 创建差 36s——useSessionTeamMissions 仅 hasActive 时轮询，mission 迟到后无刷新机制 chip 永不出现；×仅收起提示不取消（mission 仍在→再派 409）；chip 无更新入口；入口图标品牌色与附件/技能灰黑不一致
方案：轮询条件扩展 hasRunningTurn 消盲区；× 改调 cancelTeamMission+刷新（收起记忆下线）；chip 主体点击开弹层、确认前置取消活跃 mission 重派（弹层 hasActiveMission 提示行）；图标改 text-muted-foreground；page/dialog 双模式同步；顺手修 ux-fixes 既有测试债（stash 实证先在）
结果：7 个测试文件 181/181 通过（新增真取消/重派顺序/提示行用例）+ tsc 无错
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx

## ql-20260828-010-ca22 | 2026-08-28 10:38:59 | 切换守护进程时同步确认新机器的项目本地路径
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/workspace-daemon-switcher.tsx（两步切换：路径确认态面板 + 确认提交）
- frontend/src/components/__tests__/workspace-daemon-switcher.test.tsx（重写：新增路径确认 3 用例共 9 用例）
需求：切换守护进程时同步确认新机器的项目本地路径
根因：本地项目路径是机器相关的，跨机切换沿用旧 root_path 多半不匹配新机器，派发/扫描会找错目录
方案：workspace-daemon-switcher 改两步切换：点选非当前 daemon 进入路径确认态（WorkspacePathPicker 绑定新 daemon、预填当前 root_path、可改可浏览远程目录），确认才 upsertMyBinding 一并提交 daemon_id+root_path；取消返回列表；点当前项仍仅收起
结果：vitest 切换器组件 9/9 通过（新增路径确认态预填/改后提交/取消 3 用例）、工作区详情页 10/10 通过、tsc --noEmit 0 错误
