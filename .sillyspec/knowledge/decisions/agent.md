# 决策知识 — agent

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : 团队=会话内能力而非独立会话类型
状态：implemented
变更：2026-08-22-team-session-unify
锚点：未记录
文件：backend/app/main.py, backend/app/modules/agent/profile/seed.py, backend/app/modules/agent/tests/test_profile_seed.py
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

## D-agent-001@v1 2026-10-09-stale-recheck-scope——改 `backend/app/modules/agent/service.py` 的 stale run 清理链一处，修 2026-10-09 风险审查实证的三
状态：implemented
变更：2026-10-09-stale-recheck-scope
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-09-stale-recheck-scope/design.md
文件：backend/app/modules/agent/service.py, backend/tests/modules/agent/test_stale_run_recheck.py
最近确认：未记录
理由：改 `backend/app/modules/agent/service.py` 的 stale run 清理链一处，修 2026-10-09 风险审查实证的三缺陷（原实现来自 2026-10-08-backend-restart-fake-failed）：(1) **范围收窄**——`_cleanup_stale_runs_impl` 之后的排期不再用「全系统任意 running 轮日志新鲜」作条件，新增 `_deferred_run_ids(session)`（单 group-by 查询取 running 轮最新日志时刻，宽限窗内者即启动跳过项）作为复扫链唯一追踪集合快照；`_recheck_stale_runs_loop(deferred_run_ids)` 只对该集合工作，集合清空即退出，启动后新开的轮永不进判死面（长期僵尸归还 patrol）。(2) **daemon 活性门**——新增 `_run_daemon_alive(session, run_id) -> bool | None`（链路 run 最新 lease（updated_at 倒序首见即定）→ runtime → daemon 实例；True=online 或心跳宽限窗内，False=offline 且心跳停滞超窗，None=链路不可解析），复扫对日志停滞的追踪轮：alive=True 保持追踪，False/None 才判死（None 退回纯 recency，防永卡兜底不缩小）。(3) **韧性 + 锁粒度**——循环体逐迭代 try/except（连续失败 ≥ `_RECHECK_MAX_CONSECUTIVE_ERRORS`=5 才 log.error 放弃）；启动清理与复扫都把 recency 判定移到 FOR UPDATE 之前（快照元数据完整的恢复分支仍先加行锁），逐轮 commit 即时释放行锁。判死字段写入提取共用助手 `_mark_stale_run_failed`（字段语义不变，error_code 是 FR-02 回正例外条件的匹配键）。
