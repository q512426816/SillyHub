
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

## ql-20260827-008-3952 | 2026-08-27 13:33:50 | 后台子代理完成后自动唤醒主代理汇报：daemon 收到 task_notification（completed/failed）时，经 debounce 合并同窗口多条通知，向同会话 inject 一条『[后台任务通知]』user 消息（含 …
状态：进行中
关联变更：（无）
文件：（见实际改动）
