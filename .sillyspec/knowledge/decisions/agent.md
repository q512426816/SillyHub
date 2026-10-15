# 决策知识 — agent

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

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

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-restart-fake-failed
锚点：未记录
最近确认：89a7e9a42c4d0438ccccf1c85a4297cf19d04226
理由：最大风险：宽限窗选小了误杀仍发生（长安静期轮被复扫判死）——但此时 FR-02 兜底回正，最坏 结果是徽标先失败后自动变回完成；窗选大了 daemon 真死时 UI 多挂一会儿"运行中"（10 分钟上 限，可接受）。放弃的方案：(a) 启动清理时探测 daemon WS 在线状态——backend 重启瞬间 daemon 往往尚未重连（实证重启后 41 秒才恢复上报），启动时点探测必假阴性，且"daemon 在线" ≠"该轮还在跑"，信号弱于日志 recency；(b) 迟到结果一律允许重放终态——会破坏既有幂等语义 （失败轮被重复 result 触发重复 auto-recover/事件），风险面大，收窄到误杀标记+成功这一种 组合。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-stale-recheck-scope
锚点：未记录
最近确认：ef3fca11264f031c7ef95c05eb7da475e76cbb81
理由：最大风险：daemon 活性门放过的「在线 daemon + 永久静默轮」会一直被追踪不判死——有意取舍（对齐 patrol 判死段语义：在线 daemon 的轮不判死，归属用户取消/会话超时面）；若需硬上限可后续迭代加最长追踪时长。次风险：`_run_daemon_alive` 的 lease 倒序首见语义在 lease 频繁重建时可能解析到无 runtime_id 的新 pending lease 而返回 None——None 走 recency 判死，方向与原实现一致不放大。试过放弃：(a) 复扫判死面保持全局仅加活性门——放弃，启动后新开轮每 10 分钟进判死面本身就是审查实证缺陷源；(b) 循环异常无限重试——放弃，持久故障下无限日志噪音且违背有界退避要求。

## D-001@v1 借用沙箱感知深度 = 元信息 + 真实路径只读
状态：implemented
变更：2026-10-10-borrow-sandbox-workspace-context
锚点：未记录
最近确认：2d4702355
理由：注入工作区名称/描述/repo 地址/分支/技术栈 + lender 机器上真实代码目录

## D-003@v1 写隔离 enforcement 不动，AGENTS.md 仅纵深防御提示
状态：implemented
变更：2026-10-10-borrow-sandbox-workspace-context
锚点：未记录
最近确认：2d4702355
理由：不变。写隔离的唯一 enforcement 是 daemon 写守卫（registerBorrowSandbox

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-run-close-task-sweep
锚点：未记录
最近确认：9efccfff7751ef838fe436eafa9da030ef68554d
理由：- 最大风险：daemon 对「子代理实际还在跑」的极窄窗口（run 收口瞬间任务仍在收尾事件在途）会被提前收口为 stopped——但 run 已终态意味着该轮进程已结束，任务不可能再产出合法结果，收口语义正确；迟到终态事件仍可覆盖（乱序问）。 - 放弃方案「读端把终态 run 的 running 任务渲染为停止」：治标——脏数据永存、导出/其它消费方仍见 running；放弃「给 upsert 加会话级对账」：面大且治不了存量。 - 已知残留：message 覆盖旧值（Optional 字段 latest-wins 既有语义内，可接受）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-task-sweep-daemon-truth
锚点：未记录
最近确认：ed9542f24dd515f923417163e8a2b71ba2b53477
理由：- 最大风险：部署窗口内 daemon 旧版（无该 RPC method）→ method_not_found 跳过 → 卡死行暂不收敛（回到 v1 之前的滞留态）直到 daemon 升级——安全方向的退化（宁可不收不错收），daemon 经 /daemon 分发自动升级，窗口有限。 - 放弃方案「问询结果缓存 + TTL」：重新引入时间参数且收益微小（清扫触发点低频）；放弃「daemon 周期性全量推送任务表」：广播放大 + 双端状态机，远重于按需问询。 - 已知残留：daemon 注册表本身的丢失窗口（重启后 task_notification 无处可归被跳过——17 条实证根因）仍会让终态事件丢失，但确认清扫在下一触发点把它收敛（这正是本设计的收敛路径）；is_async 列仍恒 false（daemon emit 不带 async 字段——遗留元数据问题，不再是死判依赖，留待后续按需修）。 - 前两代裁决作废声明：run-close-task-sweep 的「run 终态即收」与 task-sweep-liveness-guard 的「5 分钟宽限」死判均被本变更废除，标记/复活机制沿用。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-agent-profile-express-preset
锚点：未记录
最近确认：534cef161623ee81046dd08d697300c005071294
理由：最大风险：协议文案把「新功能/大改动」也错误降级进极速通道——文案显式写入规模定级与拒绝降级条款（新功能提示改走完整 brainstorm 流程）。放弃方案 A（加为第三条 `is_system_default=True` 默认档案）：会进 `resolve_profile` 兜底链改变所有未选档案会话的默认人格（破坏零回归），且 seed 去重按 provider 与既有 claude 默认档冲突；放弃方案 B（仅用管理 API 在当前库建一条数据）：DB 重置即丢（规则 11 允许重置）、不可复现，不符合「平台预置」语义。
