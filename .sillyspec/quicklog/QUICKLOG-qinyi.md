
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
状态：进行中
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
