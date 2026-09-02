
## ql-20260828-011-1ec7 | 2026-08-28 11:00:28 | 预会话派团队配置确认后补待生效反馈标签
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（TeamTriggerRow pendingTeam chip+预会话消费点）
- frontend/src/components/daemon/__tests__/session-panel-team.test.tsx（待生效 chip 两组用例+setupPre 提升文件级）
需求：预会话派团队配置确认后补待生效反馈标签
根因：预会话（无 sessionId）弹层确认后仅暂存 payload+回填 /team+关弹层，界面零反馈——用户不知道配置已生效待随首句创建（mission 随首句落库是 D-009 设计，无会话期间本就无 mission/chip），用户实测后误以为团队没建成
方案：TeamTriggerRow 加 pendingTeam 待生效 chip（虚线 brand 边框区分「进行中」实线；主体点击重开弹层修改、× 放弃暂存+清回填的 /team 输入框）；page 预会话消费点接 preTeamMission 非空渲染
结果：session-panel-team 18/18（新增确认后 chip 出现/× 放弃后消失+首句不带 team_mission）+ 相邻回归 130/130 + tsc 无错

## ql-20260828-012-4425 | 2026-08-28 11:16:47 | 派团队标签点击编辑回显当前配置
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/schema.py（summary 三字段）
- backend/app/modules/daemon/router.py（构造填充）
- frontend/src/lib/daemon.ts（类型同步）
- frontend/src/components/daemon/team-trigger-popover.tsx（initialConfig 回显+确认语义）
- frontend/src/components/daemon/session-panel.tsx（chip 派生/透传）
- frontend/src/lib/api-types.ts + backend/openapi.json（gen:types）
需求：派团队标签点击编辑回显当前配置
根因：chip 点击只 openTeamPopover(null) 弹层全初始值，用户重选全部配置；TeamMissionSummary 缺 project_id/worker_preset/main_agent_config 无法完整回显
方案：后端 summary 三字段补齐+gen:types；弹层 initialConfig 六项回显（含 mount 首跑 scope 不清修复 + 回显实例未展开预设确认原样回传）；session-panel 真会话从活跃 mission 派生（占位符目标过滤）、预会话从暂存 payload 回显
结果：前端 7 文件 185/185 + 后端 test_session_team_mission 26/26 + tsc 无错

## ql-20260828-013-a55b | 2026-08-28 13:03:17 | 团队任务状态永不收敛——分身失败/被杀后任务卡进行中
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/mission.py（_virtual_status 首run终态兜底）
- backend/app/modules/daemon/router.py（本地展开+行化同款）
- backend/app/modules/agent/tests/test_derive_status_matrix.py（守护用例×2）
需求：团队任务状态永不收敛——分身失败/被杀后任务卡进行中
根因：树内会话的 run 从 derive 输入剔除（防双计），run 终态信息完全丢失：_virtual_status 仅看会话侧——run killed 后会话 ended 无强收标记、run failed 后会话未收敛 active，两种形态虚拟 run 都卡 running（DB 实证 mission 1eae4f70 两形态并存）
方案：mission.py + daemon/router.py 两处 _virtual_status 加首 run 终态 failed/killed→虚拟 failed 兜底（mission 下带 role 的最早 run 查表；追问轮无 mission_id 不进首 run 集）；router 行化 row_status 同款；排序键 isoformat 规避 naive/aware datetime 混比；守护用例×2 锁定两形态收敛 + completed 不越权
结果：agent 全量 1181/1181（含 derive 矩阵 169 + team mission 端点）全绿；模块文档 agent.md 注意事项补双源同改警示
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/agent/tests/test_derive_status_matrix.py

## ql-20260828-014-bfef | 2026-08-28 13:35:22 | list_workers MCP 工具分身状态不收敛（主控拒派）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/mcp_tools.py（_list_workers_core 首run终态兜底）
- backend/app/modules/agent/tests/test_mcp_tools.py（守护用例）
需求：list_workers MCP 工具分身状态不收敛（主控拒派）
根因：ql-013 修了两处状态源，第三处镜像 _list_workers_core（MCP list_workers，主控唯一状态查询源）漏改首 run 终态兜底——run d72943d7 日志实证：主控查到 killed 分身显示 running，结论「没有全失败」拒绝用户重新分析请求
方案：row_status 加 first_run.status in (failed,killed)→failed 分支（三处镜像同构收齐）；守护用例锁定 killed+ended / failed+active 两形态；agent.md 警示双源改三源
结果：test_mcp_tools 52/52（含新增守护用例）

## ql-20260831-003-3d0a | 2026-08-31 09:20:49 | 消除 install.ps1 双 BOM 致 irm 加 iex 每次安装报无法将 Windows 项识别为 cmdlet
状态：已完成
关联变更：（无）
文件：
- backend/Dockerfile（删 printf 补 BOM + 加恰好一个 BOM 构建断言）
- backend/tests/test_daemon_dist.py（fixture 模板带单 BOM + 响应体无 \ufeff 回归锚点）
- .sillyspec/docs/backend/modules/daemon.md（install.ps1 编码契约更新为 BOM 单一来源 + 构建断言）
- .sillyspec/docs/backend/modules/daemon.changelog.md（补 2026-08-31 双 BOM 修复条目）
需求：消除用户每次 irm install.ps1 | iex 安装开头的无法将 Windows 项识别为 cmdlet 报错。
根因：backend/Dockerfile 构建时 printf 无条件补 UTF-8 BOM，与源文件自带 BOM 叠加成双 BOM，dist_router utf-8-sig 只剥一个，残留 \ufeff 混入响应体首字符，PS5.1 把首行注释当代码执行（该 bug 已三次横跳）。
方案：删 Dockerfile printf 补 BOM 行确立 BOM 单一来源为源文件，加恰好一个 BOM 的构建断言（违反即构建失败），test_daemon_dist fixture 模板带单 BOM 还原真实镜像状态并加响应体不以 \ufeff 开头的回归锚点，daemon.md 编码契约同步。
结果：pytest 9 passed，镜像重建部署后 127.0.0.1:3000 与 10.10.115.118:3000 返回首字节均为 # 无 BOM，PS5.1 用 irm 实拉并 iex 首行零报错，报错彻底消除；部署时附带发现前端 Node 代理缓存后端容器旧 IP 需随重建重启。

## ql-20260831-006-6d67 | 2026-08-31 11:14:57 | 会话卡排队双修复：inject 发送 30s 超时兜底 + suspended 会话随 daemon 回线自动恢复
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/api.ts（apiFetch timeoutMs/timeoutMessage 选项与 abort 合并）
- frontend/src/lib/daemon.ts（injectSession 接 30s 超时+专用文案）
- frontend/src/lib/__tests__/api.test.ts（超时 4 用例（自定义/缺省文案、外部 abort、无超时零回归））
- frontend/src/lib/daemon.test.ts（injectSession 超时文案 1 用例）
- backend/app/modules/daemon/sweep.py（session_auto_recover_sweep_once 第三档+常驻循环接线）
- backend/app/modules/daemon/tests/test_session_sweep_recover.py（新建（恢复/不误伤/幂等 4 用例））
- .sillyspec/docs/SillyHub/modules/daemon.md（sweep 三档描述（顺带修正旧文案 A5 分流语义））
- .sillyspec/docs/SillyHub/modules/daemon.changelog.md（ql-20260831-006-6d67 条目）
- .sillyspec/docs/SillyHub/modules/frontend_lib.md（api.ts 超时契约）
需求：会话卡排队双修复：inject 发送 30s 超时兜底 + suspended 会话随 daemon 回线自动恢复
根因：2026-08-31 会话卡排队事故两个实锤缺陷：①前端 apiFetch 无超时——后端劣化时 inject POST 无限挂起，占位轮永远「排队中/正在思考…」无错误提示，刷新后消息彻底消失（从未到后端）；②backend 重启窗口 daemon WS 断开被 10s 降级 offline，offline sweep 把 active 主会话误标 suspended 后无任何恢复触发点（既有恢复链只在 daemon 自身重启时跑），实测挂起 15 分钟无人恢复、24h 后被 GC 翻 failed
方案：①apiFetch 新增 timeoutMs/timeoutMessage（AbortController 合并调用方 signal，外部 abort 仍走 network_error），injectSession 统一 30s 超时+「发送超时：草稿已保留」文案，page/dialog 两模式既有 catch 撤占位轮+横幅提示；②sweep.py 新增 session_auto_recover_sweep_once——suspended 主会话其 runtime 重新 online+600s 宽限且挂起满 60s → 翻 reconnecting+发 SESSION_RESUME 控制指令（payload/供应商凭证对齐 reopen），daemon restoreAndReconnect→confirm 翻 active，失败三路收敛，wire 进 60s 常驻巡检
结果：后端 4 新用例绿+相邻回归 57 绿+ruff/format/mypy 0；前端 39 用例绿（新增 5）+tsc 0+eslint 0 error；未部署（改动在源码，Docker 镜像未重建）

## ql-20260831-007-520d | 2026-08-31 13:14:56 | worktree 基准分支探测兜底——派发前验证 default_branch 真实存在
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/execution.py（base_ref 探测兜底（git_rev_parse 验证 + HEAD 回退））
- backend/app/modules/agent/tests/test_dispatch_worker_worktree.py（mock 补 git_rev_parse + 新增 3 用例）
- .sillyspec/docs/SillyHub/modules/agent.md（MissionExecutionService 条目补探测兜底说明）
需求：worktree 基准分支探测兜底——派发前验证 default_branch 真实存在，缺失回退 HEAD
根因：平台缺陷：workspace 建档时 default_branch 落字段缺省值 'main'（schema.py:115），派发从未探测仓库真实分支；crrcdt-hubin 的 pmp-web-ui 仓库默认分支非 main，分身 worktree 创建连续 4 次 fatal: Not a valid object name: 'main'（worktree_create_failed），任务派发链整体断裂
方案：prepare_worker_worktree（团队/子会话两派发路径共用 helper）对非 HEAD 的 base_ref 先经既有 git_rev_parse RPC 验证可解析，不可解析/异常回退 HEAD（当前 checkout 基准）+ warning 日志；可解析则配置照常生效。零新增 RPC、零 daemon 改动、零数据库变更，存量配错工作区即时自愈
结果：test_dispatch_worker_worktree 9 绿（新增 3：缺失回退/探测异常回退/可解析保持）+ 相邻回归 50 绿（caller/direct/target 19 + subsession 31）+ ruff/format/mypy 0；已部署并生产端到端验证——向主控发「重新分析 pmp-web-ui」触发分身派发，backend 命中 mission_worker_base_ref_missing_fallback_head（'main' 不可解析回退 HEAD），worktree_branch=workers/ea51f348 成功建出、worker 正常运行（此前同场景连续 4 次 worktree_create_failed）

## ql-20260831-008-6876 | 2026-08-31 13:38:17 | mission.constraints 损坏双修——合并 SQL object 类型守卫 + 读取端 TypeDecorator 归一
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/patrol.py（_json_merge_expr 双方言 object 守卫）
- backend/app/modules/agent/model.py（ConstraintsJSON TypeDecorator（新增类+挂列））
- backend/app/modules/agent/tests/test_mission_constraints_integrity.py（新建 7 用例）
- .sillyspec/docs/backend/modules/agent.md（constraints 完整性双修条目）
需求：mission.constraints 损坏双修——合并 SQL object 类型守卫 + 读取端 TypeDecorator 归一
根因：patrol _json_merge_sql 的 COALESCE(constraints,'{}') 只挡 SQL NULL 挡不住 JSON 类型的 null：PG 下 json-null || 对象 按操作符规则产出数组 [null,{...}] 且每轮巡检继续追加（生产两条 mission 滚到 760KB），读取端 (mission.constraints or {}).get 对真值数组崩 AttributeError——converge 500 + patrol 每轮 mission_patrol_mission_failed；数据已手工修复但代码层缺陷在：新 mission 建档仍 JSON null，首次强收标记即复发
方案：①_json_merge_expr 双方言加守卫（PG jsonb_typeof / SQLite json_type，非 object 一律回 '{}' 再合并，存量损坏行由下一次合并自愈）；②AgentMission.constraints 列换 ConstraintsJSON TypeDecorator（读取端非 dict 归一 {}、None 保持，DDL 仍 JSON 零迁移），中心化覆盖全部 13 处读取点
结果：新 7 用例绿（合并三态+自愈+读取归一+PG SQL 锚点）+ 相邻回归 159 绿（finalizer/mission 族 76 + patrol 四件 83）+ ruff/format/mypy 0；待部署

## ql-20260831-012-5f60 | 2026-08-31 14:32:29 | 输入胶囊＋功能按钮放大显形——antd 高度钳制成 40x32 椭圆
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-input-bar.tsx（＋按钮改原生 button 40x40 圆形显形 + 发送按钮 !h-9 !w-9 修高度钳制）
- .sillyspec/docs/SillyHub/modules/frontend_components.md（frontend_components 变更索引补 ql-20260831-012 条目）
需求：输入胶囊＋功能按钮放大显形——antd 高度钳制成 40x32 椭圆
根因：antd Button 的 .ant-btn height:32 覆盖 Tailwind h-10，＋按钮实测渲染 40x32 椭圆且透明无边框、纯灰图标，用户反馈太小不明显；旁边发送按钮同根因被钳成 36x32（本应 36x36 正圆）
方案：session-input-bar.tsx：＋按钮弃 antd 改原生 button（同菜单项模式）真实 40x40 正圆 + border-border/bg-card 可点击外形，hover/展开态 brand 语义色随 data-theme 双主题换肤；发送按钮 h-9 w-9 改 !h-9 !w-9（!important 压 antd，惯例见 message-queue-bar）恢复正圆
结果：vitest 3 文件 31 用例全过（plus-menu/ux-fixes/team）；Docker 重建 frontend 镜像 --force-recreate 生效，容器内 chunk grep 到新类名，浏览器实测 40x40 正圆/发送 36x36/hover 青色 brand 态，截图目视通过

## ql-20260831-013-9043 | 2026-08-31 15:12:22 | 会话归档 UX 重做——行按钮按状态二选一 + 已归档徽标置灰 + 视图横幅 + toast 反馈
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/session-list-panel.tsx（行按钮二选一+徽标置灰+横幅+toast）
- frontend/src/components/sessions/sessions-portal.tsx（归档回调返回失败个数）
- frontend/src/components/floating/floating-session-host.tsx（同上悬浮宿主侧）
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（新增 4 用例+useNotify mock）
- .sillyspec/docs/SillyHub/modules/frontend_components.md（变更索引补条目）
需求：会话归档 UX 重做——行按钮按状态二选一 + 已归档徽标置灰 + 视图横幅 + toast 反馈
根因：行级归档/取消归档按钮无条件齐显，不看会话实际归档状态，点错侧后端幂等静默无反馈；归档后行从默认列表消失零提示，归档视图内行与普通会话同貌无任何标识，只能靠筛选猜
方案：session-list-panel：行按钮按 archived_at 二选一；已归档行加徽标（title 含归档时间）+ 整行 opacity-60 降调；归档视图顶部横幅（数量+恢复指引）；单条/批量操作全走 useNotify toast，回调契约改返回失败个数（sessions-portal 与 floating-session-host 两调用方 Promise.allSettled 统计 rejected 同步），部分失败出 warning
结果：vitest 56 用例全过（新增 4）；tsc --noEmit 零错误；Docker 重建 frontend 生效，浏览器生产实测横幅/徽标/置灰/按钮二选一/toast 文案全部确认（antd v6 toast DOM 为 .ant-message-notice-title），测试归档数据已还原

## ql-20260831-014-c6fe | 2026-08-31 15:39:19 | 会话列表 6 个确认弹窗去渐变色块图标
状态：已完成
关联变更：（无）
文件：frontend/src/components/sessions/session-list-panel.tsx
需求：会话列表 6 个确认弹窗去渐变色块图标
根因：渐变色块 icon 在 antd v6 confirm icon 槽被压成 16x32 瘦条变形且与全站 confirm 风格不一致（用户反馈突兀）
方案：session-list-panel.tsx 单/批删除、单/批归档、单/批取消归档 6 处 Modal.confirm 删除自定义渐变 icon，走 antd 默认样式（对齐 runtimes 页惯例）
结果：vitest 56 用例全过；tsc 零错误；Docker 重建容器内 chunk 已无渐变类。后续：用户追加反馈默认感叹号图标不对应功能，ql-015 将改为功能语义图标

## ql-20260831-015-d729 | 2026-08-31 15:54:08 | 确认弹窗图标功能语义化 + 全部状态含已归档（后端 archived 三态）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service.py（归档过滤三态化）
- backend/app/modules/daemon/service.py（facade 签名同步）
- backend/app/modules/daemon/router.py（HTTP 默认 None）
- backend/app/modules/daemon/tests/test_session_review_fixes.py（新增三态测试）
- frontend/src/components/sessions/session-list-panel.tsx（6 个 confirm 语义图标）
- frontend/src/components/mobile/mobile-session-list.tsx（默认视图显式 archived=false）
- frontend/src/lib/use-daemon-machines.ts（会话计数显式 archived=false）
- frontend/src/lib/api-types.ts + backend/openapi.json（gen:types 再生成）
- 模块文档×2（变更索引与人工备注补条目）
需求：确认弹窗图标功能语义化 + 全部状态含已归档（后端 archived 三态）
根因：去渐变后 antd 默认感叹号图标不对应操作功能（用户反馈）；「全部状态」筛选实际只查未归档（HTTP 层 archived 默认 False），语义应为全部
方案：后端 list_agent_sessions/facade 改 archived:bool|None=False 三态（None=不过滤，service 默认零回归），router Query(default=None)；桌面树不传参即全部（行有徽标置灰），移动端默认视图与 use-daemon-machines 显式 archived=false 保原语义；6 个 confirm 传 lucide 语义图标（删除=Trash2 红/归档=Archive/取消归档=ArchiveRestore brand 色）；gen:types 同步 openapi+api-types
结果：后端 31 用例过（新增三态测试）；前端 125 用例过（移动端 C-08 断言随契约更新）；tsc 零错误；Docker 前后端重建生效，浏览器实测全部状态 62 个含 1 归档行徽标、弹窗 Archive 图标 brand 青色不变形（截图确认）
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_session_review_fixes.py, frontend/src/components/mobile/mobile-session-list.test.tsx

## ql-20260831-016-54a0 | 2026-08-31 16:17:15 | 确认弹窗图标被压缩变形且与标题零间距——外包固定尺寸 span 修正
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/session-list-panel.tsx（confirmIcon helper + 6 处换用）
- .sillyspec/docs/SillyHub/modules/frontend_components.md（变更索引补 ql-016 条目）
需求：确认弹窗图标被压缩变形且与标题零间距——外包固定尺寸 span 修正
根因：antd v6 confirm icon 槽的尺寸/间距样式期望 .anticon 包裹结构，裸 lucide svg 不命中——实测 ql-015 的 h-5 w-5 图标被压成 12x20、与标题 gap=0（用户反馈太小太贴）
方案：session-list-panel.tsx 封 confirmIcon(Icon, colorCls) 模块级 helper：外包 span（h-6 w-6=24px 与 16px 标题视觉匹配 + shrink-0 防 flex 压缩 + mr-3=12px 间距），6 处 confirm 统一换用，图标种类与语义色不变
结果：56 用例全过；tsc 零错误；Docker 重建生效，浏览器实测图标 24x24 不变形、与标题间距 12px，截图目视比例协调（AI 视觉评审通过）

## ql-20260901-002-8e58 | 2026-09-01 10:49:58 | /team 指令消息气泡与回放显示前缀修复
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service.py（_strip_team_command_prefix 派发层剥离：create dispatch_prompt/objective 回落、inject SESSION_INJECT/SWITCH payload/objective 占位回填）
- frontend/src/components/daemon/session-panel.tsx（三处 handleSend 改发原始输入 + 裸 /team 守卫 + 注释更新）
- backend/app/modules/daemon/tests/test_inject_first_turn_briefing.py（新增 TestTeamCommandPrefixStrip 5 用例）
- frontend/src/components/daemon/__tests__/session-panel-team.test.tsx（codex 直发断言改原文）
- frontend/src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx（放行直发断言改原文）
- frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx（首句 prompt 断言改带前缀原文）
需求：/team 指令消息气泡与回放显示前缀修复（对齐 /sillyspec:quick 等技能指令的显示形态）
根因：前端 handleSend 三处发送路径剥离 /team 前缀，后端 user_input 日志存剥后文本——展示层（气泡/回放）永远拿不到前缀，与 /sillyspec:quick 等技能指令显示形态不一致
方案：前端三处发送路径改发原始输入（裸 /team 无内容守卫保留前端）；剥离收口到后端派发层 _strip_team_command_prefix（create dispatch_prompt/objective 回落、inject SESSION_INJECT/SWITCH payload/objective 占位回填；整条指令匹配 /teams 不误伤），user_input 日志/队列条目保留原文
结果：后端 test_inject_first_turn_briefing 15/15 绿（新增 5 用例）+ruff/mypy 0；前端 4 套件 66/66 绿+tsc 0+eslint 0 errors；Docker 重建后浏览器实测气泡显示前缀、刷新回放保留、DB 验证 objective 剥后+日志原文、加载 1.65s 正常
审计：⚖️ 归属切分：4 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_inject_first_turn_briefing.py, frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx, frontend/src/components/daemon/__tests__/session-panel-team.test.tsx, frontend/src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx

## ql-20260902-001-4f08 | 2026-09-02 09:33:51 | daemon worktree 命令 10s 超时必杀大仓库检出 + workers 分支与残缺 worktree 无清理路径
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/host-fs-handler.ts（GIT_WORKTREE_TIMEOUT_MS=120s 四处接线 + gitWorktreeRemove 可选 branch 删分支）
- sillyhub-daemon/src/daemon.ts（RPC 分发透传 branch 参）
- sillyhub-daemon/tests/host-fs-handler-worktree.test.ts（WT5b/5c/5d 分支三态 + TT1~TT3 超时回归）
- backend/app/modules/daemon/host_fs/delegate.py（git_worktree_remove branch 透传）
- backend/app/modules/agent/execution.py（创建失败路径 best-effort 收残）
- backend/app/modules/agent/finalizer.py（cleanup SQL 补选 worktree_branch 并传 remove）
- backend/app/modules/agent/tests/test_dispatch_worker_worktree.py（断言收残调用参数）
- backend/app/modules/agent/tests/test_finalizer.py（断言 branch 逐 run 传对）
- backend/app/modules/agent/tests/test_finalizer_cleanup.py（假 delegate 签名补 branch=None）
- .sillyspec/docs/sillyhub-daemon/modules/host-fs-handler.md（契约/超时双档/branch 语义）
- .sillyspec/docs/backend/modules/agent.md（路径B 收残 + finalizer 删分支）
- .sillyspec/docs/backend/modules/daemon.md（host_fs git RPC 族 branch 参）
需求：daemon worktree 命令 10s 超时必杀大仓库检出 + workers 分支与残缺 worktree 无清理路径
根因：git worktree add 检出 7705 文件在 Windows 冷缓存下超 10s 被 GIT_TIMEOUT_MS 杀掉，分身 worktree_create_failed 派发必败；且创建失败 run 的 worktree_branch 为 NULL 被 finalizer 清理 SQL 漏掉、全链路无 branch -D 调用，残留目录+分支永久堆积
方案：daemon 新增 GIT_WORKTREE_TIMEOUT_MS=120s 用于 worktree add/merge/remove，git_worktree_remove 增可选 branch 参连带 git branch -D；backend delegate 透传 branch，execution 创建失败路径立即 best-effort 收残，finalizer converge 清理连带删分支
结果：daemon typecheck 0 错 + vitest 19 passed；backend pytest 定向 8 文件 77 passed（含 2 个签名连带修复）；部署待重建镜像后经 daemon 自动升级生效
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/agent/tests/test_finalizer_cleanup.py

## ql-20260902-002-2849 | 2026-09-02 10:39:23 | runtimes 页升级 daemon 按钮增已是最新判断
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/machine-card.tsx（daemonUpToDate 判定 + 按钮禁用/文案/title 三处接线）
- frontend/src/components/daemon/__tests__/machine-card.test.tsx（新增已是最新禁用 + 落后仍可点两用例）
- .sillyspec/docs/frontend/modules/components-daemon.md（MachineCard 已是最新态条目）
需求：runtimes 页升级 daemon 按钮增已是最新判断
根因：daemon 侧同版本自更新是静默 no-op（preflight 同版本直接返回不写状态），按钮未拦截导致已最新仍可点且 toast 提示已下发，产生有指令无进度的误导
方案：machine-card 增 daemonUpToDate 判定（build_id 与 latestVersion.latest_build_id 均已知且相等），按钮禁用+换文案已是最新+title 带版本；任一侧未知不比较保持可点
结果：vitest machine-card 15 passed（新增 2 用例）+ 相邻 3 文件 50 passed；tsc --noEmit 0 错；components-daemon.md 已同步；部署需重建 frontend 镜像

## ql-20260902-003-b0a4 | 2026-09-02 10:56:57 | sillyspec 手动升级指令加版本前置比对
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/sillyspec-manager.ts（requestManualUpgrade 版本门手动入口）
- sillyhub-daemon/src/daemon.ts（WS SILLYSPEC_UPDATE 接线换新入口）
- sillyhub-daemon/tests/sillyspec-manager.test.ts（新增门三用例）
- sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts（接线断言改新入口+mock 补方法）
- frontend/src/components/daemon/machine-card.tsx（sillyspecUpToDate 按钮禁用态）
- frontend/src/components/daemon/__tests__/machine-card-sillyspec.test.tsx（默认场景改已最新断言+落后可点+三处文案适配）
- .sillyspec/docs/sillyhub-daemon/modules/sillyspec-manager.md（requestManualUpgrade 契约）
- .sillyspec/docs/frontend/modules/components-daemon.md（按钮六态）
需求：sillyspec 手动升级指令加版本前置比对，已最新不再白跑 npm
根因：auto 定时路径有 isOutdated 门但 server_command 手动指令直入 requestUpgrade 无门，已最新时白跑 npm install -g 还滚动一轮 running→success 横幅；前端按钮也未按已最新禁用
方案：daemon 新增 requestManualUpgrade 手动入口（版本门 no-op，探测失败/未安装放行，保 requestUpgrade 同步置位契约不内联），WS 接线换新入口；前端机器卡按钮增已是最新禁用态（六态）
结果：daemon 44 passed（新增 3 用例）+ typecheck 0 错；前端 66 passed + tsc 0 错；模块文档同步 2 张；部署待重建 frontend 镜像 + daemon 经自更新升级
审计：⚖️ 归属切分：3 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/daemon/__tests__/machine-card-sillyspec.test.tsx, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts

## ql-20260902-004-0a10 | 2026-09-02 11:25:49 | 升级按钮置灰反馈修正：保留原文案+sillyspec 取消置灰
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/machine-card.tsx（daemon 按钮保留原文案 + sillyspec 回退已最新态）
- frontend/src/components/daemon/__tests__/machine-card.test.tsx（已是最新用例改断言原文案+禁用+title）
- frontend/src/components/daemon/__tests__/machine-card-sillyspec.test.tsx（默认场景回可点+三处定位回原文案）
- .sillyspec/docs/frontend/modules/components-daemon.md（两条目回退/修正）
需求：升级按钮置灰反馈修正：保留原文案+sillyspec 取消置灰
根因：置灰换已是最新文案不符合用户预期；sillyspec latest 是周期探测的滞后值会误锁入口
方案：daemon 按钮保留原文案禁用；sillyspec 按钮回退已最新态，版本门交 daemon 侧现探兜底
结果：前端 66 passed + tsc 0 错；文档同步；部署待重建 frontend 镜像

## ql-20260902-007-1b07 | 2026-09-02 14:32:20 | 团队任务嵌套分身死锁根治——孙层完成逐级回叫父会话+僵尸等待态强收兜底
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/mcp_tools.py（_worker_done_core 嵌套逐级回叫段）
- backend/app/modules/agent/mission_context.py（notify_parent_workers_done helper+幂等键）
- backend/app/modules/agent/patrol.py（职责⑦②僵尸等待判据）
- backend/app/modules/agent/mission.py（_virtual_status 强收映射扩 idle 形态）
- backend/app/modules/agent/tests/test_worker_subsession_done.py（TestNestedChildWake 五用例）
- backend/app/modules/agent/tests/test_worker_subsession_patrol_dead_worker.py（TestZombieWaitForceEndHit 四用例）
需求：团队任务嵌套分身死锁根治——孙层完成逐级回叫父会话+僵尸等待态强收兜底
根因：生产 ee24ba15 实证三层互等：孙 worker_done 唤醒只有「全树完成→通知根」无回叫直接父，中间层分身派完孙结束轮次后永不被唤醒不上报 done；_virtual_status 把首 run 成功+会话空闲+未上报映射 running；patrol 职责⑦只扫 ended/failed 终态，active 空闲僵尸不命中——三道防线全漏致 mission 永不收敛
方案：三层修复：①mcp_tools._worker_done_core 嵌套逐级回叫——孙 done 时直接父为树内中间层且未 done 无活跃 turn 即注入父唤醒（mission_context.notify_parent_workers_done，幂等父×子粒度 Redis SETNX 6h 独立事务）；②patrol 职责⑦扩僵尸等待形态——active+未done+无活跃turn+首 run 终态且 finished_at 超宽限置 worker_force_ended_at；③_virtual_status 强收映射扩 idle 形态按 failed 终态放行 awaiting_input 超时收敛
结果：worker_done+dead_worker 37 用例（新增 9）+相邻回归 258 全绿；ruff 0 错 mypy 113 文件 0 错；agent.md 关键逻辑同步；待 Docker 重建部署

## ql-20260902-008-3723 | 2026-09-02 15:41:49 | 团队分身会话查看器「加载更早消息」点击无反应——单 run 跨游标整段丢弃修复
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（handleLoadEarlier 同 run 伪 runId 插入）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（单 run 跨游标新用例）
需求：团队分身会话查看器「加载更早消息」点击无反应——单 run 跨游标整段丢弃修复
根因：分身会话整段执行是单个长 run，handleLoadEarlier 的 run 级去重把与当前窗口同 run 的更早日志整 turn 丢弃（原作者注释视作可接受降级，但对分身单 run 会话是 100% 丢弃——按钮永远无反应，ee24ba15 分身 c479dbc6 用户实证）
方案：同 run 跨游标不再丢弃——伪 runId 变体（#e+游标短码防多次翻页 key 相撞）插入该 turn 之前；realRunId 保持原值不动，SSE 增量归流与孤儿 run 补建的 realRunId 匹配零影响；before 游标保证与当前窗口日志内容不重叠
结果：page.test 加载更早 4 用例（新增单 run 跨游标 1）+ 整文件 25/25 绿；tsc 0 错；待 Docker 重建 frontend 部署

## ql-20260902-009-0d92 | 2026-09-02 16:36:08 | 会话面板「加载更早消息」改触顶自动加载——滚动到顶自动拉取+行内加载提示+到头不再触发
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（触顶监听+锚定+行内提示）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（scroll 触发用例改写）
需求：会话面板「加载更早消息」改触顶自动加载——滚动到顶自动拉取+行内加载提示+到头不再触发
根因：用户要求把按钮交互改为滚动加载（触顶触发、加载有提示、全部加载完成后触顶不再请求）
方案：捕获阶段监听 TurnTimeline 滚动容器（scrollTop ≤ 48px 触发，对齐 shadow-session-viewer 模式）；同步 ref 锁防滚动事件高频双拉；prepend 滚动锚按 scrollHeight 增量补回视口（正在读的内容不被顶走）；加载中顶部行内提示（Loader2 旋转+正在加载更早消息）；hasEarlier=false 到头后 handleLoadEarlier 内部自挡；稳定 callback ref 驱动主体挂载时重挂监听（会话骨架早退渲染先于主体）
结果：page.test 25/25（触顶用例改 scroll 触发+到头不重复请求断言）+ session-panel-ux-fixes 5/5 绿；tsc 0 错；待重建 frontend 部署

## ql-20260902-010-f493 | 2026-09-02 16:50:38 | 触顶自动加载补口——初始内容不满视口（无滚动条）时自动续拉直至撑出滚动条或翻到头
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（maybeAutoFill 视口补拉链+初始/翻页触发点+连拉上限）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（无滚动条自动续拉用例（原型级布局打桩））
需求：触顶自动加载补口——初始内容不满视口（无滚动条）时自动续拉直至撑出滚动条或翻到头
根因：初始 100 条日志装配出的对话高度可能不足一屏：容器无滚动条则 scroll 事件永不触发，触顶加载成了死路（用户实测分身会话初始展示未满屏无法继续加载）
方案：maybeAutoFill 视口补拉：容器有布局高度且 scrollHeight ≤ clientHeight（不满一屏）且有更早历史时自动续拉一页；初始满页后 setTimeout 复查 + 每次翻页满页后链式复查（DOM 提交后）；连拉上限 10 防极端空渲染批量请求，换会话重置；jsdom 无布局（scrollHeight=0）不触发保既有用例零影响
结果：page.test 26/26（新增无滚动条自动续拉用例——原型级打桩布局尺寸，断言无滚动事件即 prepend 且到头即停）绿；tsc 0 错；待重建 frontend 部署
