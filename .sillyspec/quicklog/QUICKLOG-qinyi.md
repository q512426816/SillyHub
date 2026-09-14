
## ql-20260911-027-13b6 | 2026-09-11 16:48:56 | pi 会话 AskUser 弹窗缺失修复——vendored ask-user 扩展补发起端
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/vendor/pi-extensions/ask-user/index.ts（新增自研扩展（AskUserQuestion 工具））
- | sillyhub-daemon/vendor/pi-extensions/README.md（补 ask-user 自研件行+双降级开关）
- | sillyhub-daemon/src/interactive/pi-rpc-driver.ts（共用路径解析+ask-user 装载）
- | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（beforeEach off 同款+5 新例）
- | .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引补 ql-20260911-027-13b6）
- sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（软归属·同模块测试，未声明）
需求：pi 会话 AskUser 弹窗缺失修复——vendored ask-user 扩展补发起端
根因：2026-09-09-askuser-pi-cursor 只做了 pi 弹窗链路的接收半（extension_ui_request→平台弹窗桥接），但 pi 本体无任何模型可调的提问工具、daemon 只挂 subagent 扩展，发起端缺失——pi 会话模型只能文字罗列问题（会话 d4c29d95 实证 session_dialog_requests 零行）
方案：新增自研扩展 vendor/pi-extensions/ask-user/index.ts 注册 AskUserQuestion 工具（有选项 ctx.ui.select、无选项 ctx.ui.input，不传 timeout 永久等待，降级路径明确文本）；pi-rpc-driver 抽共用 resolveVendoredExtensionPath + piVendoredAskUserExtensionPath（SILLYHUB_PI_ASK_USER_EXTENSION 可 off）+ spawn 第二个 --extension；工具名对齐 claude 内置名使双端 tool-kind 分类器零改动
结果：pi-rpc-driver 78 passed（+5 新例）；tsc 0；本机真实 pi CLI 装载冒烟通过（对照实验验证方法有效）；待提交后 bundle 部署服务器 + 本机 daemon 自更新 + 平台真机验证
审计：⚖️ 归属切分：3 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/src/interactive/pi-rpc-driver.ts, sillyhub-daemon/vendor/pi-extensions/README.md, sillyhub-daemon/vendor/pi-extensions/ask-user/
审计：🔍 软归属：1 个窗口内未声明同模块测试文件已补入文件行（若属并行会话改动请手工剔除）：sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（+78/-0）

## ql-20260911-028-8736 | 2026-09-11 19:01:43 | 代报需要延迟兜底——活体 mission c4731a06/worker 4ca98b77 实证 claude_code 分身（mcp=true 自报路径）未调…
状态：已完成
关联变更：2026-09-10-review-dispatch-platform-fixes
文件：
- sillyhub-daemon/src/daemon.ts（缓存+延迟兜底）
- sillyhub-daemon/src/hub-client.ts（getMissionStatus opts）
- sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts（新增 6 用例）
- .sillyspec/docs/SillyHub/modules/daemon.md（代报链条目）
需求：代报需要延迟兜底——活体 mission c4731a06/worker 4ca98b77 实证 claude_code 分身（mcp=true 自报路径）未调 worker_done 工具致 artifacts 恒空。
根因：立即代报只覆盖 mcp=false（claude 自报无兜底）；pi 空白 result（override 晚到）无补报机会；叠加 workspace b97f8231 default_agent=NULL 使派发白跑 claude（已补 pi）。
方案：一切 mission_worker 成功轮 +90s 探测 getMissionStatus（session-scoped opts.sessionId）——本 run artifacts 仍空且 mission 活跃才用 result/会话级最后全文兜底代报（防双写）；文本缓存双写源（onTurnMessage 完整 text 事件 + result），FIFO 500 上限。
结果：daemon 18 用例（新增 6：兜底触发/已自报跳过/不活跃跳过/pi 立即后不二次/空白+晚到全文/探测失败与缺失）+回归 111 全绿，tsc 过；4ca98b77 已手工回填（artifact 8da04f9c 全文 11928 字节）；uuid 配对疑点裁决非 bug（_revoke_committed_partials 按 segment_id 单段配对，by-design）。

## ql-20260911-029-5571 | 2026-09-11 21:33:04 | pi 切智谱断流修复：models.json api 按 api_format 映射
状态：已完成
关联变更：2026-09-11-session-provider-switch-codex-pi
文件：
- sillyhub-daemon/src/pi-settings.ts（PROVIDER_API→piApiForFormat 映射+未知格式 warn 跳过）
- sillyhub-daemon/tests/pi-settings.test.ts（期望值+未知格式新用例）
- sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts（pi 产物期望值）
- sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts（fixture+mock /v1/messages+x-api-key 断言）
- .sillyspec/docs/sillyhub-daemon/modules/pi-settings.md（契约/逻辑/基线三处同步）
需求：pi 切智谱断流修复：models.json api 按 api_format 映射
根因：writePiDir 把 api 写死 openai-completions（上一变更按 OpenAI 兼容端点 golden 设计），anthropic 形态无映射——pi 拿 OpenAI 协议打智谱 anthropic 端点必断流（线上会话 d4c29d95 首切实证，pi 四次重试全秒断）
方案：PROVIDER_API 常量改 piApiForFormat 映射（anthropic/缺省→anthropic-messages；未知值→warn 跳过零写入）；writeModelsJson 增 api 参；pi-settings/dispatch 期望值 + 未知格式新用例 + smoke integ fixture 加 api_format、mock 增 /v1/messages anthropic SSE、断言改 x-api-key 头；pi-settings 模块卡三处口径同步
结果：typecheck 0 错；pi-settings 16 + dispatch 17 + reload 21 + smoke integ 5（真 pi CLI 命中 mock /v1/messages + x-api-key，exit=0）全绿；真实智谱端点端到端实测（用户 key + glm-5.3）输出正常 exit=0；待重新打包部署


## ql-20260911-030-dbf0 | 2026-09-11 22:24:11 | 群聊面板聊天背景与输入框高度拖拽对齐常规会话样式
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/group-chat/group-chat-panel.tsx（背景四层对齐 + 拖拽手柄移植 + 胶囊换会话同款）
- frontend/src/components/group-chat/member-panel.tsx（旁栏玻璃化（bg-card/70 对齐会话列表））
需求：群聊面板聊天背景与输入框高度拖拽对齐常规会话样式
根因：群聊面板视觉独立演进——根容器平铺 bg-card 不透明全卡（会话为玻璃 bg-card/80 backdrop-blur + 时间线 bg-background 分层）、输入胶囊 rounded-xl bg-card + primary 聚焦（会话 rounded-2xl bg-muted/40 + brand 柔环）、无输入框高度拖拽能力（会话 ql-20260826-010 已有）
方案：group-chat-panel 根/头/时间线/typing/输入区逐层抄 session-panel 语义类；拖拽逻辑原样移植并与单聊共享同一 localStorage 键（sillyhub.sessions.inputBarHeight 全局高度偏好）；textarea 去掉 max-h-[120px] 钳制挂受控高度；member-panel 根玻璃化对齐会话列表面板旁栏口径
结果：群聊 113 用例 + sessions-portal/m-sessions 64 用例全绿、tsc 0 错；dev server 真浏览器实测拖拽 44→144px 落盘 + 双击恢复清键、群聊与会话两面板渲染类名 1:1 对齐（玻璃 blur 24px / bg-background / 胶囊 16px 圆角）

## ql-20260911-020-c7e2 | 2026-09-11 22:50:00 | session-panel-pre-session mock 补 agent_kind（预存债顺手修）
状态：已完成
关联变更：2026-09-11-workspace-asset-bridges（verify 门暴露；债务源 1e4bb818f/2026-09-11-session-provider-switch-codex-pi）
文件：frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx（mock provider 补 agent_kind: claude）
验证：36 passed

## ql-20260912-001-081d | 2026-09-12 07:06:51 | 24h 只读审查发现的十项高置信风险落地修复（H-1 subdir 穿越 / H-2 MCP PATCH 密钥静默清空 / H-3 头像误删新文件 / M-1…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/skill_source/service.py（H-1 校验+safe_discovery_root+M-4/M-5+循环导入拆环）
- backend/app/modules/skill_source/git_fetcher.py（M-1/M-2/M-3/M-6+probe 补杀）
- backend/app/modules/mcp_registry/service.py（H-2 密钥保留语义）
- backend/app/modules/file/service.py（M-8 docstring）
- backend/app/modules/agent/skills_bundle_service.py（M-6+safe_discovery_root 接入）
- frontend/src/lib/auth.ts（H-3 fetchMe best-effort）
- docs/sillyspec/external-mode-no-root-session-resolution.md（门禁拦·裸文件名引用改仓根相对路径）
- backend/app/modules/mcp_registry/tests/test_service.py（软归属·同模块测试，未声明）
- backend/app/modules/skill_source/tests/test_git_fetcher.py（软归属·同模块测试，未声明）
- frontend/src/lib/__tests__/auth.test.ts（软归属·同模块测试，未声明）
需求：24h 只读审查发现的十项高置信风险落地修复（H-1 subdir 穿越 / H-2 MCP PATCH 密钥静默清空 / H-3 头像误删新文件 / M-1 换 URL 失效 / M-2 Windows rmtree 死循环 / M-3 子进程树杀 / M-4 事件循环阻塞 / M-5 branch 注入+refresh SSRF 复查 / M-6 symlink 越界读 / M-8 回收语义 docstring），外加预存循环导入拆环与并行会话遗留的门禁两拦（坑文档移动核实放行、裸文件名引用改仓根相对路径）。
根因：GET 不回显密钥键致读-改-写交集恒空、fetchMe 与 PATCH 同抛误判保存失败、origin 地址只写 DB 不修正、git 只读对象+rmtree ignore_errors 静默失败、kill 单进程留 helper 孤儿、同步 os.walk 阻塞事件循环、refspec 位可注入选项、followlinks 只挡目录链接、workspace/__init__ 急切拉 router 成环。
方案：service 层 validate_subdir/validate_branch 422 + safe_discovery_root 五消费点纵深、密钥保留语义改显式清空、fetchMe best-effort、remote get-url/set-url 漂移修正、rmtree_force onexc chmod 重试、POSIX killpg+Windows taskkill /T /F、asyncio.to_thread 四点、symlink 双侧跳过、Workspace 延迟导入拆环。
结果：skill_source 80 passed 2 skipped（Windows symlink 按设计跳过）/ mcp_registry test_service 58 passed / 前端 auth 4 + 账号页 15 passed / ruff check+format 绿 / mypy 14 文件零 issue / 前端 tsc exit 0。
审计：⚖️ 归属切分：7 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：.gitignore, backend/app/modules/skill_source/tests/test_source_crud.py, backend/migrations/env.py, backend/migrations/versions/1d763051eb15_merge_workspace_scope_and_agent_log_.py, docs/sillyspec/pre-commit-autofix-swallows-commit.md, docs/sillyspec/finished/agent-log-hub-attribution-cross-session-contamination.md, docs/sillyspec/finished/pre-commit-autofix-swallows-commit.md
审计：🔍 软归属：3 个窗口内未声明同模块测试文件已补入文件行（若属并行会话改动请手工剔除）：backend/app/modules/mcp_registry/tests/test_service.py（+82/-4）, backend/app/modules/skill_source/tests/test_git_fetcher.py（+126/-1）, frontend/src/lib/__tests__/auth.test.ts（+83/-0）

## ql-20260912-001-b3f7 | 2026-09-12 07:30:00 | env.py 登记+循环导入 P0+双 head 缝合+gitignore（quick 三连收尾）
状态：已完成
关联变更：2026-09-11-workspace-asset-bridges / 2026-09-11-skills-central-library（遗留收尾）；并行 20260912050000（双 head 缝合）
文件：
- backend/migrations/env.py（补 skill_source model import——autogenerate 假漂移消除）
- backend/app/modules/skill_source/service.py（Workspace 顶层导入→函数级 lazy：bridges task-03 的 skills_view_service 反向导入造成循环，import skill_source.service 直接炸——真 P0 顺手抓）
- backend/migrations/versions/1d763051eb15_merge_*.py（双 head merge revision）
- .gitignore（deploy/*.tar.gz——289MB 产物误入 4ad0b87c6 教训）
验证：570 passed+3skip（四模块）+ import 链 app.main OK + ruff/mypy clean + alembic 单 head

## ql-20260912-002-4e8a | 2026-09-12 11:30:00 | pre-session-picker caps 断言同步第 10 键（预存债）
状态：已完成
关联变更：全局审查暴露；债务源 56a37498b/2026-09-11-provider-adapter-registry
文件：frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx（九键→十键两处断言补 provider_switch）
验证：27 passed

## ql-20260912-003-4506 | 2026-09-12 16:00:28 | 任务执行面板轮次历史 tokens 列拆分为输入/输出/缓存读取/缓存写入四维独立展示
状态：已完成
关联变更：（无）
文件：.sillyspec/docs/SillyHub/modules/daemon.changelog.md（+1/-0）, .sillyspec/docs/SillyHub/modules/frontend_components.md（+2/-1）, .sillyspec/docs/SillyHub/modules/frontend_lib.md（+1/-1）, backend/app/modules/agent/provider_caps.py（+97/-0）, backend/app/modules/daemon/router/session_insights.py（+8/-0）, backend/app/modules/daemon/tests/test_session_runs_endpoint.py（+8/-1）, backend/openapi.json（+23/-1）, docs/sillyspec/docs-gate-shared-worktree-parallel-block.md（+0/-16）, frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx（+43/-0）, frontend/src/components/daemon/task-execution-panel.tsx（+54/-28）, frontend/src/lib/api-types.ts（+7/-0）, frontend/src/lib/daemon/sessions.ts（+8/-0）, frontend/src/lib/provider-caps.ts（+141/-0）, docs/sillyspec/finished/docs-gate-shared-worktree-parallel-block.md（+24/-0）, scripts/migrate-spec-junction.mjs（+152/-0）
需求：任务执行面板轮次历史 tokens 列拆分为输入/输出/缓存读取/缓存写入四维独立展示
根因：原轮次行 tokens 是 input+output 合并单值且不含缓存两维，长会话 prompt cache 占大头时数字远小于直觉、与会话用量条（含缓存四维）口径不可比，用户误读为统计异常
方案：后端 runs DTO SessionRunRead 扩 cache_read_tokens/cache_creation_tokens 两 nullable 字段（from_attributes 直映既有列零查询改动）+gen:types；前端 RunListRow 由单 tokens 列改为主行 grid（轮次/状态/耗时/发送者）+下方带标签 meta 行四维独立展示（对齐 TaskListRow meta 设计语言，flex-wrap 窄容器安全；null 维不渲染不编造 0，全 null 无 meta 行）；lib/daemon sessions.ts 手写接口同步两可选字段；模块文档三处同步（含修正 frontend_components 轮次惰性取数陈旧断言——实现本就挂载即拉）；审计解锁的删除/新增文件为并行会话 docs/sillyspec 归档移动与 scripts 未跟踪脚本，非本 quick 产物不随本次提交
结果：backend test_session_runs_endpoint.py 13 passed（含 cache 两维正/负断言扩展）；frontend task-execution-panel.test.tsx 13 passed（新增四维展示/null 维省略/全 null 无 meta 行用例）；ruff 两后端文件通过；mypy session_insights.py 0 错；frontend tsc --noEmit 干净；eslint 三前端文件 0 告警；未部署（本地改动）

## ql-20260913-001-1c98 | 2026-09-13 07:17:04 | 24h 审查风险修复批第三轮：group 共识事务边界+alembic 双头+auto_resume 重放链上限+junction 迁移脚本护栏+迁移 now() 方言兼容
状态：进行中
关联变更：（无）
文件：backend/app/modules/daemon/group/service/messages.py, backend/app/modules/daemon/session/service/auto_resume.py, backend/app/modules/daemon/tests/test_group_consensus.py, backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py, backend/migrations/versions/20260910130000_group_consensus.py, backend/migrations/versions/20260912050000_agent_log_attribution_reset.py, backend/tests/test_migrations_graph.py, scripts/migrate-spec-junction.mjs, .sillyspec/docs/backend/modules/daemon.md, .sillyspec/docs/backend/modules/migrations.md

## ql-20260913-002-a71d | 2026-09-13 02:10:00 | spike-01 codex tokenUsage.last 字段真机实证（2026-09-13-ctx-usage-all-providers task-08）
状态：已完成
关联变更：2026-09-13-ctx-usage-all-providers（task-08 / R-01 / FR-07）
验证方法：临时 Node ESM 脚本（/tmp/spike-ctx-usage/spike-codex.mjs，不进仓）spawn 真机 `codex app-server --listen stdio://`（codex-cli 0.147.0），行分隔 JSON-RPC 握手（initialize → notifications/initialized → thread/start）→ turn/start 单轮（提示词要求不调用工具），捕获全部通知帧
结论（thread/tokenUsage/updated 实捕 JSON）：
1. `last` 字段存在且为单调用快照（首轮 total == last 逐字段相同，佐证 total 线程累计 / last 单调用的既有注释口径）
2. 毛值口径实锤：last.inputTokens=12122 ≥ cachedInputTokens=1216 且 totalTokens=12126=inputTokens+outputTokens——inputTokens 已含 cache 分量即该次调用全提示词大小，ctx_tokens = last.inputTokens 直取正确（加 cache 分量会双计）
3. 意外收获：通知自带 `modelContextWindow: 950000`（模型上下文窗口分母真源！）——后续可做「codex 会话环分母精确派生」独立变更（本次 NG-05 分母链不动，仅记录机会）
pi 侧证据（R-02）：fixtures/pi-rpc-events/manual-success-turn.jsonl 系 2026-09-04 真机采样（README 采样环境节：pi 0.81.1 `pi --mode json -p "用 Bash 执行 echo pi-smoke 并汇报"` 真工具调用轮），两调用轮 turn_end.usage 与末次 message_end 逐字段相同（input=520 非累计 1000）——单调用快照语义真机证据链闭合，无需重跑

## ql-20260913-003-4ee3 | 2026-09-13 07:25:02 | 24h 审查风险修复批第三轮收尾：群共识收尾事务+auto_resume 重放链上限+junction 脚本护栏+迁移方言兼容+alembic 单头守护
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/group/service/messages.py（gather 后失败登记/立即收口变更统一收口 commit（P0 后半））
- backend/app/modules/daemon/session/service/auto_resume.py（重放分支 auto_resume_of 紧链上限+hint 共用助手+前驱查询 tiebreak）
- backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py（新增交替类型击穿同型守卫用例）
- backend/app/modules/daemon/tests/test_group_trigger_lock.py（新增失败登记持久化用例（rollback 独立重读断言））
- backend/tests/test_migrations_graph.py（新增 alembic 单头/引用闭合/唯一守护（AST 接 Assign+AnnAssign））
- backend/migrations/versions/20260912050000_agent_log_attribution_reset.py（now() 改绑定参数方言无关）
- scripts/migrate-spec-junction.mjs（statSync→lstatSync 修幂等护栏+两处回滚失败如实上报）
- .sillyspec/docs/backend/modules/daemon.md（群共识事务三段边界+自动恢复 B 分支链上限）
- .sillyspec/docs/backend/modules/migrations.md（DML 方言规则+单头守护+20260912050000 修订）
需求：24h 审查风险修复批第三轮收尾：群共识收尾事务+auto_resume 重放链上限+junction 脚本护栏+迁移方言兼容+alembic 单头守护
根因：①get_session 成功路径不 commit，gather 后共识变更只 flush 即回滚；②同型守卫拦不住交替错误类型；③statSync 跟随 junction 致幂等护栏失效、回滚 catch{} 吞错误报成功；④now() 是 PG-only 函数；⑤双头两周两次复发且 CI 拦不住
方案：①send 返回前 consensus_task 非空统一收口 commit；②重放分支补 auto_resume_of 紧链上限 2+hint（与 nudge 同款，hint 提取共用助手）+前驱查询排除自身消撞值；③lstatSync+两处回滚逐步如实上报；④bindparams(ts) Python 侧生成时间戳；⑤新增 AST 单头/引用闭合/唯一守护测试
结果：9 个相关测试文件 62 passed（含 2 新用例）；mypy 942 文件 0 issue；ruff check+format 0 告警；node --check 过；迁移语句 SQLite 绑定参数冒烟过
审计：📎 文档引用失效：5/0 处 file:line 失效（sillyspec docs check 可复现）
审计：   ❌ [docs/sillyspec/conflict-compare-wrong-status-root.md:0]  → 文档不存在
审计：   ❌ [docs/sillyspec/docs-gate-shared-worktree-parallel-block.md:0]  → 文档不存在
审计：   ❌ [docs/sillyspec/platform-spec-junction-migration-split.md:0]  → 文档不存在
审计：   ❌ [docs/sillyspec/platform-sync-progress-rollback-and-db-corruption.md:0]  → 文档不存在
审计：   ❌ [docs/sillyspec/pre-commit-autofix-swallows-commit.md:0]  → 文档不存在
审计：⚖️ 归属切分：12 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/conflict-compare-wrong-status-root.md, docs/sillyspec/docs-gate-shared-worktree-parallel-block.md, docs/sillyspec/platform-spec-junction-migration-split.md, docs/sillyspec/platform-sync-progress-rollback-and-db-corruption.md, docs/sillyspec/pre-commit-autofix-swallows-commit.md, docs/sillyspec/finished/agent-log-ctx-attribution-mismatch.md, docs/sillyspec/finished/agent-log-hub-attribution-cross-session-contamination.md, docs/sillyspec/finished/conflict-compare-wrong-status-root.md, docs/sillyspec/finished/docs-gate-shared-worktree-parallel-block.md, docs/sillyspec/finished/platform-spec-junction-migration-split.md, docs/sillyspec/finished/platform-sync-progress-rollback-and-db-corruption.md, docs/sillyspec/finished/pre-commit-autofix-swallows-commit.md

## ql-20260913-004-dd9c | 2026-09-13 08:38:34 | sillyspec CLI 三个工具负面点按规则 15 落 docs/sillyspec/ 活跃坑登记
状态：已完成
关联变更：（无）
文件：
- docs/sillyspec/quick-sync-block-filenotes-and-quicklog-mixed-commit.md（规则 15 活跃坑登记——quick 启动同步阻塞/file-notes 后置生效预告缺失/QUICKLOG 共享文件提交夹带三坑）
需求：sillyspec CLI 三个工具负面点按规则 15 落 docs/sillyspec/ 活跃坑登记
根因：上一批修复会话实证：quick 启动被平台同步阻塞 126s 超时会话却已建立；--file-notes step2 传完才被告知仅 step3 生效；QUICKLOG 共享文件提交必夹带并行会话条目
方案：单文件三坑分节登记（现象/环境/影响/绕过/建议工具修复+处置进展），每坑附实证细节与绕过路径、修复建议按侵入度分档
结果：docs/sillyspec/quick-sync-block-filenotes-and-quicklog-mixed-commit.md 落盘；纯文档登记零代码零测试面；登记会话启动尾部再次实证坑 1 已记入

## ql-20260913-005-06bf | 2026-09-13 08:46:18 | 裁决 20260912050000 清库迁移与 compose 自动前滚的时序矛盾并落地（用户授权评估摘除自动执行或白名单门控）
状态：已完成
关联变更：（无）
文件：
- backend/scripts/reset_agent_log_attribution.py（一次性清库运维脚本——collect_counts/apply_reset 分离、事务边界归调用方、时间戳 bindparams 方言无关）
- backend/migrations/versions/20260912050000_agent_log_attribution_reset.py（DML 抽出改 no-op 指针（revision 保留，docstring 记三候选取舍））
- backend/tests/test_reset_agent_log_attribution.py（DML 语义 2 用例（含不提交事务边界断言））
- .sillyspec/docs/backend/modules/migrations.md（部署裁决段落替换+方言条目先例指向更新）
需求：裁决 20260912050000 清库迁移与 compose 自动前滚的时序矛盾并落地（用户授权评估摘除自动执行或白名单门控）
根因：compose 启动命令 alembic upgrade head 自动执行破坏性清库，必然发生在 CLI 升级前（DG-03 时序为 backend 发布→CLI 升级→手动执行），清空白做且旧 CLI 旧语义上报立即重建错配数据；链内数据 DML 在 downgrade→upgrade 重放时还会把已重建的正确数据再清一遍
方案：两候选均否决（白名单/stop-revision 因兄弟分叉迁移图不可行、env 门控有 stamp 后永不重跑死结）后取第三方案：DML 抽出到 backend/scripts/reset_agent_log_attribution.py（dry-run 默认+--apply 单事务+前后计数回报），迁移本体改 no-op 指针保留 revision id 维持图完整，compose 零改动、后续 schema 迁移自动升级惯例不破坏
结果：2 新用例+图守护回归 4 用例绿；ruff check/format 0；mypy 942 文件 0；开发中修正 dry-run 计数与 UPDATE rowcount 的口径差（NULL→NULL 同计）

## ql-20260913-006-107d | 2026-09-13 09:17:25 | 修复清库运维脚本直接执行 import 失败
状态：已完成
关联变更：（无）
文件：
- backend/scripts/reset_agent_log_attribution.py（补 sys.path 引导（scripts 直跑/docker exec import app 可达））
需求：修复清库运维脚本直接执行 import 失败
根因：python scripts/x.py 时 sys.path[0]=scripts 目录，from app.core.config import 不可达；单测被 pytest 路径注入掩盖，docker exec 生产执行路径同样会炸
方案：照 cleanup_daemon_instances.py:30 先例补 sys.path.insert 引导仓库根
结果：脚本 help 参数直跑成功（imports 与 CLI 解析独立可跑）；单测 2 用例复跑绿；ruff check/format 0

## ql-20260913-007-1351 | 2026-09-13 21:24:01 | 轮次刻度轨命中区修复——刻度按钮从2px细线扩为透明命中区
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/turn-catalog.tsx（刻度按钮扩透明命中区+视觉线内移span+去gap+飞出卡定位取刻度中心）
- frontend/src/components/sessions/__tests__/turn-catalog.test.tsx（状态类断言迁内部span+新增命中区2用例+定位mock补offsetHeight）
需求：轮次刻度轨命中区修复——刻度按钮从2px细线扩为透明命中区
根因：用户反馈会话左侧轮次展示鼠标指向需精确到极小范围才能显示摘要卡和点击，刻度按钮本体仅 h-[2px] w-[14px]，2px 高命中区远低于任何可用性基线，刻度间 gap-[7px] 还是无响应缝隙
方案：turn-catalog.tsx 按钮本体改为透明命中区（h-[18px] × 轨全宽，上下各 8px 缓冲），视觉横杠移入内部 span 居中渲染，状态色/hover 放宽/空心描边平移至子元素 group-* 触发（视觉基本不变，刻度周期 9px→18px 密度略降）；nav 去 gap 相邻命中区紧贴连续；飞出卡垂直定位改用刻度中心（computeFlyoutTop 首参 offsetTop→tickCenter）；测试状态类断言迁移至内部视觉线 span 并新增 2 个命中区用例
结果：turn-catalog 17/17 通过（含新增用例）、sessions page 37/37 通过（轮次导航集成 8 用例全绿）、session-panel-variant 通过；eslint 0 error（1 warning 为 2026-09-08 存量非本次引入）

## ql-20260914-001-b14c | 2026-09-14 09:01:11 | 24h 审查 P2 清单三项收尾：目录 fsync+reload 白名单派生化+群聊系统提示行放行
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/atomic-write.ts（rename 后父目录 fsync（Windows best-effort 吞））
- sillyhub-daemon/src/interactive/session-manager.ts（PROVIDER_RELOAD_ENGINES 派生化并导出）
- sillyhub-daemon/tests/atomic-write.test.ts（open(r) 探针断言目录 fsync 意图）
- sillyhub-daemon/tests/provider-adapter-registry.test.ts（守护⑥ 派生对账+三元语义锚）
- frontend/src/components/group-chat/group-chat-panel.tsx（无卡 system 事件渲染 kind:system 提示行）
- frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx（同用例改新语义+空白 ignore 分支）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（白名单派生段+changelog 两修）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引 ql-20260914-001-b14c 条目；2026-09-14 善后修正——原预留期旧 ID ql-20260913-007-1351 系他者条目，见 docs/sillyspec/quick-sync-block-filenotes-and-quicklog-mixed-commit.md 坑 4）
需求：24h 审查 P2 清单三项收尾：目录 fsync+reload 白名单派生化+群聊系统提示行放行
根因：①rename 后目录项未 fsync，POSIX 掉电窗口丢 rename；②手写白名单与注册表脱节，新引擎 switchable:true 后前端解锁而 daemon 抛错；③无卡 system 事件被整类 ignore，四类后端既定实时流提示（含收口失败）用户不可见
方案：①open(dirname)+sync 补目录持久（Windows best-effort 吞）；②照前端同款手法从 INTERACTIVE_PROVIDERS.switchable 派生并加守护⑥对账；③渲染既有 kind:system 条目类型（渲染器预留零产出），合成 id 去重
结果：daemon 13+69、frontend 64 用例全绿；daemon/前端 tsc 0；eslint 0 新增

## ql-20260914-002-5f98 | 2026-09-14 09:07:58 | 修复 pi 交互会话 ctx_tokens 被 driver 轮累计覆盖丢失
状态：进行中
关联变更：（无）
文件：sillyhub-daemon/src/interactive/pi-rpc-driver.ts, sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts

## ql-20260914-003-aafe | 2026-09-14 09:11:37 | 修复 pi 交互会话 ctx_tokens 被 driver 轮累计覆盖丢失
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/pi-rpc-driver.ts（lastEndUsage 快照+覆盖分支补派 ctx+轮重置）
- sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（既有 5 处 usage 断言补 ctx 键（16/2080））
- sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts（新增 2 回归用例（生产形态/跨轮粘滞））
需求：修复 pi 交互会话 ctx_tokens 被 driver 轮累计覆盖丢失
根因：pi-rpc-driver 轮累计覆盖块（ql-20260909-028）用 turnUsageSum 整体替换 turn_end usage 事件的 ev.usage，抹掉归一化器派生的 ctx_tokens；且现行 pi 版本 turn_end 定格常为零值，正确数据源是末次 message_end 原始帧（2026-09-13-ctx-usage-all-providers 设计漏审计 driver 层注入点，归一化器单测不经覆盖块故全绿；生产实证=阿里云会话 aa3e2d4e 今早两轮四维 usage 在库而 ctx 恒空）
方案：driver 累计处定格末次 assistant message_end usage 快照（lastEndUsage），覆盖分支经 ctxTokensFromNetInput 净值三和补派 ctx_tokens 注入轮累计对象（与 codex last 毛值同为末次调用口径）；无快照回退分支沿用事件原值；轮边界重置防跨轮粘滞
结果：pi-rpc-driver 3 套件 119 用例全绿（含 2 新回归：生产形态零值定格+双调用 ctx=2080 事件/result 双路断言、跨轮不粘滞回退 ctx=13）+ 既有 5 处 usage 全对象断言补 ctx 键 + typecheck exit 0；待重打包部署阿里云 + 本机 daemon 重启生效
审计：📝 文档欠账（D-8）：2 个源码文件改动未同步任何模块文档

## ql-20260914-004-0be7 | 2026-09-14 09:14:32 | 登记 sillyspec CLI 第四坑（ql-ID 预留/分配竞态）+ 修 QUICKLOG 旧 ID 引用
状态：已完成
关联变更：（无）
文件：
- docs/sillyspec/quick-sync-block-filenotes-and-quicklog-mixed-commit.md（补第四坑 ql-ID 预留分配竞态+标题引言四坑化+处置进展）
- .sillyspec/quicklog/QUICKLOG-qinyi.md（b14c 条目文件行旧 ID 引用修正并注善后原因）
需求：登记 sillyspec CLI 第四坑（ql-ID 预留/分配竞态）+ 修 QUICKLOG 旧 ID 引用
根因：quick 会话启动预留 ql-ID 无查重，同一 ID 可双发放（实证 007-1351）；file-notes/模块文档在最终 ID 分配前引用预留值会指向他者条目
方案：坑文档补第四坑（现象/影响/绕过/建议修复，工具修复归 sillyspec 仓用户另行安排）+QUICKLOG b14c 条目文件行旧 ID 修正并注善后原因
结果：纯文档与日志数据修正零代码零测试面；登记会话自身 guard.json 复现同一 stale ID（坑 4 第二现场）

## ql-20260914-005-8b8f | 2026-09-14 09:57:08 | 坑 4（ql-ID 预留/分配竞态）处置记录补登，规则 15 闭环
状态：已完成
关联变更：（无）
文件：
- docs/sillyspec/quick-sync-block-filenotes-and-quicklog-mixed-commit.md（坑 4 处置记录（sillyspec 132d01d 修复证据+本机 CLI 重装激活））
需求：坑 4（ql-ID 预留/分配竞态）处置记录补登，规则 15 闭环
根因：工具侧已修（sillyspec 仓 132d01d 三层护栏），活跃坑文档需补处置进展；坑 1-3 未修不能整体迁 finished
方案：处置进展节补登：修复证据链（三层护栏+25 断言+463 绿）+本机 CLI 旧装不含修复实证与重装激活确认；坑 4 关闭标注，文件保持活跃位
结果：纯文档补登零代码零测试面；本 quick 会话由修复版 CLI 承载（分配正常间接自证）

## ql-20260914-006-e395 | 2026-09-14 10:03:54 | 平台进度同步防跨机时钟偏差：last_pushed_at 改存服务器权威时钟 + 409/GET 回传 last_pusher 供 CLI 身份归属
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/platform_sync/service.py（server_now_iso 服务器钟 + upsert 接受分支存服务器钟回传 stamp + 冲突分支回传 last_pusher + get_progress 顶层 last_pusher）
- backend/app/modules/platform_sync/router.py（409 body 组装 last_pusher + 200 ack 回传服务器钟）
- backend/app/modules/platform_sync/schema.py（ConflictResponse/ProgressSyncOk 补字段）
- backend/app/modules/platform_sync/tests/test_router.py（新增服务器钟落库 + 409 回传 pusher 两用例；8 处旧契约断言改从 ack 链服务器钟）
- backend/app/modules/platform_sync/tests/test_owner_smoke_e2e.py（last_pushed_at 断言改 ISO-Z 正则）
- backend/app/modules/platform_sync/tests/test_pending_approval_broadcast.py（重复推 base 链前次 ack）
需求：平台进度同步防跨机时钟偏差：last_pushed_at 改存服务器权威时钟 + 409/GET 回传 last_pusher 供 CLI 身份归属
根因：CLI 侧自回声血统归属判定基于客户端时间戳，他机慢钟可把外来更新伪装进 [base, local_modified] 血统窗口被误判自回声覆盖（sillyspec 仓审查结论）；且乐观锁 stored > base_ts 与『平台更新』判定全建立在客户端时钟字典序上，跨机偏差本身污染冲突检测。根修=判定基准统一到服务器钟 + 推送者身份回传
方案：service.py 新增 server_now_iso()（UTC ISO 毫秒 Z）；upsert_progress 接受分支存服务器钟并经返回值/200 ack 回传（CLI 回填 base_ts 与库中值同钟，否则必假 409）；冲突分支与 get_progress 回传行内 last_pusher（PlatformSyncResult/ConflictResponse/ProgressSyncOk 补字段）；_apply 保持哑写者（stamped_at 由调用方生成）；router 409 body 组装 last_pusher。契约文档在 sillyspec 仓同步（另一 quick）
结果：platform_sync 模块聚焦 pytest 234 passed（新增 2 用例 + 改写 8 处旧契约断言 + 相邻 2 文件同因修）；ruff check/format/mypy 模块级全绿；pnpm gen:types 已跑——端点在 OpenAPI 无 schema 面，api-types/openapi 零内容差（EOL 噪音已还原）；未部署（crrcdt.ppdmq.top 需发版重部才生效）

## ql-20260914-007-8f1d | 2026-09-14 18:27:03 | CI 修复批：backend 随机 UUID 参数化 xdist 收集不一致 / frontend 时区固件 / turn-catalog 命中区丢失实现 /…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/skill_source/tests/test_library_enable.py（parametrize 三处随机 UUID 固定字面化）
- frontend/src/components/daemon/__tests__/turn-timeline-auto-recover.test.ts（reset_at/dispatchAt 本地时区固化）
- frontend/src/components/sessions/turn-catalog.tsx（补 ql-20260913-007-1351 命中区实现）
- sillyhub-daemon/tests/interactive/cursor-driver.test.ts（usage 断言补 ctx_tokens）
- frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx（补 listScheduledMessages mock）
需求：CI 修复批：backend 随机 UUID 参数化 xdist 收集不一致 / frontend 时区固件 / turn-catalog 命中区丢失实现 / cursor-driver 断言补 ctx_tokens / platform-shared 定时消息 mock
根因：①parametrize 值收集期求值，随机 UUID 使 xdist 各 worker 收集到不同用例 ID 必炸（backend-ci 4 连败）；②固件写死 +08:00 偏移串但断言本地墙钟 10:03，UTC CI 渲染 02:03（frontend-ci 4 连败）；③ql-20260913-007-1351 的组件实现未落 git 仅测试随 d114568f3 入库，测试契约与 ba8b088ce 旧实现脱节（最新 5 败）；④ctx-usage-all-providers 给 cursor 派生 ctx_tokens 时漏改该用例的负向断言（daemon-ci 2 连败）；⑤全局 apiFetch mock 返回共享智能体数组被真 listScheduledMessages 吞掉，summarizeScheduledPrompt 读 undefined.length 异步崩（known_failures I 组 flaky）
方案：①三处 uuid.uuid4() 改固定字面量；②固件改本地时区固化构造 new Date(y,m,d,10,3,59).toString()（对齐 turn-catalog 测试既有惯例）；③按 quicklog sidecar 方案恢复组件——button 改 h-[18px] 全宽透明命中区+子 span 视觉线（group-* 触发状态色/hover/空心）+nav 去 gap；④usage 断言补 ctx_tokens 13 并注明两口径设计；⑤@/lib/daemon mock 补 listScheduledMessages 空列表
结果：backend skill_source -n 2 xdist 16 passed+ruff/format 绿；frontend turn-catalog 17+sessions 页/variant 44+auto-recover 7（TZ=UTC 亦绿）+platform-shared 4，tsc 0，eslint 1 存量 warning 不变；daemon cursor-driver 23 passed+tsc 0；未部署（待 push 触发 CI）
审计：[gate] L1（跨 0 模块 · 7 文件：1 代码/4 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量不适用（≤1 代码文件）

## ql-20260914-008-f2c3 | 2026-09-14 19:15:49 | backend-ci 解锁后两连修：group 表契约测试补共识双字段 + rmtree_force POSIX 父目录只读重试
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/tests/test_group_chat_models.py（表契约补共识双字段）
- backend/app/modules/skill_source/git_fetcher.py（rmtree_force POSIX 父目录重试）
需求：backend-ci 解锁后两连修：group 表契约测试补共识双字段 + rmtree_force POSIX 父目录只读重试
根因：①模型已随 2026-09-13-consensus-timeout-activity-aware 提交而测试期望集漏同步（known_failures K 组预登记，此前被 xdist 收集错误掩盖从未在 CI 暴露）；②rmtree_force onexc 只 chmod 失败目标自身，POSIX unlink/rmdir 权限看父目录写位，只读父目录下该重试无效（Windows 只读属性挂目标自身故本地恒绿 Linux CI 红，同为收集错误掩盖的存量失败）
方案：①期望集补 consensus_mode/consensus_timeout_seconds；②onexc 二段重试——首段维持 chmod 目标自身，二段 chmod 父目录（stat.S_IMODE 保原 mode 补 S_IWRITE）后重试，Windows 语义走首段不动
结果：两套件 46 passed + 2 Windows skip；Linux Docker python:3.12 容器实测只读父目录场景 removed=True；ruff/format/mypy 全绿；local.yaml K/I/L-1 组豁免随根因清偿移除；未部署（待 push 触发 CI）

## ql-20260914-008-7c2e | 2026-09-14 17:55:00 | spike-01/02/R-01 压缩通道真机实证（2026-09-14-session-ctx-compact task-07）
状态：已完成
关联变更：2026-09-14-session-ctx-compact（task-07 / FR-08 / R-01·R-02·R-03）
方法：临时脚本真机驱动（$TEMP/spike-compact-pi.mjs / spike-compact-codex.mjs，不进仓）
结论：
1. spike-02 codex **全实证**：真机 codex app-server 0.147 建线程跑一轮后发 `thread/compact/start {threadId}`（camelCase）→ response `{"id":100,"result":{}}` 空对象受理，与设计/实现完全一致；thread/compacted 通知未见（v1 不消费，NG-04 无影响）
2. spike-01 pi **机制实证**：真机 pi 0.81.1 rpc 模式 get_state→prompt→turn_end 后发 `{"type":"compact"}` 命令，返回真实 response 信封与文档错误语义（"Nothing to compact (session too small)"，三轮放大上下文仍低于压缩阈值 ~36k tokens 未取得数字回执）——命令通道/响应信封/error 语义实证；回执字段名 tokensBefore/estimatedTokensAfter 以官方 rpc.md:374-411 为准，代码留有 spike 校正点（不符只改 data 读取处）
3. R-01 claude **未取得真机实证**：本机裸 claude CLI 认证失效（401 authentication_failed 重试环），stream-json 仅见 init/api_retry 帧；按设计降级姿态收口——官方 Agent SDK 文档背书 slash 经 prompt 分发 + 代码就位 + 生产实证不生效则 caps claude compact 翻 false 重生成（按钮消失，其余三键不受影响）

## ql-20260915-002-3fa | 2026-09-15 04:15:00 | 思考级别真机三引擎实证（2026-09-14-session-thinking-level task-04 spike + task-07）
状态：已完成
关联变更：2026-09-14-session-thinking-level（task-04 首步 spike / task-07 / FR-07 / R-01·R-02·R-03）
方法：临时脚本真机驱动（$TEMP/spike-tl-codex*.mjs / spike-tl-pi*.mjs，不入库）
结论：
1. **codex 三结论全实证**（task-04 spike，sidecar ql-20260915-001-0de2 详录）：①turn/start 顶层 reasoningEffort 受理（轮收敛正常——启动设置保留不走降级）；②thread/settings/update 需 initialize capabilities.experimentalApi=true（注入后受理空 result）；③thread/read 无 reasoningEffort 现值（current=undefined 不伪造）
2. **pi 双命令+事件+现值全实证**（本轮 task-07）：get_available_thinking_levels 按模型动态返回（kimi-for-coding → ["off","minimal","low","medium","high"] 五档非全七档——映射矩阵 pi 全直传正确）；set_thinking_level 生效（high→off 两轮切换成功回 {}）；thinking_level_changed 事件实时推送；get_state.thinkingLevel 现值准确反映（off→xhigh→high 链验证）
3. claude applyFlagSettings/supportedModels 未真机实证（本机裸 CLI 401 认证环同 compact R-01）——SDK 类型级实证（sdk.d.ts:2505/:2552/:576）+driver 实现就位+降级预案（supportedModels 不可用退默认五档/off 无操作语义）

## ql-20260915-001-8312 | 2026-09-15 05:03:35 | codex driver JSON-RPC 撞号修复——compact 等回执请求 id 并入 nextRpcId 单计数器
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（删 nextJsonRpcId，_sendJsonRpcRequest 复用 nextRpcId 单源分配）
- sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（8 处断言统一语义+新增防碰撞回归用例）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（追加修复条目（staged））
需求：codex driver JSON-RPC 撞号修复——compact 等回执请求 id 并入 nextRpcId 单计数器
根因：24h 审查发现双计数器缺陷：nextRpcId（turn/start·interrupt，≥3 无上界）与 nextJsonRpcId（compact，seed 100）共享 id 空间，长会话约 97 轮后交叉撞号，同 id 并发时 _maybeResolveJsonRpcResponse 按先到回执错配唤醒 pending（压缩结果误报）
方案：删 nextJsonRpcId 字段（含句柄初始化与注释三处），_sendJsonRpcRequest 改复用 nextRpcId++ 单源分配——在途请求 id 全局唯一；既有 8 处 seed-100 断言同步统一计数器语义（未发 turn 首取 3）；新增防碰撞回归用例（nextRpcId 推到交叉点 100 后 compact/turn/start 分号不同、turn 回执先到不误唤醒、正主 id 才 resolve）
结果：codex-app-server-driver.test.ts 61/61 两轮全绿（含并行 thinking-level 同文件新增 8 例）+ tsc --noEmit 0 错；代码改动已被并行会话以 e771bcec4 裹入提交（标注 ql-20260915-001 并行会话产物），经受 7c0ef8a4c 同文件叠加后复验仍绿
