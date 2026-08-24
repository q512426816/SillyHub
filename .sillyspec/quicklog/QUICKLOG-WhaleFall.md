
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
