
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
结果：test_dispatch_worker_worktree 9 绿（新增 3：缺失回退/探测异常回退/可解析保持）+ 相邻回归 50 绿（caller/direct/target 19 + subsession 31）+ ruff/format/mypy 0；待部署验证
