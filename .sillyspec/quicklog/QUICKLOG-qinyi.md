
## ql-20260829-008-69d9 | 2026-08-29 14:00:21 | 工作区状态字段维护（详情页归档/恢复）+ 列表默认只展示活跃工作区
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/workspace/schema.py（WorkspaceUpdate.status Literal 化 + 删类尾重复自由字符串字段）
- backend/app/modules/workspace/service.py（update 内 pending→active 委托 activate 引导）
- backend/app/modules/workspace/tests/test_router.py（新增 3 用例（归档恢复/非维护值 422/pending 引导））
- backend/openapi.json（gen:types 再生成）
- frontend/src/lib/api-types.ts（gen:types 再生成）
- frontend/src/lib/workspaces.ts（UpdateWorkspaceInput.status 收窄 active|archived）
- frontend/src/app/(dashboard)/workspaces/page.tsx（statusFilter 默认 active）
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx（基本信息编辑表单状态下拉 + 取消重置 + 状态中文标签常量）
- frontend/src/components/workspace/hero-header.tsx（非 active 状态徽标显中文（原显英文原值））
- frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx（默认筛选+切全部状态用例（antd Select mouseDown 点选））
- frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx（编辑归档保存链路用例）
需求：工作区状态字段维护（详情页归档/恢复）+ 列表默认只展示活跃工作区
根因：状态值域四值（pending/active/archived/deleted）虽已定义，但 WorkspaceUpdate 类尾存在一个同名的自由字符串 status 字段，把后来任何校验都覆盖成任意值可写（连 deleted 都能裸写且不触发软删收敛）；同时列表页无默认状态筛选，归档/废弃工作区与活跃区混排
方案：后端删除重复字段并给 WorkspaceUpdate.status 挂 WorkspacePatchStatusLiteral（仅 active/archived，其余 422）；service.update 对 pending→active 委托 activate 引导（spec bootstrap 与 last_scanned_at 不被绕过）；前端列表页 statusFilter 默认 active（全部状态可选回），详情页基本信息编辑表单增状态下拉（存量 pending 追加原值选项、取消重置草稿、omit 不改语义），hero 徽标非 active 值显中文标签，UpdateWorkspaceInput.status 类型收窄
结果：后端 workspace 模块 218 passed 1 skipped（skip 为 Windows 符号链接权限预存环境跳过，新增 3 用例含归档恢复主路径/非维护值 422/pending→active 引导断言）+ ruff/mypy 0 错；前端两个测试文件 18 passed（新增 2 用例）+ tsc 0 错 + eslint 0 错误；gen:types 已同步 openapi.json 与 api-types.ts；模块文档 workspace.md 已更新暂存

## ql-20260829-009-a4e6 | 2026-08-29 14:30:16 | 工作区选择器只列活跃工作区 + 归档详情页提示横幅
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/agent-profile-form.tsx（档案归属工作区选择器取数加 status active）
- frontend/src/components/daemon/platform-shared-agents-card.tsx（共享智能体源码工作区下拉取数加 status active）
- frontend/src/components/workspace/LinkWorkspaceDialog.tsx（PPM 关联候选取数加 status active（已关联存量行不受影响））
- frontend/src/app/m/workspaces/page.tsx（移动端列表 statusFilter 默认 active）
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx（归档态顶部琥珀提示横幅）
- frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx（归档横幅用例（活跃无/归档有+文案））
需求：工作区选择器只列活跃工作区 + 归档详情页提示横幅
根因：上一变更落地状态维护后的遗留收口——归档区仍出现在各处工作区下拉候选（档案归属/共享智能体源码/PPM 关联），且进归档区详情页无状态提示，不知为何列表看不到
方案：三处下拉选择器取数加 status=active（agent-profile-form / platform-shared-agents-card / LinkWorkspaceDialog）；移动端 /m/workspaces 列表默认筛选活跃对齐桌面；归档详情页顶部琥珀横幅（提示默认不可见口径+恢复路径指向基本信息编辑）；名字解析类与会话工作区树刻意不过滤，归档区既有会话与绑定名仍可见
结果：tsc 0 错；受影响测试全绿（组件 27+移动端 5+详情 14，新增归档横幅用例 1 条）；eslint 改动文件 0 错误；模块文档 workspace.md 已补选择器口径段

## ql-20260829-010-0616 | 2026-08-29 20:47:49 | 归档工作区禁写收口（写入口 409 守卫 + 前端按钮置灰）
状态：已完成
关联变更：（无）
文件：
- backend/app/core/errors.py（WorkspaceArchived(409) 错误类）
- backend/app/modules/workspace/service.py（ensure_writable 静态守卫（archived 拦/pending 放行））
- backend/app/modules/workspace/tests/test_archived_write_guard.py（新建 5 用例（unit 两态+会话/run/变更 409 集成））
- backend/app/modules/daemon/session/service.py（创建会话工作区解析点接守卫）
- backend/app/modules/change_writer/service.py（发起变更门禁接守卫（先于 not-scanned））
- backend/app/modules/agent/service.py（批量派发 start_run+变更级派发两处接守卫）
- frontend/src/components/sessions/session-list-panel.tsx（归档组头「＋」置灰（archivedWorkspaceIds 经 hook→GroupNode 透传））
- frontend/src/components/sessions/sessions-portal.tsx（scoped 页头「新建会话」置灰（getWorkspace 判归档））
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（归档＋禁用用例（disabled+title+活跃组不受影响））
需求：归档工作区禁写收口（写入口 409 守卫 + 前端按钮置灰）
根因：状态维护（ql-20260829-008/009）落地后归档只是不可见+提示，写入口未拦——归档区仍可经 API 创建会话/发起变更/派发任务，与归档语义矛盾
方案：后端 WorkspaceService.ensure_writable 统一守卫（WorkspaceArchived 409 中文提示+恢复路径），接线四处写入口——创建会话（daemon/session）、批量派发 run（start_run）、变更级派发、发起变更（change_writer 门禁先于 not-scanned）；pending 不拦。前端会话树归档组「＋」与 scoped 门户页头「新建会话」置灰（提示恢复路径），权限权威在服务端
结果：后端新增 5 用例全绿（unit/会话 409/run 409/变更 409 含顺序断言）+ change_writer 47 + 会话路由 + agent run 37 回归绿，ruff/mypy 0 错；前端 session-list-panel 52（新增归档＋禁用用例）+ 门户/会话页 107 回归绿，tsc 0 错，eslint 0 错误；模块文档 workspace.md 已补禁写口径段
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/workspace/tests/test_archived_write_guard.py

## ql-20260829-011-d37c | 2026-08-29 21:14:26 | 归档区存量会话转只读（inject/interrupt 409 + 前端输入栏置灰）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service.py（_ensure_session_workspace_writable 守卫 + _inject_into_session/interrupt_session 两处接线）
- backend/app/modules/workspace/tests/test_archived_write_guard.py（新增 inject 409/interrupt 409 集成用例（守卫先于 status 判定））
- frontend/src/components/daemon/session-panel.tsx（sessionWorkspaceArchived 派生 + sendingDisabled/placeholder 并入（三处输入栏覆盖））
- frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx（归档只读用例（findBy 等异步 workspacesQuery））
需求：归档区存量会话转只读（inject/interrupt 409 + 前端输入栏置灰）
根因：上一轮禁写只拦「新建」，归档区既有会话仍可继续对话（inject）与中断（interrupt），归档语义不完整
方案：后端 SessionService._ensure_session_workspace_writable 守卫接线 _inject_into_session 共享核心（覆盖用户 inject/平台审批代写/激活分支三路径）与 interrupt_session，409 与创建/派发同口径，无工作区会话不拦；前端 SessionPanel sessionWorkspaceArchived 派生并入 sendingDisabled+占位文案（归档只读提示），三处输入栏挂载点自动覆盖
结果：后端 test_archived_write_guard 7 用例全绿（新增 inject/interrupt 409 集成）+ inject/interrupt 相关 97 回归绿 ruff/mypy 0；前端预会话 36（新增归档只读用例）+ prompt/dialog 62 回归绿 tsc 0 eslint 0 错误；模块文档 workspace.md 已补存量会话只读段

## ql-20260829-012-2eb3 | 2026-08-29 23:01:56 | 会话开启自动注入用户信息与平台规则前导
状态：已完成
关联变更：2026-08-29-session-user-preamble
文件：
- backend/app/modules/daemon/session/context.py（新增 build_user_preamble/build_platform_rules_preamble/build_sillyspec_preamble 三前导函数+admin/auth 模型导入）
- backend/app/modules/daemon/session/service.py（create_session 前导段组装三前导（workspace 口径与 AgentSession 同式）并扩 _prefix_parts 至七段）
- backend/app/modules/daemon/tests/test_session_user_preamble.py（新建三组 14 用例（字段/空跳过/护栏/环防护/探测三分支/首轮顺序/缺块/后续轮干净））
需求：会话开启自动注入用户信息与平台规则前导
根因：此前 agent 不认识对话用户、无语言规范约束、不知道项目是否用 SillySpec 管理，业务用户常被专业术语轰炸
方案：context.py 新增三前导构建函数（用户信息含组织全路径与沟通适配指引+护栏、语言规则、SillySpec 条件注入）并在 create_session 首轮拼进 dispatch_prompt 紧贴用户原话，后续轮次不带
结果：相关测试 46+76 全绿（含新增 14 用例），ruff check/format 0 问题，mypy 0 问题

## ql-20260830-001-2e52 | 2026-08-30 05:55:40 | 风险审查 8 簇高置信缺陷修复批（PAX 中文路径/墓碑 rename 错配/半删 CASCADE/归档禁写 7 绕过/重派自愈链/usage 闸门/流式 ta…
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/mcp_tools.py, backend/app/modules/agent/service.py, backend/app/modules/agent/worker_redispatch.py, backend/app/modules/change/dispatch.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_reparse_delete_closure.py, backend/app/modules/change_writer/service.py, backend/app/modules/daemon/sweep.py, backend/app/modules/daemon/tests/test_session_usage.py, backend/app/modules/daemon/tests/test_worker_redispatch.py, backend/app/modules/mcp_gateway/tools.py, backend/app/modules/platform_sync/router.py, backend/app/modules/spec_workspace/router.py, backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/tests/test_bundle_sync.py, backend/app/modules/workspace/service.py, backend/app/modules/workspace/skills_view_service.py, backend/app/modules/workspace/tests/test_archived_write_guard.py, frontend/src/components/permissions/session-permission-panel.test.tsx, frontend/src/components/permissions/session-permission-panel.tsx, sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/test_bundle_metadata_compat.test.ts
需求：风险审查 8 簇高置信缺陷修复批（PAX 中文路径/墓碑 rename 错配/半删 CASCADE/归档禁写 7 绕过/重派自愈链/usage 闸门/流式 tar 泄漏/SSE 无限重连）
根因：2026-08-30 01:00 只读审查发现 8 簇高置信缺陷：PAX len 按码元校验致中文文件名落混淆路径互相覆盖；墓碑行进 rename 候选致同日新变更出生即隐藏且永久 409 无逆转；delete_change 两 commit 间中断的半删行被 reparse 物理删 CASCADE 抹审计；归档禁写守卫漏 7 写入口；重派 NoOnlineDaemonError 后 sweep 只选 active/pending 自愈承诺无实现；usage 端点缺 TASK_RUN_AGENT 且软删不过滤；tar 流 finally 先 done 后 put 满队死锁+starlette 不调同步迭代器 close；审批面板无 done 监听无限重连
方案：①parsePaxRecords 改 Buffer 字节偏移（daemon+CLI 两仓同修）②_detect_renames 候选排除 location=deleted ③删除环遇 platform_deleted 锚点降级置软删（stats.tombstoned）④激活分支/plan-response/_dispatch_worker_core/mcp_gateway dispatch_worker/_dispatch_execute_team/skills+mcp-config+init+generate-projects/change_writer 八点接 WorkspaceService.ensure_writable ⑤sweep 每轮捞 failed worker+末次 run=daemon_interrupted+runtime 回在线+宽限窗内重 fire（fire_worker_redispatch 补强引用池）⑥usage 端点换 TaskRunAgentUser+归属过滤加 deleted_at ⑦_BundleTarStream put 先于 done.set、路由经 iter_bundle_stream async 包装显式 close 且阻塞挪线程池 ⑧审批面板 wire() 加 done 命名事件监听置 closed
结果：全部相关测试绿：daemon bundle 兼容 10/10、CLI pull-spec-bundle 17/17、reparse 删除闭环 19/19、归档守卫 14/14、worker_redispatch 26/26、session_usage 8/8、bundle_sync 14/14、审批面板 13/13、相邻套件 104+37 绿；backend ruff check 0 错、改动文件 format/mypy 0（既有 7 错为 HEAD 预存非本次引入）；daemon tsc 0 错；frontend tsc 0 错+eslint 改动文件 0 错（3 warning 均 HEAD 既有）；未部署

## ql-20260830-002-f0d2 | 2026-08-30 06:32:28 | 剩余中置信缺陷修复批（selfupdate 停机竞态/unlink 窗口/.tmp 残留/outbox 422 丢报/update 绕墓碑/archive 边界…
状态：已完成
关联变更：（无）
文件：backend/app/modules/platform_sync/service.py, backend/app/modules/platform_sync/tests/test_change_deleted_guard.py, backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/lib/daemon.test.ts, frontend/src/lib/daemon.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/preflight.ts, sillyhub-daemon/src/resilience/service.ts, sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts, sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts, sillyhub-daemon/tests/resilience/resilience-service.test.ts, sillyhub-daemon/tests/preflight-download-replace.test.ts
需求：剩余中置信缺陷修复批（selfupdate 停机竞态/unlink 窗口/.tmp 残留/outbox 422 丢报/update 绕墓碑/archive 边界/SSE 停连/reopen 守卫）
根因：上轮审查 5 条中置信+2 条留置（stop 幂等空转致 respawn 抢锁全灭；无条件 unlink 致 since 漂移；下载失败 tmp 残留；stale-token 422 永久丢报；update 绕防复活守卫落僵尸文件；archive 名范围吞归档区；全局 SSE 无停连名单；reopen 未接守卫）
方案：R1 stop 存 _stopPromise 可重入等待+定时器 _running 守卫；R2 rename 直接覆盖失败才退回；R3 catch 清理 tmp；R4 staleReplay 标记+422 有界保留 5 轮；R5 两道守卫扩到 update；R6 前缀四段起步+archive 跳过活跃区范围；R7 PERMANENT_SSE_ERROR_STATUSES 接入全局订阅；R8 reopen 接归档守卫。顺手清偿 f7f99a2f getSessionUsage mock 债（page/portal 17 红转绿）
结果：相关测试全绿 20/8/3/35/15/13/29/47/59/56；daemon tsc 0；backend ruff/format/mypy 改动文件 0；frontend tsc 0+eslint 0 错；未部署

## ql-20260830-003-e38e | 2026-08-30 06:59:04 | CI 修复批——frontend getSessionUsage mock 债清偿 + backend ruff/mypy HEAD 预存债清偿
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/mission.py, backend/app/modules/agent/tests/test_derive_status_matrix.py, backend/app/modules/agent/tests/test_worker_subsession_dispatch.py, backend/app/modules/spec_workspace/tests/test_quicklog_reconcile.py, backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py, backend/app/modules/workspace/member_runtimes/tests/test_representative_binding.py, frontend/src/components/daemon/__tests__/session-panel-connection.test.tsx, frontend/src/components/daemon/__tests__/session-panel-ctx-tokens.test.tsx, frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx, frontend/src/components/daemon/__tests__/session-panel-dialog-changeid.test.tsx, frontend/src/components/daemon/__tests__/session-panel-dialog-offline.test.tsx, frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx, frontend/src/components/daemon/__tests__/session-panel-prompt.test.tsx, frontend/src/components/daemon/__tests__/session-panel-team.test.tsx, frontend/src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx, frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx, frontend/src/components/daemon/__tests__/session-suspended-display.test.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, backend/app/modules/agent/mcp_tools.py, backend/app/modules/change/service.py, backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
需求：CI 修复批——frontend getSessionUsage mock 债清偿 + backend ruff/mypy HEAD 预存债清偿
根因：f7f99a2f session-usage-stats 给 @/lib/daemon 新增 getSessionUsage 且 SessionPanel 双模式挂载用量条后，旧测试文件 mock 未同步：actual 展开型（dialog/pre-session）真实取数撞测试 fetch 桩 junk-resolve 崩 cacheHitRate（usage.totals undefined），显式列表型（sessions-portal/dashboard sessions page）缺导出炸 Uncaught Error；backend-ci 5 连败全是 ruff format HEAD 债（Mypy/Pytest 从未跑到），mypy 另有 5 错 HEAD 债：change/service _progress_reported_active_keys 累加器复用参数名 keys 致 no-redef+返回二义、spec_workspace 三测试 _op 过时 type: ignore[arg-type]
方案：前端 13 个 SessionPanel 测试文件 hoisted 对象补 getSessionUsage: vi.fn().mockResolvedValue(null)（必须 resolve——裸 vi.fn() 返回 undefined 会被组件 .then 同步崩；null=按无数据不渲染）+ factory 映射行；portal/page 由并行会话已补 mock，我修其 vi.fn 零参推断 vs 转发层 rest 展开的 TS2556（实现加 (..._args: unknown[])）；后端 ruff format 5 文件 + 3 处过时 ignore 删除 + 累加器改名 active_keys
结果：前端 4 个 CI 失败文件 150/150 绿 + 11 个防回归文件 78/78 绿 + typecheck/lint 0 错；后端 change+spec_workspace 34 用例、agent+workspace 193 用例全绿，mypy 0 错（原 5）、ruff check 过、格式化 4 文件 --check 干净；未部署（纯测试基建与静态检查修复）
审计：📝 文档欠账（D-8）：17 个源码文件改动未同步任何模块文档（涉及模块：frontend）

## ql-20260830-004-90a4 | 2026-08-30 07:20:09 | daemon-ci 红修复——selfupdate 集成 harness 模拟在跑 daemon
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts
需求：daemon-ci 红修复——selfupdate 集成 harness 模拟在跑 daemon
根因：3aff0ce5 R1 给 30s 自升级复查定时器加 !this._running 停机守卫（生产语义正确，stop 后 SDK 子进程句柄可使进程存活到 +30s 不该再触发升级）；但 selfupdate-scenarios 集成 harness 四路径刻意不 start()，_running 恒 false，重探全被守卫吃掉，路径①/② 的 writePendingUpdate×3 与 runDaemonSelfUpdate×2 断言过期变红
方案：makeHarness 按既有 _registeredRuntimes 直填同款 cast 惯例补 (daemon as unknown as { _running: boolean })._running = true，模拟在跑 daemon 对齐守卫前置；不改产品代码
结果：selfupdate-scenarios 4/4 绿 + 邻近 selfupdate/orchestrator/heartbeat/preflight 31 用例绿 + daemon tsc 0 错；未部署

## ql-20260830-005-6441 | 2026-08-30 07:45:57 | backend-ci Pytest 21 红清偿
状态：已完成
关联变更：（无）
文件：backend/app/modules/git_log/tests/test_router.py, backend/tests/modules/spec_workspace/test_apply_sync.py
需求：backend-ci Pytest 21 红清偿，git_log 补种 daemon 实体与旧位三元组解包
根因：e2b95aad 落在最后一次绿 backend-ci 之后，其 host_fs 解析 JOIN daemon_instances 使 git_log 测试的幽灵 daemon_id 绑定解析归 None，20 用例塌缩 502 OFFLINE，被 ruff 格式墙挡了约 18 小时才在 Pytest 暴露；d3f094da 把 build_bundle 改为三元组返回但漏改 tests/modules 旧位用例的二元解包
方案：git_log 的 binding_factory 在 daemon_id 非空时按 test_worker_subsession_dispatch 同款 raw INSERT 补种真实 daemon_instances 行；旧位用例改为三元组解包；均不改产品代码
结果：git_log test_router 44/44 绿，tests/modules/spec_workspace/test_apply_sync 12/12 绿，ruff format 与 check 均无问题；未部署

## ql-20260830-006-5639 | 2026-08-30 16:15:27 | 删除被 23 天前孤儿 claimed lease 永久 409——删除路径前置收敛死 lease
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/runtime/service.py（_converge_dead_leases_before_delete 前置收敛 + 两删除路径接线）
- backend/app/modules/daemon/tests/test_runtime_admin_management.py（孤儿收敛 204/活会话仍 409/过期收敛 三用例）
- backend/app/modules/daemon/tests/test_machines_router.py（机器级孤儿收敛用例）
需求：删除被 23 天前孤儿 claimed lease 永久 409——删除路径前置收敛死 lease
根因：interactive lease 恒 NULL 过期时间（daemon 设计），会话终态后若 daemon 死亡 lease 行无收敛通道，永久停在 claimed；删除守卫盲数 pending/claimed 把死行当在途工作，生产 26 行实证把 delete_runtime 永久 409
方案：RuntimeService._converge_dead_leases_before_delete（两类可证死行置 cancelled：interactive+绑定会话 ended/failed；claimed+expires_at 已过），delete_runtime 与 delete_machine 共用，收敛后再数真在途（活会话/未过期仍 409）
结果：后端 60 用例全绿（runtime 级新增 3：孤儿收敛 204/活会话仍 409/过期收敛 204；机器级新增 1）+ ruff/mypy 0 错；模块文档 daemon.md+changelog 已更新

## ql-20260830-007-5d4f | 2026-08-30 16:41:18 | 权限审批通知点击跳转会话深链补齐
状态：已完成
关联变更：2026-08-29-approval-notify-push
文件：
- backend/app/modules/daemon/permission_service.py（link 深链）
- backend/app/modules/daemon/tests/test_permission_owner_notify.py（link 断言）
需求：权限审批通知点击跳转会话深链补齐
根因：task-06 实现期 _notify_session_owner 的 link 留空 None，铃铛组件对空 link 仅标已读不跳转（用户反馈会话 684607b 提问通知点击无效）
方案：link 改为 /sessions?session={session_id}（前端真实深链 sessions-portal.tsx:134 deepSessionId），覆盖 permission_request 与 permission_timeout 两类 owner 定向通知；测试补 link 断言
结果：test_permission_owner_notify 6 passed（含新断言）；daemon.changelog 追加索引；改动仅 permission_service.py 与其测试

## ql-20260830-008-fe1d | 2026-08-30 16:46:30 | daemon 徽标 15s 闪烁修复——状态查询缓存键剔除心跳时间戳
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/workspace-daemon-status.ts（queryKey 瘦身 id+status + keepPreviousData）
- frontend/src/components/workspace-switcher.tsx（撤 30s 轮询改下拉打开时 refetch）
需求：daemon 徽标 15s 闪烁修复——状态查询缓存键剔除心跳时间戳
根因：quick-90a9bf32 把含 last_heartbeat_at 的整个 machineCandidates 塞进 queryKey，15s 机器轮询后键必变切到空缓存，statusMap 短暂退化为空致全页徽标闪「未绑定」；切换器另有 30s 常驻轮询 GET /api/workspaces 治吵诉求
方案：workspace-daemon-status.ts 缓存键瘦身为每台机器 id+status 二元组并加 placeholderData keepPreviousData 双保险（聚合仍用完整候选，共享 daemon 误报修复语义不变）；workspace-switcher.tsx 撤 30s refetchInterval 改下拉打开时 refetch，同步修正过时注释
结果：workspace-daemon-status 15 + workspace-switcher 12 共 27 用例全过，tsc --noEmit 0 错误，frontend.changelog.md 已同步

## ql-20260830-009-8177 | 2026-08-30 17:00:41 | 通知面板样式与文案优化
状态：已完成
关联变更：2026-08-29-approval-notify-push
文件：
- backend/app/modules/daemon/permission_service.py（_dialog_preview+body 文案）
- backend/app/modules/platform_sync/service.py（显示名前缀剥离+body 句式）
- frontend/src/components/notifications/notification-bell.tsx（条目重排）
- backend/app/modules/daemon/tests/test_permission_owner_notify.py（body 断言×3）
- backend/app/modules/platform_sync/tests/test_pending_approval_broadcast.py（title/body 断言+前缀剥离用例）
需求：通知面板样式与文案优化
根因：权限/提问/超时通知 body 与 title 逐字重复（实现期占位未替换）；待审通知变更名回退 change_key 原始全名（含日期前缀）致截断难看；前端条目标签与标题同行挤占空间、时间行混排、未读标识弱
方案：后端提问 body 放提问预览（_dialog_preview 同前端口径）、canUseTool body 为请求使用工具名、超时 body 为 None；待审显示名在 title 空或等于 key 时去日期前缀、body 新句式；前端标签移标题上方独立行加时间右对齐、标题独占整行、未读改左侧竖条、去点击查看、全部已读加图标、间距收紧
结果：后端 11 passed（含新 body 断言与日期前缀剥离用例）前端 7 passed tsc 0 ruff/format 过；期间修一处类属性裸引用 NameError 被吞坑

## ql-20260830-010-509a | 2026-08-30 19:53:49 | 附件草稿清理任务传参修复——main.py 传工厂函数本身致每轮清理必抛
状态：已完成
关联变更：（无）
文件：
- backend/app/main.py（lifespan 挂载点改传工厂实例）
- backend/app/modules/session_attachment/cleanup.py（三函数类型注解+fail-fast 守卫）
- backend/app/modules/session_attachment/tests/test_cleanup.py（新增契约与错型拒绝两用例）
需求：附件草稿清理任务传参修复——main.py 传工厂函数本身致每轮清理必抛
根因：11c17b36 挂载时 start_draft_cleanup_task(get_session_factory) 少调一层括号，cleanup 内 async with session_factory() 拿到 async_sessionmaker 直接抛 TypeError 被吞成 hourly warning，草稿行自 8-20 从未清理，mypy arg-type 全局禁用拦不住
方案：main.py 改传 get_session_factory() 工厂实例；cleanup.py 三函数形参补 async_sessionmaker 注解；start_draft_cleanup_task 加 isinstance 错型 fail-fast 守卫
结果：session_attachment 测试 4/4 绿（新增契约+错型拒绝两用例）+ ruff 过 + mypy 0 错；已提交 206523c4 未推送

## ql-20260830-011-99a8 | 2026-08-30 20:19:03 | 清偿 CI 双红：backend 测试夹具 location 非法值对齐 + daemon 自更新盘上校验目录改注入派生修环境依赖测试
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/tests/test_context_builder.py（夹具 4 处 location 非法值）
- backend/app/modules/agent/tests/test_dispatch_profile.py（夹具 1 处）
- backend/app/modules/agent/tests/test_execution_context.py（夹具 1 处）
- backend/app/modules/agent/tests/test_m2n_agent_run.py（夹具 1 处）
- backend/app/modules/agent/tests/test_router.py（夹具 1 处）
- backend/app/modules/file/tests/test_file_agent_owner.py（夹具 1 处）
- backend/app/modules/workflow/tests/test_audit_hooks.py（夹具 2 处）
- backend/app/modules/workflow/tests/test_router.py（夹具 1 处）
- backend/app/modules/workflow/tests/test_spec_guardian.py（夹具 1 处）
- backend/app/modules/workspace/tests/test_m2n_task.py（夹具 1 处）
- backend/tests/core/test_audit_hooks_effective.py（夹具 1 处）
- sillyhub-daemon/src/daemon.ts（_tryUpdate 两处校验目录改 dirname(_selfUpdateBundlePath)+注释）
- sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts（bundleWith 填充 ≥64KB+两大 describe beforeEach 预置基础盘态）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引补 ql-20260830-011-99a8 条目）
需求：清偿 CI 双红：backend 测试夹具 location 非法值对齐 + daemon 自更新盘上校验目录改注入派生修环境依赖测试
根因：27c05447 把 changes.location CHECK 对齐 active/archive/deleted 三值但只修了 change 模块自己的测试，其余 11 文件 15 处夹具仍插从未合法的 'change'（生产 PG 建表起即两值约束，SQLite 测试库无该约束掩盖）；951ad8be 给 _tryUpdate 加 stop 前 validateBundleOnDisk 主拦截时硬编码 DAEMON_BIN_DIR（HOME 目录），集成测试不真实落盘，作者本机恰有真实部署 bundle 才绿，CI 干净环境必红
方案：夹具 15 处改 'active'；daemon.ts 两处校验目录改 dirname(_selfUpdateBundlePath)（生产默认同值行为不变，D-006 同款可注入）；selfupdate-scenarios 两大 describe（task-08 四路径+task-06 恢复互斥）beforeEach 预置 ≥MIN_BUNDLE_BYTES 且含 BUILD_ID 的假 bundle 模拟下载已落盘；sillyhub-daemon.md 变更索引补条目（顺带入卡 951ad8be 漏同步的 D-009 拦截语义）
结果：daemon selfupdate 相关 3 文件 50/50 绿 + tsc 0 错；backend 11 文件 136/136 绿 + ruff format/check 0 问题；待 push 后 CI 复核

## ql-20260830-012-d892 | 2026-08-30 20:52:29 | CI 双红清偿二轮：补修首轮漏掉的 4 个 location="local" 非法值夹具文件
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/git_gateway/tests/test_router.py（夹具 location 非法值）
- backend/app/modules/tool_gateway/tests/test_router.py（夹具 location 非法值）
- backend/app/modules/tool_gateway/tests/test_policy.py（夹具 location 非法值）
- backend/app/modules/worktree/tests/test_router.py（夹具 location 非法值）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（条目口径更新 15 文件 19 处）
需求：CI 双红清偿二轮：补修首轮漏掉的 4 个 location="local" 非法值夹具文件
根因：首轮只按 CI 日志 INSERT 参数暴露的 'change' 值检索，git_gateway/tool_gateway×2/worktree 四文件夹具用的是另一个非法值 'local'（同样不在 CHECK 三值 active/archive/deleted 内），CI 二跑仍 52 红暴露
方案：4 处 location="local" 统一改 "active"；模块文档 ql 条目口径更新 15 文件 19 处；迁移测试的故意反例 bogus 不动
结果：4 文件 81/81 用例绿 + ruff 0 问题；daemon-ci 已在 a9df1beb 转绿；本轮补修后待 push 复核 backend-ci

## ql-20260830-013-14b3 | 2026-08-30 22:19:09 | 会话用量条摘要行小型化——指标名改图标+悬浮提示
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-usage-bar.tsx（摘要行图标化+title 提示+小型化）
- frontend/src/components/daemon/__tests__/session-usage-bar.test.tsx（标签断言 getByText→getByTitle）
需求：会话用量条摘要行小型化——指标名改图标+悬浮提示
根因：会话顶部用量统计视觉过于显眼（六项文本标签+13px 粗体值抢会话主体视觉），用户要求弄小、指标名不直显
方案：session-usage-bar 摘要行六项改 lucide 图标（ArrowDownToLine/ArrowUpFromLine/HardDriveDownload/HardDriveUpload/Repeat/Gauge）+11px medium 值，指标名收敛为原生 title 悬浮提示；「按模型明细」按钮改 ChevronDown 图标按钮（title+aria-label 保语义）；容器 py-2.5→py-1.5 收紧；折叠明细表按需展开不动；测试标签断言 getByText→getByTitle 同步
结果：vitest 针对性 5 用例全绿（session-usage-bar.test.tsx 1 file passed），pnpm exec tsc --noEmit exit 0

## ql-20260830-014-74f5 | 2026-08-30 22:42:20 | 会话用量条悬浮提示升级 antd Tooltip
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-usage-bar.tsx（title→antd Tooltip+aria-label）
- frontend/src/components/daemon/__tests__/session-usage-bar.test.tsx（断言 getByTitle→getByLabelText）
需求：会话用量条悬浮提示升级 antd Tooltip
根因：原生 title 悬浮约 1 秒延迟且样式随浏览器不跟主题，用户要求改用 antd Tooltip
方案：六项 UsageItem 与「按模型明细」按钮的 title 属性改 antd Tooltip（先例 message-queue-bar，即时弹出+主题 token），触发元素补 aria-label（无障碍名+测试锚点）并移除 title 防浏览器双提示；测试断言 getByTitle→getByLabelText；模块文档条目与 changelog 同步
结果：vitest 针对性 5 用例全绿（session-usage-bar.test.tsx 1 file passed），pnpm exec tsc --noEmit exit 0

## ql-20260831-001-6dde | 2026-08-31 02:03:40 | 修复 2026-08-31 风险审查六项：恢复链误杀在途 turn/start 双实例/disable 停进程/VBS 引号/备份残件/附件清理竞态
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/types.ts（新增 SessionBusyError 恢复链守卫错误类型）
- sillyhub-daemon/src/interactive/session-manager.ts（restoreAndReconnect 驱逐前活会话守卫 running/待处理输入抛 SESSION_BUSY）
- sillyhub-daemon/src/daemon.ts（恢复链 catch 入重试队列+resume busy 跳过两条消费分支）
- sillyhub-daemon/src/cli.ts（startAction step 0.5 单实例守卫 pid 存活且非自身拒绝 respawn 标记豁免）
- sillyhub-daemon/src/preflight.ts（respawn spawn 注入 SILLYHUB_DAEMON_RESPAWN=1+备份残件清理）
- sillyhub-daemon/src/autostart/linux.ts（unregister 去 --now 不再停止运行中 unit）
- sillyhub-daemon/src/autostart/macos.ts（unregister 改 launchctl list 判运行中跳过 bootout）
- sillyhub-daemon/src/autostart/windows.ts（buildVbsContent node 路径加引号防 Program.exe 植入）
- backend/app/modules/session_attachment/cleanup.py（DELETE 外层补 session_id IS NULL 关回填竞态）
- sillyhub-daemon/tests/cli.test.ts（单实例守卫 3 用例）
- sillyhub-daemon/tests/autostart.test.ts（unregister 语义更新+VBS 引号新断言）
- sillyhub-daemon/tests/session-manager-busy-check.test.ts（驱逐守卫 3 用例）
- sillyhub-daemon/tests/interactive/daemon-recovery-boot.test.ts（SessionBusyError 重试分支用例）
- sillyhub-daemon/tests/preflight.test.ts（respawn env 断言）
- sillyhub-daemon/tests/preflight-download-replace.test.ts（备份残件清理用例）
- backend/app/modules/session_attachment/tests/test_cleanup.py（双谓词契约用例）
- .sillyspec/docs/sillyhub-daemon/modules/autostart.md（disable 语义/VBS 引号/双实例提示）
- .sillyspec/docs/sillyhub-daemon/modules/cli.md（单实例守卫流程）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（驱逐前守卫）
- .sillyspec/docs/sillyhub-daemon/modules/preflight.md（respawn 标记+备份残件）
需求：修复 2026-08-31 风险审查六项：恢复链误杀在途 turn/start 双实例/disable 停进程/VBS 引号/备份残件/附件清理竞态
根因：风险审查发现的可证缺陷：恢复链触发瞬间忙检只查一次，在途期间新起 turn 会被 restoreAndReconnect 静默驱逐；start 无单实例守卫（macOS autostart enable 的 bootstrap RunAtLoad 立即拉起第二实例）；linux disable --now 与 macos bootout 会停运行中 daemon，与文档契约矛盾；VBS node 路径未引号存在 Program.exe 植入面；备份 copyFile 中途失败残件占轮换名额；附件清理 DELETE 守卫只在子查询，回填竞态可误删已发送附件
方案：①types 新增 SessionBusyError+restoreAndReconnect 驱逐前守卫（running/待处理输入抛错），daemon 恢复链 catch 入退避重试队列、SESSION_RESUME catch warn 跳过；②startAction 加 pid 存活单实例守卫，respawn spawn 注入 SILLYHUB_DAEMON_RESPAWN=1 豁免交接时序；③linux unregister 去 --now、macos 改 launchctl list 判运行中跳过 bootout；④VBS node 路径加引号；⑤备份失败清理半截 .bak；⑥cleanup.py DELETE 外层补 session_id IS NULL
结果：daemon 相关 8+4 文件套件 264 用例绿（含新增 cli 守卫 3+恢复链 1+守卫单测 3+备份残件 1+macOS unregister 3）+tsc 0；autostart 73 绿；backend test_cleanup 5 绿（含新增双谓词契约 1）+ruff/format/mypy 0

## ql-20260831-002-f683 | 2026-08-31 02:51:04 | 会话上下文窗口用量修复——分母可编辑默认1M兜底+daemon轮末usage补发
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/model.py（AgentSession加ctx_window_tokens列）
- backend/migrations/versions/20260831120000_add_agent_sessions_ctx_window_tokens.py（新迁移）
- backend/app/modules/daemon/schema.py（Read透出+请求DTO）
- backend/app/modules/daemon/router.py（PATCH ctx-window端点）
- backend/app/modules/daemon/session/service.py（update_ctx_window）
- backend/app/modules/daemon/service.py（门面委托）
- frontend/src/components/sessions/ctx-usage-bar.tsx（四级链+浮层编辑器）
- frontend/src/components/daemon/session-panel.tsx（真会话环接线）
- frontend/src/lib/daemon.ts（updateSessionCtxWindow）
- sillyhub-daemon/src/interactive/session-manager.ts（_flushTerminalUsage轮末补发）
- backend/openapi.json+frontend/src/lib/api-types.ts（gen:types产物）
需求：会话上下文窗口用量修复——分母可编辑默认1M兜底+daemon轮末usage补发
根因：本地模型（本机默认/未绑平台供应商）会话前端拿不到provider记录且本地端点协议不暴露窗口大小，分母派生为空显示「—」；daemon轮边界清零pendingUsage把最后一个500ms flush窗口内的usage（含ctx_tokens）静默丢弃，DB实证短轮大量NULL致环分子滞后
方案：agent_sessions加ctx_window_tokens列+迁移+PATCH ctx-window端点（1k~100M边界None=清除）；前端分母链升四级（会话覆盖＞one_m 1M＞常量表200k＞兜底1M不再为空）+环浮层内嵌编辑器；daemon新增_flushTerminalUsage在onTurnResult前逐桶补发usage-only消息
结果：backend 10+38绿 ruff/format净 mypy仅2预存错（非本次文件）；frontend 3文件50绿 tsc0 lint仅预存警告；daemon 4+13绿 tsc0；gen:types产物同步；本地Docker Postgres迁移已应用验证；生效需重建backend/frontend镜像+重装本机daemon

## ql-20260831-003-3c87 | 2026-08-31 09:53:13 | 修复 daemon 重启后 30 分钟内新建会话被会话闸全拒（SESSION_LIMIT_REACHED）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/tests/interactive/session-manager-worker-depth.test.ts, .sillyspec/docs/sillyhub-daemon/modules/interactive.md
需求：修复 daemon 重启后 30 分钟内新建会话被会话闸全拒（SESSION_LIMIT_REACHED）
根因：markReconnected 恢复成功后把 lastActiveAt 刷成 Date.now()，而 create 闸真活跃口径按 30 分钟窗口计数——重启恢复的满额 idle 会话（实机 21≥20）全被误判真活跃；既有 P0 回归测试直塞 _store 绕过恢复链，未拦住
方案：session-manager.ts markReconnected 移除 lastActiveAt 刷新（恢复是系统动作非用户活动，保档盘上原值，活跃时间由 inject/_onResult/interrupt/reload 真实用户活动维护），函数头注释补依据；worker-depth 测试文件 P0 块新增走真实 restoreAndReconnect→markReconnected 链的回归用例；interactive.md 人工备注补 ql-20260831-003-3c87 条目
结果：目标测试文件 16 用例绿（含新增 1）；恢复/idle/codex 相关 3 套件 49 用例绿；resilience/stop-suspend/bridge/busy-check 4 套件 57 用例绿；pnpm typecheck 0 错；三文件已 git add

## ql-20260831-004-d49f | 2026-08-31 10:12:13 | run 失败原因透出到 UI（failure_summary 全链路）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/control_commands.py, backend/app/modules/daemon/router.py, backend/app/modules/daemon/tests/test_control_commands.py, backend/app/modules/daemon/tests/test_session_runs_endpoint.py, frontend/src/components/agent-log/__tests__/normalize.test.ts, frontend/src/components/agent-log/normalize.ts, frontend/src/components/daemon/session-panel.tsx, frontend/src/lib/daemon.ts
需求：run 失败原因透出到 UI（failure_summary 全链路）
根因：调度层/系统层失败原因（撞闸 SESSION_LIMIT_REACHED、inject 过期联动）只存 agent_runs.output_redacted 且响应不暴露；GC 判败只写 error_code 不写文案；前端错误卡只消费模型层 error_detail，为空即显示「运行失败（无详情）」
方案：backend SessionRunRead 加 failure_summary（validation_alias 映射 output_redacted）；GC inject 过期联动按 delivered_at 分桶写中文原因；normalize 新增 buildSystemFailureItem（failure_summary 优先+撞闸识别+error_code 映射）；session-panel 三处失败卡逐级兜底；gen:types 双端重生成；模块文档 2 份同步
结果：backend 27 用例绿（新增 2）；frontend 67 用例绿（新增 3，夹具按规则 21 补字段）；ruff check/format 0、mypy 0；frontend/daemon tsc 0；gen:types 双端已同步
审计：⚖️ 归属切分：4 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/openapi.json, frontend/src/components/daemon/__tests__/session-panel-ctx-tokens.test.tsx, frontend/src/lib/api-types.ts, sillyhub-daemon/src/api-types.ts

## ql-20260831-005-c7a7 | 2026-08-31 10:34:16 | SESSION_INJECT 静默丢弃改为立即回报失败带原因（王鹏案根治）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/daemon-inject-drop-report.test.ts
需求：SESSION_INJECT 静默丢弃改为立即回报失败带原因（王鹏案根治）
根因：daemon 四条丢弃路径只 warn 不回报，run 挂 pending 等 10 分钟 GC 用笼统 interactive_inject_send_failed 收敛，丢弃原因永不到前端（实机案生产 wp 机 84cf91ab）
方案：_routeSessionControl 四路径接入 _reportInjectDropped：payload 自带 run_id/lease_id/claim_token 三件齐时 notifyRunResult 失败带中文原因（P2b 同款），summary 经 failure_summary 透出；不齐仅 warn 由 GC 兜底；新增 daemon-inject-drop-report.test.ts 六用例；daemon.md 同步
结果：新测试 6 绿；回归 resume-route/ws-session-control/kind-dispatch/control-dispatcher 55 绿 + interactive-bridge 32 绿；tsc 0 错

## ql-20260831-006-c089 | 2026-08-31 11:27:57 | cwd 守卫工作区范围直接放行（修 wp 机工作区会话被白名单误拒）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/interactive-cwd-guard.ts, sillyhub-daemon/tests/interactive-cwd-guard.test.ts
需求：cwd 守卫工作区范围直接放行（修 wp 机工作区会话被白名单误拒）
根因：工作区绑定会话的 cwd 即工作区根（非借用路径 cwd 恒等于 rootPath），机器白名单没配工作区目录时主会话/分身全被 cwd_forbidden 拒（生产 wp 机 84cf91ab：E:\sgm 是工作区 sgm 根却不在机器白名单）
方案：checkWorkspaceBoundCwd 加 workspaceRoot 可选参数——cwd 在工作区根内（assertWithinAllowedRoots 同口径）跳过机器白名单，存在性检查保留错机保护；daemon.ts 调用点传 rawRootPath；新增 5 用例；daemon.md 备注
结果：守卫测试 16 绿（新增 5）；回归 bridge+inject-drop 38 绿；tsc 0

## ql-20260831-007-0fd4 | 2026-08-31 11:57:38 | sillyhub-daemon 官方隔离参数 SILLYHUB_DAEMON_DIR——daemon 状态目录单点收口 8 处
状态：已完成
关联变更：2026-08-31-machine-sillyspec-version
文件：sillyhub-daemon/src/config.ts, sillyhub-daemon/src/credential.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/mcp-config.ts, sillyhub-daemon/src/preflight.ts, sillyhub-daemon/src/runtime-lock.ts, sillyhub-daemon/src/skill-manager.ts, sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/daemon-state-dir-isolation.test.ts, sillyhub-daemon/tests/spec-strategy/pull-strategy.test.ts, sillyhub-daemon/README.md
需求：sillyhub-daemon 官方隔离参数 SILLYHUB_DAEMON_DIR——daemon 状态目录单点收口 8 处，集成测试不再劫持 USERPROFILE
根因：pid 守卫等 daemon 状态全局派生 ~/.sillyhub/daemon，派生点分散 8 处（config hub + 直连 homedir 三处 + daemon.ts/preflight.ts 双份 bin 常量）无收口；集成测试只能覆写 HOME+USERPROFILE 整个 home 绕行，Windows 两侧都要覆写且波及 git/npm/claude 所有权路径
方案：config.ts 新增 daemonStateDir()（SILLYHUB_DAEMON_DIR 覆盖、resolve 归一、懒求值）与 daemonBinDir()；DEFAULT_CONFIG_DIR/CLAUDE_CONFIG_DIR/credentials/specs/manifests/skills/locks（LOCKS_DIR→locksDir() 懒函数，5 调用点跟进）/bin（daemon.ts+preflight.ts 收口同源消重）/mcp.json（原自拼 HOME 口径不一致）全部改派生；README 补「状态目录隔离」节（含 Git Bash/PowerShell 集成测试用例）；新增 tests/daemon-state-dir-isolation.test.ts 6 用例；pull-strategy.test.ts 的 node:os mock 变量补声明期初值（spec-sync 引入 config 后模块级求值撞上 mock 未初始化窗口，全量回归实证修复）
结果：typecheck 0 错；定向 5 文件 103 passed（含新 6 用例）；全量 187 文件回归与 E1 基线完全一致（6 既有 Windows interactive 失败、181 通过含新测试、零新增失败）；真实 dist 产物 e2e——SILLYHUB_DAEMON_DIR=<tmp> node dist/cli.js status 输出 Config dir 指向隔离目录、per-server config 写入隔离目录（读写双向验证）；local.yaml E2 段注释已补隔离参数关联说明

## ql-20260831-008-a52e | 2026-08-31 12:45:20 | CI 清偿：daemon interactive 9 用例双根因修复 + backend mypy unused-ignore
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts, backend/app/modules/session_attachment/tests/test_cleanup.py, .sillyspec/docs/sillyhub-daemon/modules/interactive.md
需求：清偿 CI 连续 6 次红——daemon-ci 9 个 interactive 用例稳定失败（8 个 onTurnResult spy 未调用 + 1 个僵尸驱逐抛 SessionBusyError）、backend-ci mypy 两个 unused type: ignore
根因：① ql-20260831-002-f683 在 _onResult 的 _runNotifyChain 前加了无条件 await _flushTerminalUsage——空转 await 也推迟一个 microtask，破坏 ql-20260825-f6#4「空链时 onTurnResult 同步直调」契约（emitResult 后同步断言的 8 用例全挂）；② ql-20260831-001-6dde 恢复链活会话守卫（running/pendingInject 抛 SessionBusyError）与 ql-20260823-006 僵尸静默驱逐语义冲突——僵尸条目恰是 running 态，被守卫拦成 SESSION_BUSY；③ test_cleanup.py 两处 type: ignore[method-assign] 在 CI 的 uv 锁定环境（较新的 sqlalchemy/mypy 组合）下判定为多余
方案：① _onResult 加 _hasPendingTerminalUsage 同步预判，有待发 usage 才 await 补发（补发→通知顺序不变，无 usage 恢复同步路径）；② 守卫收窄为同 lease 才拦——backend reopen_session 恒建新 lease 并随 SESSION_RESUME 下发（claim_token 亦重置），lease 失配即旧 lease 已被 backend 判死的孤儿工作，running 僵尸也静默驱逐（否则真僵尸永远 SESSION_BUSY 重启死循环）；同 lease running 才是真「恢复在途新起 turn」，维持 SessionBusyError（busy-check 守卫 3 用例同 lease 构造不受影响）；③ 删两处多余 ignore
结果：daemon 定向 17 文件 202 用例绿（含原 9 失败 + busy-check/daemon-recovery-boot 守卫回归）+ tsc 0；backend mypy app 全量 809 文件 0 错 + ruff/format 过 + test_cleanup 5 用例绿；interactive.md 守卫条目同步 lease 判据

## ql-20260831-009-c751 | 2026-08-31 12:56:17 | 修复多轮交互会话 token 用量虚增（modelUsage 累计快照差分化）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（modelUsage 快照差分（_deltaModelUsage + 基线 Map + onTurnResult 四维/明细行/成本差分 + onSessionEnd 回收））
- sillyhub-daemon/tests/daemon-interactive-bridge.test.ts（新增 7 个差分用例（含生产形态回归））
需求：修复多轮交互会话 token 用量虚增（modelUsage 累计快照差分化）
根因：SDK 的 modelUsage/total_cost_usd 在 streaming-input 会话每轮报的是会话至今累计快照，daemon 把快照当本轮增量上报、backend 按 run 求和，多轮部分被重复累计（生产会话 574793c6 缓存读 338.7 万 vs 真实 128.3 万）
方案：daemon.ts 新增 _deltaModelUsage 按模型逐维差分（复位检测：任一维回落基线即判 SDK 计数清零、全量上报基线归零）+ _modelUsageBaselineBySession 基线 Map（onSessionEnd 回收）；onTurnResult 的四维 token/model_usage 明细行/total_cost_usd 全走差分，无效快照回落 result.usage 老路径
结果：daemon-interactive-bridge 39 用例全绿（新增 7 差分用例）+ 相邻 3 套件 47 用例回归绿 + tsc 0；模块文档变更索引已补；历史已落库数据仍虚增未迁移，部署需重打 daemon bundle
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/tests/daemon-interactive-bridge.test.ts, backend/probe_glm_stream_usage.py

## ql-20260831-010-b7ec | 2026-08-31 12:57:02 | 轮次徽标输入侧 null 运行中改「↑执行中…」消假 0
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/turn-timeline.tsx（TurnStatusBadge 输入 null+isLive→「↑执行中…」）
- frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx（补运行中 null 输入回归用例）
需求：轮次徽标输入侧 null 运行中改「↑执行中…」消假 0
根因：旧实现 inputTokens null 时硬编码「↑0」误导；根因是 GLM 流式期间 message_start 不携带输入而 daemon 只从该事件取输入，轮内输入常 null（输出经 message_delta 实时累加正常显示）
方案：turn-timeline.tsx TurnStatusBadge 输入分支对齐输出侧 isLive 处理：null+运行中→「↑执行中…」，终态 null 保持「↑0」旧口径；补回归用例断言运行中 null 输入显示「↑执行中…」且无「↑0」；changelog 追加
结果：vitest turn-timeline-session-input-bar 22 用例全绿（含新用例），相邻 4 文件 18 用例回归绿，tsc --noEmit exit 0

## ql-20260831-011-2d44 | 2026-08-31 13:09:15 | daemon message_delta 差分补读 input_tokens 轮内输入实时化
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/session-manager.ts（delta 分支 input 差分累加+lastCallInputTokens 基线）
- sillyhub-daemon/tests/interactive/session-manager-usage-cache.test.ts（补 GLM/官方/跨 call 三形态差分用例）
需求：daemon message_delta 差分补读 input_tokens 轮内输入实时化
根因：GLM 兼容端点 message_start 不带 input（实证轮内↑0 终态才有值），daemon 只从 message_start 取输入、delta 只读 output/cache——若 GLM 在 delta 携带 cumulative input 也被丢弃，轮内输入无法实时显示
方案：session-manager _bufferPartial delta 分支补 input 差分累加：新增 lastCallInputTokens 基线（message_start 设 startUsage 值），delta 带 cumulative input 时差分累加 session/turn 双计数器并同步 main 桶 ctx；三形态全覆盖（官方 delta 无 input 零影响/start 带 input 差分 0 不翻倍/start 无 input 全额计入），补 3 个差分用例
结果：usage-cache 5 用例全绿（含 3 新），interactive 全套 55 文件 707 用例回归绿，tsc exit 0；daemon 待重建部署后 GLM 会话实测 delta 是否带 input

## ql-20260831-012-cd5e | 2026-08-31 15:46:49 | suspended 会话搁浅自愈（runtime 回在线自动救回 + 前端放开手动续聊）
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/__tests__/session-suspended-display.test.tsx, frontend/src/components/daemon/runtime-session-helpers.tsx, frontend/src/components/daemon/session-panel.tsx（后端自动救回与并行会话 ql-20260831-006-6d67 撞车，rebase 采纳其 session_auto_recover_sweep_once，本会话重复实现让路删除）
需求：suspended 会话搁浅自愈（runtime 回在线自动救回 + 前端放开手动续聊）
根因：后端部署重启期间 daemon 心跳断超 600s，离线巡检挂起 active 主会话并取消 lease；runtime 回在线后 daemon 没重启不走 recover、cancelled lease 无人复活，suspended 永挂且前端禁用手动续聊（实机 574793c6）
方案：前端 canResumeSession 放开 suspended（backend reopen 本就接受）+ 挂起横幅改双通道文案；后端自动救回原拟新增 recover_suspended_sessions_once，与并行会话 ql-20260831-006-6d67 的 session_auto_recover_sweep_once 同案撞车，rebase 采纳其更完善实现（含 min_age 防误抢优雅停机窗口），本侧重复实现删除
结果：backend sweep 13 绿（新增 3）；前端 suspended-display 11 绿；ruff/mypy/tsc 0
