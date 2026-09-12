
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
