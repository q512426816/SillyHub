## FR-components-shared-001 Finalizer 单点收敛（触发锚点 complete_lease）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-005@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 一个 mission 的所有 Worker Run 进入终态（completed/failed/killed） mission 仍有 pending/runni；When 最后一个 Worker 的 lease 在 complete_lease（backend/app/modules/daemon/lease/service.py:278）完成 某 Worker lease comp；Then complete_lease 末尾 mission 分支检测到 `run.mission_id 非空` 且 `derive_status(mission) in
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-01
最近确认：98d3e56dd

## FR-components-shared-002 Artifact 自动收集触发（与 session end 解耦）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given Worker Run 属于某 mission（run.mission_id 非空） interactive 多轮会话不 end session；When 该 Worker 的 lease 在 complete_lease 完成（batch 或 interactive 路径） Worker lease comple；Then complete_lease 开头按 lease.agent_run_id 调 collect_completed_artifacts 回灌 AgentArti
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-02
最近确认：98d3e56dd

## FR-components-shared-003 治理门挂载到 dispatch 循环
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given mission 的 dispatch 循环（backend/app/modules/agent/router.py:680-687）准备 dispatch 下一个 Worker 累计成本 < 预算 且 activ；When 调 can_dispatch_worker(mission_id) 返回 (false, reason) can_dispatch_worker 检查；Then 拒绝 dispatch 该 Worker；剩余未 dispatch 的 pending Run 标记 killed；Mission 进入收敛流程（Finaliz
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-03
最近确认：98d3e56dd

## FR-components-shared-004 超预算收敛信号（非错误）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given mission 累计成本达到预算上限；When can_dispatch_worker 检查；Then 返回 (false, "budget_exceeded")；已完成的 Worker Artifact 不丢弃，Finalizer 用已有（可能不完整的）Arti
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-04
最近确认：98d3e56dd

## FR-components-shared-005 工具治理 v1 降级（不强制、patch 人审兜底）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given v1 Worker（read-only 或写类）dispatch execute team 写类 Worker 产出 patch；When Worker 在 daemon 执行 Finalizer 收敛；Then 工具层不强制审批（batch 默认 policy + prompt 约束）；read-only 与写类均走 batch patch 经人审 apply-back
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-05
最近确认：98d3e56dd

## FR-components-shared-006 bootstrap team 闭环
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given bootstrap 入口选择 team 档 bootstrap 入口未选 team（single 默认）；When 启动 team bootstrap 启动 bootstrap
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-06
最近确认：98d3e56dd

## FR-components-shared-007 auto/team 三档路由（第一版 bootstrap+execute 入口）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given bootstrap 或 execute 入口 auto 档；When 选择路由模式 任务特征（任务数/模块跨度/风险/预计上下文）满足 team 阈值（阈值待 plan 定义）；Then 可选 single（现状）/ team / auto（按任务数·模块跨度·风险·预计上下文自动选）；其他 stage 固定 single 自动选 team；否则
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-07
最近确认：98d3e56dd

## FR-components-shared-008 前端 Mission 可观测性
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given mission 详情页 后端 MissionWorkerRunResponse；When 渲染 序列化 Worker；Then 显示 Mission 树（Worker 层级/DAG）；每个 Worker 可点击查看日志（复用 agent-log-viewer 按 run_id）；成本/预
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-08
最近确认：98d3e56dd

## FR-components-shared-009 execute team（多 worktree patch + 受控 apply-back）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given EXECUTE stage 选择 team 档（single 默认） execute team 风险评估过高；When 启动 execute team 前置 Wave1/2/3 未跑通；Then plan.md Wave/Task 分给 Worker，每 Worker 在独立 worktree（基于主分支）写不同 task → 出 patch Artif
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-09
最近确认：98d3e56dd

## FR-components-shared-010 兼容与回退
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 未配置 team/auto team 档出问题；When 任何入口 切回 single；Then 走 single=现状，现有 AgentRun/DaemonLease/complete_lease（非 mission 分支）行为不变 恢复现状（路由默认值回
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-10
最近确认：98d3e56dd

## FR-components-shared-011 工作台页面与入口
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户已登录且持有 PPM_TASK_READ 权限；When 访问 `/ppm/workbench` 或点击 PPM 菜单「个人工作台」；Then 渲染三栏布局工作台页面；`/ppm` redirect 行为不变（仍 → /ppm/projects）
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-01
最近确认：af41fac1d

## FR-components-shared-012 个人信息·工号
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given users 表已通过 migration 加 `employee_no` 列；When 工作台请求 `/api/ppm/workbench/profile`；Then 返回 `employee_no`；当前用户未录工号时返回 null，前端显示「—」；不影响登录与其他 UserRead 消费方
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-02
最近确认：af41fac1d

## FR-components-shared-013 个人信息·部门
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given `user_organizations` + `organizations` 表存在；When 查询当前登录人部门；Then 经 `user_organizations` JOIN `organizations` 取主部门（首个 active 组织）name；无关联则 null，前端显
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-03
最近确认：af41fac1d

## FR-components-shared-014 个人信息·角色
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — When 查询当前登录人角色；Then 取 `MeResponse.workspaces[0].role_name`（工作区角色），首个非空；全空则 null
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-04
最近确认：af41fac1d

## FR-components-shared-015 本月指标聚合
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-008@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 范围参数 range ∈ {week, month, all}；When 请求 `/api/ppm/workbench/summary?range=month`；Then 统一按 `ppm_plan_task.start_time` 区间过滤（week=本周一~周日，month=当月1日~月末，all=不限）返回：
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-05
最近确认：af41fac1d

## FR-components-shared-016 待办派生
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given `now_handle_user` 存储格式为 `str(user.id)` 逗号分隔（已验证 backend/app/modules/ppm/problem/service.py...:433；When 派生当前人待办；Then 合并：① `ppm_problem_list` / `ppm_problem_change` 的 `now_handle_user` 包含 str(me.id)
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-06
最近确认：af41fac1d

## FR-components-shared-017 任务操作表
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — When 工作台展示任务表；Then 复用 `GET /api/ppm/personal-task-plan/page`（已有，按当前登录人过滤）；列显示 序号/项目名(project_name)/
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-07
最近确认：af41fac1d

## FR-components-shared-018 工作日历
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-010@v1
场景正文：
- 场景：默认场景 — When 请求 `/api/ppm/workbench/calendar?year_month=2026-07`；Then 返回当月每日：task_count（按 `start_time` 落在该日计数，跨多日只计 start_time 当日）。**reverse sync 2026
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-08
最近确认：af41fac1d

## FR-components-shared-019 工时统计口径
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — When 计算 work_hours 指标；Then 数据源为 `ppm_task_execute.time_spent`（`ppm_work_hour` 表当前为空）；按 execute_user_id=me +
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-09
最近确认：af41fac1d

## FR-components-shared-020 缺陷统计
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 计算 defect_count；Then count(`ppm_problem_list` where `duty_user_id`=me AND status!="4"已关闭)；不受 range 影响
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-10
最近确认：af41fac1d

## FR-components-shared-021 占位区块
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — When 渲染消息通知 / 绩效考评；Then 显示 EmptyState 空状态（「功能开发中」），不报错、不建后端表；快捷入口「绩效考评」点击提示未开放；「问题清单」「知识库」跳转已有页面
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-11
最近确认：af41fac1d

## FR-components-shared-022 接口权限
变更：2026-07-14-2026-07-13-ppm-personal-workbench-prototype
状态：active
摘要：默认场景
依据决策：D-009@v1
场景正文：
- 场景：默认场景 — When 请求 workbench 三个接口；Then 要求 `PPM_TASK_READ` 权限（复用 `require_permission_any(Permission.PPM_TASK_READ)`，不新建权
全文：.sillyspec/changes/archive/2026-07-14-2026-07-13-ppm-personal-workbench-prototype/requirements.md#FR-12
最近确认：af41fac1d
