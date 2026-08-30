
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
