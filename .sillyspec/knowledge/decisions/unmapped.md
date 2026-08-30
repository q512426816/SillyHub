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
