# 决策知识 — unmapped

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-003@v1 : 平台共享智能体绑定的守护进程取管理员自己名下
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：仅平台管理员自己名下的在线 daemon runtime。依据：避免引入「管理员

## D-002@v2 : 平台共享智能体会话——源码只读 + 指定目录可写
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户实答（重问轮）：「允许某个目录下写操作，可以生成点文档原型图
supersedes：D-002@v1

## D-004@v2 : 共享机器/智能体由用户在会话中显式选择
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户实答（重问轮）：「会话选择共享的机器和智能体呀，用户自己选」
supersedes：D-004@v1

## D-006@v1 : 实现方案选 B——统一授权表 daemon_runtime_grants
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户选定方案 B：新建 daemon_runtime_grants 统一授权表，工作区共享与

## D-011@v1 : 打破 daemon 零改动 Non-Goal——session 级 overlay roots 写守卫增量（spike-02 B 裁决）
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：选项 II（最小 daemon 增量）：_judgeWriteViaPolicyEngine 增加 per-session

## D-012@v1 : platform grant 的 pinned runtime 不经共享档案直接钉定 → 404
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：否——共享的是智能体而非裸 runtime：authorize_pinned_runtime 的

## D-002@v1 : 服务器重新部署范围
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：仅后端进程重启（docker 容器重启/发新版镜像），数据库保留，daemon 的 api_key 与注册信息仍有效

## D-003@v1 : 前端回显纳入范围
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：包含关键前端修复——断线状态提示、卡住的「运行中」轮次兜底、审批面板断线重连

## D-004@v1 : 改造深度
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：允许结构改造——可新增接口/协议（控制消息补拉接口、lease 过期回收后台任务、SSE 游标增强等），彻底解决断线窗口丢消息

## D-005@v1 : 实现方案选型
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：方案 A——控制指令落库待发（参考 DaemonChangeWrite 占坑-轮询-GC 先例）+ WS 推送保即时性 + daemon 重连后 HTTP 补拉幂等消费；分层加固：daemon 退避重连+register 重试、终态上报入 outbox、backend lease GC 接线与 WS 断开即时降级、会话 suspended 挂起语义、前端连接状态与看门狗兜底

## D-006@v1 : 六段设计整体确认
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：确认。变更名 2026-08-29-daemon-platform-resilience，原型 prototype-session-connection-states.html 六状态快照

## D-003@v1 : 三条线打包 = 单变更三波交付（+revision 1 并入波 4）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：未记录
最近确认：0ec935c9
理由：删除收敛+防复活基建（波 1）/删除入口（波 2）/拉取口子（波 3）一个变更三波，波与波共享防复活基建（波 1 建）；进行中可见性经 revision 1 重开 brainstorm 并入为波 4——与波 1-3 同文件（platform_sync/change/changes 页面），并入避免并行变更冲突（规则 19）。跨仓配套（X1-X4）以 repo: sillyspec 任务卡入列，不另开变更。

## D-003@v2 : 磁盘旁路探测方式与 disk_change 直启路径（Grill B1/B2 修正）
状态：implemented
变更：2026-08-29-daemon-selfupdate-safety
锚点：未记录
最近确认：HEAD
理由：探测=读 bundle 文件正则提取 BUILD_ID（gen-build-id.mjs 格式 regex 兼容，无 spawn）；disk_change 触发后走独立直启路径——不下载不查 manifest，空闲即 stop+respawn 到盘上版本（操作者换文件即意图，multica trySelfReload 同款）；server_command 仍走现有下载链
supersedes：D-003@v1

## D-004@v1 : 方案选型 A3 完整形态
状态：implemented
变更：2026-08-29-daemon-selfupdate-safety
锚点：未记录
最近确认：HEAD
理由：A3——A1 全部（空闲屏障/所有权 CAS+失败释放/磁盘探测/pending 本地 status 可见）+ 心跳上报 pending_update 字段 + backend 机器视图透出 + 前端机器卡展示「等待空闲升级」原因

## D-005@v1 : 保留既有优势语义
状态：implemented
变更：2026-08-29-daemon-selfupdate-safety
锚点：未记录
最近确认：HEAD
理由：保留「拉起失败旧进程保活」（multica 没有的优点）并补全其半边语义——交接失败必须释放更新所有权与屏障，让下一条 SELF_UPDATE 指令可再触发；下载原子替换/防降级/noop 保活等既有行为不变

## D-006@v1 : 设计整体确认
状态：implemented
变更：2026-08-29-daemon-selfupdate-safety
锚点：未记录
最近确认：HEAD
理由：确认。变更名 2026-08-29-daemon-selfupdate-safety，原型 prototype-machine-update-status.html

## D-001@v1 : 会话继承触发范围
状态：implemented
变更：2026-08-29-batch-session-inherit
锚点：未记录
最近确认：HEAD
理由：仅 infra 中断继承——lease 过期自动重派（daemon 掉线/断连）attempt+1 继承原会话继续；lease 内 spawn 重试维持现状清空 resume（R-10 防副作用）；手动重跑走 dispatch_to_daemon 全新 lease 天然新会话

## D-003@v1 : 方案选型 A 最小闭环
状态：implemented
变更：2026-08-29-batch-session-inherit
锚点：未记录
最近确认：HEAD
理由：A——backend handle_lease_expiry 继承原 lease metadata+注入 resume_session_id/work_dir；daemon work_dir 同一性守卫+resume 失败降级。零迁移零新端点零前端，全消费既有链路

## D-004@v1 : 设计整体确认
状态：implemented
变更：2026-08-29-batch-session-inherit
锚点：未记录
最近确认：HEAD
理由：确认。变更名 2026-08-29-batch-session-inherit；无 UI 变化不产出 HTML 原型

## D-005@v1 : P0 方向重定位——worker 重派继承（Grill C-01 裁定）
状态：implemented
变更：2026-08-29-batch-session-inherit
锚点：未记录
最近确认：HEAD
理由：转向 worker 重派继承——interactive worker 会话（AgentSession.role 含 worker 或 parent_session_id 非空）daemon 掉线后不 suspended 而是 failed+自动重派继承原会话（worker 是临时会话无人手恢复，挂起无意义）；主会话（orchestrator/用户 chat）保持挂起语义不变

## D-001@v1 : 缓存范围 = has_permission + data_scope 一并覆盖
状态：implemented
变更：2026-07-23-rbac-permission-cache
锚点：未记录
最近确认：163e1065
理由：同时覆盖 has_permission(collect_permissions* 集合)与 data_scope(manager_project_ids / is_super_admin)。两套都是高频热路径,一并做避免二次返工。

## D-002@v2 : 失效策略 = 整体清空 + 失效失败 ERROR 告警(supersedes D-002@v1)
状态：implemented
变更：2026-07-23-rbac-permission-cache
锚点：未记录
最近确认：163e1065
理由：所有权限变更触发点统一执行 invalidate_all_permissions 清空 perm:* + ppm-scope:* 全部(继承 v1)。v2 增补:invalidate 失败升 **ERROR 级日志**(可监控告警),非 warning——失效失败是安全事件,可能留下最长 TTL 的越权窗口;读/写业务缓存故障仍降级静默(不影响请求)。
supersedes：D-002@v1

## D-003@v2 : 缓存粒度 = 拆键 platform/all/workspace + everywhere 内存并集(supersedes D-003@v1)
状态：implemented
变更：2026-07-23-rbac-permission-cache
锚点：未记录
最近确认：163e1065
理由：**不能共用**(v1 错误)。三者返回语义不同的集合(rbac.py:37-84 实证):platform=平台级、all=全工作区并集、everywhere=platform∪all。v2 拆为三键:`perm:{u}:platform`、`perm:{u}:all`、`perm:{u}:{workspace_id}`;everywhere 读 platform+all 内存并集,**不单独存**。has_permission 在所有调用先判 platform,workspace_id=None 时再判 all,workspace_id 指定时判单工作区键。
supersedes：D-003@v1

## D-004@v1 : 无 Redis 降级 = 回退查 DB(不加本地兜底)
状态：implemented
变更：2026-07-23-rbac-permission-cache
锚点：未记录
最近确认：163e1065
理由：沿用 api_key_service 约定,Redis 故障 try/except 回退查 DB,不加本地内存 TTL 兜底。保证正确性优先;本地兜底引入多实例一致性问题,得不偿失。

## D-005@v1 : ppm-scope uuid 反序列化保证类型
状态：implemented
变更：2026-07-23-rbac-permission-cache
锚点：未记录
最近确认：163e1065
理由：JSON 只能存 str,但 data_scope 下游用 uuid 做判断(`problem_operable` 的 `project_id in manager_pids`,project_id 是 uuid)。get_cached_ppm_scope 反序列化时必须把 manager_project_ids 还原为 `set[uuid.UUID(...)]`,is_super_admin 还原为 `bool`。否则 uuid-in-set[str] 恒 False,经理编辑/删除问题静默失效。

## D-006@v1 : WorkspaceService.create 失效点补全
状态：implemented
变更：2026-07-23-rbac-permission-cache
锚点：未记录
最近确认：163e1065
理由：补入。`_ensure_creator_as_owner`(`workspace/service.py:729`,line 770 写 UserWorkspaceRole 授 owner)的**所有调用方**——`create`(`:148/165/222`)与 `scan_generate`(`:609`,daemon-client 建工作区独立路径,`:669` 调用,不经 create)——commit 后都需调 invalidate_all_permissions,创建者的 all/everywhere 缓存才及时失效(否则最长 TTL 内缺新 ws 权限——权限缺失方向,非越权,但仍是错误)。plan-review 发现 scan_generate 遗漏(Design Grill X2 当时未穷尽 `_ensure_creator_as_owner` 调用方,属误判闭合,现补)。bootstrap 启动种子(auth/service.py seed_*)免失效(进程冷启无缓存)。

## D-001@v1 : 会话面板基元统一方向 = antd
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：用户拍板 antd（AskUserQuestion 2026-08-22）。

## D-002@v1 : 实施方式 = 一次性原子改造
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：用户选方案 A：同一变更内一次做完，单轮验收。

## D-003@v1 : TurnStatusBadge 纳入 antd 化（Grill U-01）
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：用户拍板一并换 antd（贯彻「整个会话 UI 家族统一」）。

## D-004@v1 : 按钮尺寸 = 主操作 32px / 打断 small 24px（Grill U-02）
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：用户拍板：主操作 antd 默认 32px，打断对齐 page 惯例 small 24px。

## D-005@v1 : 📎 附件按钮 antd 映射 = type="text"（Grill U-03）
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：设计内定 type="text"（对应 ghost 无边框语义）。

## D-001@v1 : 团队=会话内能力而非独立会话类型
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：用户明确：团队类似子代理——当前会话的 agent（主控）通过 MCP 工具派分身（worker），进度与结果回到当前消息流，全程不离开对话。不新增会话类型、不新增列表条目、没有独立团队页面。

## D-002@v2 : 团队工具常驻注入（Claude 引擎，分身会话除外）
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：谓词收窄：provider==='claude' 且 stage 非 worker 标识（stage 为空=普通会话或 'orchestrator'=存量主控 → 注入；分身角色/'mission_worker' → 不注入）。用户授权来源同 v1（按推荐继续）。
supersedes：D-002@v1

## D-003@v1 : 一期 Claude 专属，Codex 按钮置灰
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：一期仅在 Claude 引擎会话提供团队能力；Codex 会话中触发入口置灰并提示「团队需要 Claude 引擎」。Codex MCP 注入另立后续变更（codex driver 契约注释已标"留后续任务"）。

## D-004@v1 : 触发四路等价
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：原型 v2 确认四条等价路径：①输入区「派团队」按钮+配置弹层 ②/team 指令前缀 ③自然语言（agent 常驻工具自主判断）④AskUser 卡选择。四路最终统一到同一条后端链路（显式预建或懒建 mission）。

## D-005@v1 : 删除独立团队页面与入口
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：删除 /workspaces/[id]/missions、/projects/[id]/missions 两个页面路由、mission-console 组件与「Agent 团队」菜单项；普通会话面板的「用团队分析」按钮改为在当前会话直接触发团队；历史 mission 数据不做迁移（项目未上线允许重置）。

## D-006@v1 : AgentMission 新增 session_id 列绑定发起会话
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：代码查证：AgentMission 无 session_id 列，旧"用团队分析"把 session_id 塞 constraints JSON 且全链路无消费（死参数）。本变更新增 agent_missions.session_id 列（FK agent_sessions，索引），废弃 constraints.session_id 约定。

## D-007@v2 : worker 派发链路复用（治理门查询加判别）
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：收窄为"派发链路（worktree/scope 校验/治理门规则/预算扣减）复用"；control.py 等查询条件加 role!='orchestrator' 判别。
supersedes：D-007@v1

## D-008@v1 : 会话结束与团队任务并存
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：worker 独立 lease 存活不受会话影响；mission 收敛由主控工具调用与 patrol 兜底完成；用户重新开启会话（reopen 基建已有）可继续看到任务块与结果。

## D-009@v1 : 主控轮双标记 mission_id + role='orchestrator'
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：会话存在活跃 mission 时 inject 当轮 AgentRun 回填 mission_id + role='orchestrator' 双标记；_get_main_run 取该 mission 最新 orchestrator run（存量 external mission 同规则天然兼容）；治理门/统计查询加 role!='orchestrator' 判别。

## D-010@v1 : converge 语义重定义（session 定位 + busy 引导 + 独立置位）
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：converge 按 X-Session-Id 解析 mission；分身未全终态返回 status=busy 引导 agent 等待；全终态直接置 converged_at（不依赖主控 run 状态）→ finalize 锚点=最新 orchestrator run；响应 status ∈ converged/busy/conflict/needs_manual。

## D-011@v1 : 旧 mission 端点删除范围精确化
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
最近确认：4d7adc1d
理由：删除范围=create+list 四端点及对应前端 client；保留 GET /missions/{id}、POST /missions/{id}/cancel、全部 MCP 端点；team-progress.tsx 不动。

## D-001@v1 : 三入口统一为一个门户组件（以 /sessions 为准）
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：以 /sessions 为准抽共享 SessionsPortal（scope 判别联合），三入口渲染同一组件（用户三轮 AskUserQuestion 拍板：范围两处一起/方案A/设计确认）。

## D-002@v1 : 变更详情承载=专属路由门户
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：方案A：卡片变入口（前 3 条预览+打开按钮）跳专属路由（用户选，对比页内展开/全屏弹窗两案）。

## D-003@v2 : scope 列表数据源=全局端点+服务端过滤（取代 D-003@v1 客户端过滤）
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：后端 GET /sessions 增 workspace_id/change_id 可选过滤参；前端 scope 复用全局端点（owner-scoped+全字段+筛选+分页），v2 的降级矩阵/客户端过滤/筛选隐藏全部退场。
supersedes：D-003@v1

## D-004@v1 : ?session= 升级为门户统一能力
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：SessionsPortal 统一支持 ?session=<id> 初始选中（迁移旧 :95-113 能力，无效 id 静默忽略），三入口通用。

## D-005@v1 : ended 会话恢复自动→手动（以 /sessions 行为为准）
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：统一为 page 模式手动重开——用户「以 /sessions 为准」原则的直接推论；design §4.E 明示为有意交互变更。

## D-001@v1 : 方案 A——daemon 消费 SDK task_* + agent_task_status SSE 通道扩展
状态：implemented
变更：2026-08-27-background-subagent-progress
锚点：未记录
最近确认：debd368d
理由：daemon session-manager 拦截 SDK `task_started/task_progress/task_notification` system 消息，映射为扩展的 `agent_task_status` SSE 事件（复用 Redis `agent_session:{id}` 频道模式），异步启动回执解析做兜底。否决方案 B（daemon 透传 system 落库、backend 解析派生：事件与日志两套真相源，历史回看重放解析脆弱）；否决方案 C（前端纯展示层聚合：永远缺终态信号，卡片转圈到会话结束）。

## D-002@v1 : 生命周期双写——SSE 事件 + [TASK_*] 持久日志行
状态：implemented
变更：2026-08-27-background-subagent-progress
锚点：未记录
最近确认：debd368d
理由：生命周期节点除发 SSE 外，同步落 `[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION]` 前缀的 stdout 日志行（单行 JSON，行级带 parent_tool_use_id）。前端 assembler 识别前缀解析为段元数据，回放与实时同源；行带 parent 自动享受跨轮归位。

## D-003@v1 : 跨轮归位在 backend 落库时做（submit_messages 重映射 run_id）
状态：implemented
变更：2026-08-27-background-subagent-progress
锚点：未记录
最近确认：debd368d
理由：backend `submit_messages` 落库时，带 parent_tool_use_id 的行查 tool_use_id→run_id 映射（进程内 LRU + agent_run_logs tool_call 行冷启动反查）改写为派发 run。否决前端会话级链接（每个消费日志的页面都要适配，容易漏）。历史数据不迁移（项目未上线）。

## D-004@v1 : 空 prompt 防御——后端 422 为主，前端禁点为辅
状态：implemented
变更：2026-08-27-background-subagent-progress
锚点：未记录
最近确认：debd368d
理由：backend `inject_session` 对 strip 后为空的 prompt 抛 422（中文文案，领域类 SessionEmptyPrompt，过 l10n 守护）；前端发送按钮空内容 disabled 为辅助。服务端拒绝是权威（防任何调用方）。

## D-002@v1 : ctx 指标落库（AgentRun 加列）
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：落库。不落库则刷新页面/重进会话后上下文环拿不到数值。项目未上线（CLAUDE.md 规则 11），允许直接加列迁移。

## D-003@v1 : 历史会话（无 ctx 数据）环显示未知
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：如实显示"未知/—"（不算百分比），不用旧口径估算（旧口径 input 是该轮所有调用求和，数字本身失真）。

## D-005@v1 : 实现方案选 A（复用 usage 附带管线 + daemon 按轮重置）
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：方案 A。daemon 在现有 usage 字典加 ctx_tokens（message_start 算本次调用 input+cache_read+cache_creation）；轮边界重置累积器使实时值=本轮至今量（与终态口径一致）；backend/frontend 全链路加字段透传（AgentRun.ctx_tokens 列 + SSE + SessionRunRead）。完全符合 D-001~D-004。否决 B（改动面翻倍且旧通道无法删除，两套并存反而更乱）；否决 C（环仍爆表、跳变仅被隐藏）。

## D-001@v2 : 统一=本轮增量；终态 SDK result 权威校准
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：统一仍为本轮增量；终态以 SDK result 值为权威覆盖（校准语义）。消除的是"语义级"跳变（会话累计暴涨→本轮骤降）；若两路数值有小出入，表现为终态定格时小幅校正。execute 首任务跑真实会话 spike 验证，偏差 >5% 启用 fallback（close 仅当 result > 实时值才覆盖 input/output）。
supersedes：D-001@v1

## D-006@v1 : ctx_tokens 仅 main 桶计算与注入
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：lastCallCtxTokens 仅 'main' 桶计算与注入 pendingUsage；子桶 pendingUsage 不含 ctx_tokens（backend usage.get 缺失即跳过，天然兼容）。turnInput/turnOutput 所有桶照常（子代理计费量并入本轮）。

## D-001@v1 : 关联入口双向都要
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：双向都要——任务/问题侧提供"发起会话"入口（详情/列表处），会话输入框 @联想扩展支持选择 PPM 任务/问题，与现有变更/快速修复绑定体验一致。

## D-002@v1 : 全状态可关联
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：全状态可关联。列表/联想默认展示"进行中"，但已完成/未开始的任务也能手动关联（如复盘场景）。

## D-003@v1 : 附件真注入 + 降级文字清单
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：真附件注入——后端尝试读取附件内容作为真附件传给 agent（能看图/读文件）；读取失败的降级为文字清单（附件名+链接）。

## D-007@v1 : PPM 附件访问控制复用 _can_access
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：复用 FileService._can_access 同口径校验：有权条目物化注入；无权条目降级文字清单仅列文件名并注明「无权访问」（不带链接）。行为对齐 PPM UI 现状（batch_meta 同样静默剔除无权行），不引入跨用户文件读取。

## D-006@v1 : PPM 附件物化为 SessionAttachment
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：创建会话携带 ppm item 时，后端把任务 file_urls 对应 File 读取 bytes → 写入 session attachment storage → 物化 SessionAttachment 行（session_id 直接回填、user_id=创建者），并入现有 attachment_ids 组装链路（assemble_inject_attachments/download 回调/标记行/前端展示全复用，daemon 零改动）。

## D-005@v1 : 统一 PPM 绑定表（方案 B）
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：方案 B——一张 `ppm_item_session_links` 表（kind 字段区分 plan_task/problem），一套绑定 helper + 一个统一前导构建器；@联想/会话筛选/任务侧卡片前端逻辑复用一套。

## D-004@v2 : 工作区排序键定死 workspace_id 升序
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：workspace_id 升序（UUID 字典序）为唯一排序键，后端 link.workspace_id 写入与前端预选同键，消除分叉。
supersedes：D-004@v1

## D-004@v1 : 数据链路实现方案
状态：implemented
变更：2026-08-29-session-usage-stats
锚点：未记录
最近确认：0ea25728
理由：方案 A——新增 GET /api/daemon/sessions/{id}/usage 聚合端点：agent_run_model_usage 按 session 的 runs 聚合为主、AgentRun 六 token 列兜底无明细行的老 run，返回会话汇总+按模型分组；与 /runtimes/usage 先例同模式

## D-001@v1 : 注入通道选前导拼接，不动 system_prompt 与 daemon
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：现有 4 条注入通道中选「前导拼接」：backend `daemon/session/context.py` 新增前导构建函数，`session/service.py` create_session 的 `_prefix_parts` 接线（变更/页面/PPM/团队简报四前导同款模式）。否决 system_prompt 通道（仅 claude 消费，codex 不支持，且是 per-AgentProfile 语义）与 daemon 侧注入（daemon 纯透传、不认识用户）。

## D-002@v1 : 仅首轮注入 + 覆盖重派重渲染路径；后续轮次与服务身份注入不带
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：仅首轮（用户信息+规则留在上下文持续生效，避免每轮膨胀）；掉线重派（batch-session-inherit 的 prompt 重渲染路径）须确认重渲染时同样带上。后续轮次 `_inject_into_session` 与平台审批代写等服务身份注入不带用户前导（由「仅首轮」自然满足）。

## D-003@v2 : 不加 Role 字段，角色名称直接给 agent 自行判断沟通风格
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：用户在 brainstorm step 6 明确推翻 Role 加字段方案：「直接给角色名称给 agent 分析就行，不要加字段了」。用户信息块内列出角色名称原文 + 一小段静态沟通适配指引文案，由 agent 根据角色名自行判断用业务语言还是技术语言。无 schema 迁移、无 admin/前端改动，变更范围缩小为 backend daemon/session 模块。
supersedes：D-003@v1

## D-004@v1 : SillySpec 工具规则条件注入（工作区根存在 .sillyspec/ 才拼）
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：条件注入：仅会话绑定的工作区根目录检测到 `.sillyspec/` 目录才拼入。无条件注入会诱导 agent 在非 SillySpec 项目擅自 `sillyspec init` 污染用户仓库。无工作区会话不注入该块。

## D-005@v1 : batch（批量任务）路径本期不注入
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：本期仅做交互会话（interactive session）；batch 已有 CLAUDE.md prepend 通道，将来可复用同一套模板函数，不纳入本变更范围。

## D-007@v1 : 整体方案选 A（后端前导拼接 + Role 受众字段），否决 B（纯 prompt 猜测）与 C（system_prompt 通道）
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：用户在 explore 阶段看到完整对比表后确认「帮我实现吧」= 选 A。A 是唯一同时满足 D-001~D-006 的方案；B 违反 D-003（自由文本角色名不可靠推断）且画像判定失控；C 违反 D-001（codex 不支持 systemPrompt，provider 不对称）。

## D-002@v1 : token 统计范围 = 派发执行 ∪ 关联会话执行（按 run 去重）
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：并集去重（用户 AskUserQuestion 确认）。变更侧 = 直接挂 change_id 的 run ∪ 关联会话（change_session_links）内全部 run，按 run id 去重合并。跨变更共享会话时同一份消耗会在多个变更各显示一次——口径特性非 bug，详情页注明。快速修复无派发链路，恒走 quicklog_session_links→agent_sessions→agent_runs 会话链路（代码事实，非选项）。

## D-003@v1 : 落地方式 = 实时聚合计算字段（零迁移）
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：实时聚合（用户 AskUserQuestion 确认）。查询时从 agent_runs / agent_run_model_usage 现算，DTO 计算字段，不新建表列、零 migration；数字与最新执行终态一致。列表用批量聚合（一条 SQL 按变更分组）。否决「冗余入表」。

## D-004@v1 : 展示位置 = 列表 + 详情都要
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：列表 + 详情都要（用户 AskUserQuestion 确认）。变更中心「变更」tab 与「快速修复」tab 列表各加摘要列（耗时 + token 总量档）；变更详情页与快速修复抽屉展示完整五指标（输入/输出/缓存读/缓存写/调用次数 + 轮次）+ 分模型明细。对齐运行时页/会话页用量卡先例。

## D-005@v1 : API 形态 = 方案 A（独立用量端点 + 列表内嵌摘要）
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：方案 A（用户 AskUserQuestion 确认）。列表 DTO（ChangeSummary / QuicklogEntryListItem）内嵌摘要字段，批量聚合一条 SQL 挂既有富化管道（零 N+1）；完整五指标+分模型明细走两个新独立端点；前端一个可复用用量组件覆盖变更详情页与快速修复抽屉。否决 B（详情响应膨胀、分模型明细无处安放、与先例不一致）与 C（run DTO 仅输入/输出两维，数据面不成立——session-usage-stats 先例已核实）。

## D-006@v1 : 软删会话的执行计入统计
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：计入。消耗真实发生，用量口径=真实成本；UI 隐藏是展示层整洁考虑，两者不矛盾——详情卡注脚声明（R-07）。孤儿 run（agent_session_id 已置空）经派发锚点 change_id 仍可命中，不丢数。

## D-007@v1 : 用量卡取数用 react-query useQuery（非 useEffect）
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：useQuery。两个目标渲染点的既有卡片（change-sessions-card.tsx:60 / quicklog-sessions-card.tsx:60）均用 useQuery 且都在 QueryClientProvider 内；session-usage-bar 规避的是会话浮窗零 react-query 约束，本变更两渲染点无此约束。变更详情页「本页禁新增网络请求」注释（[cid]/page.tsx:339）经核实为 last-signal 功能局部语境（禁的是为派生小字段加轮询，同页 sessions 卡已自取数）。

## D-001@v1 : 缺口①触发形态 — 心跳恢复事件触发
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：`_sendHeartbeatOnce` 成功分支、degraded 累计 >720s 守卫、复用 boot

## D-003@v1 : 下载校验口径 — 零子进程
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：buffer ≥64KB 且 `BUILD_ID` 正则可提取（与 `DISK_BUILD_ID_RE` 同款，

## D-005@v1 : respawn 最后防线 — 不退出保活
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：spawn 前同款校验，不过 → error 日志 + 提前 return 不退出；返回类型

## D-009@v1 : respawn 前校验提前到 stop 之前（主拦截点）
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：新增 `validateBundleOnDisk` 导出；`_tryUpdate` 在 stop() **之前**调用：

## D-003@v1 : 实现方案——daemon 自发现 + 日志 tail 推导 + 第一方事件汇聚（方案 1）
状态：implemented
变更：2026-09-07-agent-liveness-states
锚点：未记录
最近确认：e76e191d9
理由：方案 1。唯一同时满足"全托管会话有状态灯（含 zcode 非托管登记）"与"blocked 确定性"的路线，CLI 契约零变更零回归（草案 D-005），五层既有地基全复用；代价是 daemon 侧工作量最大，由 P1a 先行消化。方案 2 违反"CLI 非执行体"既定定位且覆盖不了登记盲区；方案 3 放弃 zcode/裸会话覆盖，G-1 达不成

## D-004@v1 : 状态展示两层——会话列表小灯+悬浮卡，完整总览放工作台
状态：implemented
变更：2026-09-07-agent-liveness-states
锚点：未记录
最近确认：e76e191d9
理由：A。会话列表每行行尾只加 ~18px 状态小灯（五态色+呼吸闪烁，不新增列不改布局），悬停弹详情小卡（静默时长/关联 ctx/证据摘要）；完整「Agent 状态总览」卡片（分组计数+等人跳转）放工作台首页。用户原话背景：会话列表没那么大空间展示这些信息

## D-003@v1 : PPM 个人工作台头像维持首字占位（用户头像功能非目标）
状态：implemented
锚点：未记录
最近确认：41c3b37
理由：2026-09-10-account-avatar-upload——PPM 已上线模块不动，WorkbenchProfile.avatar_text 维持首字；展示范围圈定为个人中心+顶栏+群聊（用户选定）。后续要接入再单独立变更。

## D-001@v1 实施路线——渐进下沉（双轨兼容）而非契约替换或最小注册表
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：方案A 渐进下沉。driver 内归一化吐 AgentEvent，backend/前端双轨兼容新旧两种事件格式，验证稳定后再退役旧文本协议（退役为后续 change）

## D-002@v1 会话级信号的承载方式——status 事件 subtype + 有状态归一化器，raw 降格为调试通道
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：①会话级信号全部事件化为 status 型 + subtype 枚举（session_started/bash_status/plan_mode/agent_task_status/task_notification），SessionManager 改按 subtype 分发；②depth 状态机等跨消息状态由有状态归一化器类（ClaudeEventNormalizer，每会话实例）内部维护；③envelope.raw 仅在 SILLYHUB_DEBUG_RAW_EVENTS=1 时携带，下游禁止依赖（cli.ts 的 SDKMessage 接线随之演进）

## D-003@v1 usage 实时透传语义——任意携带 usage 的事件即更新，不限 turn_result
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：对齐现行为：任意携带 usage 的 AgentEvent（含 partial text/thinking flush 事件）→ daemon lift → backend 更新 agent_runs token 统计 + SSE summary 实时透传（现链路锚点 daemon.ts:3564-3586、service.py:357-370）

## D-004@v1 partial override 撤回的事件化表达——override:true + segment_id
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：text/thinking 事件增加可选 override:boolean——true 表示替换同 segment_id 已落库 partial 行；backend 行为对齐现有 stale 撤回链（DELETE by (run_id, segment_id) → INSERT）。partial/override 归一化逻辑移植自 daemon session-manager 现实现（非 backend _extract_sdk_messages，后者对 stream_event 恒返回空）

## D-005@v1 AgentEvent v2 契约补遗——status 增 thinking_tokens 子类型、usage 增 ctx_tokens 字段
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：契约微扩：AgentStatusSubtype += 'thinking_tokens'；AgentEventUsage += ctx_tokens?: number。归一化器对应产出（thinking_tokens 子类型事件、usage 差分携带 ctx_tokens）

## D-006@v1 双轨渲染已知改进差异的取舍——主 agent Task tool_result 配对（新轨 call_id 优先）与 cache_* 完整帧聚合（新轨更全）
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：均接受为已知改进差异（新轨行为更正确），以豁免/可执行登记形式固化（dual-path fixture 豁免 #2 + TestDocumentedFormatDivergences/§2 差异冻结测试），不要求新轨复刻旧轨缺陷；旧轨本身零改动（回退轨保真）

## D-001@v1 命令下发通道——机器级即时 WS 指令（方案 A）
状态：implemented
变更：2026-09-04-conflict-resolve-entry
锚点：未记录
最近确认：0d7e66502
理由：方案 A。复用机器级 fire-and-forget WS 指令先例（self_update/cleanup/sillyspec_update 同款，`POST /machines/{id}/sillyspec-update` router.py:1269）：backend 校验权限后经 DaemonWsHub 即时下发，daemon 侧 handler 本地 execFile 执行 sillyspec CLI（sillyspec-manager 30s 超时模式），执行结果缓存于 daemon 内存并随下次心跳 sillyspec_status 通道上报（≤60s 页面自动回绿）。B 的离线补拉增益对本场景为负（sillyspec 操作必须机器在线，离线排队上线时现场可能已变）且六处协议扩展过重；C 的 host_fs RPC 挂会话上下文无页面载体、字符级白名单对变长 change 名脆弱，不适配

## D-003@v1 操作权限——机器所有者 + 平台管理员
状态：implemented
变更：2026-09-04-conflict-resolve-entry
锚点：未记录
最近确认：0d7e66502
理由：机器所有者 + 平台管理员。冲突数据挂机器维度，机器主人最清楚现场，管理员兜底无主机器；其他成员只读红灯不可操作。活跃阶段变更（非 archived）的冲突行加警示标注 + 确认弹窗加重文案，不硬禁（机器主人有最终裁量）

## D-004@v1 心跳 sillyspec_command_result 落库语义——两态清除 + register 恒清（Grill X-04 修订）
状态：implemented
变更：2026-09-04-conflict-resolve-entry
锚点：未记录
最近确认：0d7e66502
理由：两态。对象=整包直写、键不出现=置 NULL 清除，与 sillyspec_status 现状（model.py:108-109、runtime/service.py:525-529）语义一致；daemon 终态窗过期后直接停发该键，不发送显式 null；register 恒清（service.py:232-235 先例）堵 daemon 重启后 DB 残留。三态需在心跳面新增 absent/null 判别，唯一先例 router.py:988 display_alias PUT 属 PUT 端点非心跳，无谓引入新机制

## D-001@v1 cursor 交互式 driver 架构——每轮 respawn + --resume chatId 薄 driver
状态：implemented
变更：2026-09-08-cursor-interactive-session
锚点：未记录
最近确认：35f3d6528
理由：方案A 每轮 respawn。每个 UserTurnInput spawn 一次 `cursor-agent -p --output-format stream-json [--resume chatId] [--model] <prompt>`，NDJSON 逐帧归一化为 AgentEvent v2，result 帧 + 进程退出 = turn 收敛；chatId 从帧内 session_id 捕获（`create-chat` 子命令兜底）；Windows 经 resolveWindowsCmdShim（含 cursor 坏 ps1 版本目录增强）。B/C 否决：worker 实测是 Cursor 云端 worker 注册通道（K8s 探针/标签/池分配，非本地 stdio 会话协议）；cursor-agent 无 --input-format/SDK 控制协议（批量适配 D-008@v1 已证参数集分叉），ClaudeSdkDriver 握手必挂

## D-002@v1 接入范围——仅交互式会话最小闭环
状态：implemented
变更：2026-09-08-cursor-interactive-session
锚点：未记录
最近确认：35f3d6528
理由：仅最小闭环：补齐交互式会话链路（driver + 归一化器 + 注册表 + 三端 caps + 前端白名单 + 测试 + 冒烟），对齐 pi 接入先例。liveness 推导器注册与平台侧 Cursor 凭证配置（llm_provider agent_kind 扩展 + CursorCredentialInjector）留后续变更

## D-004@v1 caps 守护测试 EXPECTED_PROVIDERS 同步必改（Grill B-01）
状态：implemented
变更：2026-09-08-cursor-interactive-session
锚点：未记录
最近确认：35f3d6528
理由：否。`backend/app/modules/agent/tests/test_provider_caps_alignment.py:52` EXPECTED_PROVIDERS 为硬编码 `{"claude","codex","pi"}`，test_provider_sets_identical 对三端表断言集合相等——三端表加 cursor 后守护测试必失败。必须同 commit 同步 EXPECTED_PROVIDERS 加 'cursor'（pi 接入 commit 7c4dd4efd 同款先例）。设计文件清单已补该文件

## D-001@v1 派生粒度=工具调用聚合为单任务
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：以「一轮（turn）内的活动」聚合为单条任务：turn_start 建/复running行（task_id=pi-run-<runId> 稳定键，task_name 取首轮用户消息或'执行任务'），tool_execution_start 刷新 last_tool_name/tool_uses 累计/summary（'正在调用 X'），tool_execution_end 保持 running（工具成败不等于任务成败），turn_end 按 stopReason 映射终态（error→failed 其余→completed）置 message/finished_at。子代理粒度（claude Task 工具那种）pi 原始流无对应概念，不做

## D-002@v1 派生位置选归一化器（方案 A）——⚠️ 自主决策待用户复核
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：选 A。PiEventNormalizer 增实例级 turnTask 聚合状态产出 status/agent_task_status——贴 claude-events 同位置派生信号的既有架构，session-manager/_dispatchStatusEvent→cli 上报链路零改动，纯函数测试范式可延续；代价是归一化器从逐行纯函数升级为实例级状态机（turn 边界做状态推进点，normalizeRpcLine 单行解析仍独立）

## D-003@v1 设计整体确认——⚠️ 自主决策待用户复核
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：按 D-001/D-002 定稿确认。原型跳过理由：纯数据链路补齐，前端任务执行面板零改动（pi 会话从空态变有数据，无界面变化，原型分级「纯后端无界面变化」档）

## D-004@v1 design-grill 修正——stopReason 枚举实证与测试路径
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：修正三处：①fixture 全量实证 stopReason 仅 stop/error 两值，aborted 是 ame.error 的 reason（流层中止）非 stopReason——删除 aborted→stopped 映射，被打断的轮按 completed 收行；②测试路径实存 tests/interactive/pi-events.test.ts，新增集成用例定名 tests/interactive/pi-task-dispatch.test.ts；③R-01 应对改写：既有用例 expected 数组需追加派生事件（预期适配非破坏）

## D-002@v2 品牌色派生 token 三主题分值（blue 不继承紫）
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：品牌色派生 token（--aurora-*/--row-active(-ring)/--shadow-glow/--shadow-primary）按既有 --shadow-primary 三主题分值惯例写满 :root/[data-theme="blue"]/[data-theme="dark"] 三块，blue 给蓝系取值
supersedes：D-002@v1

## D-003@v1 消息形态 = 气泡 + 头像
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：用户选定「气泡 + 头像」——现有气泡骨架保留，agent 消息加品牌渐变头像（Bot/引擎图标），用户消息维持右对齐品牌色气泡

## D-004@v1 范围含群聊面板
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：会话页 + 群聊一起改——group-chat-panel 的消息行同步焕新（头像/气泡层级/代码块已由 MarkdownText 共享自动获益）

## D-005@v1 dark 主题底色一起调
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：连主题底色一起调——dark 主题 card/border 取值微调拉大页面底与卡片反差（themes.ts darkTheme + globals.css dark 变量块同步，取值仍限 Tailwind v3 zinc 阶默认值）；全站受益，回归面经 build+主页面实拍控制

## D-006@v3 群聊 agent 成员无自定义头像时统一 Bot 渐变光环（取舍记录）
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：取舍为维持统一光环——发送者区分由消息行成员名行承担且群聊本就渲染成员名；统一 agent 视觉锚点（与单聊一致）价值大于分色辨识（分色仍保留在成员面板/facepile 等非消息行场景）；自定义头像（avatar 入参）优先级不变
supersedes：D-006@v2

## D-007@v1 高级感设计语言（v2 原型定调）
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：v2 原型定调六根杠杆——①环境极光背景（品牌色径向渐变光晕，浅/dark 双套取值）；②多层弥散阴影替代硬边框（边框统一降透明 --border-soft）；③玻璃拟态（顶栏/面板头/列表列 backdrop-blur + saturate）；④渐变点睛收敛到三处：标题「智能体」渐变字、agent 光环头像、发送按钮；⑤macOS 风深空代码块（三色窗点+语言标签+复制钮）；⑥微交互（发送钮 hover 浮起/点击回弹、plus 钮 hover 渐变填充、composer 聚焦光环+弥散阴影）

## D-008@v1 v3 修正——玻璃可读性 + 删流光顶条
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：①玻璃拟态不可读的根因是极光只铺内容区、玻璃面板底下是纯色底没有东西可透——v3 把极光铺满整个应用底（body background-attachment: fixed），侧栏/列表列/面板整体降透明 + backdrop-blur，玻璃下有色彩可透才读得出玻璃感；②panel-accent 渐变流光顶条整体删除——运行态氛围收敛为脉冲状态点 + 任务条 spinner 两个既有元素，克制优先，不再加新动效载体

## D-009@v1 v4 自查修正（用户要求"你自己看看效果图"后的逐项自审）
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：自审五条——①浅色下用户气泡紫色面积太大太吵（max-width 76%→72% + shadow-primary 降重：阴影 alpha 减半）；②composer 聚焦光环 v3 过浓且原型硬编码常驻焦点态（dark 下呈 RGB 霓虹圈游戏感）——改 3px/10% 透明度柔环、阴影不再跳档、原型展示常态；③列表/导航选中态两主题都太弱——inset 描边从 border-soft 换品牌色 22%/30% 透明度（--row-active-ring 新 token）；④浅色右上极光泛紫过浓（13%→9%）；⑤dark 极光太弱整体死黑（四团光晕各加 3-4 个百分点）

## D-010@v1 RoundDivider 状态六态映射
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：status 改六态判别联合，着色映射：completed=success / failed+killed=error / running=info / pending+interrupting=neutral

## D-011@v1 死 token 删除 + G-02 43px 悬空口径修正
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：①四 token 全删（消费面 Tailwind 阶已达成同观感，留死定义徒增维护面）；②G-02 作废——task-05 的 43px 对齐要求删除（对话视图无过程行，全部视图按 G-03 不动，turn-segment-views 零改动是正确实现）；③design 文件清单 layout.tsx 行改指 app-shell.tsx（极光实际落点）

## D-009@v1
状态：rejected
变更：2026-09-11-agent-log-attribution-refactor
锚点：未记录
最近确认：353eb11b0
理由：否——用户明确「不应该限制 agent 类型」，跨 harness 同变更挂接是需求而非缺陷
否决理由：与「同变更就挂」需求直接冲突
复潮条件：未来出现同变更跨 harness 归属仍需区分展示的需求

## D-010@v1
状态：rejected
变更：2026-09-11-agent-log-attribution-refactor
锚点：未记录
最近确认：353eb11b0
理由：否——首次错标仍会发生、subagent 归属仍靠 cwd 猜，治标不治本
否决理由：治标；不满足 FR-01
复潮条件：锚定方案在某个 harness 上不可实施时的局部回退

## D-011@v1
状态：rejected
变更：2026-09-11-agent-log-attribution-refactor
锚点：未记录
最近确认：353eb11b0
理由：否——动表结构与 D-005 冲突；现有 change/quicklog links 表已能表达「会话↔ctx」登记
否决理由：违反已确认的「不动表结构」决策；现有 links 表能力足够
复潮条件：ctx owner 解析出现性能问题或需要显式管理界面

## D-003@v2 聚合形态 = 编译期聚合（落点修订）
状态：implemented
变更：2026-09-11-provider-adapter-registry
锚点：未记录
最近确认：f0211bbcf
理由：Grill 复审发现 @v1 表述「新建 provider-adapter.ts」与实际最优落点不符——ProviderDescriptor（providers.ts:262）已承载五要素，原地扩展 INTERACTIVE_PROVIDERS 为 ProviderAdapter 聚合表改动面最小。@v2 修订：落点=providers.ts 内扩展，不另立契约文件。
supersedes：D-003@v1

## D-001@v1 预会话草稿键细分，消除跨入口串台
状态：implemented
变更：2026-09-13-session-group-ux-fixes
锚点：未记录
最近确认：39d3d8c5c
理由：代码查证：真会话草稿按 sessionId 隔离（sillyhub.sessions.draft.<sid>）且所有 7 个 SessionPanel 宿主均有 key={sessionId} 强制重挂载，rAF 门闩（draftHydratedRef）时序推演在重挂载/非重挂载两路径均正确；唯预会话（sessionId=null）草稿用固定键 __pre__（frontend/src/components/daemon/session-panel/turn-state.ts:304），跨工作区/跨机器入口共享——用户在不同入口开新会话时上一入口未发送内容必然带入，与用户「a 会话内容带到 b 会话」实测吻合。修复：预会话草稿键按 workspaceId+runtimeId 细分（__pre__:<ws>:<runtime>），真会话逻辑不动仅补测试覆盖。

## D-002@v2 拖拽不使用 setPointerCapture（Grill 修正）
状态：implemented
变更：2026-09-13-session-group-ux-fixes
锚点：未记录
最近确认：39d3d8c5c
理由：不用。frontend/src/components/ui/panel-resizer.tsx:11-13 真实先例明文因 jsdom 无实现而不用 setPointerCapture，window 级 pointermove/pointerup 监听已保证拖出元素收事件；测试走 fireEvent(window) 同路径（explorer-page.test.tsx 补坐标方案）。@v1 表述中「+ setPointerCapture」为 brainstorm 期误引，以本版为准。
supersedes：D-002@v1

## D-003@v1 群聊跨工作区可见性——后端返回可见工作区集合
状态：implemented
变更：2026-09-13-session-group-ux-fixes
锚点：未记录
最近确认：39d3d8c5c
理由：选后端方案：list_groups 响应组装时为每个群计算 visible_workspace_ids（直接 workspace_id + project 经 PpmProjectWorkspace 关联的全部 workspace_id，批量查询无 N+1），GroupChatListItemRead 加字段；前端各消费点（桌面 session-list-panel / 移动 mobile-session-list / 悬浮宿主如有群分区）过滤改为 includes 判定。理由：单一数据源、全部消费点免费获益、避免每个消费点各自拉项目-工作区映射造成数据不一致与重复查询。可见性口径：仅放宽列表展示（用户须是群成员才看得到，现有 member 过滤不动），打开群后的访问控制仍走群成员校验，权限语义零变化。

## D-004@v1 整体方案选 A——后端可见集合 + 预会话键细分 + Pointer Events
状态：implemented
变更：2026-09-13-session-group-ux-fixes
锚点：未记录
最近确认：39d3d8c5c
理由：用户选定方案 A。理由要点：单一数据源、全部消费点免费获益、改动聚焦（backend 2 + frontend 5 文件）；否决 B（逻辑复制 3 处、映射独立加载有时序窗口）；否决 C（真会话串台未证实，为未证实问题重构违反 YAGNI）。

## D-001@v1 修复方案——锚点 + 协议标记（方案 A）
状态：implemented
变更：2026-09-15-background-task-permission-lockout
锚点：未记录
最近确认：e21bf19cc
理由：A。daemon `onResult` 在会话的后台任务注册表非空时保留 currentRunId 作后台锚点（任务全部终态注销时清）；写通道守卫 `writeChannelGuardDeny` 新增「status=active + currentRunId 在 + 注册表有存活任务」放行条件；权限请求协议加 `background_task` 标记，backend `handle_permission_request` 据此放宽 active-turn 校验为「按 run_id 直查 + 会话归属校验」
故障面：注册表泄漏（task_notification 永不到达）会让锚点 currentRunId 永不清 → 守卫放行窗口变长；缓解＝锚点仅在 status=active 时有效，下一次 inject 正常切新 run，写策略/人审链路仍全程生效，放行的只是「通道存在性」而非权限本身
退役判据：SDK 未来提供 per-task 权限上下文（canUseTool 带 task 归属）时，锚点机制可退役为直连 task→run 权限路由

## D-001@v1 游标修复方案——before_id 附加参数 + 块内复合过滤（方案 A）
状态：implemented
变更：2026-09-16-logs-cursor-tiebreaker
锚点：未记录
最近确认：b204034fb
理由：A。backend get_agent_session_logs 新增可选 before_id 查询参数，before_id 非空时过滤改 `(ts < before) OR (ts = before AND id < before_id)`，缺省保持现行 `ts <= before` 旧语义；ORDER BY（run 块序 anchor_ts→ts→id）零改动；openapi/gen:types 同步；前端游标升级 (ts,id) 二元组 + pageKey 追加 id 后缀 + loadEarlierOnce 进度判定二元组化
故障面：WHERE 裸 ts 过滤与 run 块序排序键不对齐是既有已接受局限（跨 run 时间交叠时 ts 游标可跳行）——顺序会话（一会话一活跃轮）不受影响，本变更不扩大该局限（复合过滤仅在块内收紧）
退役判据：若未来日志查询改为全局 (ts,id) 序的专用分页端点或换 cursor token 协议，before_id 参数随 before 一并退役

## D-001@v1 对齐范围 = 变更中心列表页 + 详情页的功能补齐
状态：implemented
变更：2026-09-16-mobile-changes-parity
锚点：未记录
最近确认：d33092ea3
理由：变更中心在 PC 端由两个路由承载——列表页 `/workspaces/[id]/changes`（含 quicklog tab）与详情页 `/workspaces/[id]/changes/[cid]`；移动端对应 `/m/workspaces/[id]/changes` 与 `/m/workspaces/[id]/changes/[cid]`。对齐范围为这两对页面。

## D-002@v1 任务看板 / 任务执行页维持桌面引导，不在本次对齐
状态：implemented
变更：2026-09-16-mobile-changes-parity
锚点：未记录
最近确认：d33092ea3
理由：不移植。原变更 2026-08-26-mobile-workspace-page D-002 已明确将任务域裁剪出移动端核心版，移动详情页保留「任务区桌面引导条」；任务看板+执行页是独立大块功能（非列表/详情的信息呈现），用户指令针对「变更中心内容」，未点名任务域。
故障面：用户若预期任务看板也上手机端，本决策遗漏该预期——汇报中显式列为可否决项

## D-005@v1 实现方案 = 方案 A「既有组件复用挂载 + 移动壳适配」
状态：implemented
变更：2026-09-16-mobile-changes-parity
锚点：未记录
最近确认：d33092ea3
理由：选方案 A。三案对比：A=PC 既有卡组件（ChangeUsageCard/ChangeLastSignal/ScopeAuditCommandCard/ChangeActivityBadge）布局无 lg 依赖可直接挂载，数据层函数与 query key 全部复用，移动壳（筛选抽屉/⋯菜单/折叠卡）沿用本页既有范式；B=每卡重写移动版，违反移动端代码明文约束「数据层 100% 复用桌面（禁止复制第二份实现）」（每份移动页头部注释均载），制造双实现漂移面；C=废弃 /m/ 路由体系改响应式，推翻 2026-08-26-mobile-workspace-page 整个架构决策，牵连 m/layout 钻取路由、MobileWorkspaceHeader、底部 Tab 等全部移动基建。A 是仓库惯例的直接推论，非开放取舍。
故障面：若某桌面组件在小屏实测溢出（如 ScopeAuditCommandCard 明细表），需就地加移动断点而非重写——执行时验证
退役判据：若未来移动端整体转向响应式单套页面（方案 C 复活），本决策随之退役

## D-001@v1 知识来源范围——会话记录 + 手工录入 + 变更归档
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：用户多选确认：会话记录、手工录入、变更归档三项；事件复盘（incident postmortem）不在 v1 范围。

## D-002@v1 蒸馏引擎=派发 agent 会话（非后端直调 LLM）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：用户单选确认：派发 agent 会话。理由（用户选项描述）：能力最强，agent 能读文件、能跑 sillyspec knowledge propose 等命令，产物直接落在 .sillyspec 树内，与 CLI 口径天然一致。
故障面：派发依赖 daemon 在线与 lease 可用；daemon 离线时蒸馏任务排队/失败需有反馈路径。
退役判据：若 agent 会话蒸馏成本/时延不可接受且后端 LiteLLM 直调已能覆盖同等质量，可复议 D-002@v2。

## D-003@v1 入库位置=.sillyspec/knowledge 树（与 sillyspec CLI 同源）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：用户单选确认：写入 .sillyspec/knowledge。候选先进待审区（proposed/），人工审核后合并进正式知识文件并更新 INDEX，经现有 spec 同步（spec_version bump → daemon lease claim 按 latest_spec_version 拉取）回流各端；CLI 与网页看到同一份。
故障面：平台侧写入与 daemon 上行同步可能撞 manifest 乐观锁（冲突走既有 conflict 路径人工拍板）。
退役判据：若知识规模/并发写入增长到文件树形态不可维护（数千条目/多人同时写常态），复议为文件真相源之上加 DB 读索引，而非放弃与 CLI 同源。

## D-005@v1 平台侧写路径=方案A 平台直写（服务端权威写 + 蒸馏上行复用现有同步）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：用户单选确认：方案A 平台直写。手工录入与审核合并由 backend 直接写服务器 spec_root（维护 SpecFileManifest 单写者语义：行版本 +1、spec_version bump、软删备份），网页即时生效不依赖 daemon 在线；agent 蒸馏任务在会话内写本地 .sillyspec 后照现有上行同步回流（pull/push 维持主动快照语义，daemon 决策库 D-004@v1）。与上行同步撞同文件冲突走既有 manifest conflict 人工拍板路径（知识文件写入低频，冲突面可控）。否决方案B（全走 daemon 代写 outbox：daemon 离线即阻塞、异步排队体验差）；否决方案C（分期：人为拖慢用户明确要的蒸馏能力）。
故障面：平台直写与 daemon 上行同步并发改同一知识文件时触发 manifest 冲突（走既有 conflict 人工拍板）；repo-native junction 场景下行应用会改用户 git 工作树，需 git 感知提示。
退役判据：若知识写入频率升高导致冲突常态化，复议 D-005@v2 转代写队列或合并写协调器。

## D-007@v1 merge 两段式 apply + 三类映射目标 + 路由关键词人工输入（Design Grill B-1/B-3 修正）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：两段式：第一段 apply_ops([update(目标文件), update(INDEX.md)])，确认返回无 conflict 后第二段 apply_ops([delete(proposed)])；第二段失败=候选残留幂等可重试。合并目标 v1 限定三类 INDEX 映射文件（known-issues.md/patterns.md/conventions.md）；路由关键词由审核人人工填写（KnowledgeMergeIn.keywords），不做自动派生。另定 path 字段规范：entry.path 保留 .sillyspec/knowledge/ 前缀（顶层条目值不变，兑现兼容承诺），filename 扩展为含子目录段的相对路径，zone 由 filename 首段派生（Grill B-2 定论）。
故障面：两段间窗口内另一端同步改动 proposed 文件 → 第二段 conflict，候选残留（可重试，无知识丢失）。
退役判据：apply_ops 若未来提供事务性整批中止（all-or-nothing）语义，可合并回单段。

## D-008@v2 R-08 三洞修复落定——附件通道取数 + --spec-dir 指路回流 + 三重护栏（supersedes D-008@v1）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：实现期调查（2026-09-17，commit 2c7873e5e）修正前提：**spec 树三策略统一下发 daemon 本地 `~/.sillyhub/daemon/specs/{ws_id}`（交互会话启动 pull + 会话结束 postSpecSync 增量回传，`knowledge/` 在同步集内）**——v1 判断"platform-managed 下 daemon 本地无树"不成立，洞二实为"树在缺指路"。修正落定：①洞一取数走**附件通道**（导出会话日志为 Markdown→SessionAttachmentService 上传→create_session attachment_ids→daemon 落盘 {cwd}/attachments/ 供 agent 读，不污染知识库树；替代 v1 的 .runtime 导出方案——.runtime 在同步排除集内送不到 daemon，v1 方案不可行）；②洞二回流=prompt 统一带 `--spec-dir ~/.sillyhub/daemon/specs/{ws_id}` 指路（CLI 实测 propose 只认 --spec-dir 不认 --spec-root，scan 参数不可照搬）；③洞三护栏=turn>2000 422/单条 8KB 截断/总量 19MB 422 引导 resume；④非多模态引擎（附件通道依赖 provider_caps.multimodal，仅 claude/pi）fresh 会话源 422 守卫。
supersedes：D-008@v1
故障面：附件下载 daemon 侧 60s 超时（既有链路）；postSpecSync 乐观锁冲突靠 pending_push 自愈（既有）；超大对话 resume 模式上下文超限由引擎 compact 兜底。
退役判据：若 daemon 侧未来提供会话记录查询 MCP 工具，可弃附件导出通道。

## D-009@v1 会话源蒸馏默认走原会话续接（reopen+inject），新 agent 为可选项
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：会话源默认=原会话续接——平台既有 reopen_session（（续接入口 reopen_session，见 backend/app/modules/daemon/session/service/session_lifecycle.py），续接已结束 claude/codex 会话，SDK resume 保留完整对话历史+prompt cache）+ inject_session(prompt=...)（（inject_session，见 backend/app/modules/daemon/service.py））把提炼指令发进原会话。一举兑现三好处（快/省 token/高质量）并化解 R-08 洞一（原会话读自己，无需取数通道）。新 agent（现状 bootstrap 新建 AgentRun）保留为可选项，用于：会话已删/引擎不支持 resume/用户想换视角。变更源天然走新 agent（文件树无"原会话"概念）。引擎限制：续接仅 claude/codex（provider caps 门控）+ 仅已结束会话可 reopen（进行中用 inject）+ 归档区禁写。原型未体现"谁去干"——前端补选择 UI（会话源默认勾选"原会话续接（推荐）"，旁保留"新建 agent"）。
故障面：续接会话可能比新 agent 更"固执"于原上下文视角（用户已有认知，故保留换 agent 选项）；reopen 对进行中会话报错需引导用 inject 而非 reopen。
退役判据：若后续所有引擎均支持 resume 且用户实测续接质量稳定，可收窄新 agent 选项为高级设置。

## D-010@v1 沉淀闭环增强——已沉淀标签+知识点反链 / quicklog 第三来源 / 新建 agent 复用 create_session / 蒸馏会话隔离
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：四项全做，源码可行性已核实：①已沉淀标签=查该源有无 distill run（AgentRun.agent_session_id 关联+metadata_.kind 落档，无需新表），proposed frontmatter 的 source 字段为反链载体（backend/app/modules/knowledge/writer.py 的 frontmatter source 行 现写 manual，蒸馏写 session:<id>/change:<key>/quick:<id>）；合并时把目标小节锚点记入反链（因合并后 proposed 文件删除入备份区，反链须指到合并后目标小节 known-issues.md#某节而非已删 proposed 文件）；②quicklog 与 knowledge 同构（GET /quicklog 现成 backend/app/modules/knowledge/router.py:197），数据在文件树 .sillyspec/quicklog/，新 agent 直接读、连 R-08 洞一取数问题都没有——来源类型扩 quick，单条 ql 小故来源多选；③新建 agent 复用 create_session（backend/app/modules/daemon/session/service/（create_session 入口，见 backend/app/modules/daemon/session/service/create.py） 原生支持 runtime_id 钉机器+provider/agent_profile_id/llm_provider_id/model 完整形态），后端代触发而非用户手点，title 带「提炼」前缀；④AgentSession.metadata_（backend/app/modules/daemon/model.py:457 JSON 列）写 origin=knowledge-distill，常规会话页列表过滤排除，知识库侧 DistillTaskRead 保留 agent_session_id 可跳转——会话有据可循+不污染常规列表双兑现。
故障面：反链映射在合并时若目标小节重命名会失效（锚点漂移，需以 file+section_title 双键而非裸锚点）；蒸馏会话过滤若靠 metadata 判空，老会话（无 origin 字段）默认可见需零回归兜底。
退役判据：若常规会话页引入通用「会话用途」过滤维度，蒸馏隔离可并入该维度不再单列 origin 键。

## D-001@v1 变更范围=知识库效果面板三件套
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户对话逐条点单：①使用统计+热力图（知识库被用起来的节奏）②决策库展示效果化（裸文件→卡片，体现防复潮价值）③fr/ 目录（FR 索引，fr-index 新产物）展示效果化（状态/取代链/场景全埋正文里看不见）。统一主题=知识库从「能看到」升级到「看效果」。
故障面：hits 上行链路新增 daemon 改动面（此前 knowledge 变更零 daemon 改动）。
退役判据：若 hits 遥测被 CLI 侧改为直接上报平台 HTTP 端点，daemon 豁免上行可撤。

## D-003@v1 上行链路=daemon 同步豁免 hits 文件增量上报（非 CLI 直报）
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：复用既有 spec 同步通道而非改 CLI：daemon 在 spec 同步流程单独摘出 spec 目录下 .runtime/knowledge-hits.jsonl（豁免 UPLOAD_EXCLUDE 的这一个文件），按「已上行字节数/行数」断点增量 POST 到平台新端点批量落库。离线容忍（下次补传）、CLI 零改动、多端各报各的天然合并。
故障面：行截断（上行时本地正 append）——按完整行断点，尾行不完整留下次。
退役判据：CLI 未来原生支持遥测上报时可退役 daemon 豁免通道。

## D-006@v2 总体方案 A 确认（用户亲答）
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户亲答（2026-09-20）：认可方案 A（daemon 豁免增量上行+落库聚合+卡片渲染器+日历热力图），附加要求：上行链路必须解决多用户单工作区问题（见 D-007）。
supersedes：D-006@v1

## D-007@v1 多用户单工作区=各端独立上报+行 hash 幂等去重+行带 daemon 归属
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户亲答提出此问题，方案：①汇聚——各 daemon 只报本机 hits 增量（.runtime 不同步各端文件独立），服务器按行内容 sha256 做幂等去重（唯一约束 workspace_id+line_hash，INSERT ON CONFLICT DO NOTHING），多端天然合并零重复，重装/offset 丢失全量重报亦兜底；②断点——每 daemon 在自身家目录状态文件记已上报 offset（不落 spec 树防同步污染）；③归属——上报经 daemon 鉴权，行落库带 daemon_id（可关联注册用户），展示默认聚合总量（热力图=工作区整体节奏），数据层留归属供后续按人视图。
故障面：两端同一毫秒并发 INSERT 同 hash——唯一约束+ON CONFLICT 兜底，无竞态。

## D-004@v2 统一条目渲染器覆盖全部 zone（supersedes D-004@v1）
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户亲答（2026-09-20 原型反馈）：整个知识库下各目录结构应统一，都搞成人类阅读更友好的形式，参考本仓与 sillyspec 仓的知识结构。统一条目模型（两仓实证同构）：手册文件=## 小节多条目、decisions/fr=## ID+字段行、generated=单条目、INDEX=路由目录页。统一渲染器三形态：①正文小节卡（手册：小节标题+markdown 正文+条目级 🔥 徽标——手册命中本就是 条目#锚点 粒度）②结构化字段卡（决策/FR：状态/字段/理由/取代链/互跳）③目录导航卡（INDEX：分类段+路由行→点击跳对应条目）。每文件保留「原文」tab 切回 md 视图。
supersedes：D-004@v1

## D-009@v1 热力图删除，换运营指标仪表盘（用户亲答 a）
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户亲答选 a：删除日历热力图。顶部换运营指标仪表盘四卡：①知识覆盖率（被命中条目/全部条目+趋势）②死条目（90 天零命中，可点开清单引导清理）③每任务命中密度（均值趋势，过低=检索没跟上/过高=注入过肥）④新知识生效速度（近 30 天新增条目已被使用比例）。使用榜改日均使用率排序（命中次数÷条目存在天数，消除老条目累计偏差；绝对次数作副信息）。

## D-001@v1 维持 R-01 接受不修代码，文档登记观察项（方案 A）
状态：implemented
变更：2026-09-16-background-task-grace-timeout
锚点：未记录
最近确认：83b402f6b
理由：D（不改代码），文档载体方案 A。维持 2026-09-15-background-task-permission-lockout R-01 已接受的 P1 风险；本变更收窄为 known-issues.md 观察条目（四要素：暴露差/缓解链/重估触发/未来修复首选）+ 本变更 design.md 否定决策存档
故障面：若未来线上实证注册表泄漏（守卫放行但无对应存活任务），无界宽限暴露面超出设计先例——观察项记录的重估触发条件命中时按「未来修复首选：双窗兜底（条目存活=静默<60min 对齐先例 且 总时长<4h 绝对上限）」重开变更
退役判据：SDK 提供 per-task 权限上下文（canUseTool 带 task 归属）或 task_notification 可靠送达保证时，本观察项与 R-01 一并退役

## D-002@v1 分叉溯源 UX = 子代理式「块 + 点击浮层看原会话」
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户要「类似子代理这样，点击可以看原会话信息」——复用分身浮层形态（WorkerSessionOverlay 内嵌完整 SessionPanel），方向反过来指向父会话；多跳分叉呈链式可逐级回看。

## D-004@v1 引擎两档——claude 原生真分叉 + codex/pi 种子式降级
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户拍板「claude 真分叉 + 其余种子式」——claude 走 SDK resumeSessionAt+forkSession 真截断；codex/pi 用「截至分叉点的前情转述作首条消息」降级（新会话读到的是转述而非原生历史）。能力位按引擎分档，UI 明确标注两档语义差异。
故障面：种子档被误当真分叉——前情细节有损（转述≠原文），UI 不标注会引发「模型忘了」误报；能力位取值错误会让 codex/pi 走到原生参数路径直接失败
退役判据：codex/pi 引擎出现原生任意点恢复能力时，该档能力位置 true 并退役种子链路

## D-005@v1 原会话分叉后保留可继续（git 语义）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户选「保留可继续」——分叉对原会话零状态影响，两边并行各聊各的；防双活约束不适用于通用分叉场景，handoff 特例的「交接后冻结」语义由后置变更另行定义。

## D-006@v1 handoff 自动续接不并入本变更
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户选「不并入，后置独立变更」——本变更只交付通用手动分叉闭环（选点→分叉→谱系展示→溯源回看）；handoff 触发器、种子链、sillyspec CLI --json 补种子字段全部后置。

## D-007@v1 分叉执行链路 = 方案C（backend 主导管道扩展 + pi 原生 fork 接线）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户选方案C——以方案A为基座（backend 主导：claude 走既有 create-with-resume 管道加 fork 参数透传 resumeSessionAt+forkSession，daemon 不新增协议消息；种子组装在 backend 读库），追加 pi 原生 fork 接线：pi RPC 的 fork/switch_session 截断语义先 spike 实测，能截断则 pi 原生档、不能则退种子档；codex v1 种子档。
故障面：pi spike 失败退种子档（预期内降级）；pi fork 若实为「整文件分叉无截断」而误标原生档 → 分叉点语义错误，必须以 spike 断言截断行为定档
退役判据：codex 后续版本提供任意点恢复 API 时升原生档，退役种子链路

## D-008@v1 双 spike 定档——pi 档位与 claude 锚点结论
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：实测 pi=native（判据：RPC fork 命令以用户消息 entryId 为锚实测截断成立——fork 后 get_messages 6→2、新会话探针「name=Alice; code=none; color=none」不知截去轮、原会话文件零改动；截断唯一入口是 RPC fork 命令，CLI --fork 旗标为全量复制）；claude 锚点=轮末最后一个 chain-entry 消息 UUID（普通轮=轮末 SDKAssistantMessage.uuid，resume+resumeSessionAt+forkSession 实机断言知前2轮不知第3轮、transcript 物理截断；end-turn tool 轮/中断轮细则按 sdk.d.ts 归纳标待实机确认）；resumeDropsTurn 守卫=CLI 2.1.216 不支持 --resume-drops-turn（真 UUID 亦 unknown option 硬崩 exit 1、query() reject），SDK 0.3.247 类型已声明——守卫不可启用，省略即官方明示的未校验截断（截断语义不受影响），v1 driver 禁传该参数
故障面：pi 会话上游 API 错误被静默吞成空 assistant 轮（无错误事件，daemon 侧不浮出）；锚点取「末 assistant uuid」遇 end-turn tool 轮/中断轮时按细则应取轮末最后条目，取错会触发守卫拒绝或截断错位（守卫当前不可用则静默错位）；claude CLI 后续升级支持 --resume-drops-turn 前，任何传参尝试都是进程级硬崩
退役判据：claude CLI 升级支持 --resume-drops-turn 后启用守卫并补校验拒绝路径实测；pi 若大版本改 fork 锚语义须重跑本 spike

## D-010@v1 执行期裁决——D-008 pi=native 的规格落实（FR-07 修订+卡片定值）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：①caps 定值：pi sessionFork=native（task-03 直接落值，不再待定）；②engine_anchor 语义分档——claude=该轮末 chain-entry UUID（轮终态回填，task-04 原案）；pi=该轮首条用户消息 entryId（daemon 上报链落库）；pi 档 fork 语义=「分叉在第 N 轮后」→ 取第 N+1 轮 engine_anchor 为锚 position before，N 为末轮则走 clone 全量分叉；codex 恒 NULL；③task-06 claude driver 禁传 resumeDropsTurn（undefined 序列化 null 硬崩）+后台 job lane 禁用截断参数对；pi 分支确认实装（活 RPC 会话发 fork 命令）。
故障面：pi entryId 若不在既有上报链，需 daemon 侧增报字段（task-06 范围内），漏报则 pi 档 fork 拿不到锚
退役判据：同 D-008

## D-011@v1 执行期裁决——锚点数据源改走消息级 metadata 通道，task-04 依赖反转挪 W5
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：走消息级 metadata 通道：task-06 两个 driver 在归一化产物上补挂引擎原生锚进 AgentEvent.metadata 固定键 engineAnchor（claude=record 顶层 uuid；pi=用户消息 entryId），不碰 event-wire 平铺契约（metadata 键现成，event-wire.ts:81-116）不碰 claude-events/pi-events（driver 层持有 raw+归一化双视角，均在 task-06 allowed_paths 内）；backend 侧 AgentRunLog.metadata_ 列现成持久。task-04 改为消费端：从该轮已落库消息 metadata.engineAnchor 取值回填 AgentRun.engine_anchor（claude=轮末 assistant 消息；pi=轮首 user 消息）。task-04 因此增依赖 task-06、从 W2 挪 W5（与 task-08 同波，文件正交）；不降档、不推翻 D-008（正是落实其锚值语义）。
故障面：driver 漏挂或 backend 漏读该键→engine_anchor 恒 NULL→该轮入口灰（R-05 既有降级面，不炸链路）
退役判据：引擎侧原生提供可截断锚的上报 API 时收敛为单一来源

## D-012@v1 执行期裁决——lease.metadata fork 参数组统一契约（claude/pi 双形态）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：lease.metadata fork 参数组四键：resume_at_uuid（claude 链 UUID）、fork_session(bool)、fork_anchor_entry_id（pi 用户 entryId）、fork_mode('resume_at'|'rpc_fork'|'clone')。fork.py 按 provider×锚可得性定 mode：claude→engine_anchor 有=resume_at、无=422；pi→at_run 下一轮 engine_anchor 有=rpc_fork、末轮=clone；codex(seed)→不写 fork 键纯种子。daemon（task-06）按 mode 消费：resume_at→claude SDK options 三件（禁 resumeDropsTurn）；rpc_fork→对源会话活 RPC 发 fork 命令（源死则加载源文件起临时 RPC 再 fork）；clone→pi 全量分叉。CreateSessionInput 对应增 resumeAtUuid/forkSession/forkAnchorEntryId/forkMode 四可选键。
故障面：rpc_fork 时源 pi 会话文件不可达（跨机/已删）→ fork 失败 4xx，文案提示
退役判据：pi 提供 spawn 期截断参数时收敛为 resume_at 同形态

## D-014@v1 执行期裁决——W4 双卡裁决汇总（pi 预 fork 方案/路径漂移//runs DTO 增列归属）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：①pi fork 采用「短命 RPC 预 fork」替代卡面「源会话活 RPC」——实证 pi fork/clone 会劫持 RPC 进程自身活跃会话（teardownCurrent+apply），活 RPC 方案须 switch_session 切回且违反 D-005 零侵扰；短命方案（临时 pi --mode rpc --session <源> → fork/clone → get_state 读新分支 → 杀 temp → B 以分支文件 spawn）附带支持源会话已结束场景，失败原样上抛不降级。②pi entryId 不在 message 事件（仅 SessionEntry 落盘后存在）→ message_end(role=user) 回查 get_fork_messages 取轮首锚，失败仅 warn=锚缺失入口灰。③task-07 发现 /runs SessionRunRead 未透出 AgentRun.engine_anchor（native 档门控无数据源）→ session_insights.py 一行增列+gen:types 归 task-08，engineAnchor prop 由 /runs 数据接线。另：task-06 路径漂移两处（建会话真身在 session-manager.ts 非 index.ts facade；CreateSessionInput 在 interactive/types.ts）=代码现实修正。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-change-detail-restore-assets
锚点：未记录
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec
理由：最大风险：恢复的挂载再次被并行会话夹带覆盖（本次事故根因即此）。缓解：新增页面级钉子测试断言资产卡与观测事件卡并存，下次任何提交删挂载会被聚焦测试拦下（CI 层面）。试过但放弃：把 aside 卡片清单抽成数组配置防漏挂——放弃，卡片间挂载条件与注释各不相同（quicklog 卡需 change_key、对账卡带 archived 语义），抽象后反而丢语义，收益不成比例。线上已部署旧镜像的窗口期：需重新部署前端镜像才能让用户看到恢复，代码层无风险。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-assets-testfile-path-resolve
锚点：未记录
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1
理由：最大风险：短路径后缀匹配救错文件——同 basename 的测试文件在仓库多个模块存在且都非 `.sillyspec/.runtime/` 前缀时（如 frontend 与 backend 各一个同名测试），后缀匹配多命中已降级为候选列表由用户选，不自动猜；唯一后缀命中才自动救回，且救回时弹窗明示真实路径 + 原记录路径，用户可察觉错配。试过但放弃：①直接修归档件 test-trace.json 的路径数据——放弃，审计件 sha256 锚定链会被破坏，且同类短路径在其它归档变更可能重复出现，逐个修数据不如展示层统一兜底；②后端 assets 聚合时归一——放弃，后端容器无真实仓库文件系统，探测必须走 daemon RPC，等价于把解析搬到后端但多一跳契约变化，收益不成比例。搜索端点按文件名子串匹配（RPC 60s 超时）大仓性能由 explorer 既有实现承载，本变更只新增弹窗打开时的一次调用。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-assets-test-binding-raw-text
锚点：未记录
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2
理由：最大风险：requirements.md 槽格式是 sillyspec 工具约定（AGENT 注释 + 内容行），工具改版后格式漂移会让正则失配——表现为 raw_binding=None 静默降级（与现状等价，不劣化），且工具坑已留档（test-trace 截断坑里建议摘录保真，若工具侧修了截断，tests 数组本身带用例名，本原文行自然退居补充信息）。试过但放弃：①改摘录器保真——外部 CLI 工具，本项目侧改不了；②前端自行拉归档 requirements.md 展示——归档件在 spec 镜像树，无逐文件读取端点，为展示开新端点收益不成比例。正则锚点取 FR-[A-Za-z0-9-]+ 宽容匹配（含 FR-auto-xxx 等未来形态），内容行截止到下一 <!--AGENT: 或空行。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-change-real-timeline
锚点：未记录
最近确认：e120a799bafc77f4b5b9f35e7971baece30c33f8
理由：最大风险：事件流覆盖不全（watcher 后拉起/单飞锁盲窗，CLI 脚注同款披露）——展示面注明「观测起点≠诞生时刻」，墙钟统计以首末事件为界，不冒充完整历史。次风险：tasks.md 机器稿行含长描述截断规则与未来格式漂移——正则宽容匹配（task-\d+ 后冒号任意文本），坏行跳过不炸。试过但放弃：①把 CLI 命令嵌 daemon RPC 直接取渲染文本——耦合 CLI 输出格式且失去结构化（前端无法做任务面表格），且 daemon 旧版无此命令会 502；②events 表加 timeline 专用投影列——违反红线 D-004（零业务加工），聚合现算即可（变更事件量级 <100/单变更）。commit 标题匹配用 9 字符短哈希前缀——碰撞概率在 limit 50 窗口内可忽略，命中多条取最新。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-change-asset-transparency
锚点：未记录
最近确认：8846b46367fb931d6e806042b88c4d591a5e8781
理由：最大风险：「待复核」标记语义≠完整知识消费面——flow start 注入的知识命中（conventions/patterns 锚点）不落盘，本组只覆盖被 flow done 打标的 FR/决策（有覆盖交集才打标）；页脚措辞如实（「知识触达（待复核标记反查）」）不冒充全量消费记录。次风险：模块图 paths glob 语义简化为去 ** 前缀匹配——深嵌套例外路径（负 glob/多段通配）会误归/漏归，模块图现行形态（单前缀+**）下无实例，误归代价是 chip 多一个可点项（低危）。中文名 h1 提取对无 h1 文档回退 id（conventions 要求模块卡 h1 中文名，存量已合规）。试过但放弃：①CLI 侧落盘完整注入清单（含知识命中）——外部工具改动，留坑建议；②模块页独立路由——平台无模块卡页面先例，开新页面超本变更换代价值，先以文档预览弹窗承接，后续有模块中心需求再升格。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-knowledge-card-machine-block
锚点：未记录
最近确认：963dde53e652652befc497ed379f1eaefe60924b
理由：最大风险：对 writer 格式演进的耦合——tests 多值连接符 " | "、两空格缩进、字段集是 sillyspec test-bindings.js 的现行形态，CLI 侧改形态时这里需跟（宽容匹配注释标记前缀已留余量；tests 用 "|" split 天然容忍多值）。试过放弃的方案：①整块隐藏机器块——丢 tests 覆盖信号，放弃；②后端解析透传结构化字段——动 openapi/api-types 面大，展示层问题展示层解决，放弃。另注：knowledge-page 既有深链用例在 jsdom 下有 scrollIntoView 未实现的既有报错噪音（与本次无关，昨日引入）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-thin-badge-survives-archive
锚点：未记录
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32
理由：最大风险：时间窗边界误判——若数据库存在 created_at 异常（时钟漂移/手工导入）的边界数据，可能误标/漏标出身；误标代价仅是多显示一个徽章（低危展示层），且 thin 分流上线后 quick 类型不再新增，窗口语义单调。试过但放弃：①镜像 flow-state.yaml tier==thin 精确投影——需后端详情读侧加文件系统读取，读放大不成比例；②列表页徽章同改——列表行徽章走 ChangeStepBadge（另一组件），用户诉求在详情页标题，列表另行跟进不夹带。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-sillyspec-command-queue
锚点：未记录
最近确认：8fa02468648621a9d4bf8a745cca6b1a5a895f3d
理由：最大风险：排在长升级链（npm 安装分钟级）后的命令可能撞前端 150s 回显恢复窗（ECHO_TIMEOUT_MS）——前端恢复按钮可重试，重复排队条目执行幂等裁决（重复 resolve 同一 change 无害，冲突已消解则 no-op），且冲突计数 ≤75s 采集刷新自愈；不设队列深度上限（单管理员洪水不存在，设上限反而重新发明忙拒）。试过放弃的方案：①保留忙拒+前端自动重试——复杂度推给两端且用户仍见失败红字，与本次反馈直接冲突；②升级完成事件化（await 一次性 promise）——升级链状态机（_update running/deferred→终态+10min 展示窗）无单点完成信号，deferred 复查本身已是 1s 轮询实现，事件化需动 manager 状态机超出薄改范围；出队时 1s 轮询与其等价且零侵入。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-probe-concurrent-rpc
锚点：未记录
最近确认：43ee45c1ffc967e605e6a35482f84318e65d9e3d
理由：最大风险：把 3s 预算设得比真实慢链路还短——daemon 在线但公网高抖动（>3s）时探测会从「慢但有真答」变成「unknown」。权衡依据：探测是三态 UI 展示（unknown 时界面照常显示「未知」并维持现状路径，§5.D），拿不到真答的代价只是显示降级，而 30s 预算下整批探测拖分钟级的代价是用户可感的全局卡顿；且单次 stat 本地执行毫秒级，3s 已含 ~3 个数量级的网络余量。 试过但放弃：给 git_probe 结果加 TTL 缓存（比如 30s 内复用）——被 R-02「每次调用实时探测不缓存」明确否决，且缓存会让「daemon 刚下线/刚变 git 态」的展示滞后，违背探测语义，放弃。 次要风险：gather 不开 return_exceptions，若未来有 git_probe 实现抛异常，并发版会在首个异常时与其余在飞任务一起快速失败——与原串行版「首个异常中断」语义一致，不视为回归。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-migration-chain-dedupe
锚点：未记录
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb
理由：最大风险：重写 040000 DDL 造成「文件内容与历史已应用效果不一致」的审计歧义——某库记号 040000 但表结构可能是旧版也可能是（未来的）新版，只能靠矫正迁移的存在与 information_schema 探测兜底对齐。缓解：040000 docstring 显式记重写历史与适用边界；矫正迁移 234000 紧随其后，任何路径到达 head 后表结构唯一确定（幂等探测保证收敛，与起点结构无关）。 试过但放弃：①给 063000/040000 加「表存在则跳过」幂等 guard 保留双文件——放弃：全新库仍按图序执行两份建表逻辑，且两条分支结构不一致（stage 列有无），guard 掩盖而非消除分叉，链图审计面双份；②ts 转 ISO 用 ts::text——放弃：输出「2026-09-25 06:04:02.526+00」（空格分隔、+00 后缀）与 service 层写入的 ISO 8601 格式不一致，混合格式破坏字典序比较一致性，用 to_char 统一 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'。 次要风险：stage 历史值丢弃（119 行）——观测数据无消费方，接受；severity NULL→'info'（157 行）与 rule NULL→'' 的回填值是语义近似（历史写入端未归一），展示层无差别。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-daemon-queue-stop-gaps
锚点：未记录
最近确认：3942b156fd3a9feb541d81daccbc763a2f5cad94
理由：最大风险：预算 5 分钟是经验值——合法但极慢的升级链（网络差时 npm 拉包+校验）超 5 分钟会让本可成功的命令记 failed；代价有限（失败终态可重试、命令幂等、前端恢复按钮在），优于无界楔死。其次：超时后升级仍在跑，后续命令继续排队各等 5 分钟逐条 failed——「逐条显式失败」仍是活性态（链尾持续推进），非楔死。试过放弃的方案：①「排除 deferred 态出等待」——deferred 任意时刻可翻 running，会在 npm 半安装窗口并发 spawn CLI，违背安全动机，放弃；②「等待超时后照常 exec」——同半安装风险，放弃；③「给 deferred 复查本身加上限」——改 manager 状态机越界本变更范围（deferred 无限推迟对升级链自身是合理语义），放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-visual-gap-fix
锚点：未记录
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc
理由：最大风险：两栏 grid 中 ChangesOverviewCard（内部自带高度行为）在窄栏挤压下的布局回归——已跑概览 23 用例 + 卡片 19 用例全绿对冲。试过放弃：把 WorkspaceConfigCard 也收进右栏——放弃（ql-20260821-003 用户裁决全宽展示，不推翻既有用户决策）。会话门户左栏深改（3665 行条目重构）放弃——风险收益比差，已有 11px/brand 阶打底，留待专项。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-audit-followup-hardening
锚点：未记录
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94
理由：最大风险：合法但形态特殊的 doc 值（如含反斜杠的合法相对路径）被误判越界丢弃 chip——影响面仅展示降级（名回退 id），不丢模块触达本身。试过放弃：①「resolve+is_relative_to 白名单」——Windows 大小写/符号链接语义跨三平台分歧大（规则 13），纯词法判定更可移植；②「doc 保留仅去 h1 读取」——越界路径仍外发给前端 chip 可点击，留下二次面；③「同步修 explorer 预览侧」——explorer 自有寻径防护（前端传参仅展示路径），无需重复设防。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-visual-align-2
锚点：未记录
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7
理由：最大风险：[&>*] 子选择器依赖子卡 SectionCard 边框类形态，子卡改版式会失效——已用详情域 134 用例对冲。放弃：时间线组件重写——核对发现其已是竖线节点形态（pl-[26px]+before 竖线），无需重写；头像完整用户名展示——原型即 20px 首字符，title 携全名。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-hover-polish
锚点：未记录
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7
理由：最大风险：muted 实色在 dark 主题的悬浮对比（dark muted=zinc-700 深灰，实色悬浮为深一档——与原型 canvas 语义一致方向）；已放弃：自定义 canvas 色阶 token——三主题 muted 即语义等价物，不新增阶。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-prototype-pipeline
锚点：未记录
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9
理由：最大风险：Tailwind 全量 CSS 使每产物 ~150KB、七文件合计 ~1MB 入仓——接受（纯文本 git 增量压缩后很小；后续可加按视图 content 裁剪优化，非本变更范围）。次风险：视图静态渲染无水合，交互仅 vanilla JS 子集（主题切换/tab 过滤）——规约中明示，需要完整交互的原型走 dev 预览路由（后续变更）。 试过放弃：① mermaid 文本方案——渲染产物需浏览器运行时（内联 mermaid.js ~2MB/文件）或引入 puppeteer 重依赖，放弃；② 复用 @xyflow/react——交互式定位编辑超流程「描述类」原型所需，静态渲染下自动布局不稳定，放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-thin-display-fix
锚点：未记录
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e
理由：最大风险：steps 兜底判定对「无 steps 记录的标准变更」误判——判定要求 steps.length>0，空 steps 不命中（标准变更 active 期必有步骤记录，归档标准变更 steps 含四阶段痕迹已验证 observation 样本）。钉子测试暴露并修正了 quick 时间窗缺失（历史 quick 误标）；放弃：列表行归档 flow-thin 出身标识——列表投影无 steps/change created_at 有但 change_type=feature 无信号，需后端 is_thin 投影（已列遗留）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-change-list-is-thin
锚点：未记录
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e
理由：最大风险：判定口径与前端 lib/thin-lineage.ts 双实现漂移——注释互指+同口径测试锚定（后端 6 用例对齐前端 6 用例矩阵）；已放弃：ChangeRead 详情也加 is_thin——详情前端已有本地判定且正确，最小面原则不加。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-knowledge-governance-cards
锚点：未记录
最近确认：99c508227642192dc929cd0702441f3303a6ceff
理由：最大风险：与 CLI digest 的口径分叉（unmapped 基线消音平台侧没有、绑定信号缺失）——双出口数字可能不一致；缓解：unmapped 只进 totals 降展示级、绑定信号 CLI 独有已在两端注释与卡面处置文案交叉指引，v2 可经 daemon RPC 直采 CLI digest --json 收敛单源。次风险：伪域 v1 只读卡（迁移动作 CLI 手工）——动作回传 v2；阈值与 CLI 同值但两处字面量（跨仓无法单源），注释互指。放弃方案：daemon RPC 实时跑 CLI digest——正确终态但需 daemon+RPC 双端改造，v1 平台直算已解 3/4 信号可见性，性价比不对等。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-assets-testfile-bracket-note
锚点：未记录
最近确认：99c508227642192dc929cd0702441f3303a6ceff
理由：最大风险：真实文件名含「」字符会被误剥——测试绑定约定「」为用例名注解语法，且仓库实测无此类测试文件名，接受该权衡并在函数注释言明。放弃方案 a：改 sillyspec CLI 的 flow done 补全解析（tests[] 只存纯路径）——治本但属另一仓库存量数据救不回，已按规则 15 记 docs/sillyspec/ 活跃坑；放弃方案 b：只在 TestFileBody 局部剥——resolveTestFilePath 的 norm 与搜索入参两处口径会分裂，故统一在归一函数做。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-session-portal-ia-restructure
锚点：未记录
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83
理由：最大风险：session-panel-page.tsx（4615 行）JSX 大块迁移时破坏隐蔽行为——占位轮 SSE 抢先认领、触顶加载锚钉回、跳转抑制窗、发送窗口期打断回退等防呆逻辑都缝在 render 与 effect 的交界处。对策：只移动 JSX 块的容器位置，不动任何 hooks/回调/数据派生；每完成一个 task 跑相关测试再进下一步；收口时对 diff 逐行审查确认「仅 render 组织层」。实际暴露（独立评审 P1）：desktop 非 portal 宿主（分身浮层/悬浮助手）不传 onOpenSubagent，右列初版绑定宿主 props 导致它们的用量条与任务面板消失——已修复（右列容器与子代理 Provider 解耦，desktop 一律有右列）。另注：本变更工作区基线叠加于上一轮 2026-09-26-core-pages-visual-redesign 未提交的 staged 快照之上，冻结件 change.patch 因此含上一轮 38 文件捆绑（主仓库已分两笔 commit 剥离归属：先 staged 快照落地为上一轮 commit，再本变更独立 commit）。 试过放弃的方案：①ChatGPT 式单栏+抽屉布局（推翻三栏）——深链/群聊/文件模式/四分支全部重做，风险与收益不成比，放弃；②把 SessionConfigBar/CtxUsageBar 也收进右栏——配置与压缩上下文是输入前高频操作，收进右栏断操作流，放弃；③portal 层做统一四栏容器——群聊分支与文件树模式联动复杂，波及面大，放弃（改为 panel 层内解决）；④TaskExecutionPanel/UsageBar 彻底只留右栏——mobile 无右列会丢功能，放弃（mobile 维持原位）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-governance-rpc-actions
锚点：未记录
最近确认：3306460582a64242091b32ebee63a85f1b071444
理由：最大风险：spawn shell:true 命令串注入——kind 白名单硬编码 + 域名 [a-z0-9-]+ + root_path 元字符黑名单三层，且 root 只进 cwd 不拼命令串。次风险：RPC 优先路径的 backend 测试只验回退（happy path 由 daemon 侧 handler 测试 + 真实链路 E2E 留部署后——ws_hub mock 成本高，披露）；digest 超时 60s 偏宽（CLI 大仓绑定扫描秒级实测，留观察）。放弃方案：平台直接 spawn CLI（无 daemon 链路）——平台容器不可达成员仓工作树（2026-09-11 skills-central-library 同款结论）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-timeline-coexist
锚点：未记录
最近确认：d3ee2bbd7cc53faf6cabdfc312554ef032dcddb3
理由：最大风险：厚变更若事件表有历史数据，归档后详情页会多出一张合成卡——判定为可接受（信息增量，非误报；事件恒 provisional 角标已声明观测语义）。试过放弃的方案：恢复第一代 tasks.md 勾选时间戳指令（需改 CLI 流程模板且与第二代 watcher 事件流机制重复，放弃）；后端在 steps 里带真实事件时间（改 CLI 同步协议，面大，放弃）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-timeline-task-time
锚点：未记录
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7
理由：最大风险：tasks.md 行序与事件勾选计数序错位（人工重排行/中间插行）会标错时刻——CLI 同款固有语义，卡上已恒定标注「≈顺序推断」脚注，可接受。试过放弃：把推断下推到 watcher 推送时带任务 id（需改 CLI 事件协议且历史数据无法回填，放弃——推断层纯展示零协议负担）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-thin-affected-modules-from-patch-manifest
锚点：未记录
最近确认：8acb0f197f8b660e404eefa917b0fbebd621e1ac
理由：最大风险：files 含 CLI 侧冻结的 `.sillyspec/docs/` 交付文档路径（note 声明保留），可能命中文档类模块产生轻微噪声——实测本仓 SillyHub 图无 docs/ 前缀模块，噪声为零，故只滤 `.sillyspec/changes/` 而不扩大滤除面。放弃的方案：直接读 CLI 新三键 `modules[].id`——id 语义绑定 flow 运行仓的项目图，跨仓无意义，且存量件无此键。曾评估并否决「维持单图」：单图选择依赖目录字母序巧合且 Windows 平台失效（实测坐实），多图合并的粗粒度冗余命中（backend/frontend 顶层粗模块与细模块并存）经真实数据冒烟权衡为可接受展示代价，最终落地多图合并（本条为评审 P2 清偿修正——原稿写作时基于「SillyHub 单图已覆盖」的错误前提）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-session-fast-replay
锚点：未记录
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1
理由：最大风险：跳转直达的 prepend 装配链——单轮日志直接进 logsToTurns 需与既有 turns 正确衔接（复合游标去重依赖 ts 排序，单轮请求升序返回天然满足）；防护=复用既有 prepend 锚钉回+会话纪元防串台机制，测试覆盖跨页边界（目标轮与已加载窗口相邻/重叠两种情形）。第二风险：大纲摘要 SQL 窗口函数在超大日志表（15 万行）上的成本——指纹缓存吸收重复读，首算成本 DB 端扫描无传输（可接受；若实测慢再上物化投影，本次不做）。 试过放弃的方案：①全量历史虚拟滚动（@tanstack/react-virtual）——治渲染不治传输，且动态高度虚拟化复杂度高，hermes 实证聊天流不需要（窗口小），放弃；②大纲落库物化表+触发器维护——正确性最好但写路径侵入大，首版用指纹缓存（读时失效），实测不够再升级，放弃先行；③/runs 改分页——大纲端点已承担全量轻列职责，runs 保持现状语义只瘦身，避免双端点职责重叠。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-audit-risk-fixes
锚点：未记录
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938
理由：最大风险：黑名单收窄以「root 只进 spawn cwd、绝不拼命令串」为前提——若未来 knowledge 命令改为拼接 root，& 等字符会重新构成注入面；已在类注释钉死该前提，改命令构造时必须回看。containment 是真正的物理边界，黑名单仅异常值防线。 试过放弃的方案：把 issue-row 的 div onKeyDown 一并删除（F-3 同源直觉）——div role=button 无原生键盘激活，删了是可访问性回归；只删 underline-nav 的容器级处理（tab 是真 button，原生激活足够）。 不可修项留档：66ae9a0d4 提交点 ImportError 是 git 历史事实（HEAD 已由 723d325fd 补全），不改写历史。 评审 P2 裁决（change.patch 冻结区间夹带）：session_insights.py 的 `func.max(cast(AgentRunLog.id, String))` hunk 属并行会话提交 66393f432（turn-outline 指纹 PG 无 uuid 聚合修复，生产 500），非本变更交付文件面——baseline(b14ce676f)..HEAD 区间采集把它扫入冻结件，属区间机械现象（先例：多份归档提交的「并行会话增量不夹带」注记）。该 hunk 的行为承诺与测试（15 用例）在 66393f432 自身留档，本变更不重复承接，边界已裁决：可接受。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-drop-observation-card
锚点：未记录
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5
理由：最大风险：观测事件卡的 warning 告警自动展开提醒能力随卡消失——可接受（主栏时间线卡事件轴同款 warn 色渲染 warning 行，信息不丢，只失去「自动展开」交互；如后续需要可给时间线卡加告警高亮）。放弃方案：保留两卡但观测卡收敛为仅 warning（用户裁决「直接不要了」，从简执行）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-turn-nav-hover-flyout
锚点：未记录
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f
理由：最大风险：浮层覆盖聊天区可能遮挡阅读中的内容——对策：默认收起（仅 44px），悬停防抖 300ms 防掠过误触，移开 250ms 即收，非 pin 态点行选完即收；浮层带阴影+边框视觉区分，聊天区不被挤压（absolute 不改布局）。 放弃的方案：①并入右栏详情 tab——中栏最干净但跳转多一步且右栏已有详情/文件/子代理三态；②默认 120px 收窄常驻——仍占一列，没解决本质；③保留拖宽——浮层不占布局后拖宽失去意义，砍掉（宽度记忆键随之退役）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-turn-nav-empty-hint
锚点：未记录
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb
理由：最大风险：无摘要轮与「确实坏了的大纲」混淆——用户看到「（无内容记录）」可能仍疑惑。对策：本变更实证了空摘要=空数据（非故障）；若后续群聊摘要兜底（group message 表取正文）立项，该占位自然消减。放弃的方案：后端跨表取群消息正文兜底——超出文案修正范围且需群聊数据链路验证，另立变更。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-ci-failures-sweep
锚点：未记录
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a
理由：最大风险：daemon 超时修复依赖「waitForSpawn 轮询 mock.calls」的既有 helper 语义，若未来 spawn 前路径再加真实 IO，waitForSpawn 本身仍稳（真实时间预算轮询）；但**同文件多轮 runLease** 的用例若忘传 minCalls 会复发第二轮丢事件——已在 helper docblock 写死该死锁链与用法。 放弃的方案：①给 applyClaudeSettings 打 mock 挡 unlink——放弃，撤下语义是有意产品行为，mock 会掩盖真实 IO 时序；②e2e 改用平台 admin 身份绕过菜单权限——放弃，N4 负向断言依赖非 admin 形态，且冒烟角色语义就是普通成员。 残留风险：e2e N2/N3 本机无 Docker 全栈未实证（e2e-ci 验证）；304eba982 冲掉 fed6e9e9a 的模式提示并行会话基于旧基线提交会回退他人已合入改动——本仓库已知协作形态，非本次可根治。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：change-list-description
锚点：未记录
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231
理由：最大风险：提取规则对动机段书写形态的覆盖面——动机段可能只有列表、可能含「成功标准」字样在散文中、可能空段。对策：规则保守（无动机段/剥后为空 → None，前端零占位），500 字符截断防长文破版，纯函数加一组形态回归测试（thin 机器稿/完整流程散文/列表首段/无动机段/空前缀）。 放弃的方案：① CLI 侧给 thin proposal 起语义 H1——只惠及未来 thin，存量与完整流程不受益，且机器自动起标题质量不可控；② 前端行内直接拉 proposal 文档渲染——列表页多一轮文档请求、且 search 仍搜不到，不解决「找」的本痛点。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：roadmap-retire
锚点：未记录
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f
理由：最大风险：误判「无消费」——已复核：平台仓自有代码（frontend/backend/daemon src）grep 仅 daemon 注释 1 处；消费真实来自 sillyspec CLI 的通用读点（全条件化）；.claude/skills 为提示面。放弃的方案：机器化维护单行条目——lite/thin 豁免使字典永远缺主力通道数据，补齐需动 lite 归档语义，为已被四套真源覆盖的文件不值。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-change-ux-detail-batch
锚点：未记录
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5
理由：最大风险：布局类改动（grid/h-64/滚动）在真实浏览器的观感无法由 jsdom 断言——已按 tailwind 语义保守实现（md 两列、h-64 固定高、min-h-0 flex-1 overflow-y-auto 链条齐全），真机目验移交用户；列表行修复是标准 flex 陷阱修法（min-w-0），确定性高。放弃的方案：沉淀资产每组独立 max-h（行高不齐对不齐）——改统一 h-64 换取网格对齐；平台同步保留常驻但折叠——用户明确要求收进按钮，折叠态仍占一行。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-timeline-anchor-scope
锚点：未记录
最近确认：34d39ff7c1306f64976528484698bf7330463691
理由：最大风险：本变更 commit 事件的短哈希在全局 50 窗口外（远端落后、窗口截断）→ anchor_pairs 空 → 锚 None——无锚是诚实降级优于错锚；titles 同理降级。放弃方案：锚匹配直接读 events 不经 git 窗口（事件只有短哈希无 message，token 匹配必须有 message——保留经窗口取对的形态只收窄窗口）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-unmapped-batch-redomain
锚点：未记录
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236
理由：最大风险：粗域错置（name/text 级判定的变更可能有个别条目实际属另一端）——条目全文随迁、搜索按内容命中，错置代价是「在相邻模块也能搜到」而非丢失；判定依据全量留档可回溯可再迁。放弃的方案：①逐条 698 次语义判定——成本翻数倍、收益边际（粗桶清理已达成可查找目标）；②给 redomain 工具补 --by-change 参数后用工具迁——正确长期路径（已留档 docs/sillyspec 缺陷2）但等工具排期，本次数据清理不该被工具改进阻塞。 >

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-knowledge-inbox-clear
锚点：未记录
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1
理由：最大风险：INDEX 锚点手写错（GitHub 中文 slug 规则：标点删除、空格转连字符）致索引点击不可达——用 node 脚本按同规则自检 41 条锚点后跑 sillyspec knowledge validate 双保险。次风险：归类判断主观（个别条目跨类，如 Next.js 代理条目兼含 SSE 范式）——按条目主锚（主要教训）归类，正文整体迁移不拆条，不丢信息。放弃的方案：按条目拆分跨类内容到多个文件（破坏原条目完整性与可回溯性，放弃）；已修复条目删除（违背收件箱头注「已修复项保留并标注状态便于回溯」，放弃）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-remove-liveness-overview-card
锚点：未记录
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3
理由：最大风险：误删共享受害面——agent-liveness-overview-card.tsx 删除若连带删 lib 层（listWorkspaceAgentLogs / liveness-badge）会打断会话列表活性链路；已核对引用（grep 全仓）确认仅摘卡不动数据层。放弃的方案：①「无有效数据时隐藏卡片」——判定条件含糊（库里恰有一条 manual_test idle 测试行会让门失效），且链路未建立期间卡片等于死代码，不如删干净；日后链路修复可从 git 历史整卡恢复。②「修链路保功能」——需 daemon 指回本机后端 + 各 workspace local.yaml 下发 platform token + daemon 常驻，为一个总览卡付出整条运维链路成本，用户已裁决不值得。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-change-detail-header-overflow
锚点：未记录
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b
理由：最大风险：PageHeader 被 41 个页面共用，min-w-0 理论上改变极端长内容页的既有视觉（原先溢出可见、现在可能截断）——但「溢出可见」本身就是缺陷态，且正常宽度内容不受影响；jsdom 单测锁定类名在场，Playwright 生产复测定格几何。 试过放弃的方案：仅在详情页 subtitle 外包一层 `overflow-hidden` 容器——放弃：治标（裁掉溢出但不恢复截断省略号语义），且不动组件会留下其余 40 个使用方的同型隐患。 另注：三断点纪律的①spec/②执行断点按会话自主模式跳过等待（用户为报障式请求、修复面两行 CSS、根因有生产实测锚定），③归档断点结果照常汇报。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-fr-review-batch
锚点：未记录
最近确认：bccffba0b0d15714673700b5743c33378eff8c06
理由：最大风险：子代理为凑数把不相关的测试绑上去（橡皮图章绑定）——防御：子代理指令明确「测试必须真实覆盖该 FR 行为，拿不准就报『无测试面』不动绑定」；evidence 必须是测试形态文件（CLI 强校验）；主会话抽查各域非 confirm 类裁决。次风险：内容修正误判（把仍准确的条目改错）——防御：仅在被当前代码证伪时最小修正，拿不准归「保留待人工」不碰。放弃的方案：①主会话单线程逐条处理 263 条——上下文与时长爆炸，放弃；②一次性九域全并行——波间无校验断点、失败面大，改为三波。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-quicklog-title-overflow
锚点：未记录
最近确认：e231b269b3b23711582a7b5e62f376be937624a6
理由：最大风险：fixed 布局下各定宽列（130/90/130/150/190/130）被严格执行，极窄视口下宽度不够的列内容改为溢出裁切而非撑宽表格——移动端另有独立页面（m/workspaces），本表仅桌面消费，风险面可控；jsdom 无法测表格布局，几何断言由部署后生产全单元格扫描承担（成功标准第 4 条）。 另注：三断点①②按会话自主模式跳过等待（用户报障式请求、根因有生产实测锚定、改动面三行），③归档结果照常汇报。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-29-jump-empty-turn-dup
锚点：未记录
最近确认：46e58f4b3a574fafdc1f01d3250f768b8a9654f1
理由：最大风险：把「日志在窗口外」误判为「零正文」导致内容永不加载——不会发生：判定基于本次 run_id 直达拉回的**全量** run 日志（该请求不受游标窗口限制），拉回有正文即照旧 prepend；仅拉回全空才标记。试过放弃的方案：①「turn 在 turnState 存在即视为已加载不再拉」——孤儿空壳（displayTurns 补建/翻页空壳）不在 turnState 或因陈旧闭包查不到，且壳轮的日志可能在已加载窗口之外、首点必须拉，存在性判定会弄丢首次加载机会；②「扩 loadedHasBody 判定条件」——治标不治本，陈旧闭包（deps 无 turnState）下二次点击依旧查不到首次 prepend 的轮。ref 标记不受闭包影响，是稳态判定。实证：stash 掉修复跑新用例红（expected 2 to be 1——二次点击重复直达），恢复后绿。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-29-issue-row-grid-misalign
锚点：未记录
最近确认：790c594bf0570259215b5c18178c481f6f856a22
理由：最大风险：占位 div 占据首轨 auto 宽度——空 div 无内容宽≈0，轨道宽 0，视觉零位移；对带 leading 调用零影响。放弃方案：改 ISSUE_ROW_GRID 为三轨模板/条件模板——两套模板分叉后 header/row 对齐约束翻倍，占位是同文件既有先例的最小修复。 另注：三断点①②按会话自主模式跳过等待（用户已给 DOM 级证据、根因有 Playwright 复现锚定、改动一行），③归档结果照常汇报。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-29-change-detail-timeline-files-polish
锚点：未记录
最近确认：5307276fa19543342bc4b11b9fe3f165f53ecf87
理由：最大风险：现有时间线卡测试断言行级 className（text-amber-700 醒目态）与 testid——重构 DOM 结构时须保住这两个锚点；jsonl 预览的 mime 不确定性（后端 guess_type 对 .jsonl 在不同平台可能返回 None/application/json/text-plain）已用三层兜底（EXT_MAP + JsonPreviewer 名字转发 + 解析失败回落纯文本）覆盖。 试过放弃的方案：直接复用 primer Timeline 组件做事件轴——放弃：其节点 h-7 + pb-5 行距是稀疏事件范式（GitHub 活动流），事件密集的留痕时间线用它会把卡片撑得更高，与「限高防撑爆」目标矛盾；只借其「节点+连线+tone」视觉语言自建紧凑行。另放弃在 openFullscreenPreview 里把 meta.name 换成中文名——下载文件会得到中文名文件，破坏本地对照能力。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-title-adopt-clobber-guard
锚点：未记录
最近确认：5da89fb8c48a2117e379b3d759cc72b19e1b33c4
理由：最大风险：兜底判定把「裸模板 H1 文本」也算兜底——若作者刻意把自定义标题写成恰命中 TEMPLATE_H1_RE 的纯类型词文案（如就叫「提案书」），其标题会被收养/重派生刷新掉。该口径与 normalize_display_title 既有判定同源，非新标准；真实碰撞面可忽略。放弃的方案：a) Change 加 title_source 标记列区分收养/派生来源——需 schema 变更且两文档路径都要改判定，收益不抵复杂度；b) 只守 documents 路径不守 reparse——审查实证 _apply_parsed 同样无条件覆盖，漏守即缺陷残留（test_apply_parsed_fallback_keeps_semantic_title 先红实证）。遗留（超出本变更）：documents H1 派生值超 500 字在 Postgres 仍会 DataError（documents 路径有 broad except 降级告警；reparse 路径会使该次扫描失败——预存行为，触发需 500+ 字 H1 的病态输入）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-assets-testfile-nodeid-anchor
锚点：未记录
最近确认：bac7255cc57ba16fe9efcb44032e435a0d4d508e
理由：最大风险：锚界符（::/#/>）误伤真实路径片段——若测试文件名本身含这些字符会被截短，但本仓测试文件命名无此形态，且截短后仍有 basename 同名搜索 + 唯一后缀救回兜底，最坏退化为多候选点选而非误报未找到。半角 ( 出现在合法文件名中（如 file(1).py），为降误伤面只剥全角（，半角不剥（本轮实证数据全部为全角）。试过放弃的方案：① 改 test-trace.json 存量数据剥锚——归档件是冻结审计件不可补（先例 2026-09-26 摘录保真坑同判）；② 收紧 CLI 书写约定禁止锚后粘注解——书写契约已由 binding-anchor-fidelity 落定且 CLI 侧已有单源剥锚，重定契约属设计反转，不采纳。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-change-file-cn-align
锚点：未记录
最近确认：d1e177421b7887da267d28e28f269b66169c6e6d
理由：最大风险：窄列（280px 文件树列 + 深层缩进）下中文名+原名同排可能溢出——已用外层 min-w-0+truncate、原名 shrink-0+truncate 双兜底（原名截断 hover 有 title 全路径）。放弃的方案：原名整体隐藏只显中文名——放弃：丢失「原名保留可对照」的 FR-03 语义。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-takeover-tier3-ambiguous-msg
锚点：未记录
最近确认：a9c4c690dd8402bdb7387669a6d182a4c1af88ab
理由：风险：机器名含 runtime.name 为空时回退 id 短码（文案仍可诊断）。死路：无——三种失败态各有明确指引。回滚=revert 单 commit（纯文案+details 字段，无 schema/协议面）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-takeover-handoff-any-location
锚点：未记录
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6
理由：测试：后端 test_takeover_handoff.py 增 openclaw 422「不支持会话」断言（6 用例绿）；前端 session-panel-takeover.test.tsx 增白名单过滤用例（7 用例绿）+ tsc/lint/mypy 零错。回滚=revert 单 commit（纯过滤与文案，无 schema 面）。死路：无。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-breadcrumb-dedupe-zh
锚点：未记录
最近确认：6a3bdf9684653bcbe9eae4eaf3b66dd76448d2eb
理由：最大风险：中文命名与用户心智不一致（如 changes 译「变更中心」而页签叫「变更」）——以侧边栏 menuLabel 为第一权威、页签 label 为工作区语境补充，两侧本来就有「变更中心/变更」粒度差，面包屑取菜单级「变更中心」与被删页内面包屑文案一致。试过放弃的方案：把动态 id 段也替换为业务名（changeKey/task_key）——需要 TopBar 拉工作区数据引入请求依赖，超出本次「去重复+中文化」范围，放弃；id 段维持现状原样显示。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-vitest-passwithnotests-rollback
锚点：未记录
最近确认：557497bae50851b1723c49d0f973a0a06f6dc744
理由：最大风险：若 sillyspec 修复未生效（CLI 未链接源码）而撤掉兜底会复现假红——已核实 npm ls -g sillyspec 指向 C:/Users/qinyi/IdeaProjects/sillyspec（npm link），且撤除前用原始失败面在修复后源码上复跑门禁函数确认全绿，风险已消除。试过放弃的方案：保留 passWithNoTests 作为双保险——放弃理由：它会掩盖未来真正错误的空收集（如过滤条件写错时 CI 静默通过），兜底价值低于语义保真。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-01-review-followup-reset-guard-machineid
锚点：未记录
最近确认：9f38792b6b354fb02d4e6b43d23726a68b1056e1
理由：最大风险：machine-id 收紧「非 uuid 形即覆写」可能误伤手工预置的非标准身份串（如有人手写短码）——但协议文档明约「纯文本 uuid（36 字符）」，非 uuid 形本就是损坏态，误伤面为零。试过但放弃：temp+rename 真·原子替换——两个并发写者各自 rename 仍是 last-write-wins，不解决本问题主矛盾（并发双生成漂移），反而多一次跨平台 rename 语义差异（Windows 目标被占用 EPERM）面；wx 独占创建 + 回读胜者用更小的面收敛同一目标。

## D-002@v1 实现方案=后端聚合 stats 端点 + 独立前端面板组件
状态：implemented
变更：2026-09-21-scan-docs-ops-panel
锚点：未记录
最近确认：e05d03fed
理由：用户方案选择题选定（2026-09-21）：新增 GET /workspaces/{ws}/scan-docs/stats（SCAN_DOCS_READ），四指标+榜单全部后端 SQL 聚合 + 解析库内 _module-map.yaml 行；前端独立 ScanDocsStatsPanel 组件（视觉对齐知识库 OpsDashboard）挂 scan-docs 页 PageHeader 之下，useQuery 消费。否决的替代：前端全量自算（口径散落、逐项目拉 yaml 详情请求多）、物化快照表（296 行量级过度设计）。
故障面：新增 DTO 触发 gen:types 类型链（api-types.ts + openapi.json 同步提交）。
退役判据：若扫描文档指标演进到需要跨工作区汇总或遥测实时推送，聚合端点形态重议（本决策只钉「口径在后端算」）。

## D-003@v1 注入频次遥测=docs-inject 行复用 knowledge-hits 通道（并入本变更）
状态：implemented
变更：2026-09-21-scan-docs-ops-panel
锚点：未记录
最近确认：e05d03fed
理由：CLI 在模块上下文注入点（prompt.js renderModuleContext 及 execute.js 孪生处）经既有 appendKnowledgeHit 追加 `{type:'docs-inject', change, query, matchedFiles:[docs 相对路径], at}` 行——复用 knowledge-hits.jsonl 通道而非新建文件：daemon 上行链路整 jsonl 原样转发零改动；平台 HitsService.ingest 对白名单外 type 宽容前向落库（hits.py:233「外型存原值」），且 USAGE_TYPES 白名单不含 docs-inject，不污染知识库统计。平台 stats 聚合读 type='docs-inject' 行做 30 天窗口指标与文档级频次榜。
故障面：跨仓交付（sillyspec CLI 独立发版节奏）——CLI 未升级环境永远空态；docs-inject 行量随 quick/execute 步骤注入频次增长（每步一行，量级=知识 inject 同款，可控）。
退役判据：若未来 docs 注入改为平台侧统一注入（不经 CLI），本遥测型随 CLI 注入下线一并退役。

## D-001@v1 repoPath 不出 daemon（本地路径隐私）
状态：implemented
变更：2026-09-20-scope-audit-cross-repo-platform
锚点：未记录
最近确认：42c464536
理由：不透传。daemon 投影白名单不含 repoPath——先例 ql-20260911-003-355a P2：daemon 原始消息含本机路径只进服务端结构化日志、不随 details 下发客户端。前端分组与展示用 repo key（sub-grid-security 等）足够；排查需要真实路径时看服务端日志或本机 CLI。

## D-002@v1 全链 additive 兼容，不加版本门禁
状态：implemented
变更：2026-09-20-scope-audit-cross-repo-platform
锚点：未记录
最近确认：42c464536
理由：三层各自缺省回退：daemon 侧 parsed.repos 非数组 → 投影 repos=null；backend 侧 result.repos 非法形态 → repos=[]；前端 repos 空/缺 → 走现状单段渲染（三态 chips 从 rows 统计）。不新增 sillyspec_capability_missing 类版本门禁错误——契约 v2 是 additive，旧 CLI 输出仍合法 v1。

## D-005@v1 实现方案选 A——全链投影 + 按仓分段
状态：implemented
变更：2026-09-20-scope-audit-cross-repo-platform
锚点：未记录
最近确认：42c464536
理由：方案A。daemon 投影行级 cross_repo + 信封 repos[]（每仓锚点/三态计数/降级），backend schema 全量透传 + gen:types，前端卡面按仓分段 + 明细按仓分节 + note 顶摘要层。理由：任务书验收「主仓段+各跨仓段真实三态与锚点档」只有 A 同时具备行级仓归属（明细分组/单文件 diff 联动判仓）与信封级汇总（卡面分段计数单一源）；B 缺行级仓归属致明细层不可按仓分组；C 不满足已确认的按仓分类展示诉求。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-02-title-norm-thin-h1-family
锚点：未记录
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27
理由：最大风险：误伤面——若某作者自定义标题恰为「设计记录」「任务注册表」等裸类型词（无冒号/无后续内容），会被当模板回退语义名。该风险与既有词表条目（「设计」「任务」等更短的词）同级且更小（新词更长更具体），既有测试锚定冒号自定义标题保留不受影响。遗留：已归档变更不再有 documents 推送，其存量污染 title 行不会自动刷新（新变更与活跃变更自愈）；如需清洗可后续做一次性 reparse/修数，不在本变更范围。放弃的方案：在 documents 推送侧按文件名（tasks.md/design.md）硬判模板而不看 H1 内容——放弃理由：会废掉「自定义 H1 覆盖收养标题」的改名通道（tasks.md 写自定义 H1 是合法改名路径，有既有测试锚定）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-03-usage-ingest-session-concurrency
锚点：未记录
最近确认：bf325fda515865d118734dc1bfa6fa47233bd067
理由：最大风险：串行定位段拉长任务总时长——上限 50 entry × 每次 3-4 个本地查询， 毫秒级/条，远小于 RPC 段本身（30s 预算/条），可忽略；若 daemon 全离线， 定位仍逐条走完（每条查询+404 抛出），属既有降级路径的既有代价。 放弃方案：① 任务内自开 session（identity map 跨 session 改写复杂，见槽1）； ② 定位整体改为候选筛选时一次性批量 JOIN 查询——需改动 router 共享函数 `_resolve_agent_log_read_target`，牵连 content/messages 两端点，超出本缺陷 修复范围。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-03-local-usage-caliber-fix
锚点：未记录
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305
理由：最大风险：口径切换期新旧快照并存（存量未重摄的旧口径行 input 偏大、命中率偏低）——活跃变更下次上报自动收敛，死日志不重算可接受（展示偏高不丢数）。放弃的方案：展示层按数据源分公式（本地 CLI 用 cache_read/input、平台用现行公式）——两口径数字混一张表仍费解、公式分叉扩散到三处组件；落库归一一处收敛全部下游，且与平台列语义同构。次要风险：invocations 与 api_requests 语义近似（CLI 留底计数 vs API 调用）非严格同义，注脚已声明。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-03-usage-backfill-script
锚点：未记录
最近确认：373239040c2899e288f1f904584ad692584aa2c7
理由：最大风险：daemon 离线导致大面积跳过（回填不完整）——设计为可重跑补齐，且每条独立降级不影响其他；历史日志文件已被用户清理的条目 RPC not_found 跳过（诚实缺数）。放弃的方案：写进 alembic 迁移自动跑——链内破坏性/外部依赖（RPC）不可入迁移（reset 脚本先例同裁决）；逐条即时 commit——无必要（幂等覆盖写无中间态语义）。

## D-001@v1 本地用量归属 = 水位差分片段（方案 2）
状态：implemented
变更：2026-10-03-local-usage-segment-attribution
锚点：未记录
最近确认：ba6e699c8
理由：方案 ②（用户 AskUserQuestion 拍板「方案 2」）。协议：每次 agent-logs 上报插一行「水位」记录（上报时刻的 ctx + 当行已落库累计五值：invocations/四维 token）；某变更的本地用量 = 该 ctx 水位与下一水位（或 entry 当前快照）的差分之和。否决 ①（把偏差换个方向：后干的工作量记到先变更）、③（跨变更连续工作是常态，持续失真不可接受——本会话实证 caliber-fix 的量被 backfill 抢走）。
故障面：水位插入与摄取异步竞态（水位取的是「当时已落库值」，摄取稍后刷新——差分仍正确，见 D-002 时序推演）；水位表无界增长（见 D-003 修剪）
退役判据：若未来 CLI 协议升级为逐调用上报（含实时 ctx），水位差分可整体下线换直记

## D-002@v2 水位语义补精度边界（Grill X1 修正，supersedes D-002@v1 的一条断言）
状态：implemented
变更：2026-10-03-local-usage-segment-attribution
锚点：未记录
最近确认：ba6e699c8
理由：恒成立的是**总量守恒**（mark 单调序列 telescoping 可证）；「A 尾巴归 A」仅在尾巴摄取先于 B 上报落库时成立——滞后窗口内跨界 token 归后继变更（错归方向声明：后继多计/前驱少计），窗口=一次摄取延迟。invocations 同步值无此问题。D-002@v1 其余语义不变。
supersedes：D-002@v1

## D-004@v1 首水位锚定 = 差分序列隐式起点 0（Grill X2 P0 修正）
状态：implemented
变更：2026-10-03-local-usage-segment-attribution
锚点：未记录
最近确认：ba6e699c8
理由：每 entry 差分序列隐式起点 0：首水位 ctx 认领 [0, mark_first)。存量迁移语义=与改造前整行归属同值同主（重推 ctx 即当时 ctx）；新文件 mark_first=0 无影响。实现为聚合侧规则（无需插锚定行）。
故障面：首水位 ctx 认领基线——若存量真实归属与重推 ctx 不同（历史换主场景），基线记给重推 ctx（与改造前整行路径行为一致，不劣化）；修剪若未豁免首水位则基线转移（已由 D-003@v2 堵死）
退役判据：若 CLI 协议升级为逐调用实时上报（带 ctx），差分协议与锚定整体下线

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-04-knowledge-touch-plain-title
锚点：未记录
最近确认：a8d3ad5b8d85a1f303de3d358cfb010d938c7f13
理由：最大风险：文案改写后与知识库 FR 条目语义漂移（FR-auto-frontend-093 引用旧标签）——已同步最小修正该条目并 validate 通过规避。试过但放弃：①把两态口径差异做成可见副标题——放弃，机制细节对普通用户是噪音，用户诉求就是"说人话"；②顺带改写空态引导文案——放弃，超范围（其行为未变，FR 语义仍准确）；③起全栈环境渲染实页截图——放弃，纯字符串替换无布局/样式变化，组件测试断言即证据面（先例 2026-09-27-assets-testfile-bracket-note 同口径）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-04-takeover-tier3-agent-cwd-fallback
锚点：未记录
最近确认：38dac6640ba5963b70f788745959497d6b97c050
理由：最大风险：回退扩大 tier3 命中面后，若两台在线机器白名单都覆盖该 agent_cwd，会从「409 无匹配」变成「409 歧义（列候选机器名）」——不静默换机的红线不变，只是拒因更准；真歧义时用户按文案清理白名单即可。试过放弃的方案：建桶/刷新时把 agent_cwd 回写会话行 cwd——只对未来上报生效，存量会话（如线上 7ea5177a，已不会再被旧 CLI 重推）救不了，且给 ingest 增加一条写路径；协议 §4 的口径本就是 entry 级匹配，故弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-04-handoff-doc-kind-contract
锚点：未记录
最近确认：5d86f73b2cfc02a803dc079a4d0daaddbb85bc94
理由：最大风险：regex 兜底从截断 JSON 提取 path 时，若 path 类键值本身被 2KB 截断切断会取出半截路径进「涉及文件」节（展示性瑕疵，不参与任何匹配/写库）。试过放弃的方案：改 daemon 侧让 tool_input 直接下发结构化 path 字段——要动 RPC 契约 + 老 daemon 兼容窗口 + 前端同步，代价远超收益；JSON 字符串解析在 backend 侧做即可闭环，故弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-04-handoff-op-detail
锚点：未记录
最近确认：0479804512b435b4129e8eacb2b5768802f9c1ac
理由：最大风险：regex 兜底从截断 JSON 取 command 时，命令值本身被 2KB 截断切断会得到半截命令进操作行（展示性，同上一变更已披露的半截路径边界；不参与匹配/写库）。120 字符截断已把该噪声压到一行内。试过放弃的方案：操作行带完整 tool_input JSON——2KB/条的原始入参让 8 行操作节膨胀到淹没对话节，且大量与涉及文件节重复；摘要（单字段值）信息密度/噪声比最优，故弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-05-litellm-crashloop-quarantine
锚点：未记录
最近确认：0d419ddad3523713b28806579fb28b198ae920dc
理由：最大风险=恢复路径被遗忘：2026-10-05 本地矩阵已证伪「选新 tag」路线（无可 pin 的 「健康镜像 + gap-A」组合），分叉（①等上游修复版 / ②自研薄适配层退役 litellm）拍板后 的专门变更若漏处理两处 profiles 行——分叉①下 litellm 不随默认栈拉起，表象是 OpenAI 型 供应商经 litellm 的链路静默缺失（该链路当前尚未启用，短期无感，正因此更易被遗忘）。 缓解：compose 两处注释与坑文档 2026-10-05 隔离加固段三处互指「恢复/退役=专门变更处理 profiles 行」，且坑文档保持 docs/sillyspec/ 活跃区跟踪至分叉拍板与移除闭环。 试过但放弃的方案：① 注释掉整个服务块——配置失去可见性、恢复 diff 噪音大；② `restart: no` ——`up -d` 仍会拉起坏镜像执行一次 127 崩溃（低配机白拉镜像层），且违背 NFR-03 的 always 语义、恢复时易忘改回；③ 依赖「服务器已手动 stop + 注释提醒」——已被 2026-10-04 实践证伪： stop 状态挡不住下一次 `up -d`（这正是本变更的动因）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-05-promo-film-page
锚点：未记录
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7
理由：最大风险：Canvas 中文排版与不同操作系统字体栈差异导致观感不一致——用系统中文栈（PingFang SC/微软雅黑/Noto Sans SC）+ 关键标题走 canvas measureText 动态布局兜底，避免外链字体（保 FR-01 零依赖）。 次要风险：低端机粒子量过大掉帧——粒子数与屏幕像素解耦（按 1920×1080 逻辑坐标设计，数量固定上限），主循环只做一次 clear+draw，无离屏抖动。 放弃的方案：①嵌入真实视频文件（webm）——违背「纯代码拍片」参考思路且体积失控，弃；②用 Three.js/WebGL 做三维粒子——CDN 依赖违背 FR-01，手写 WebGL 工程量与收益不成比，2D Canvas 已够表达本片视觉，弃；③接平台前端做 Next.js 页面——宣传物料应独立分发（发别人看/挂静态托管），绑进应用反而要求起服务，弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-05-promo-film-v2
锚点：未记录
最近确认：7da35f4cb7be766ec46365637cb77fc11bbe2df5
理由：最大风险：①截图内含真实业务信息（内网 Git 地址、成员姓名）——已按用户提供的环境授权采集，影片内嵌说明「界面来自真实运行中的 SillyHub」；如需脱敏版后续可换资产重跑。②28 张图约 3.5MB，首帧前需预解码——用「首屏渐进 + 按幕预取」策略（当前幕及下一幕图片优先解码），海报页停留期预热全部资产，点击播放时资源已就绪。③5 分钟单页 rAF 长跑内存——所有节点按幕创建/销毁，无无限增长的 livePads/定时器（音乐节点按小节自带终止）。 放弃的方案：①录屏视频嵌入（webm）——体积失控且违背纯代码拍片思路；②iframe 嵌线上环境实况——需要账号态且播放不可控（seek 无法重现），改为确定性截图 + 标注动画；③继续 v1 引擎修补——shadowBlur 散布各幕，修不干净，重写引擎成本低于维护。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-05-remove-promo-film
锚点：未记录
最近确认：5eb9b1dd74e57562ae64dee99adcbca21e1844d8
理由：最大风险是误删仍需要的文件——已核对 docs/promo 全部 31 个文件均由本会话生成（v1 变更与 v2 变更的交付物，无第三方内容），且 git 历史可完整恢复（git revert 6b6c18fc9）。放弃的方案：只删 v2 保留 v1——用户语义「生成的我不需要」覆盖两版，全删。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-06-opencode-go-direct-anthropic
锚点：未记录
最近确认：135a0d3a6dcbac6ce10d8c38c6882af5401d6515
理由：最大风险：opencode go 端点行为是实测口径（仅认 x-api-key、识别 Claude Code 原生 session 头、全模型可经 /v1/messages 路由），上游未来变更口径（如强制专有 session 头、收敛 /v1/messages 模型面）会使直连失效——缓解：平台探活（GET /zen/go/v1/models）与每次会话请求会立即暴露，届时按报错口径再调整，且此形态与 cc-switch 生态用户同型，上游破坏面大、概率低。放弃的方案：① 修 litellm 换 tag 复活 openai_chat 链——2026-10-05 本地矩阵已证伪无可 pin tag（两个 v1.95.x 变体坏构建、1.96+ anthropic adapter 不认 mode=chat 恒打上游 /responses）；② 注入 x-opencode-session 自定义头——实测 Claude Code 原生 session 头已被识别（官方文档明示 + 真机验证），无需加复杂度；③ opencode_zen_openai 预设（zen 计费）也切直连——该 key 无 zen 余额（实测 Insufficient account funds），且 zen 端点 anthropic 面未验证，留待 litellm 分叉拍板一并处置。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-06-litellm-log-rotation
锚点：未记录
最近确认：6a3bd3113b5d405935f3b2de2a54e8c30c9815ba
理由：最大风险：轮转上限过小导致 crash-loop 排障时关键 traceback 被截丢——取 10m×3=30m 兼顾低配磁盘与排障留存（该服务已设 PYTHONUNBUFFERED=1，崩溃 traceback 即时 flush，单份 10m 足够装下完整崩溃记录）。试过但放弃的方案：①宿主 daemon.json 全局默认轮转——动服务器系统状态、影响所有容器，超出本仓变更面；②全服务统一 logging——核心服务日志保留策略变化未评估，扩大行为面，留待专门变更。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-06-opencode-session-send-incident
锚点：未记录
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6
理由：最大风险：①HTTPS_PROXY 绑定 daemon 本机代理端口（127.0.0.1:7897）——换机器/换端口失效，属环境耦合（notes 已注明，探活与会话报错即时暴露）；②上游网络环境变化（劫持消失/代理下线）时该 env 变冗余但无害（代理拒连才会断，可再清）。放弃的方案：①把 isToolReportBody 判定内联进 handleSend（session?.origin === ...）——治标不治本，渲染区 6 处消费点仍需变量，双源漂移；②在 llm-proxy（hub 服务器侧转发）承载 opencode 流量借服务器干净网络——那是 openai_chat 的 LiteLLM 路径，anthropic 直连形态无此通道，为绕网络劫持重开转换网关属方向性倒退（litellm 分叉仍未拍板）；③给 daemon 全局配代理——影响所有供应商（国内上游走代理反而劣化），per-provider extra_env 是正确粒度。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-06-opencode-settings-config-poison
锚点：未记录
最近确认：18205e82742eba62c020a512efc29e2df21fc718
理由：最大风险：清 NULL 后丢失的 enabledPlugins/skipDangerousModePermissionPrompt/model=fable 等键原本是否被用户依赖——判定不依赖：这些键来自 openai_chat 时代/导入残留，与 anthropic 直连链路冲突且正是本次故障根因，属毒数据（若用户后续要插件开关，前端表单可重配）。放弃的方案：①保留 settings_config 仅删 env 子键——保留的 model=fable 仍会改 claude settings.json 行为且其余键语义未审计，不如整清干净；②代码层加「settings_config.env 含 ANTHROPIC_BASE_URL 时告警」防护——属产品设计面（规则 7 的优先级是有意设计），超出本事故修复范围，坑文档留教训即可。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-provider-agent-kinds-followup
锚点：未记录
最近确认：fcefa0890fbce6927826cf9e1fff813f0ed642e9
理由：最大风险：FR-01 修复后 `agent_kinds` 键出现在所有编辑提交 body 里，既有表单/apiformat 测试若存在对 PATCH body 的全量精确匹配断言（toEqual）会因新增键挂掉——处置：跑定向测试，按新契约补断言键（补字段属契约演进，非改测试凑绿）。试过放弃：①schema 层禁 null（`agent_kinds: list[...]` 去掉 `| None`）——把契约上合法的显式 null 变成 422，第三方调用方行为被动变化，且与同 DTO 其它 nullable 字段风格不一致；②前端映射器发 `agent_kinds: v.agent_kinds ?? null`——引入 null 与缺省两种「不动」歧义表达，无收益。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-hide-quicklog-tab
锚点：未记录
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d
理由：最大风险是既有测试对「点击 tab 进入」路径的依赖（桌面 2 个用例、移动端 12 处点击 + 2 处断言）——逐一改为 `?tab=quicklog` URL 初始化进入，并为隐藏补缺席断言。放弃的方案：a) 彻底删除 quicklog 视图与后端接口（存量历史数据失去唯一入口、牵动面数倍于收益）；b) CSS/条件 className 隐藏 tab 按钮（留下永假分支死代码，违反仓库一致性规则）。两者均未采用。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-spec-sync-task-reparse
锚点：未记录
最近确认：f82bc067ca74946ac7c6b88d4e6382e54e6c665c
理由：最大风险：archive_hit 全量路径下对大 workspace 逐变更 reparse 的耗时——已在后台任务里（不阻塞同步响应）且全量路径仅归档移动触发（罕见）；后续可按 location 过滤收窄。试过放弃：在 apply_ops 落盘循环里逐 op 触发——绕过调度器会复活 ql-20260909-021 修掉的风暴；放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-taskboard-tasks-md
锚点：未记录
最近确认：fbf4ae2753b9bbf2a14d929ecd2c900b533d6100
理由：最大风险：thin 行 status 只有 draft/done 两态（看板中段列空）——勾选态是 tasks.md 唯一信号，不造无据状态；后续要更细可由 status 映射规则扩展。试过放弃：把注册表行也建成卡片式富结构（priority/owner 从行文猜测）——无据造数；放弃，只取确定字段。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-ci-failures-sweep
锚点：未记录
最近确认：4a538caa395a449c33567c50bf18c219b65a4466
理由：最大风险：test_files_router 若未来 fixture 只剩归档 change，next(... location=="active") 会 StopIteration——但两活跃 change 是 fixture 固定资产，风险极低。试过放弃：为 FR-04 新增 takeover 端点归档 409 端到端用例——放弃，takeover 前置校验链（原机四级钉定/provider 行解析）夹具过重，且其写入口经 create 链已被 test_session_create_on_archived_returns_409 的 ensure_writable 守卫用例覆盖，加重复用例只增脆弱面。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-ci-sweep-jsonl-mock
锚点：未记录
最近确认：768a88a694fddfb36095ef1ec42e795e77a6e582
理由：最大风险：桶文件未来再加导出时本 mock 再度漏补（结构性重复成本）——已有注释约定承担提示职责，暂不引入 importOriginal 部分 mock（会放弃「断言降级目标桩」的精确控制，且与既有 10 桩风格不一致）。放弃方案：改用 vi.mock(importOriginal) 展开真实导出——放弃，枚举桩正是该套件断言 DS 降级路径的手段，混入真实组件会引入无关渲染依赖。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-ci-sweep-focus-visible-flake
锚点：未记录
最近确认：1cfe595a0aff8295da85267a43a4b3738a775b6e
理由：最大风险：文件内某用例未来若断言计算样式（如尺寸/颜色）会拿到空值——当前 19 用例均只断言行为与 DOM 结构，无此面；注释已声明约束。放弃方案：vitest 全局 retry 掩盖——放弃，会掩盖全仓真实回归；只 retry 本用例——放弃，治标不治本且每次重跑仍烧 CI 时间，stub 一次根治。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-assets-patch-scope-audit-fallback
锚点：未记录
最近确认：ce08f8ae7194bd05be50f99933721dba33023d29
理由：最大风险：file_list 语义按通道不同——change-patch.json 的 files 数组含 .sillyspec/ 规格工件，scope-audit.json 的 rows 只含对账表行。展示口径随之不同（各自的真实冻结 面），可接受；未来若要求统一需 CLI 侧统一留痕（第 3 层根治）。试过但放弃：在 assets 层实时重算 git diff 补数——引入实时窗口漂移，违背「归档留档冻结在收尾时点」 的既有语义。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-provider-update-models-none-guard
锚点：未记录
最近确认：87e292759e4934ec73c9c92152c38de97610509e
理由：最大风险：防护误伤「显式清空/替换列表」语义——已排除：清空应传 `[]`（非 None），防护只拦 None，回归用例内双断言钉死。放弃的方案：schema 层 validator 拒收 models=None——会使 openapi anyOf null 契约与字段注释「None=不动」双双失真，且与 api_key/agent_kinds 既有 None-pop 惯例不一致，不采用。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-dockerfile-apt-mirror-sjtu
锚点：未记录
最近确认：d304aefe57ac5e79cc74c094f21d1760d3e5ac5f
理由：最大风险：sjtu 源将来同样故障/限速（镜像站轮流抽风的先例：aliyun 2026-07-17、tuna 2026-10-08）——已在 Dockerfile 注释里留下完整的换源史与实测数据，下次故障按同模式 5 分钟内可再换。放弃的方案：① 原样重试（已试，两次死同层，tuna 服务端故障非瞬时抖动）；② 换 aliyun/ustc/huawei/http 官方源/deb.debian.org（实测同慢 ≈80KB/s，9.6MB 索引在 apt 超时内下不完）；③ 走本机 Clash 代理（7897 实测 2MB/33s 无改善）；④ 增大 apt 重试次数（传输中断形态重试无效，且要改同一行不如换源）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-sessions-menu-permissions
锚点：未记录
最近确认：086033da03918b7d38e93ce425e9e555073e43e6
理由：最大风险：可见性放宽面超预期（如某些仅持 runtime:admin 的运维角色会新增看到会话菜单）——评估为可接受，因为页面本就是这些权限的主消费面，且菜单可见≠数据可见（会话列表后端仍按 user_id 隔离、写操作仍按权限矩阵）。次要风险：runtime:admin 同时挂在 runtimes 菜单（config 组「守护进程运行时管理」）与 sessions 菜单（名不同：守护进程机器查看），勾选器两卡控制同一 key、计数联动——change:approve 双卡先例同形态，非新问题。 试过但放弃的方案：① 后端新增 agent_session:* 细分权限族（create/update/delete…）替代 task:run_agent——放弃：动鉴权矩阵影响全部 daemon 端点与既有角色，远超「菜单补齐」诉求；② 勾选器增加「未挂菜单权限」兜底桶——放弃：改组件语义面大，且把权限挂到正确的菜单卡片本身就是本来的建模意图。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-sync-sillyspec-skills-3320
锚点：未记录
最近确认：e3a4222dcee84c1281d5e7414b11b1908724cf69
理由：最大风险：`sillyspec init` 附带刷新命令卡/指引等非技能面（v3.29.3→3.32.0 间的教学面变化），diff 面比预期大——处置：跑完后逐文件审 `git status`/`git diff`，实际改动面为「技能 + AGENTS.md 版本行 + 命令卡 + .gitignore 行尾抖动（已还原）」，无意外面。放弃方案：手写脚本只拷技能目录——放弃理由：绕开 CLI 幂等注入逻辑，AGENTS.md 版本段与命令卡仍会落后，且失去历史惯例的一致性；docker 镜像内直接改——放弃理由：镜像重建即丢，仓库才是唯一源。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-menu-permissions-page-audit
锚点：未记录
最近确认：efb2d687031517958ef5e09ff49c697137b6363f
理由：最大风险：可见性放宽面（workspace:read 持有者见组件菜单等）——评估可接受，这些用户对页面真实可用，且菜单可见≠数据可见（端点仍按鉴权矩阵）。次要：audit 卡保留零消费的 platform:audit:read 可能继续误导——保留理由是不删存量 key（存量角色已勾配置依赖它维持可见），其死目录属性在代码注释中言明。 试过但放弃的方案：① 移除各卡上零消费的既有 key（component:read / platform:audit:read / task:approve）——放弃：会让这些 key 在勾选器不可配（彻底死掉），且存量角色可见性可能缩；本变更聚焦补齐而非清理，死目录清理应走独立变更评审。② 后端把 component:read 接进列表端点鉴权——放弃：动后端鉴权影响存量角色（developer 只有 workspace:read+task:run_agent，会 403），远超本变更诉求。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-node22-for-sillyspec332
锚点：未记录
最近确认：f7eeb237e90fa48bd4da92409503176dd6ef99a4
理由：最大风险：node:22-slim 与既有层交互（如 npm 路径结构变化致 ln -sf 失效）——node 官方镜像 npm-cli.js 路径多年稳定，构建本身即验证（失败即暴露，本次实跑通过）。放弃方案：①回退 SILLYSPEC_VERSION pin 到 3.29.x（Node 20 可跑）——放弃理由：技能包已 3.32.0，CLI 落后会再次制造本次要修的「指引与技能不配套」，且 node:sqlite 是 DB 引擎长期依赖，绕不过；②容器内热修 npm install（不进镜像）——放弃理由：容器重建即丢，违反镜像即真相。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-skills-follow-cli
锚点：未记录
最近确认：c1970cd37f0338f3a3b122bf3638e649e515f18f
理由：最大风险：sillyspec 未来版本改包内目录布局（`.claude/skills` 移位）→ COPY 构建期失败（fail-closed 可见，非运行期暗病）；其次 npm latest 引入破坏性变更直进生产（无 pin 缓冲）——缓解：build-and-save.sh 回显版本留痕、backup tag + .env pin 双回滚口，且 sillyspec 是用户自研工具、发布节奏自控。放弃方案：①保留仓库快照源 + 定期 init 刷新——放弃理由：自动化仍靠人记着做，正是本次要消灭的错位根源；②容器启动时 runtime npm install 拉最新——放弃理由：启动时延+网络依赖+镜像内容不确定（同 tag 不同行为），破坏回滚语义；③CI 定时重建——放弃理由：当前无 CI 部署链，超出本变更面。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-rbac-dead-permissions-cleanup
锚点：未记录
最近确认：765f4e7b684aa63c7d98653aa6b3e89af1057321
理由：最大风险：线上（crrcdt）存量角色持有死键的行被删——零功能影响（无端点消费），角色列表显示权限数变少属预期收敛；PPM 角色不涉任何删除键（PPM 18 键全保留）。次要风险：种子迁移编辑只影响新环境（已应用环境不重跑），存量靠清理迁移收敛，两路径已在 ppm-permission-simplify 先例验证。 试过但放弃的方案：① 给 code:* / tool:* 接消费端点（代码评审流 / 工具 RBAC 门控）——放弃：属新功能立项不是清理，且会话 canUseTool 审批已是现行机制；② 只隐藏不删（卡片摘掉、枚举保留）——放弃：枚举残留仍进 OpenAPI 契约与角色校验域，"配了没用"的混乱只是换个形态；③ 顺带删 PermissionGroup（后端零消费）——放弃：与权限键删除耦合扩散测试面，留待独立清理。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-image-slim-no-claude
锚点：未记录
最近确认：55ea8ab01ec9a279e1210a8b4423eec60a50a642
理由：最大风险：证据面有盲区——若存在 grep 未覆盖的运行时 claude/node 依赖（如未来新代码 spawn），容器将直接 FileNotFoundError。缓解：唯二 exec 点已逐行核实为 git；diff_collector 的 FileNotFoundError 分支本就按零 diff 降级不炸；变更后本地重建全链路验证 + 服务器部署后复验。放弃方案：①保留 node 只删 claude——放弃理由：node+npm+node_modules 占大头（claude 二进制本身不大，大头是其 node_modules），半删收益减半且留「半个遗物」心智负担；②只注释不删除（防御性保留）——放弃理由：镜像层一旦保留就会被后人当成可用能力写代码，遗物越藏越深；③compose 保留 claude-data 挂载以防万一——放弃理由：卷挂载会遮盖 /app/.claude 目录语义，与「容器内无 claude」的新事实矛盾。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-deploy-script-version-echo-msys
锚点：未记录
最近确认：45240ef8baaa17b5f1cb4c03bc262ee0a4244a9e
理由：风险极低（一行 shell）；放弃方案：MSYS_NO_PATHCONV=1 前缀——放弃理由：需按平台条件设置，比 sh -c 包裹更绕且仅 Git Bash 语义。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-turn-nav-hover-mark
锚点：未记录
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916
理由：最大风险：指向 ring 与浮层行既有 `hover:bg-muted/50` 底色叠加的视觉密度——选择仅 ring 描边不加底色，二者正交叠加不糊（token 均为主题语义阶，随 data-theme 换肤）。放弃方案：①指向行加底色（与 active 行 `bg-muted/60` 底色同型，视觉冲突辨识度差）；②刻度上挂原生 title/tooltip 显示轮号（>60 轮密集态刻度仅 6px 高命中差，且不满足「浮层卡片标记指向轮」的需求本体）；③浮层行高亮直接复用 active 同款样式（「我在指」与「聊天停在哪」两语义混同，正是本 bug 的认知混淆点）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-restart-fake-failed
锚点：未记录
最近确认：89a7e9a42c4d0438ccccf1c85a4297cf19d04226
理由：最大风险：宽限窗选小了误杀仍发生（长安静期轮被复扫判死）——但此时 FR-02 兜底回正，最坏 结果是徽标先失败后自动变回完成；窗选大了 daemon 真死时 UI 多挂一会儿"运行中"（10 分钟上 限，可接受）。放弃的方案：(a) 启动清理时探测 daemon WS 在线状态——backend 重启瞬间 daemon 往往尚未重连（实证重启后 41 秒才恢复上报），启动时点探测必假阴性，且"daemon 在线" ≠"该轮还在跑"，信号弱于日志 recency；(b) 迟到结果一律允许重放终态——会破坏既有幂等语义 （失败轮被重复 result 触发重复 auto-recover/事件），风险面大，收窄到误杀标记+成功这一种 组合。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-ci-sweep-2
锚点：未记录
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b
理由：最大风险：正则锚未来再随 schema 形态演化漂移——防哑绿抛错语义保留（失配即响亮失败），漂移会被即时暴露而非静默通过。放弃方案：回退四处生产变更让测试通过——放弃，均有变更档案/评审留痕的有意行为，回退等于推翻已验收功能；改用运行时 import 跨语言读词表——放弃，TS 无法 import Python 源，源文件读取式解析即先例形态。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-ci-sweep-2-migration-anchor
锚点：未记录
最近确认：efb85fc566889705e304026f05380aacc58d77b2
理由：最大风险：并行会话持续加迁移导致锚反复红——结构性成本已由约定承担（每次新迁移随动一行），改用「断言单 head + 链尾 ≥ 某版本」弱断言会失去精确锚定防分叉价值，放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-shared-assertion-surfaces
锚点：未记录
最近确认：e7787cadba68c5b51b50c7aaf6c461a4caac849c
理由：最大风险：清单自身腐化（新增共享断言面不登记、钉子测试移动不更新条目）——缓解：条目末尾写明「新面按同款登记」的口径，且知识条目进 distill 链可被后续 knowledge 命令校验。放弃方案：CI 内自动扫描钉子断言生成清单（AST/grep 解析 toHaveLength/toEqual 钉子反查契约）——跨语言三端解析成本高且误报难消，先人工登记验证命中价值再谈自动化。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-stale-recheck-scope
锚点：未记录
最近确认：ef3fca11264f031c7ef95c05eb7da475e76cbb81
理由：最大风险：daemon 活性门放过的「在线 daemon + 永久静默轮」会一直被追踪不判死——有意取舍（对齐 patrol 判死段语义：在线 daemon 的轮不判死，归属用户取消/会话超时面）；若需硬上限可后续迭代加最长追踪时长。次风险：`_run_daemon_alive` 的 lease 倒序首见语义在 lease 频繁重建时可能解析到无 runtime_id 的新 pending lease 而返回 None——None 走 recency 判死，方向与原实现一致不放大。试过放弃：(a) 复扫判死面保持全局仅加活性门——放弃，启动后新开轮每 10 分钟进判死面本身就是审查实证缺陷源；(b) 循环异常无限重试——放弃，持久故障下无限日志噪音且违背有界退避要求。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-frontend-risk-fixes
锚点：未记录
最近确认：9f996f692b6c018f7db14109def4af2e137fb1e5
理由：最大风险：overview 等待最长 200s——期间 UI 无中间反馈（react-query isLoading 态），用户可能重复刷新；属既有 UX 债非本变更引入，后续可加进度提示。次风险：copyText 去掉可选链后，jsdom/旧浏览器上 clipboard 缺失路径从「静默 no-op」变为「失败提示」——全文路径复制（fulltext-link）调用方仍忽略返回值静默降级（本体是可见文本），锚点复制从假成功变真失败提示，方向正确。试过放弃：(a) 渲染级测试钉 onPointerDown 置位——放弃，jsdom 无 canvas 2D 上下文，rAF 循环 effect 早退不可观测，改为提取 shouldAutoRefit 纯函数 + 双源置位一行接线（仓库 graph-canvas.test 纯函数惯例）；(b) 后端并发化 overview 三 RPC 缩短总预算——放弃，RPC 客户端并发安全性未证且超出本变更（前端风险收口）范围。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-msys-fonts-guard
锚点：未记录
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b
理由：最大风险：无自动化测试钉住脚本行为（运维脚本无测试面），守卫正确性靠 bash -n + 与同文件既有守卫形态的目视一致性；真实解包验证留待下次字体恢复实操（容器重建后场景）。文档整文拷贝的风险是若 .zcode 版自身有误则三副本同错——但 .zcode 版是 85c8704a7 变更同步过的现行真相，方向上优于两份 2026-08-13 旧版。试过放弃：(a) 在脚本头部统一 export MSYS_NO_PATHCONV=1——放弃，作用域大于必要（会影响脚本内一切命令的路径转换，包括可能的宿主路径场景），同文件既有惯例是逐命令前缀；(b) 只更新漂移段落——放弃，逐段手改引入转录风险且不可 diff -q 验证。
