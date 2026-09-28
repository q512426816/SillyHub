## FR-components-shared-001 Finalizer 单点收敛（触发锚点 complete_lease）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-005@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 一个 mission 的所有 Worker Run 进入终态（completed/failed/killed） mission 仍有 pending/runni；When 最后一个 Worker 的 lease 在 complete_lease（backend/app/modules/daemon/lease/service.py:362）完成 某 Worker lease comp；Then complete_lease 末尾 mission 分支检测到 `run.mission_id 非空` 且 `derive_status(mission) in
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-01
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcuig3:backend/app/modules/agent/tests/test_finalizer.py
  tests: backend/app/modules/agent/tests/test_finalizer.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

## FR-components-shared-002 Artifact 自动收集触发（与 session end 解耦）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given Worker Run 属于某 mission（run.mission_id 非空） interactive 多轮会话不 end session；When 该 Worker 的 lease 在 complete_lease 完成（batch 或 interactive 路径） Worker lease comple；Then complete_lease 开头按 lease.agent_run_id 调 collect_completed_artifacts 回灌 AgentArti
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-02
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcuirl:backend/app/modules/agent/tests/test_finalizer.py
  tests: backend/app/modules/agent/tests/test_finalizer.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

## FR-components-shared-003 治理门挂载到 dispatch 循环
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given mission 的 dispatch 循环（backend/app/modules/agent/control.py:285 can_dispatch_worker，调用点 mcp_tools.py/mcp_gateway/tools.py）准备 dispatch 下一个 Worker 累计成本 < 预算 且 activ；When 调 can_dispatch_worker(mission_id) 返回 (false, reason) can_dispatch_worker 检查；Then 拒绝 dispatch 该 Worker；剩余未 dispatch 的 pending Run 标记 killed；Mission 进入收敛流程（Finaliz
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-03
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcuj0s:backend/app/modules/agent/tests/test_finalizer.py
  tests: backend/app/modules/agent/tests/test_finalizer.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

## FR-components-shared-004 超预算收敛信号（非错误）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given mission 累计成本达到预算上限；When can_dispatch_worker 检查；Then 返回 (false, "budget_exceeded")；已完成的 Worker Artifact 不丢弃，Finalizer 用已有（可能不完整的）Arti
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-04
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcuj9h:backend/app/modules/agent/tests/test_finalizer.py
  tests: backend/app/modules/agent/tests/test_finalizer.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

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

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcujjx:backend/app/modules/agent/tests/test_orchestrator.py
  tests: backend/app/modules/agent/tests/test_orchestrator.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

## FR-components-shared-007 auto/team 三档路由（第一版 bootstrap+execute 入口）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given bootstrap 或 execute 入口 auto 档；When 选择路由模式 任务特征（任务数/模块跨度/风险/预计上下文）满足 team 阈值（阈值待 plan 定义）；Then 可选 single（现状）/ team（实态 2026-09-28 复核：stages.team_mode 布尔两档，auto 档未实现）；其他 stage 固定 single 自动选 team；否则
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-07
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcuqal:backend/app/modules/change/tests/test_dispatch_execute_team_mode.py
  tests: backend/app/modules/change/tests/test_dispatch_execute_team_mode.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

## FR-components-shared-008 前端 Mission 可观测性
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given mission 详情页 后端 MissionWorkerRunResponse；When 渲染 序列化 Worker；Then 显示 Mission 树（Worker 层级/DAG）；每个 Worker 可点击查看日志（复用 agent-log-viewer 按 run_id）；成本/预
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-08
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcuqjo:frontend/src/components/__tests__/team-progress.test.tsx
  tests: frontend/src/components/__tests__/team-progress.test.tsx | frontend/src/components/daemon/__tests__/team-task-block.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

## FR-components-shared-009 execute team（多 worktree patch + 受控 apply-back）
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given EXECUTE stage 选择 team 档（single 默认） execute team 风险评估过高；When 启动 execute team 前置 Wave1/2/3 未跑通；Then plan.md Wave/Task 分给 Worker，每 Worker 在独立 worktree（基于主分支）写不同 task → 出 patch Artif
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-09
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcuqs3:backend/app/modules/agent/tests/test_worktree_integration.py
  tests: backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

## FR-components-shared-010 兼容与回退
变更：2026-06-28-team-mainline-integration
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 未配置 team/auto team 档出问题；When 任何入口 切回 single；Then 走 single=现状，现有 AgentRun/DaemonLease/complete_lease（非 mission 分支）行为不变 恢复现状（路由默认值回
全文：.sillyspec/changes/archive/2026-06-28-team-mainline-integration/requirements.md#FR-10
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcur1u:backend/app/modules/agent/tests/test_finalizer.py
  tests: backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-06-28-team-mainline-integration
  status: active

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

## FR-components-shared-023 _infer_affected_components 在 module-impact.md 与 ta
变更：2026-09-27-thin-affected-modules-from-patch-manifest
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When _infer_affected_components 在 module-impact.md 与 tasks 路径两来源之外增加 change-patch.jso；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-affected-modules-from-patch-manifest/requirements.md#FR-01
最近确认：8acb0f197f8b660e404eefa917b0fbebd621e1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-thin-affected-modules-from-patch-manifest:flow:FR-01
  tests: backend/app/modules/change/tests/test_parser.py::TestInferAffectedComponentsFromManifest::test_manifest_files_inferred
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-09-27-thin-affected-modules-from-patch-manifest
  status: active

## FR-components-shared-024 files 中 .sillyspec/changes/ 前缀的变更治理件不参与匹配（不产生伪命中），
变更：2026-09-27-thin-affected-modules-from-patch-manifest
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When files 中 .sillyspec/changes/ 前缀的变更治理件不参与匹配（不产生伪命中），其余代码路径直接参与前缀匹配；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-affected-modules-from-patch-manifest/requirements.md#FR-02
最近确认：8acb0f197f8b660e404eefa917b0fbebd621e1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-thin-affected-modules-from-patch-manifest:flow:FR-02
  tests: backend/app/modules/change/tests/test_parser.py::TestInferAffectedComponentsFromManifest::test_manifest_governance_only_yields_empty
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-09-27-thin-affected-modules-from-patch-manifest
  status: active

## FR-components-shared-025 change-patch.json 缺失/JSON 损坏/files 非 list 时静默跳过不抛错
变更：2026-09-27-thin-affected-modules-from-patch-manifest
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When change-patch.json 缺失/JSON 损坏/files 非 list 时静默跳过不抛错，module-impact.md 优先级与既有两来源行为零；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-affected-modules-from-patch-manifest/requirements.md#FR-03
最近确认：8acb0f197f8b660e404eefa917b0fbebd621e1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-thin-affected-modules-from-patch-manifest:flow:FR-03
  tests: backend/app/modules/change/tests/test_parser.py::TestInferAffectedComponentsFromManifest::test_manifest_malformed_json_skipped
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-09-27-thin-affected-modules-from-patch-manifest
  status: active

## FR-components-shared-026 新增 pytest 用例覆盖：files 推断命中、治理件滤除、畸形件防御、module-impac
变更：2026-09-27-thin-affected-modules-from-patch-manifest
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 新增 pytest 用例覆盖：files 推断命中、治理件滤除、畸形件防御、module-impact.md 优先回归，全部通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-affected-modules-from-patch-manifest/requirements.md#FR-04
最近确认：8acb0f197f8b660e404eefa917b0fbebd621e1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-thin-affected-modules-from-patch-manifest:flow:FR-04
  tests: backend/app/modules/change/tests/test_parser.py::TestInferAffectedComponentsFromManifest（6
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-09-27-thin-affected-modules-from-patch-manifest
  status: active

## FR-components-shared-027 既有 change 模块测试（test_parser.py 全量）零回归
变更：2026-09-27-thin-affected-modules-from-patch-manifest
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有 change 模块测试（test_parser.py 全量）零回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-affected-modules-from-patch-manifest/requirements.md#FR-05
最近确认：8acb0f197f8b660e404eefa917b0fbebd621e1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-thin-affected-modules-from-patch-manifest:flow:FR-05
  tests: backend/app/modules/change/tests/test_parser.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-09-27-thin-affected-modules-from-patch-manifest
  status: active

## FR-components-shared-028 轮次大纲端点（全轮摘要一次下发 + 会话级缓存）
变更：2026-09-27-session-fast-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端 daemon 模块就绪；When 前端 GET /api/daemon/sessions/{id}/turn-outline；Then 一次响应返回该会话全部轮次摘要（无 500 条截断）：每轮含 run_id、seq 轮号（created_at 升序 1 起）、status/started_a
全文：.sillyspec/changes/archive/2026-09-27-session-fast-replay/requirements.md#FR-01
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1

## FR-components-shared-029 日志端点按轮直达 + slim 模式 + 单条全文
变更：2026-09-27-session-fast-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given /sessions/{id}/logs 端点就绪；When 传 run_id 参数或 slim=true；Then run_id 命中时只返回该 run 全部日志（升序，上限 2000 条；run 不存在或不属于该会话 404）；slim=true 时 tool 通道 con
全文：.sillyspec/changes/archive/2026-09-27-session-fast-replay/requirements.md#FR-02
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1

## FR-components-shared-030 runs 瘦身 + gzip
变更：2026-09-27-session-fast-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given /sessions/{id}/runs 端点就绪；When 前端拉 runs；Then 响应中 agent_profile_snapshot 剥离 system_prompt 键（保留 name/provider/model 等轻键——前端实证仅消
全文：.sillyspec/changes/archive/2026-09-27-session-fast-replay/requirements.md#FR-03
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1

## FR-components-shared-031 首屏接线（大纲并行尾页）
变更：2026-09-27-session-fast-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端打开会话；When 首屏装配；Then getTurnOutline 与尾页日志（slim=true）并行请求，首屏 ≤2 次请求即可见最近消息+全量轮次导航；既有触顶翻页保留（before 复合游标
全文：.sillyspec/changes/archive/2026-09-27-session-fast-replay/requirements.md#FR-04
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1

## FR-components-shared-032 未加载轮直达跳转
变更：2026-09-27-session-fast-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 大纲显示某轮未加载；When 用户点击该轮（导航列或既有入口）；Then 以 run_id 单轮请求直达（≤2 次往返）并 prepend 定位高亮——替代既有 40ms interval 逐页循环（JUMP_LOAD_EARLIER
全文：.sillyspec/changes/archive/2026-09-27-session-fast-replay/requirements.md#FR-05
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1

## FR-components-shared-033 行式轮次导航列（TurnCatalog 重做）
变更：2026-09-27-session-fast-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given desktop 会话面板渲染；When 轮次导航挂载；Then 左侧常驻行式导航列（约 220px，可拖宽收窄）：每行整行命中区（≥40px 高）含轮号+状态点+prompt 摘要+相对时间，当前轮高亮滚动联动保留，未加载轮
全文：.sillyspec/changes/archive/2026-09-27-session-fast-replay/requirements.md#FR-06
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1

## FR-components-shared-034 slim 工具详情按需全文
变更：2026-09-27-session-fast-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given slim 模式下工具条目被截断；When 用户展开工具详情；Then 截断条目展开时按需拉取单条全文（getAgentSessionLogFull）渲染，非截断条目零额外请求
全文：.sillyspec/changes/archive/2026-09-27-session-fast-replay/requirements.md#FR-07
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1

## FR-components-shared-035 行为零回归 + 质量门
变更：2026-09-27-session-fast-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本变更 diff 与测试；When 审查与运行；Then SSE 实时流/steering 三态/深链 ?session=/草稿/队列/触顶锚定/content-visibility 等既有行为零回归；旧会话数据（无大
全文：.sillyspec/changes/archive/2026-09-27-session-fast-replay/requirements.md#FR-08
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1
