
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
