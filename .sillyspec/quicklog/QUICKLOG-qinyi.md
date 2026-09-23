
## ql-20260919-001-25c7 | 2026-09-19 05:49:45 | update_entry 坏编码守卫——网页编辑非 UTF-8 文件不再静默毁坏 + probe docstring 勘误
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/knowledge/writer.py（_decode_knowledge_strict 共享 helper + update_entry 坏编码守卫）
- backend/app/modules/knowledge/tests/test_writer.py（新增 TestUpdateEncodingGuard 2 用例（守卫先红后绿+对照组））
- backend/app/modules/workspace/router.py（probe_workspaces docstring 勘误）
- .sillyspec/docs/SillyHub/modules/knowledge.md（注意事项截断坏编码口径三合一 + ql-20260919-001 增量）
- .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md（变更索引新条目）
需求：update_entry 坏编码守卫——网页编辑非 UTF-8 文件不再静默毁坏 + probe docstring 勘误
根因：ql-20260918-005 只把 merge 回写路径 _read_raw 收口为严格解码，网页编辑链 GET 基底仍来自 parser._read_file_safe 的 errors=replace，坏编码文件（Windows GBK 残留）保存整文件替换即毁坏原字节且 update 不进 spec-backups；probe docstring 则是 ql-20260918-012 加 repo_url 回填写副作用时漏改前段只读表述（24h 审查 M1 残余缺口 + L1）
方案：writer.py 新增模块级 _decode_knowledge_strict 共享 helper（_read_raw 内联严格解码收敛进来，错误形态单一来源），update_entry 大小守卫后对磁盘原文严格解码探测（≤1MB，结果弃用只探测），坏编码抛既有 KnowledgeFileEncodingInvalid 422（details 带 byte_offset，文件与 manifest 版本不动）；router.py docstring 改为不改生命周期状态（唯一写例外 repo_url 回填）
结果：test_writer 27 全绿（新增 2 例先红后绿——坏编码 422+GET 基底含 U+FFFD 前置自检+磁盘原字节与 manifest 版本未动、合法 UTF-8 中文对照组不误伤）+ 相邻面 test_router/test_parser/test_distill 72 绿；ruff check/format 3 文件净、mypy scoped 0；docs gate 405=基线 405 放行
审计：[gate] L1（跨 0 模块 · 5 文件：2 代码/1 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260919-002-2378 | 2026-09-19 23:53:31 | tool-report-session-replay 双实现对撞深读后的合并收口——回带三处+格式串裁决（深读报告=设计依据…
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts（slotCallMeta锚定重构（MergedSlot去meta/锚定循环/UNANCHORED_META兜底/头注释））
- sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts（Z11翻转+正向锚定用例+Z12补产段断言）
- sillyhub-daemon/tests/agent-log-matrix.test.ts（ZCODE_MINI改滑动窗+M2/M4/M5锚定期望+交叉口径重构）
- frontend/src/lib/agent-log-turns.ts（孤儿结果未记录文本（R-03红线））
- frontend/src/lib/__tests__/agent-log-turns.test.ts（断言翻转）
- sillyhub-daemon/src/agent-log/registry.ts（格式串正典裁决注释）
需求：tool-report-session-replay 双实现对撞深读后的合并收口——回带三处+格式串裁决（深读报告=设计依据：主线基底略胜但rollout用量归属与孤儿编码两处失分）
根因：主线基底版两处语义缺陷：rollout兜底路径后写覆盖的用量/turnId归属失真（自家测试:661把宽松语义固化成契约）+孤儿tool_use的running编码踩R-03红线（已结束会话不得假运行）；对岸worktree实现在这两处更精确
方案：①parse-zcode-model-io.ts锚定重构——slotCallMeta产出调用锚（行N窗口末assistant锚行N-1元数据）替换槽位后写覆盖，未锚槽UNANCHORED_META全null（未知优于错值）；测试Z11翻转+正向锚定新用例、矩阵M2/M4/M5夹具改真实滑动窗（L1含R1）+锚定期望、Z12改补产段断言 ②agent-log-turns.ts孤儿tool_use轮定稿统一填「结果未记录（更早窗口外或中断）」+status=ok（R-03），测试翻转 ③残轮合并核对=主仓已等效（非真人起点轮prompt空串同worktree哨兵语义，豁免） ④系统事件双视图=TurnTimeline无systemMarkers支撑，组件级改动按报告可选项推迟 ⑤格式串裁决：-jsonl后缀族为正典（主仓内部已一致零代码变更，registry注释记录裁决+生产端现状）
结果：daemon agent-log定向196/196全绿（含锚定翻转与新增正向用例）；frontend agent-log-turns 15/15全绿；frontend+daemon双侧tsc --noEmit零错；CLI --done门禁亲跑隔离快照；④推迟与③豁免随QUICKLOG留档
审计：[gate] L1（跨 0 模块 · 6 文件：3 代码/3 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260920-001-c304 | 2026-09-20 01:09:20 | 红线机检种子清单首批两条落地（对撞实验两失分点的机检固化）
状态：已完成
关联变更：（无）
文件：
- .sillyspec/redlines.yaml（种子两条+YAML单引号正则书写规范注释）
需求：红线机检种子清单首批两条落地（对撞实验两失分点的机检固化）
根因：语义红线活在散文无机器可查形态，对撞实验两处失分三层评审352测试全漏
方案：.sillyspec/redlines.yaml 两条：RL-001 孤儿tool_use禁running编码/RL-002 用量归属禁后写覆盖，severity error + origin锚归档design
结果：探针11实弹：applicable 2条断言0命中0警告；正则单反斜杠书写教训记入文件头注释

## ql-20260920-002-8626 | 2026-09-20 07:20:28 | 修复 24h 审查四风险：codex steer 窗口丢轮 outcome 软锁死 + steering 丢 page_context + mid-turn 注…
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（修①finishTurn 暂存 completedOutcome + consumeCompletedOutcome 统一消费（等待层轮分支/空闲层入口/threadId 超时三点））
- sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（修①新增 completed-先于-steer-回执被拒/成功两序用例）
- backend/app/modules/daemon/session/service/control.py（修②③_inject_mid_turn_into_run 增 page_context（前导只进 payload prompt）+ user_input log 事件补发）
- backend/app/modules/daemon/session/service/queue.py（修②_handle_busy_turn 与 dispatch_now steered 分支透传/重放 page_context + 修④复锁+条目复取）
- backend/app/modules/daemon/session/service/__init__.py（修②facade _inject_mid_turn_into_run 签名同步透传 page_context）
- backend/app/modules/daemon/tests/test_session_queue_actions.py（修②③④新增 4 例（前导/重放/事件/接力已删行收口））
- .sillyspec/docs/SillyHub/modules/daemon.md（增量节 ql-20260920-002-8626 四风险修复记录）
- .sillyspec/docs/SillyHub/modules/daemon.changelog.md（同 ql-ID 变更索引行）
需求：修复 24h 审查四风险：codex steer 窗口丢轮 outcome 软锁死 + steering 丢 page_context + mid-turn 注入缺 user_input SSE 事件 + dispatch_now 无锁双派发
根因：①driver 等待层 race 输入赢后 await steer 期间 turn/completed 只 resolve promise，continue 回循环顶被 beginTurn 覆盖，reportResult 永不执行致 run 永远 running；②queue.py 两处 inject 分支不传 page_context（排队路径会存会重放）；③control.py mid-turn 注入行 backend 直接落库但不补发 Redis log 事件，前端已投递转换不可达；④置顶 commit 释放行锁后无锁查 run 即注入，接力派发竞态下同条双执行
方案：①finishTurn 暂存 outcome + consumeCompletedOutcome 三点统一消费（closing/finalized 守卫原口径，引擎侧 cancelled 照报）；②_inject_mid_turn_into_run 增 page_context 参数，前导只进 SESSION_INJECT payload prompt（留痕原文），两调用点透传 + facade 签名同步；③对齐 inject.py 口径 commit 前快照 commit 后补发；④发送动作前复锁会话行 + status 复检 + 条目复取（已删行返 dispatched 零注入）
结果：daemon codex-app-server-driver 68/68 绿（新增 2 例）；backend test_session_queue_actions 34/34 绿（新增 4 例）；相邻面 session_queue+user_preamble+inject_empty+session_router 70 绿 + 群聊四件 105 绿；daemon tsc 零错 + backend ruff/format/mypy 定向零错；daemon.md 增量节 + daemon.changelog 已记
审计：📎 文档引用失效：1/0 处 file:line 失效（sillyspec docs check 可复现）
审计：   ❌ [docs/sillyspec/cursor-agent-transcript-report-pipeline.md:0]  → 文档不存在
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/cursor-agent-transcript-report-pipeline.md, docs/sillyspec/finished/cursor-agent-transcript-report-pipeline.md

## ql-20260920-003-5b69 | 2026-09-20 08:36:36 | 回带④系统事件双视图——对撞深读合并清单最后一项收口
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/turn-timeline.tsx（对话视图system_event药丸块（viewMode门控））
- frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx（断言翻转（对话视图可见））
需求：回带④系统事件双视图——对撞深读合并清单最后一项收口
根因：主仓实现系统事件仅全部视图可见，对岸worktree双视图恒显；深读裁决④=可见性语义采对岸、渲染形态随主仓已发布药丸
方案：turn-timeline.tsx对话视图块：从processItems提取system_event项渲染同款中性虚线药丸（viewMode===conversation门控防双画；D-03不冒充用户气泡）+agent-replay-body断言翻转
结果：agent-replay-body 16/16+agent-log-turns 15/15零回归+tsc零错；CLI门禁亲跑；提交acfd25095（含并行会话staged面8文件披露amend，同f254733先例）

## ql-20260920-004-f580 | 2026-09-20 14:24:15 | claude 会话 one_m 勾选未作用于主模型——1M 供应商 ~160k 提前触发引擎自动压缩
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/credential-injector.ts（withOneMSuffix 导出纯函数 + 规则 3 ANTHROPIC_MODEL 补缀）
- sillyhub-daemon/src/interactive/session-manager/driver-factory.ts（buildDriverOptions claude 分支 options.model 补缀（create/restore 单点））
- sillyhub-daemon/tests/credential-injector.test.ts（端到端断言随行为更新（ANTHROPIC_MODEL 带 [1m]））
- sillyhub-daemon/tests/interactive/session-manager-one-m-suffix.test.ts（新建 14 用例（helper 纯函数 + 规则 3 + create 链三层））
需求：claude 会话 one_m 勾选未作用于主模型——1M 供应商 ~160k 提前触发引擎自动压缩
根因：one_m 的 [1m] 后缀只落 ANTHROPIC_DEFAULT_{ROLE}_MODEL；主模型两条路径都拿裸名——injector 规则 3 ANTHROPIC_MODEL 取 default_fallback_model/model 无 one_m 信号，daemon 又把 backend payload.model（恒裸）显式塞进 SDK options.model 优先级最高压掉 env 档位（会话 6e213eb3 实证一天自动 compact 4 次）
方案：credential-injector 新增导出纯函数 withOneMSuffix（角色映射 model 匹配且 one_m=true 追加 [1m]，幂等）；两处应用——injector 规则 3 的 ANTHROPIC_MODEL（覆盖 reload/resume 走 env 路径）与 buildDriverOptions claude 分支 options.model（create/restore 单点，state.model 与持久化保持裸名不污染；codex/pi 不认 [1m] 不应用）
结果：新增 14 用例 + injector 端到端断言更新全绿；相邻面 injector-pi/spawn-env/thinking-level/config-switch/reload/pending-switch/session-recovery/driver-registry/resume-config-dir/claude-settings 合计 284 用例全绿；pnpm typecheck 0 错；未部署（daemon bundle 需重打随下次发布）
审计：[gate] L1（跨 0 模块 · 5 文件：2 代码/2 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含

## ql-20260920-005-dac1 | 2026-09-20 14:26:42 | 单聊引导（Steering）忙轮直注入
状态：已取消
关联变更：2026-09-18-single-chat-steering
文件：backend/app/modules/daemon/router/session_crud.py, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/message-queue-bar.tsx, frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx

## ql-20260920-006-ca4a | 2026-09-20 14:33:22 | 忙轮发送默认改回排队，点队列条「转为引导」才发引导消息；引导消息须渲染在真实时间位置（修复前移到轮次开头的 bug）。根因…
状态：已完成
关联变更：2026-09-18-single-chat-steering
文件：
- backend/app/modules/daemon/router/session_crud.py（删忙轮 inject 自动门控回排队）
- backend/app/modules/daemon/tests/test_inject_empty_prompt.py（断言回排队）
- backend/app/modules/daemon/tests/test_session_router.py（注释回退标注）
- backend/app/modules/daemon/tests/test_session_user_preamble.py（断言平移到排队行）
- frontend/src/components/daemon/session-log-assembler.ts（TurnSegment 加 user_msg 段）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 非首主体转段按 ts 插入）
- frontend/src/components/daemon/turn-segment-views.tsx（UserMsgSegmentView 三态渲染）
- frontend/src/components/daemon/turn-timeline.tsx（segmentTsOf+对话视图放行）
- frontend/src/components/daemon/turn-status-bar.tsx（联动）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（实时三纯函数+删旧状态机）
- frontend/src/components/daemon/session-panel/session-panel-dialog.tsx（同款）
- frontend/src/components/daemon/message-queue-bar.tsx（⚡文案）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（段形态三态断言）
- frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx（文案断言）
- frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx（文案联动）
- .sillyspec/docs/SillyHub/modules/daemon.md（增量段）
需求：忙轮发送默认改回排队，点队列条「转为引导」才发引导消息；引导消息须渲染在真实时间位置（修复前移到轮次开头的 bug）。
根因：①首版把忙轮自动 steering 直注入当默认（D-001 语义过激）；②logsToTurns 把 mid-turn user_input 归并进轮 prompt + 实时挂在时间线末尾 streamFooter，两路都不按时间穿插。
方案：后端 router 删 busy_strategy=inject 自动门控回排队（引导入口收敛到 dispatch_now）；前端引导消息改轮内 user_msg 段模型——TurnSegment 新 kind、实时三纯函数驱动三态、回放非首主体组按 ts 插入段序列、⚡ 文案改「转为引导」。
结果：backend 41+13 用例全绿（断言回排队口径）、前端 tsc 0 错+65 测试全绿、daemon.md 增量段同步；子代理中断（额度）后分两段续做完成
审计：[gate] L1（跨 0 模块 · 33 文件：10 代码/6 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：⚖️ 归属切分：18 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：.zcode/skills/sillyhub-docker-deploy/SKILL.md, .zcode/skills/sillyspec-archive/SKILL.md, .zcode/skills/sillyspec-auto/SKILL.md, .zcode/skills/sillyspec-brainstorm/SKILL.md, .zcode/skills/sillyspec-commit/SKILL.md, .zcode/skills/sillyspec-continue/SKILL.md, .zcode/skills/sillyspec-execute/SKILL.md, .zcode/skills/sillyspec-explore/SKILL.md, .zcode/skills/sillyspec-knowledge/SKILL.md, .zcode/skills/sillyspec-plan/SKILL.md, .zcode/skills/sillyspec-propose/SKILL.md, .zcode/skills/sillyspec-quick/SKILL.md, .zcode/skills/sillyspec-resume/SKILL.md, .zcode/skills/sillyspec-state/SKILL.md, .zcode/skills/sillyspec-verify/SKILL.md, .zcode/skills/sillyspec-workspace/SKILL.md, AGENTS.md, .opencode/

## ql-20260920-007-d0dd | 2026-09-20 17:27:00 | claude 引擎 autocompact 做成 provider 级可配（解决 160K 过早压缩）。根因…
状态：已完成
关联变更：2026-09-20-claude-autocompact-config
文件：
- sillyhub-daemon/src/claude-settings.ts（白名单加三键+值守护）
- sillyhub-daemon/tests/claude-settings.test.ts（4 新用例）
- frontend/src/components/llm-providers/llm-provider-form.tsx（claude 条件压缩设置区）
- frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx（3 新用例）
- .sillyspec/docs/SillyHub/modules/daemon.md（增量段）
需求：claude 引擎 autocompact 做成 provider 级可配（解决 160K 过早压缩）。
根因：引擎默认 believed limit×~80% 触发（200K 窗口≈160K），平台 settings 白名单管道未放行 autocompact 键，无干预手段。
方案：settings_config 三键（autoCompactWindow/autoCompactEnabled/precomputeCompactionEnabled）经 daemon claude-settings.ts 白名单（值守护）写 settings.json；前端 provider 表单 claude 分支「引擎自动压缩」结构化区+超窗风险提示；零迁移零协议后端零改动。
结果：daemon claude-settings 22/22（4 新用例）、前端表单 29/29（3 新用例）、tsc 0 错、daemon.md 增量段同步
审计：[gate] L1（跨 0 模块 · 5 文件：2 代码/2 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260920-008-3066 | 2026-09-20 18:30:19 | 弹层三修。根因：单文件多条目/无高度约束/llm_provider_id 漏传。方案：条目级解析+新端点+滚动+供应商模型。结果…
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：弹层三修。
根因：单文件多条目/无高度约束/llm_provider_id 漏传。
方案：条目级解析+新端点+滚动+供应商模型。
结果：104+53+4129 绿 tsc 0，已提交推送（82a76721f）。

## ql-20260921-001-8a4d | 2026-09-21 01:31:55 | 24h审查四修：hits毒行/settings撤下/batch[1m]/⚡引导气泡
状态：已完成
关联变更：（无）
文件：
- .sillyspec/docs/SillyHub/modules/daemon.changelog.md（+1/-0）
- .sillyspec/docs/SillyHub/modules/daemon.md（+6/-1）
- .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md（+1/-0）
- .sillyspec/docs/SillyHub/modules/knowledge.md（+4/-0）
- backend/app/modules/auth/tests/test_rbac_workspace_scope.py（+5/-15）
- backend/app/modules/change/tests/test_scope_file_diff.py（+4/-4）
- backend/app/modules/knowledge/hits.py（+5/-1）
- backend/app/modules/knowledge/tests/test_hits.py（+29/-0）
- backend/app/modules/knowledge/tests/test_router.py（+2/-6）
- backend/app/modules/workspace/tests/test_platform_grant_list.py（+4/-12）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（+71/-0）
- frontend/src/components/daemon/session-panel/session-panel-dialog.tsx（+12/-3）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（+59/-2）
- sillyhub-daemon/src/claude-settings.ts（+36/-14）
- sillyhub-daemon/src/daemon.ts（+2/-2）
- sillyhub-daemon/src/task-runner.ts（+28/-2）
- sillyhub-daemon/tests/claude-settings.test.ts（+61/-3）
- sillyhub-daemon/tests/task-runner-one-m-suffix.test.ts（软归属·同模块测试，未声明）
需求：24h审查四修：hits毒行/settings撤下/batch[1m]/⚡引导气泡
根因：①knowledge hits type 列 String(32) 无截断，PG 超长抛 DataError 穿透 IntegrityError 兜底整批 500，daemon 上行按批推进无按行跳过——单条毒行永久卡死该工作区遥测；②claude settings.json 空对象不写不删，autocompact 三键撤勾后旧值永久残留生效且全 daemon 无清理路径；③ade38ec37 的 [1m] 修复漏 batch 路径——CLI --model 旗标压掉 env 档位，1M 供应商批量任务仍 ~160k 提前压缩；④⚡ dispatch_now 引导链路发送点不建 steering 段（hook 不消费响应、inject 忙轮恒排队），mid-turn 留痕 SSE 行无段可收敛，引导消息实时视图静默丢弃
方案：①_build_row type 补 [:32] 截断+截断用例；②applyClaudeSettings 空对象改删既有文件（撤下语义）+writeFileAtomic+撤下矩阵 4 用例；③task-runner 新增导出纯函数 batchModelWithOneM 应用于 spawn args --model 单点+7 用例；④session-panel-page 新增导出 appendDeliveredUserMsgIfAbsent，page/dialog 两处 SSE user_input 处理器兜底追加 delivered 段+⚡场景用例；门禁解锁清偿 5 处存量债：knowledge test_router.py format（ad8b48816 遗留）+9109db20b/8d628ba53 三测试文件 format+scope_file_diff _AUDIT_OK Any 注解（object 不可索引 mypy 错）；daemon.md 契约行/增量+两模块 changelog+knowledge.md 增量同步
结果：backend knowledge 124 + change 535 passed、mypy 967 文件 0 错、ruff check/format 全仓绿；daemon claude-settings 26+one-m 7+相邻面 130 passed + typecheck 0；frontend sessions page 41 passed + tsc 0 + eslint 0 error（5 warning 均 HEAD 既有）；未部署验证（daemon bundle 随下次发布）
审计：[gate] L1（跨 0 模块 · 18 文件：6 代码/8 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：🔍 软归属：1 个窗口内未声明同模块测试文件已补入文件行（若属并行会话改动请手工剔除）：sillyhub-daemon/tests/task-runner-one-m-suffix.test.ts（+74/-0）

## ql-20260921-002-d79d | 2026-09-21 02:41:37 | dispatch_now双注入竞态收口——steered预删同事务+复取非pending守卫
状态：已完成
关联变更：（无）
文件：.sillyspec/docs/SillyHub/modules/daemon.changelog.md（+1/-0）, .sillyspec/docs/SillyHub/modules/daemon.md（+6/-0）, backend/app/modules/daemon/session/service/queue.py（+33/-11）, backend/app/modules/daemon/tests/test_session_queue_actions.py（+140/-0）
需求：dispatch_now双注入竞态收口——steered预删同事务+复取非pending守卫
根因：旧序 steered 分支注入内部 commit 释放会话行锁后才回本函数删行，无锁窗口内并发 dispatch_now（双击⚡）复取仍见 pending 行→同条消息 mid-turn 双注入双留痕；注入 commit 后进程崩溃窗口条目残留还会被接力派发二次发送；另复取只判 None，接力派发失败化的 failed 条目照走注入/打断分支（F3）
方案：删行改注入前同事务预删——_inject_mid_turn_into_run 内部 commit 把删除与 user_input 留痕原子落库，注入 commit 前失败其内部 rollback 连带复活条目（失败语义与旧序逐字一致，enqueue_and_push/publish 均 best-effort 不抛无已删未投路径）；复锁复取补非 pending 守卫按已派发收口返 dispatched；补 3 用例（注入时刻同事务已删不变式/离线 rollback 复活/复取 failed 收口，核心两用例 stash 验证旧码红）；daemon.md 增量+changelog 同步
结果：queue_actions 37 passed（+3）+ daemon 模块全量 2361 passed、ruff/format/mypy 0；前端零改动（响应契约不变）；未部署验证
审计：[gate] L1（跨 0 模块 · 4 文件：1 代码/1 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量不适用（≤1 代码文件）

## ql-20260921-003-cc14 | 2026-09-21 08:43:53 | scan-docs 页面首屏提速与人类可读卡片视图
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/scan_docs/service.py（reparse hash跳过未变更行大列重写+_dt_equal时区归一+预取排除content）
- backend/app/modules/scan_docs/tests/test_service.py（新增TestReparseSkipsUnchangedRows两用例）
- frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx（列表先行+后台reparse+一级展开+卡片原文双tab+中文标签）
- frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx（新增首屏/刷新/视图切换3用例）
- frontend/src/lib/scan-docs-tree.ts（抽出stripPathPrefix）
- frontend/src/lib/__tests__/scan-docs-tree.test.ts（stripPathPrefix三用例）
- .sillyspec/docs/backend/modules/scan_docs.md（同步reparse跳过语义）
- .sillyspec/docs/frontend/modules/app-workspace-pages.md（同步ScanDocsPage行为）
- .sillyspec/docs/frontend/modules/lib-scan-docs-tree.md（补stripPathPrefix契约）
需求：scan-docs 页面首屏提速与人类可读卡片视图
根因：进页先同步跑 reparse（读全部296个文档+对每行整体重赋值含content大列）再拉列表，首屏被文件系统全量解析和写库阻塞；内容区只有原文视图，缺少知识库那样的人类可读卡片形态
方案：前端列表先行渲染、reparse转后台静默刷新（失败不打断浏览）、树默认只展开项目层（搜索时全摊开）、md详情区复用EntryCardList做卡片/原文双tab、目录scan/flows/modules与标准doc_type徽标配中文标签；后端_apply_parsed以content_hash相等跳过未变更行大列重写（_dt_equal时区归一比较mtime）、_fetch_existing预取load_only排除content
结果：后端pytest scan_docs+spec_workspace backfill 62过（新增未变更行零UPDATE/变更行hash跟进2用例）；前端vitest 12过（新增首屏不阻塞/后台刷新/卡片原文切换3用例）；tsc 0错；eslint 0警告；ruff check+format过
审计：[gate] L1（跨 0 模块 · 9 文件：3 代码/3 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260921-004-92f8 | 2026-09-21 09:17:47 | 直发消息双显示竞态修复——占位轮被先到的 SSE 原地认领
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（新增导出 claimPendingPlaceholderTurn 纯函数（steerMatchKey 同文认领占位轮）+ onLog user_input 分支插入认领调用）
- frontend/src/components/daemon/session-panel/session-panel-dialog.tsx（onLog user_input 分支插入同款认领调用（经 page 模块共享导入））
- frontend/src/components/daemon/__tests__/session-panel-placeholder-claim.test.ts（新建——认领纯函数 7 用例（含附件标记行同构/空键/多条防御））
- frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx（新增端到端用例——inject 挂起 + user_input SSE 先到 + daemon 双提交裸文本版均单气泡）
- .sillyspec/docs/frontend/modules/components-daemon.md（quick 增量段（根因/认领口径/回落守卫/回归清单））
需求：直发消息双显示竞态修复——占位轮被先到的 SSE 原地认领
根因：backend inject commit 后立即补发 user_input SSE 事件，而 HTTP 响应要等 ready 等待（≤8s）+ WS 派发才返回；SSE 先到时前端按真实 run_id 另建一轮，与本地占位轮同屏双显，响应到达才合并（用户实证同一消息两条气泡数秒后自动合并）
方案：session-panel-page 新增 claimPendingPlaceholderTurn：user_input 事件到达且尚无该 run_id 轮时，按 steerMatchKey 同文匹配把 __pending_inject_* 占位轮原地改名为真实 run_id（status→running）；page/dialog 两挂载点 onLog user_input 各插一行；不认领守卫（无占位/已有轮/异文/空键）回落响应侧 replacePlaceholderTurn 既有收敛（幂等兜底不动）
结果：新增 7 用例单测 + 1 端到端用例（修复前红），两测试文件 70 用例全绿；pnpm typecheck 通过；pnpm lint 触碰文件无新增告警（存量告警行号均未触碰）
审计：[gate] L1（跨 0 模块 · 5 文件：2 代码/2 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260921-005-d0aa | 2026-09-21 10:47:28 | cursor 会话开放附件——caps 第 15 键 attachments（disk-only）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/providers.ts（caps 单源：接口+四引擎 attachments 取值+docblock 依据）
- sillyhub-daemon/scripts/gen-provider-caps.mjs（CAPS_KEYS+两端模板 15 键）
- sillyhub-daemon/tests/interactive/provider-registry.test.ts（契约键列表 14→15）
- frontend/src/lib/provider-caps.ts（生成产物）
- backend/app/modules/agent/provider_caps.py（生成产物）
- backend/app/modules/agent/tests/test_provider_caps_alignment.py（EXPECTED_CAPS_KEYS 扩 attachments）
- backend/app/modules/daemon/attachment_pipeline.py（resolve_multimodal_gate 与 engine 块通道相与）
- backend/app/modules/daemon/session/service/attachments.py（inject/create 门控改 attachments 键+中性文案）
- backend/app/modules/daemon/tests/test_attachment_pipeline.py（gate 相与用例+mock 键更新）
- backend/app/modules/daemon/tests/test_session_provider_caps.py（真值表改 attachments+cursor 放行用例+新文案）
- backend/app/modules/knowledge/distill.py（洞一预检同改键（含 ruff format））
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（附件入口门控改键）
- frontend/src/components/daemon/session-panel/session-panel-dialog.tsx（附件入口门控改键）
- frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx（attachments 两态对照+cursor 用例）
- frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx（pi 断言改 attachments+全对象补键）
- .sillyspec/docs/SillyHub/modules/daemon.md（增量段落+caps 单源描述补第 15 键）
需求：cursor 会话开放附件——caps 第 15 键 attachments（disk-only）
根因：cursor CLI 无多模态块通道导致附件被整链 422 拒收，但 daemon 落盘+路径清单链路引擎中立本就可行（用户指出直接给文件路径即可）
方案：ProviderCaps 新增 attachments 键（claude/pi/cursor=true、codex=false）拆分 multimodal 块通道语义；三端生成刷新+守护测试 15 键；backend inject/create/distill 门控改查新键，resolve_multimodal_gate 与 caps.multimodal 相与强制 cursor 图片/PDF 降级落盘防静默丢图；前端 4 处附件入口改查新键。测试断言重写说明：provider-registry fourteenKeys→fifteenKeys、pre-session-picker pi.multimodal→pi.attachments 均为新键接入同步契约清单（改键目的本身），非改断言凑绿。test 门禁 skip 理由：本轮沙箱被并行变更 scan-docs-ops-panel 半成品混入（scan_docs 9 失败，本会话零 scan_docs 文件，verify 对账已排除并行文件）+ 快照行尾致 ruff format 假阳性（主仓 format --check 1294 全绿）；实测已由前轮沙箱（五模块 841.9s test passed）与主仓 scoped 全绿覆盖
结果：主仓 scoped：backend 60+11 passed + ruff check/format/mypy 0、frontend 49 passed、daemon typecheck 过 + registry 14 passed；前轮门禁沙箱 test 五模块全绿 841.9s（daemon 全量 17 失败均为既有 60s 环境性超时，单跑全绿）
审计：[gate] L1（跨 1 模块 · 58 文件：19 代码/30 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：⚖️ 归属切分：37 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：.github/workflows/frontend-ci.yml, backend/app/modules/scan_docs/router.py, backend/app/modules/scan_docs/schema.py, backend/app/modules/scan_docs/tests/test_stats.py, backend/openapi.json, docs/sillyspec/quick-gate-并行全流程变更脏文件误伤.md, frontend/.gitignore, frontend/package.json, frontend/pnpm-lock.yaml, frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx, frontend/src/components/__tests__/admin-org-tree.test.tsx, frontend/src/components/__tests__/agent-profile-form.test.tsx, frontend/src/components/__tests__/runtime-usage-line-chart.test.tsx, frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx, frontend/src/components/__tests__/work-hour-bar-chart.test.tsx, frontend/src/components/__tests__/work-hour-pie-chart.test.tsx, frontend/src/components/agent-profile/__tests__/agent-profile-card-grid.test.tsx, frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx, frontend/src/components/changes/__tests__/platform-sync-section.test.tsx, frontend/src/components/daemon/__tests__/bash-progress-card.test.tsx, frontend/src/components/daemon/__tests__/platform-shared-agents-card.test.tsx, frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx, frontend/src/components/explorer/__tests__/file-explorer.test.tsx, frontend/src/components/explorer/__tests__/file-preview.test.tsx, frontend/src/components/group-chat/__tests__/member-panel.test.tsx, frontend/src/components/scan-docs-stats-panel.tsx, frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx, frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx, frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/scan-docs.ts, frontend/src/test/dom-queries.ts, frontend/vitest.config.ts

## ql-20260921-006-2095 | 2026-09-21 11:19:25 | 前端 CI 接入覆盖率报告——不设门槛先看数
状态：已完成
关联变更：（无）
文件：
- frontend/package.json（加 devDep @vitest/coverage-v8@2.1.9 + test:coverage 脚本）
- frontend/pnpm-lock.yaml（安装产物）
- frontend/vitest.config.ts（新增 coverage 配置段(不设阈值)）
- .github/workflows/frontend-ci.yml（Test 步改覆盖率运行+报告 artifact+timeout 20min）
- frontend/.gitignore（补 coverage/ 产物目录）
- .sillyspec/docs/multi-agent-platform/modules/ci.md（frontend-ci 步骤与覆盖率门禁口径更新）
- .sillyspec/docs/multi-agent-platform/modules/ci.changelog.md（新建变更索引）
需求：前端 CI 接入覆盖率报告——不设门槛先看数
根因：313 个前端测试文件无任何覆盖率度量,测没测到全凭感觉,是测试体系唯一盲区;backend 已有 cov-fail-under=60 硬门,前端冷启动直接设门槛只会即红,故先观察
方案：package.json 加 @vitest/coverage-v8@2.1.9(精确匹配 vitest 2.1.9)+ test:coverage 脚本;vitest.config.ts 加 coverage 段(v8、text+html、include src/**、排除测试自身与测试基建,无 thresholds);frontend-ci.yml Test 步改跑 pnpm test:coverage + upload-artifact 上传 coverage/ 报告(7 天),timeout 15→20 分钟;.gitignore 补 coverage/;同步 ci 模块卡与 changelog
结果：client-path 子集带覆盖率运行 1 文件 2 用例全过,text 摘要正常输出、coverage/index.html 生成;CI 全量验证留待下次 push
审计：[gate] L1（跨 1 模块 · 7 文件：3 代码/0 测试）advisory；每文件注记已全覆盖；测试增量缺失（3 个代码文件无测试改动）

## ql-20260921-007-727c | 2026-09-21 11:40:57 | 测试断言收拢:antd/echarts/加载态类查询集中封装 helper,清理纯样式类断言
状态：已取消
关联变更：（无）
文件：frontend/src/test/dom-queries.ts, frontend/src/app/(dashboard)/runtimes/page.test.tsx, frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx, frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx, frontend/src/components/mobile/mobile-workspace-header.test.tsx, frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx, frontend/src/components/chat/__tests__/round-divider.test.tsx, frontend/src/components/chat/__tests__/chat-message-avatar.test.tsx, frontend/src/components/daemon/__tests__/bash-progress-card.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/llm-providers/__tests__/usage-footer.test.tsx, frontend/src/components/agent-profile/__tests__/agent-profile-card-grid.test.tsx, frontend/src/components/changes/__tests__/platform-sync-section.test.tsx, frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx, frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx, frontend/src/components/daemon/__tests__/platform-shared-agents-card.test.tsx, frontend/src/components/explorer/__tests__/file-explorer.test.tsx, frontend/src/components/explorer/__tests__/file-preview.test.tsx, frontend/src/components/group-chat/__tests__/member-panel.test.tsx, frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/components/__tests__/agent-profile-form.test.tsx, frontend/src/components/__tests__/runtime-usage-line-chart.test.tsx, frontend/src/components/__tests__/work-hour-bar-chart.test.tsx, frontend/src/components/__tests__/work-hour-pie-chart.test.tsx

## ql-20260921-008-b962 | 2026-09-21 11:48:04 | 前端测试第三方结构查询收口 dom-queries——antd/echarts 升级爆炸面归一
状态：已完成
关联变更：（无）
文件：.sillyspec/docs/frontend/modules/test-utils.changelog.md（+8/-0）, .sillyspec/docs/frontend/modules/test-utils.md（+8/-2）, frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx（+7/-6）, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（+3/-4）, frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx（+19/-18）, frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx（+3/-2）, frontend/src/components/__tests__/admin-org-tree.test.tsx（+2/-1）, frontend/src/components/__tests__/agent-profile-form.test.tsx（+4/-5）, frontend/src/components/__tests__/runtime-usage-line-chart.test.tsx（+6/-5）, frontend/src/components/__tests__/work-hour-bar-chart.test.tsx（+4/-3）, frontend/src/components/__tests__/work-hour-pie-chart.test.tsx（+4/-3）, frontend/src/components/agent-profile/__tests__/agent-profile-card-grid.test.tsx（+5/-7）, frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx（+4/-3）, frontend/src/components/changes/__tests__/platform-sync-section.test.tsx（+3/-2）, frontend/src/components/daemon/__tests__/bash-progress-card.test.tsx（+5/-4）, frontend/src/components/daemon/__tests__/platform-shared-agents-card.test.tsx（+12/-14）, frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx（+2/-1）, frontend/src/components/explorer/__tests__/file-explorer.test.tsx（+11/-16）, frontend/src/components/explorer/__tests__/file-preview.test.tsx（+3/-2）, frontend/src/components/group-chat/__tests__/member-panel.test.tsx（+4/-5）, frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx（+8/-9）, frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx（+4/-3）, frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（+17/-16）, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（+12/-13）
需求：前端测试第三方结构查询收口 dom-queries——antd/echarts 升级爆炸面归一
根因：22 个测试文件散落约 95 处 .ant-*/.echarts-for-react 字面量查询,antd 大版本升级或图表库替换时测试会成片碎;评估时标记的纯样式断言逐处审计后确认全部为有意契约守卫(主题语义阶/触摸热区/需求R-01槽位/原型配色),故样式清理零删除,只做结构查询收口
方案：新建 src/test/dom-queries.ts 17 函数;校验式 codemod 迁移 22 文件约95处(期望命中数校验,修过 CRLF 行尾与 import 插入点两坑);被改断言均为同类名→同 helper 的等价迁移(语义护栏指向的三个文件即属此类,不改变绿灯语义);scan-docs-page 与 pre-session-picker 因并行会话改动暂缓;同步 test-utils 模块卡+changelog。test gate 两轮红均出自并行会话 2026-09-21-scan-docs-ops-panel 的 WIP 文件(test_stats.py 9 failed / router.py ruff-format),非本变更文件;本变更不涉任何 backend 文件,按规则 19 不越界修他者活跃变更,故 SILLYSPEC_QUICK_TEST_GATE=skip 留痕跳过(本地实证见结果字段,CI push 后全量再验)
结果：22 文件 513 用例全绿(106.7s)、tsc --noEmit 干净、eslint 0 error(13 warning 全存量)、残留字面量 grep 为零;门禁快照内 frontend 侧无失败(红全部为并行会话 scan_docs WIP);CI 全量留待 push
审计：[gate] L1（跨 0 模块 · 33 文件：6 代码/24 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：⚖️ 归属切分：8 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/scan_docs/router.py, backend/app/modules/scan_docs/schema.py, backend/app/modules/scan_docs/tests/test_stats.py, backend/openapi.json, frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx, frontend/src/components/scan-docs-stats-panel.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/scan-docs.ts

## ql-20260922-001-37e7 | 2026-09-22 07:15:42 | 24h 审查五修——附件落盘原子化等 5 个中危修复
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/scan_docs/service.py（skip 加 row.exists 判定（软删复活全量回填）+注入榜拆#锚）
- backend/app/modules/daemon/session/service/ppm_activation.py（门控 multimodal→attachments 键+docblock 旧口径同步）
- sillyhub-daemon/src/interactive/session-manager/turn-control.ts（落盘 size 校验复用+tmp/rename 原子化）
- sillyhub-daemon/src/task-runner.ts（applyClaudeSettings 移入重试循环）
- backend/app/modules/scan_docs/tests/test_service.py（软删复活回填用例）
- backend/app/modules/scan_docs/tests/test_stats.py（拆锚聚合用例）
- backend/app/modules/daemon/tests/test_ppm_session.py（门控真值表 2 用例）
- sillyhub-daemon/tests/task-runner-retry-timeout.test.ts（apply=attempt 数用例）
- sillyhub-daemon/tests/turn-control-attachment-atomic.test.ts（新建：落盘原子化 4 用例）
需求：24h 审查五修——附件落盘原子化等 5 个中危修复
根因：24h 只读审查发现 5 个中危：①scan_docs 软删行同内容复活命中 hash-skip 只回 exists 不回填 content，正文永久 None；②writeAttachmentFile wx 直写最终路径，崩溃半截文件被 EEXIST 永久复用（cursor disk-only 唯一通道无兜底）；③CLAUDE_CONFIG_DIR 全局唯一，并发 lease 撤下 unlink 可删掉 settings.json 而 applyClaudeSettings 在重试循环外只调一次，attempt 2+ spawn 丢配置；④ql-20260921-005 三处门控改 attachments 键漏改 ppm_activation，cursor 会话 PPM 附件被错误降级；⑤注入榜未拆 #锚 后缀，docs_hit_30d 按 (文件,锚) 去重虚高
方案：①_apply_parsed skip 条件加 row.exists（软删行走全量回填；不用 content 判定——load_only 排除后读会触发 deferred 懒加载）；②落盘改 size 校验复用 + tmp/rename 原子落位（半截自愈）；③applyClaudeSettings 移入 for(;;) 循环每次 attempt spawn 前重写（幂等）；④门控改 attachments 键 + docblock 三处旧口径同步；⑤_strip_docs_prefix 后 split('#',1)[0] 对齐 knowledge/hits 先例
结果：本地实测全绿：新增 8 用例（半截自愈/apply=attempt 数/cursor 不降级/软删回填/拆锚聚合均旧码红）+ 回归 scan_docs 46 + ppm 16 + daemon 31+144 passed，ruff/format/mypy/tsc 0 错。门禁全量中 12 个 stats-passthrough/budget 等 runLease 集成用例超时系主仓既有环境问题（三重对照：未提交改动 stash 对照仍挂/26e362d61 还原对照仍挂/9-20 全量时全绿且依赖与测试文件未变；本机 Temp 堆积 412 个 sillyhub 残留），与本次改动无关，环境根因待单独排查——按审计留痕通道跳过门禁复跑
审计：📎 文档引用失效：1/0 处 file:line 失效（sillyspec docs check 可复现）
审计：   ❌ [docs/sillyspec/quick-gate-并行全流程变更脏文件误伤.md:0]  → 文档不存在
审计：[gate] L1（跨 0 模块 · 16 文件：4 代码/5 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：⚖️ 归属切分：4 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/quick-done-长静默与快照行尾假阳性.md, docs/sillyspec/quick-gate-并行全流程变更脏文件误伤.md, docs/sillyspec/verify-gate-worktree-crossrepo-three-defects.md, docs/sillyspec/finished/quick-gate-并行全流程变更脏文件误伤.md

## ql-20260923-001-7986 | 2026-09-23 08:57:34 | change-events-channel 执行会话反馈④：pre-commit ruff 拦提交两次…
状态：已完成
关联变更：（无）
文件：
- backend/.pre-commit-config.yaml（两 hook entry bash -c 失败提示包装+实证注释）
需求：change-events-channel 执行会话反馈④：pre-commit ruff 拦提交两次，归因『hook ruff(0.15.14) 与项目 uv ruff 版本格式化结果有差异』，诉求 hook 提示里直接给出对齐版本的修复命令
根因：实证为误诊：hook 语言 system 经 uv run 解析，仓库根与 backend 两处 uv run ruff --version 均 0.15.14、与 uv.lock 一致，无版本漂移；真实盲点=被拦时 ruff 只报 diff，对齐修复命令只写在 yaml 注释块里，失败现场不可见——check-only 是 2026-09-11 ql-20260911-006 的既定设计（auto-fix 会触发 stash 冲突回滚），不能回退
方案：两 hook entry 改 bash -c 包装：命令失败时 exit 1 前打印『↩ 修复命令（与 hook 同源 uv 环境，勿用全局 ruff）：cd backend && uv run ruff format <被拦文件>』（check hook 对应 --fix 形态）；注释块补 2026-09-23 实证记录防后续会话再误诊版本漂移
结果：pre-commit run 双路径实测：坏格式探针（x=1）→ Failed + 修复命令行出现在输出；真实干净文件 → Passed；探针即用即删。纯配置改动（yaml 单文件），test/lint 门禁按配置类自动跳过
