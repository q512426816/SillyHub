
## ql-20260826-015-3604 | 2026-08-26 21:15:22 | 会话闸只计真活跃会话——修恢复会话占满额度拒新分身
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/tests/interactive/session-manager-worker-depth.test.ts
需求：会话闸只计真活跃会话——修恢复会话占满额度拒新分身
根因：恢复的19个历史idle会话在回收默认关闭下永不释放，闸恒满拒绝新分身派发
方案：计数口径收窄为真活跃（running turn 或 30 分钟窗口内活动）
结果：3 新回归用例与 interactive 全量 640 passed 与 typecheck 零错；已提交推送；本机 daemon 已换新并在线

## ql-20260827-001-223c | 2026-08-27 00:06:43 | 派团队体验优化让分身结论直接可见且主控更果断
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/router.py, backend/app/modules/daemon/schema.py, backend/app/modules/agent/mission_context.py, frontend/src/components/daemon/team-task-block.tsx, frontend/src/lib/daemon.ts, backend/openapi.json, frontend/src/lib/api-types.ts
需求：派团队体验优化让分身结论直接可见且主控更果断。
根因：completed 分身结论需点浮层才能看到；主控分身全完成后仍问用户是否收敛。
方案：result_summary 字段展示 worker_done 上报摘要前120字符加简报行为准则让主控立即收敛。
结果：backend 全量 4785 passed 与前端 27 passed 与 E2E 真实验证 mission done 且 result_summary 可见且主控果断收敛已提交推送。

## ql-20260827-002-25d5 | 2026-08-27 07:12:53 | P0 修复：backend 重启后 running session 死锁——daemon 端 status=running 排队等永不结束的 turn，inject 需检测 turn 超时强制重置
状态：进行中
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/tests/interactive/session-manager-worker-depth.test.ts

## ql-20260827-004-c49b | 2026-08-27 09:51:21 | 修 daemon 网络切换后 WS 永久假连（git-log 502 守护进程离线）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/ws-client.ts（身份守卫+pong新鲜度+connectedAt）
- sillyhub-daemon/src/daemon.ts（WS_STALE_REAP_MS+_reapStaleWsClient看门狗）
- sillyhub-daemon/tests/ws-client.test.ts（迟到close回归+pong新鲜度2用例）
- sillyhub-daemon/tests/daemon-ws-stale-reap.test.ts（看门狗4用例新文件）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（坑条目+变更索引）
需求：修 daemon 网络切换后 WS 永久假连（git-log 502 守护进程离线）
根因：wp 机器切换网络后旧 socket 迟到 close 事件把新 socket 抹出 this._ws，keepalive 静默丢失，黑洞连接无检测、状态卡 Connected 永不重连；HTTP 心跳/会话兜底照常造成在线假象，唯独 WS RPC（git-log/explorer）持续 502
方案：ws-client 事件与超时定时器加 socket 身份守卫；pong 计入 lastMessageAt 新鲜度+新增 connectedAt 锚点；daemon._wsLoop 每秒假活看门狗 _reapStaleWsClient（陈旧≥120s 强制重建，双 null fail-open）
结果：tsc 0；vitest 相关 87 用例全绿（ws-client 42 含新 2、daemon-ws-stale-reap 新文件 4、multi-runtime+daemon.test 41）；bundle 已重打，待部署

## ql-20260827-005-8bca | 2026-08-27 11:25:38 | 登录页删常显前缀提示 + 变更文件弹窗 MD 宽内容补横向滚动条
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(auth)/login/page.tsx（删登录名输入框 extra 常显提示及注释）
- frontend/src/components/change-file-tree.tsx（预览列两层包装补 min-w-0 宽度约束链）
- .sillyspec/docs/frontend/modules/app-pages.md（变更索引登记 ql-20260827-005）
- .sillyspec/docs/frontend/modules/components-changes.md（ChangeFileTree 条目补宽度链说明）
- .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md（sidecar 变更索引登记）
需求：登录页删常显前缀提示 + 变更文件弹窗 MD 宽内容补横向滚动条
根因：提示常显冗余按用户要求移除；滚动条缺陷是 ql-20260818-008 修纵向链时漏了横向——FilePreview 分支的 min-w-0 挡不住更上层 grid item（默认 min-width:auto）被宽表格撑大 1fr 轨道，被 overflow-hidden 裁掉且无滚动条
方案：登录页 Form.Item 删 extra 属性及其注释（错误卡内失败场景提示保留）；change-file-tree.tsx 右列 grid item 与内层 flex 包装两处补 min-w-0 锁列宽，让 overflow-auto 出左右滚动条
结果：change-files-card.test.tsx 2 用例通过；两改动文件 eslint 0 error（1 既有 warning 在未触及的 onSelect 类型签名处）；模块文档 3 处已登记

## ql-20260827-006-d79d | 2026-08-27 12:43:38 | 登录滑块验证码加免验证开关
状态：已完成
关联变更：（无）
文件：
- backend/app/core/config.py（新增 auth_captcha_enabled Field）
- backend/app/modules/auth/captcha_service.py（needs_captcha 短路）
- backend/tests/modules/auth/test_login_captcha.py（test_captcha_disabled_switch_bypasses_threshold）
- backend/.env（本地开关（不入库））
需求：登录滑块验证码加免验证开关
根因：自动化集成验证被 captcha 卡（本轮 verify 本地管理员密码试错触发 423，走 confirm/verify 流程繁琐），需要本地可关、生产默认开的开关
方案：config.py 加 auth_captcha_enabled（默认 True）；CaptchaService.needs_captcha 开头短路 False；本地 backend/.env 设 AUTH_CAPTCHA_ENABLED=false；生产 .env 不含该变量核实行为不变
结果：captcha 测试套件 8/8 绿（新增 1 例：关开关超阈值免 423 直接 200 登录、恢复开关后默认 423 路径不变）；ruff 三文件过；未部署（本地 dev 开关，生产无需）

## ql-20260827-007-6453 | 2026-08-27 13:32:25 | backend-ci Mypy 红灯修复——daemon 两测试文件注解写法
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/tests/test_subagent_log_attribution.py（fixture 注解 -> Generator）
- backend/app/modules/daemon/tests/test_inject_empty_prompt.py（mock 属性去类型声明）
需求：backend-ci Mypy 红灯修复——daemon 两测试文件注解写法
根因：background-subagent-progress 变更新增的两个测试文件带类型注解笔误：生成器 fixture 返回注解写了 -> None、mock 对象属性赋值带了类型声明，mypy 非严格但 misc 错误码未禁用故 CI 拦下
方案：fixture 注解改 Generator[None, None, None] 并补 collections.abc import；mock 属性赋值去类型声明对齐仓库惯例
结果：mypy 2 文件 0 错、ruff check/format 绿、pytest 2 文件 12 passed
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/src/interactive/types.ts

## ql-20260827-008-3952 | 2026-08-27 13:33:50 | 后台子代理完成后自动唤醒主代理汇报
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/types.ts（deps 端口）
- sillyhub-daemon/src/interactive/session-manager.ts（wakeup 调度+terminate 清理）
- sillyhub-daemon/src/hub-client.ts（injectSessionPrompt）
- sillyhub-daemon/src/cli.ts（deps 桥接）
- sillyhub-daemon/tests/interactive/task-lifecycle.test.ts（3 新用例+harness 扩展）
需求：后台子代理完成后自动唤醒主代理汇报
根因：task_notification 只落库+发 UI 事件，不唤醒已结束的主代理 turn——用户必须手动发消息才能拿到汇报（实证会话 2fe664d9：05:30:50 主代理回复已派出后 turn 结束，05:31:22 两条 NOTIFICATION 无人消费）
方案：daemon 终态（completed/failed，stopped 不扰）2s debounce 合并同会话通知，经新 deps 回调 onTaskWakeupInject→hubClient.injectSessionPrompt 注入『[后台任务通知]』user 消息唤醒主代理（含摘要与防环指引）；backend 零改动（inject 端点既有，queue_when_busy 处理忙态）
结果：daemon vitest 16/16 绿（新增 3 例：合并注入/stopped 不触发/未注入回调不炸）；tsc 0 错；本地部署待用户测试（不发阿里云）
审计：📝 文档欠账（D-8）：4 个源码文件改动未同步任何模块文档（涉及模块：sillyhub-daemon）

## ql-20260827-009-f905 | 2026-08-27 13:50:27 | 唤醒通知防漏读强化
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：唤醒通知防漏读强化
根因：主代理漏读合并通知第二行并凭执念声称仍在等待
方案：prompt 头部明示总数全结束/尾部强制逐条核对禁称等待
结果：16/16 绿+tsc 0 错

## ql-20260827-010-5fa3 | 2026-08-27 14:16:13 | 工作区移动端页面（变更中心 + 会话移植）
状态：进行中
关联变更：2026-08-26-mobile-workspace-page
文件：frontend/src/app/m/layout.tsx, frontend/src/app/m/workspaces/[id]/sessions/[sid]/page.tsx, frontend/src/components/mobile/mobile-top-bar.tsx, frontend/src/components/mobile/mobile-top-bar.test.tsx, frontend/src/app/m/layout.test.tsx

## ql-20260827-011-e756 | 2026-08-27 14:17:36 | 桌面登录页加移动端入口二维码
状态：已完成
关联变更：2026-08-26-mobile-workspace-page
文件：
- frontend/src/app/(auth)/login/page.tsx（MobileQrEntry 二维码卡 + buildMobileEntryUrl 纯函数导出）
- frontend/src/app/(auth)/login/page.qr.test.tsx（新增测试（URL 构造 + 渲染断言））
- frontend/package.json（+react-qr-code@^2.2.0）
- frontend/pnpm-lock.yaml（锁文件同步（+qrcode-generator 传递依赖））
需求：桌面登录页加移动端入口二维码
根因：移动工作台已上线（2026-08-26-mobile-workspace-page）但桌面登录页没有移动端入口，手机用户缺便捷途径进入手持端
方案：(auth)/login/page.tsx 新增 MobileQrEntry 卡片（react-qr-code@2.2.0 纯 SVG 零依赖），编码当前站点 /login，扫码后经 middleware UA 分流 rewrite 到 /m/login，登录后落地 /m/workspaces；SSR 占位挂载后取 origin 防 hydration 不匹配，白底衬板保扫码对比度，卡内小字展示编码 URL；导出 buildMobileEntryUrl 纯函数供测试
结果：page.qr.test.tsx 2 用例通过；tsc --noEmit 0 错误；next lint 0 告警；并发会话移动端脏文件未触碰

## ql-20260827-012-6c87 | 2026-08-27 14:18:27 | 移动端外壳锁死整页滚动（fixed inset-0）+顶栏补主题切换入口（actions 槽注入 ThemeToggle）
状态：已完成
关联变更：2026-08-26-mobile-workspace-page
文件：
- frontend/src/components/mobile/mobile-app-shell.tsx（fixed inset-0+overflow-hidden+actions 槽默认 ThemeToggle）
- frontend/src/components/mobile/mobile-top-bar.tsx（加 actions 动作槽）
- frontend/src/app/m/layout.tsx（钻取裸容器改 fixed inset-0）
- frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx（h-full+固定顶栏+内容区滚动）
- frontend/src/app/m/workspaces/[id]/sessions/[sid]/page.tsx（h-full+overflow-hidden）
- frontend/src/components/mobile/mobile-top-bar.test.tsx（新增 3 用例）
需求：移动端外壳锁死整页滚动（fixed inset-0）+顶栏补主题切换入口（actions 槽注入 ThemeToggle）
根因：钻取裸容器与详情页原用 min-h-[100dvh] 可被内容撑高致 body 整页滚动（顶栏底栏滚走/手感松垮）；ThemeToggle 只挂桌面顶栏，/m 段无主题切换入口
方案：m/layout 钻取裸容器与 mobile-app-shell 统一改 fixed inset-0+overflow-hidden；变更详情页 h-full+固定顶栏+main overflow-y-auto；对话页 h-full+overflow-hidden；MobileTopBar 加 actions 槽、外壳默认注入桌面同款 ThemeToggle
结果：70 用例全绿+tsc/lint 零错；浏览器 390×844 实证：滚动后 body 零滚动（scrollH=clientH=844）、顶栏钉 0-44px、底部导航钉 797-844px（列表+详情双场景）；主题三选一换肤生效且 persist 跨页保持

## ql-20260827-014-d438 | 2026-08-27 15:56:10 | 修复 reopen 会话丢供应商凭证致秒回 ended
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service.py（reopen lease 补键 + WS payload 带解密凭证与降级语义）
- sillyhub-daemon/src/daemon.ts（resume 路由接收 provider_config 写 record）
- backend/app/modules/daemon/tests/test_session_reopen.py（新增 3 用例）
- sillyhub-daemon/tests/daemon-session-resume-route.test.ts（新增 3 用例）
需求：修复 reopen 会话丢供应商凭证致秒回 ended
根因：reopen_session 建 lease 漏写 session_llm_provider_id 且 SESSION_RESUME payload 不带解密 provider_config，daemon 恢复的 SDK 子进程无任何凭证（隔离 CLAUDE_CONFIG_DIR 无本机 OAuth 兜底）Not logged in 秒退，daemon 上报 end 会话约 2s 回 ended 死亡循环（阿里云会话 b70bf7b2 实证）
方案：backend reopen_session 新 lease metadata 补写 session_llm_provider_id（create 同款键）+ SESSION_RESUME 携带 resolve_bound_provider_config 解密 provider_config（降级缺键不阻断）；daemon _routeSessionResume 双读 provider_config/providerConfig 写 record.providerConfig 走既有 restore env 重建链
结果：backend reopen 两测试文件 36 passed（新增 3 用例）daemon resume 路由 13 passed（新增 3 用例）ruff mypy tsc 全过，模块文档 daemon.md+changelog 已更新
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_session_reopen.py, sillyhub-daemon/tests/daemon-session-resume-route.test.ts

## ql-20260827-015-3875 | 2026-08-27 17:07:21 | 修复后台任务通知排队刷屏——同会话合并为一条
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service.py（入队分支通知合并 + _merge_task_wakeup_prompt）
- backend/app/modules/daemon/tests/test_session_queue.py（TestTaskWakeupMerge 新增 3 用例）
需求：修复后台任务通知排队刷屏——同会话合并为一条
根因：inject 端点恒 queue_when_busy=True，daemon 后台任务终态唤醒（2s debounce 只盖 2 秒窗）在长轮期间每任务终态入队一条通知，计数只增不减且每条派发后都是一轮完整模型汇报（会话 17f10040 实证）
方案：入队分支对「[后台任务通知]」前缀做同会话 pending 合并：新通知任务行并入既有条目（头/尾计数改写，_merge_task_wakeup_prompt 行级解析），不新增行；返回同 entry id daemon 无感；普通消息互不合并
结果：test_session_queue.py 13 passed（新增 3 用例）ruff mypy 全过，模块文档已更新，待部署
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_session_queue.py

## ql-20260827-016-c3ea | 2026-08-27 20:42:39 | 移动端第三轮UX打磨：禁意外缩放+触摸基线+输入16px+悬浮胶囊底栏+卡片图标容器
状态：已完成
关联变更：2026-08-26-mobile-workspace-page
文件：
- frontend/src/app/layout.tsx（viewport导出）
- frontend/src/app/globals.css（触摸基线+m-app 16px）
- frontend/src/app/m/layout.tsx（钻取容器挂m-app）
- frontend/src/app/m/login/page.tsx（PUBLIC分支自带m-app）
- frontend/src/components/mobile/mobile-app-shell.tsx（m-app+pb-28）
- frontend/src/components/mobile/mobile-tab-bar.tsx（悬浮胶囊）
- frontend/src/components/mobile/mobile-change-card.tsx（状态图标容器）
- frontend/src/app/m/workspaces/[id]/changes/page.tsx（QuicklogCard同步）
- 两测试文件（新增断言）
需求：移动端第三轮UX打磨：禁意外缩放+触摸基线+输入16px+悬浮胶囊底栏+卡片图标容器
根因：用户反馈移动端莫名容易缩放且手感差并给参考效果图；根因是根layout无viewport导出、无触摸基线CSS、输入框字号<16px触发iOS聚焦自动放大，底栏/卡片观感与参考图差距大
方案：根layout导出viewport禁捏合缩放；globals.css加触摸基线与.m-app输入16px作用域并挂上外壳/钻取/登录容器；MobileTabBar改离底12px圆角毛玻璃胶囊并调外壳pb-28；MobileChangeCard与QuicklogCard加40px状态图标容器与间距节奏
结果：tsc全绿；vitest相关111用例全过含新增4断言；curl实证SSR meta注入与编译CSS规则；胶囊视觉与聚焦不缩放留真机复核

## ql-20260827-017-c7d3 | 2026-08-27 21:02:09 | 修复多标签页登录态互踢——session store 跨标签页同步 token
状态：已完成
关联变更：（无）
文件：frontend/src/stores/session.test.ts, frontend/src/stores/session.ts
需求：修复多标签页登录态互踢——session store 跨标签页同步 token
根因：token 经 zustand persist 落 localStorage 多页共享，但 persist 不监听其它标签页写入，各页内存各持旧 refresh token；A 页续票轮换后 B 页持旧 token 续票，超后端 60s 复用宽限窗被判重放攻击，吊销该用户全部会话，全页被踢回登录页
方案：stores/session.ts 落盘 key 提为 SESSION_STORAGE_KEY 常量 + 模块级 storage 事件监听，其它标签页写入的 token/user 回放进本页内存（缺字段不误清、坏 JSON 忽略、hydrated 不回放、SSR/HMR 安全）；同秒并发续票竞态由后端既有 grace 兜底，顺带实现登出/换账号跨页同步
结果：新增 session.test.ts 6 用例全绿；相邻回归 token-refresh 9 + dashboard layout/page 守卫 21 全绿；tsc --noEmit 0 错；eslint 改动文件 0 告警

## ql-20260827-018-dbd5 | 2026-08-27 22:36:48 | 会话聊天回显慢+有时加载不出来+实时与重载内容不一致修复
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/router.py（logs 端点 gzip 协商）
- frontend/src/lib/daemon.ts（streamSession cursor/initialSync 首连缺口同步+回放 envelope 补归属字段+maxLogTimestamp）
- frontend/src/components/daemon/session-panel.tsx（page 模式先回灌再建流+dialog 模式 cursor 接线）
- frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts（新增 7 用例）
- backend/app/modules/daemon/tests/test_session_logs_gzip.py（新增 5 用例）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（模块 mock 补 maxLogTimestamp+第三参断言适配）
- frontend/src/lib/__tests__/daemon-session.test.ts（SSE mock REST 路由 JSON 适配）
需求：会话聊天回显慢+有时加载不出来+实时与重载内容不一致修复
根因：①回显慢：/logs 历史接口全量 JSON（上限 5000 行×50KB 文本列）明文传输，WAN 部署秒级等待；②加载不出来：session-panel page 模式建流 effect 并行发起历史预取与 SSE，活跃会话重开时 SSE 先到建 turn，回灌条件 prev.turns 为空不满足→历史被整体丢弃，旧轮内容永久缺失（dialog 模式 establishStream 先例已修同款竞态）；③实时/重载不一致：replayLogsFromDb 合成 envelope 只带 5 个基础字段，丢 parent_tool_use_id/subagent_type/depth/tool_kind/edit_patch，断线 resync/轮后对账补放的子代理日志平铺渲染与硬重载不一致
方案：①后端 get_session_logs 按 Accept-Encoding 协商 gzip（>1KB 压缩，Content-Encoding+Vary，小载荷/旧客户端明文回退）；②page 模式改 await 历史先回灌再建流；streamSession 新增 cursor/initialSync 首连缺口同步（syncGapFromDb 提取自 resyncAndReconnect：建连前 runs 快照合成+logs 增量回放，建连后 5s 终态复核），补历史快照→SSE 订阅窗口的丢事件，预取失败时 initialSync 全量对账兜底；dialog 模式同接线；③回放 envelope 补透传 5 个归属字段，配套新增 maxLogTimestamp 导出
结果：backend：新增 test_session_logs_gzip.py 5 用例 + 既有 test_session_history 17 用例零回归，ruff/mypy 0；frontend：新增 daemon-session-stream-sync.test.ts 7 用例，相关 suites（daemon-session/page/sessions/runtimes/floating/mobile/assembler 等）共 212+ 用例 passed，tsc 0、eslint 无新增告警；未部署，待用户验证线上效果
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/lib/__tests__/daemon-session.test.ts

## ql-20260827-019-156b | 2026-08-27 22:38:35 | 后端安全与稳定性缺陷修复批次（重置密码支配权/角色提权链/release 审批门/排队重试 500/弱引用 task/docstring）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/admin/users_service.py（reset_password 支配权：目标超管须 actor 自身超管，否则 403 PLATFORM_ADMIN_RESET_FORBIDDEN）
- backend/app/modules/admin/roles_service.py（新增 _assert_may_write_platform_admin：permission_keys 含 platform:admin 时仅超管可写，create/update 两处调用）
- backend/app/modules/release/service.py（reject 一票阻断 _require_approvals 与 approved 迁移；_min_approvers_of/_sanitize_deploy_policy 双侧钳 min_approvers>=1）
- backend/app/modules/daemon/session/service.py（retry 派发成功行已删时返回 detached 快照 status=dispatched，替代裸 assert 500）
- backend/app/modules/daemon/lease/service.py（notify_orchestrator_workers_done 后台 task 模块级强引用防 GC）
- backend/app/modules/mcp_gateway/service.py（webhook 投递 task 模块级强引用防 GC）
- backend/app/modules/tool_gateway/tool_policy.py（docstring 失实引用 ToolGatewayService._load_policy 改为真实构造方）
- backend/tests/modules/admin/test_users_router.py（+3 用例：ws user:write 重置超管 403、重置普通用户 200 不误伤、超管重置超管 200）
- backend/tests/modules/admin/test_roles_router.py（+3 用例：非超管建/改 platform:admin 角色 403 且权限未落库、超管建 201）
- backend/app/modules/release/tests/test_service.py（+3 用例：min_approvers 0/负/非法钳制、approved 后补 reject 阻断 deploy、reject 阻断 approved 迁移）
- backend/app/modules/daemon/tests/test_session_queue.py（+1 用例：retry 成功派发返回快照不崩）
需求：后端安全与稳定性缺陷修复批次（重置密码支配权/角色提权链/release 审批门/排队重试 500/弱引用 task/docstring）
根因：多角度缺陷排查实证：重置密码接口把新明文口令回传调用者却不校验支配权，配合 require_permission_any 的任一 workspace 权限放行语义构成超管账号接管链；角色权限改写端无 platform:admin 守卫形成先绑后改的自我提权链；release 审批只数 approve 票且 min_approvers 可注入 0；排队消息重试成功路径行被删后裸 assert 必 500；两处 fire-and-forget asyncio.create_task 弱引用可被 GC 静默丢通知/回调
方案：users_service.reset_password 加目标为平台管理员时的 actor 支配权校验；roles_service 新增 _assert_may_write_platform_admin 守卫 create/update；release 增加 reject 一票阻断 deploy 与 approved 迁移、min_approvers 读取侧 max(1,·) 钳制、create 侧 _sanitize_deploy_policy 落库钳制；session retry 成功派发返回 detached 快照 status=dispatched 替代裸 assert；lease/mcp_gateway 两处 task 模块级强引用 + discard 回调；tool_policy docstring 改引真实构造方
结果：新增 10 个回归用例全部通过；admin+release+mcp_gateway+session_queue 套件 255 passed 1 xfailed、lease 相关 188 passed；ruff check/format 全过、mypy 6 模块 0 issue；模块文档 4 份已同步

## ql-20260827-020-c8d0 | 2026-08-27 23:52:51 | 会话输入框功能按钮合并——派团队并入＋功能菜单（附件/派团队/选择技能/关联变更·快速修复）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-input-bar.tsx（＋功能按钮+四入口菜单+insertMentionTrigger）
- frontend/src/components/daemon/session-panel.tsx（TeamTriggerRow 去按钮按需渲染+三宿主接线）
- frontend/src/components/daemon/__tests__/session-input-bar-plus-menu.test.tsx（新增 8 用例）
- frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx（门控用例走菜单+三参断言补遗）
- frontend/src/components/daemon/__tests__/session-panel-team.test.tsx（按钮查询改 menuitem）
需求：会话输入框功能按钮合并——派团队并入＋功能菜单（附件/派团队/选择技能/关联变更·快速修复）
根因：用户需求：输入区按钮收敛——原 📎 附件按钮与输入区上方独立「派团队」按钮两个入口合并为一个＋功能按钮，点击弹菜单承载附件、派团队、选择技能、关联变更/快速修复四类入口
方案：session-input-bar 📎 改 ＋ 按钮弹自定义功能菜单（daemon 族 absolute bottom-full 浮层惯例）：附件项走原 file input 管线（门控下沉菜单项 title）、派团队项经新 props onTeamTrigger/teamTriggerDisabled/Title 回调父层开 TeamTriggerPopover（门控口径同原按钮）、选择技能/关联变更项向光标插入 / 或 @ 驱动既有联想浮层（词中插入自动补空格保词首检测）；菜单外点/Esc/选中即关；TeamTriggerRow 移除派团队按钮并按需渲染（chip/错误/弹层开才出现）；page 真会话/预会话/dialog 三宿主接线
结果：新增 session-input-bar-plus-menu.test.tsx 8 用例全过；适配 pre-session/team 测试 13 用例（含 ql-20260827-018 streamSession 三参断言漏改补遗）；相关 9 suites 174 用例全过，tsc 0、eslint 无新增告警；未部署
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/daemon/__tests__/session-panel-team.test.tsx

## ql-20260828-001-6c6e | 2026-08-28 00:08:50 | get_or_issue 吊销按 name 过滤——init 不再一锅端持久 token
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/platform_sync/token_service.py（INIT_PROVISIONED_TOKEN_NAME 常量 + 吊销 SELECT name 过滤）
- backend/app/modules/mcp_gateway/service.py（同名常量 + 查旧过滤加 name 条件）
- backend/app/modules/platform_sync/tests/test_get_or_issue.py（场景2 反转（持久存活）+ 场景2b 并存不崩回归锚）
- backend/app/modules/mcp_gateway/tests/test_get_or_issue.py（场景2/5 契约反转）
- .sillyspec/docs/backend/modules/platform_sync.md（MANUAL_NOTES 补 2026-08-27 修订条目）
- .sillyspec/docs/backend/modules/mcp_gateway.md（MANUAL_NOTES 补 2026-08-27 修订条目）
需求：get_or_issue 吊销按 name 过滤——init 不再一锅端持久 token
根因：init lease 触发的 get_or_issue 把同 workspace+created_by 名下所有活 token（connect 换发 shpsync_ 与手签 shmcp_）全部吊销，而新 init token 明文仅当次消费不写回 local.yaml，持久凭据从此静默 401（docs/sillyspec/init-revokes-persistent-local-yaml-tokens.md）
方案：两处 get_or_issue 吊销查询加 name=init-provisioned 过滤（只轮换旧 init token 防堆积，持久 token 不动）；platform_sync 侧同时消除多活并存时 scalar_one_or_none 的 MultipleResultsFound 潜伏崩溃；两测试文件契约反转 + 并存回归锚；两模块文档 MANUAL_NOTES 补修订条目
结果：pytest platform_sync+mcp_gateway+daemon/lease 279 passed（get_or_issue 10 passed）；ruff 两模块通过；mypy 4 改动文件 0 issues

## ql-20260828-002-f314 | 2026-08-28 00:13:39 | pre-commit hook deny 文案补「整条命令未执行（含 git add）」提示
状态：已完成
关联变更：（无）
文件：.claude/hooks/pre-commit-ci-check.cjs
需求：pre-commit hook deny 文案补「整条命令未执行（含 git add）」提示
根因：PreToolUse deny 是工具调用级拦截，复合命令整条未执行，但 deny 理由只说「commit was blocked」——重试只重跑 commit 导致链上 git add 的文件静默漏提交（2026-08-27 QUICKLOG 漏提交实证）
方案：deny reason 按命令是否含 git add 追加定向/通用提示行，一行文案消除歧义
结果：node --check 通过；临时仓两分支仿真 deny 文案均按预期输出；纯文案改动无逻辑分支变化，未触及 backend/frontend 路径（pre-commit CI 不适用）

## ql-20260828-003-f2b4 | 2026-08-28 07:39:06 | session-ppm-item-sessions 越权收紧 + PPM 附件物化并行化与查询收敛
状态：已完成
关联变更：2026-08-28-session-ppm-task-binding
文件：
- backend/app/modules/ppm/common/router.py（data_scope 可见性守卫）
- backend/app/modules/daemon/session/service.py（三阶段并行物化+item 传参）
- backend/app/modules/daemon/session/context.py（item 可选传参）
- backend/app/modules/ppm/common/tests/test_session_binding.py（2 越权用例）
- .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md（条目）
需求：session-ppm-item-sessions 越权收紧 + PPM 附件物化并行化与查询收敛
根因：收尾审查发现三处：item-sessions 端点仅认证不授权，任意登录用户可枚举他人任务的会话（PPM 已上线模块的越权读取面）；物化最多 10 附件串行 2 次 IO 共 20 次串行网络往返拖慢会话创建；同一请求 load_ppm_item 查询 3 次
方案：router.py 前置 task_scope_clause/problem_scope_clause 条目可见性守卫（不可见返回 []防存在性泄露）；_materialize_ppm_attachments 三阶段重构（顺序资格判定保图≤5/文≤5 水位→asyncio.gather 并行读写→原序组装降级）；item 可选传参全链复用前置解析加载行
结果：test_session_binding 17 passed（含 2 新越权用例）+ daemon 相关 87/26 passed（含事务守卫）+ ruff 全过；容器重建实测超管可见普通用户空列表（越权修复生效）、绑定链路正常；测试数据已清理
审计：⚖️ 归属切分：4 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/grants/service.py, backend/app/modules/daemon/service.py, backend/app/modules/daemon/session/context.py, backend/app/modules/daemon/tests/test_session_create_config.py

## ql-20260828-004-5798 | 2026-08-28 08:19:07 | daemon 自更新后自动重启——更新完不再裸退出死掉
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/preflight.ts（runDaemonSelfUpdate 返回布尔+respawnDaemonAndExit+mcp-server 伴生替换）
- sillyhub-daemon/src/daemon.ts（SELF_UPDATE 处理器 stop→拉起→退出）
- sillyhub-daemon/tests/preflight.test.ts（+6 用例（返回值/mcp 三态/respawn 三态/启动期集成））
- backend/app/modules/daemon/ws_hub.py（docstring 同步自拉起）
- .sillyspec/docs/sillyhub-daemon/modules/preflight.md（契约/关键逻辑/注意事项更新）
- .sillyspec/docs/sillyhub-daemon/modules/preflight.changelog.md（新建变更索引）
- .sillyspec/docs/sillyhub-daemon/modules/daemon.changelog.md（新建变更索引）
- .sillyspec/docs/sillyhub-daemon/scan/ARCHITECTURE.md（自更新行为描述更新）
- .sillyspec/docs/SillyHub/scan/CONCERNS.md（条目坐实根因+修复）
需求：daemon 自更新后自动重启——更新完不再裸退出死掉
根因：自更新替换 bundle 后 process.exit(0)，但代码注释假设的外部 supervisor 从未落地：install wrapper 是一次性 exec，无 systemd/服务/计划任务，平台触发升级后 daemon 离线需手动拉起
方案：preflight.ts 的 runDaemonSelfUpdate 改返回 boolean 并移出退出逻辑；新增 respawnDaemonAndExit（detached spawn node 新 bundle+原启动参数，成功后 500ms exit，拉起失败记 error 保活旧进程）；启动期 runPreflight 与 WS SELF_UPDATE 两路径据 true 自拉起，WS 路径先 stop() 释放 runtime lock/标 offline 再拉起避免抢锁竞态；未发生替换改记 self_update_noop 保持运行；mcp-server.js best-effort 伴生替换
结果：vitest tests/preflight.test.ts 23/23（原17+新增6）；pnpm typecheck 绿；ruff check+format ws_hub.py 绿；文档同步 preflight.md/ARCHITECTURE.md/CONCERNS.md/ws_hub.py docstring + 两模块 changelog sidecar

## ql-20260828-005-fe24 | 2026-08-28 08:41:06 | 门户机器选择器接入共享机器——三入口漏网修复
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/sessions-portal.tsx（三处消费切融合候选）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（共享机器两步浮层回归用例）
需求：门户机器选择器接入共享机器——三入口漏网修复
根因：sessions-portal 只喂 PreSessionPicker 自有 items，漏接 task-10 的 machineCandidates 融合候选（门户新建表单是悬浮/运行中条/门户三入口中唯一漏网的）
方案：sessions-portal 三处消费（组头「＋」picker + 两处 SessionPanel）统一切 pickerMachines=machineCandidates??machines，对齐 floating-host 接法，离线判定同步覆盖共享会话
结果：新增融合候选回归用例+既有 19 用例 20/20 全过、tsc 零错、前端容器重建后 chunks 含 sharedToMe、提交 dd6d8a8e+8a6403f1 已推送 origin/main

## ql-20260828-006-739b | 2026-08-28 09:06:24 | 共享机器会话创建 404 修复——D-012 早退误伤双授权场景
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：共享机器会话创建 404 修复——D-012 早退误伤双授权场景
根因：v1 platform 早退在 workspace 授权前 return None，门户无档案直传被一刀切封堵
方案：删早退统一 workspace 判定（无授权仍默认 404，封堵目标不变）
结果：29+1386 用例全过、ruff/mypy 净、实测 201+审计 grant_id

## ql-20260828-007-2270 | 2026-08-28 09:32:26 | 会话列表机器筛选 tab 接入共享机器——session-list-panel 与移动端三处改喂 machineCandidates（同类第三批漏接）
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260828-008-f487 | 2026-08-28 09:37:14 | 工作区绑定守护进程支持选用成员共享 daemon（收尾）
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：工作区绑定守护进程支持选用成员共享 daemon（收尾）
根因：收尾步
方案：收尾
结果：全部完成

## ql-20260828-009-08d0 | 2026-08-28 09:46:50 | 运行时页平台共享智能体卡默认折叠+补启用/删除操作
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/platform-shared-agents-card.tsx（默认折叠+启用/停用切换+删除二次确认）
- frontend/src/lib/daemon.ts（setSharedAgentEnabled 泛化+deleteSharedAgent 新增）
- frontend/src/components/daemon/__tests__/platform-shared-agents-card.test.tsx（8 用例重写（折叠/启用/删除/antd v6 confirm 标题双渲染坑））
- frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx（admin 用例适配折叠断言）
- .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md（变更索引 ql-20260828-009-08d0）
需求：运行时页平台共享智能体卡默认折叠+补启用/删除操作
根因：后端 grants/router.py 已有 PATCH enabled 双向与 DELETE 204 端点但前端只接了停用按钮，且管理卡常驻展开占据页面大量空间
方案：platform-shared-agents-card.tsx 加 expanded 状态默认折叠（头部常驻 N 个生效/共 M 个计数摘要+展开按钮，条件渲染表单/列表）；lib/daemon.ts disableSharedAgent 泛化为 setSharedAgentEnabled(grantId,enabled)+新增 deleteSharedAgent；操作列按行状态给停用/启用切换+删除（App.useApp modal.confirm 二次确认，对齐 runtimes 页移除运行时先例）
结果：组件 8 用例+页面测试 20/20 绿、page-usage 10/10 绿、tsc 0 错、lint 仅预存 warning

## ql-20260828-010-d154 | 2026-08-28 10:13:48 | 工作区守护状态徽标误报离线——aggregateDaemonStatus 实例源仅自有，共享绑定 daemon 查不到判离线（列表卡/切换器/移动端三消费方同错）
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260828-011-5523 | 2026-08-28 10:24:43 | 悬浮助手工作区页新会话携带 workspace_id（收尾）
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：悬浮助手工作区页新会话携带 workspace_id（收尾）
根因：收尾
方案：同前
结果：同前

## ql-20260828-012-2a3e | 2026-08-28 10:31:24 | 工作区守护进程共享卡禁止借用绑定再共享——前端隐藏开关+后端归属校验
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/workspace/member_runtimes/service.py（归属校验 403 daemon_not_owned）
- backend/tests/modules/workspace/test_member_runtimes.py（借用者 403 无残留用例）
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx（boundDaemonOwned+借用绑定提示）
- frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx（两新用例+QueryClient 预存债修复）
- .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md（变更索引）
- .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md（变更索引）
需求：工作区守护进程共享卡禁止借用绑定再共享——前端隐藏开关+后端归属校验
根因：quick-18951370 放宽借用绑定后，前端只要 myBinding 存在就渲染共享开关（标签取共享机器候选，故显示「xx 共享」），后端 set_my_binding_shared 无 daemon 归属校验——借用者能以自己名义再开 workspace grant，原共享人撤销后借用者的授权仍在，撤销语义被击穿
方案：后端 set_my_binding_shared 在写 shared/grant 前校验 binding 的 daemon 归属（属他人 403 daemon_not_owned 零残留）；前端 page 记 boundDaemonOwned，借用绑定不渲染开关改提示「当前绑定的是他人共享的守护进程（借用），仅自有守护进程可开启共享」；新增后端借用者 403 用例+前端自有/借用两用例，顺手修 quick-18951370 漏处理的 page.test QueryClientProvider 预存债（HEAD 基线 10/10 全挂，mock use-daemon-machines 修复）
结果：后端 25 用例全绿+ruff/mypy 净；前端 page.test 12/12+toggle 组件 4/4+tsc 0

## ql-20260828-013-1a7d | 2026-08-28 12:24:35 | CI 红灯清偿：backend-ci mypy 拦门两处 + frontend-ci 九测试文件（machineCandidates mock 债与 Sessi…
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/tests/test_ppm_session.py, backend/app/modules/ppm/common/session_binding.py, backend/tests/modules/auth/test_login_captcha.py, frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx, frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx, frontend/src/components/__tests__/workspace-access-guide.test.tsx, frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx, frontend/src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx, frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx, frontend/src/components/mobile/mobile-session-list.test.tsx, frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（他者 quick 会话 quick-1cc450ee 同声明，经核实为本会话 CI 修复产出，补录文件行）
需求：CI 红灯清偿：backend-ci mypy 拦门两处 + frontend-ci 九测试文件（machineCandidates mock 债与 SessionPanel ＋菜单旧断言）+ auth captcha 环境敏感
根因：backend-ci 被 3d8432d9 两处 mypy 错误拦在 pytest 之前；frontend-ci 失败一半是组件改读 useDaemonMachines 融合候选后测试 mock 未跟、一半是 604c32fa ＋功能菜单收敛未适配旧断言；本地 captcha 两用例红是 .env 开关环境敏感（CI 不受影响）
方案：session_binding 按 kind 分支具体类型查询；test_ppm_session 改局部列表；captcha fixture 钉开关 True；6 文件 mock 补 machineCandidates 同源注入或整体 mock hook；SessionPanel 三件改走 ＋ 菜单交互与 streamSession 三参断言
结果：backend mypy 762 文件 0 错 + 相关 pytest 109+21 用例绿 + ruff 净；前端 9 文件 130 用例绿 + tsc 0 + lint 仅预存 warning；alembic 单 head 确认；local.yaml 豁免清单同步收缩

## ql-20260828-014-45f9 | 2026-08-28 13:35:04 | 登录页可读性与滚动条修复——左侧小字白透明阶+右侧光斑裁切
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(auth)/login/page.tsx（BrandPanel 小字白透明阶 + 光斑裁切罩 + QR 紧凑化/短视口隐藏 + 页脚 lg:hidden 去重 + 留白收敛）
需求：登录页可读性与滚动条修复——左侧小字白透明阶+右侧光斑裁切
根因：左侧小字用 brand-100 系色，dark 主题 brand 阶=cyan 翻转后 brand-100=#164e63 深青压深色渐变不可读；右侧两个装饰光斑绝对定位在 overflow-y-auto 滚动容器内且负偏移超出右/下边缘，任意屏幕尺寸都会无条件撑出横/纵滚动条；QR 入口卡叠加页脚又使内容在短视口超高触发滚动
方案：BrandPanel 徽标/正文/特性描述改 text-white/90·75·70（面板渐变三主题恒深色，与 hero-header 同惯例）；光斑套 inset-0+overflow-hidden 裁切罩；QR 卡紧凑化（码 80→64、p-3、mt-3、单行说明）+[@media(max-height:660px)]:hidden；桌面页脚标语与左侧 BrandPanel 重复改 lg:hidden；section py-10→8、卡 p-9→8、标题 mb-7→6、登录名/密码表单项补 mb-4
结果：page.qr.test.tsx 2 用例绿（aria-label/标题/mobile-qr-url 断言未动），tsc --noEmit 0 错，未跑无关全量

## ql-20260828-015-796d | 2026-08-28 13:39:18 | backend-ci 首跑全量暴露三预存债修复：ppm 成对 422 英文文案中文化、PublishIntent 漏 ctx_tokens、captcha 禁用…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/router.py（422 detail 中文化）
- backend/app/modules/daemon/schema.py（同口径 ValueError 中文化）
- backend/tests/modules/agent/test_agent_run_log_tool_kind.py（补 ctx_tokens=None）
- backend/tests/modules/auth/test_login_captcha.py（去 undo 改显式翻开关 + 限流阈值隔离）
需求：backend-ci 首跑全量暴露三预存债修复：ppm 成对 422 英文文案中文化、PublishIntent 漏 ctx_tokens、captcha 禁用开关用例 undo 误撤 fake_redis
根因：mypy 拦门期间三债从未在 CI 执行：3d8432d9 写了英文 422 文案违 l10n 守护、ctx_tokens 字段加入后旧测试构造未跟、captcha 用例 monkeypatch.undo 连 fixture 补丁一并撤销在无 Redis 的 CI 上失败计数丢失
方案：router/schema 两处同口径中文化；测试构造补 ctx_tokens=None；去 undo 改显式翻回开关并调高限流阈值隔离关注点
结果：l10n/tool_kind/captcha 127 用例绿 + daemon ppm/list_filters 57 绿 + mypy 762 文件 0 错 + ruff 净

## ql-20260829-001-ace1 | 2026-08-29 02:01:23 | 修复 batch token 统计 input/output 翻倍 bug（extractResultStats 同源求和）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/adapters/stream-json.ts（extractResultStats input/output 改 result 优先回落 + docstring/注释同步）
- sillyhub-daemon/tests/stream-json.test.ts（旧求和断言改四维 result 优先）
- sillyhub-daemon/tests/stats-passthrough.test.ts（case1/case3 断言修正 + case1b 翻倍回归新增）
- sillyhub-daemon/tests/cache-passthrough.test.ts（input 200→100 断言修正）
- sillyhub-daemon/tests/task-runner-budget.test.ts（result.usage 数据改官方累计语义）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引补 ql-20260829-001-ace1）
需求：修复 batch token 统计 input/output 翻倍 bug（extractResultStats 同源求和）
根因：Claude CLI 的 result.usage 本身是整个 run 的官方累计，accumulated 是 message_start/message_delta 自算的同一份账（batch 必开 --include-partial-messages 恒有值），旧代码两者相加致 AgentRun 输入/输出终值精确 2 倍（实测 1447→2894）；task-16 当时只修了 cache 两维的同类翻倍，input/output 漏改
方案：extractResultStats 的 input/output 对齐 cache 的 task-16 语义改为 result.usage 优先、缺失回落 accumulated；同步更新 _accumulatedUsage docstring 与过时注释；修正 4 处钉住旧求和断言的用例（stream-json 四维 result 优先 / stats-passthrough case1&case3 / cache-passthrough input 100 / task-runner-budget result.usage 改官方累计 110/70 保持 budget 触发意图）+ 新增 case1b 真实事件流翻倍回归；模块文档 sillyhub-daemon.md 变更索引补 ql-20260829-001-ace1
结果：stream-json+stats-passthrough+cache-passthrough+task-runner-budget 88 用例与 task-runner 72 用例全绿，pnpm typecheck 0 错误；未部署（daemon 修复需随下次 daemon 发版分发）
审计：⚖️ 归属切分：3 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/tests/cache-passthrough.test.ts, sillyhub-daemon/tests/stats-passthrough.test.ts, sillyhub-daemon/tests/task-runner-budget.test.ts
