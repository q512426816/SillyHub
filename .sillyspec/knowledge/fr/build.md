## FR-build-001 pm 项目管理 CRUD(覆盖 D-001@v1/D-003@v1/D-005@v1/D-007@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已登录用户（PPM 路由仅认证不授权，权限码已随 2026-07-20-ppm-permission-simplify 精简为 READ 集）；When 创建/查询/修改/删除 项目、客户、成员、干系人；Then 记录落库 + 自动审计;支持 /export-excel 导出;附件存 file_urls(JSON)
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-01
最近确认：859a24672

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgabb:backend/app/modules/ppm/project/tests/test_service.py
  tests: backend/app/modules/ppm/common/tests/test_export.py | backend/app/modules/ppm/project/tests/test_service.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-06-20-2026-06-20-ppm-module-migration
  status: active

## FR-build-002 plan 计划策划与模板(覆盖 D-001@v1/D-005@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已登录用户（PPM 路由仅认证不授权，权限码已随 2026-07-20-ppm-permission-simplify 精简为 READ 集）；When 管理项目计划/里程碑/计划节点模板及子表明细；Then 主子表一致性保存;查询按项目聚合
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-02
最近确认：859a24672

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgape:backend/app/modules/ppm/plan/tests/test_service.py
  tests: backend/app/modules/ppm/plan/tests/test_service.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-06-20-2026-06-20-ppm-module-migration
  status: active

## FR-build-003 problem 问题清单审批流(覆盖 D-002@v1/D-004@v1/D-006@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：superseded
退役理由：4 节点审批链（nextProcess 申请→开发经理→项目经理→部门经理 + ProcessLog/ProcessTask）已被 2026-07-20-problem-list-align-task-plan 的 3 态简化删除（problem/fsm.py 头注注明历史链已删；现行 3 态 new/doing/closed 由 test_problem_flow.py 覆盖）（2026-09-28 复核）
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 问题清单记录(status=已保存)且有 PPM_PROBLEM_WRITE；When 依次执行 nextProcess(申请→开发经理→项目经理→部门经理→验证→关闭)/ rejectProcess / doneTask / closeTask；Then status 按 4 节点状态机流转;bug 类型跳过部门经理;每次流转写 ProcessLog + ProcessTask + audit_log;有未关闭变
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-03
最近确认：859a24672

## FR-build-004 里程碑明细流(覆盖 D-002@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 里程碑明细(status=草稿)；When saveProcess / rejectProcess / changeProcess；Then status 在(草稿→审核→审批→完成)流转,驳回回退,变更生成新版本(parent_id 关联);写 _process 履历
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-04
最近确认：859a24672

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch2rn:backend/app/modules/ppm/plan/tests/test_fsm.py
  tests: backend/app/modules/ppm/plan/tests/test_fsm.py | backend/app/modules/ppm/plan/tests/test_service.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-06-20-2026-06-20-ppm-module-migration
  status: active

## FR-build-005 task 任务与工时(覆盖 D-001@v1/D-003@v1/D-005@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已登录用户（PPM 路由仅认证不授权，权限码已随 2026-07-20-ppm-permission-simplify 精简为 READ 集）；When 管理任务计划/执行/工时,执行 executePlan,统计 stat-by-user/project；Then 任务执行联动 TaskExecute 生成;工时统计正确;支持 /export-excel;个人视图按当前登录人过滤
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-05
最近确认：859a24672

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch31l:backend/app/modules/ppm/task/tests/test_task.py
  tests: backend/app/modules/ppm/task/tests/test_task.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-06-20-2026-06-20-ppm-module-migration
  status: active

## FR-build-006 kanban 看板(覆盖 D-001@v1, X-001)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 有 PPM_KANBAN_VIEW；When 查询看板人员列/任务卡片/分配/拖拽排序；Then 人员=可见 project_member(可按 Organization 分组);reorder 持久化 kanban_order
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-06
最近确认：859a24672

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch3bc:backend/app/modules/ppm/kanban/tests/test_kanban.py
  tests: backend/app/modules/ppm/kanban/tests/test_kanban.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-06-20-2026-06-20-ppm-module-migration
  status: active

## FR-build-007 lease GC 周期调度接线
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-01
最近确认：632c87add

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch3l5:backend/app/modules/daemon/tests/test_lease_expiry_sweeper.py
  tests: backend/app/modules/daemon/tests/test_lease_expiry_sweeper.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-07-14-lease-gc-recovery-reliability
  status: active

## FR-build-008 interactive lease 永不被 GC（红线）
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-02
最近确认：632c87add

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch3w4:backend/app/modules/daemon/tests/test_lease_expiry_sweeper.py
  tests: backend/app/modules/daemon/tests/test_lease_expiry_sweeper.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-07-14-lease-gc-recovery-reliability
  status: active

## FR-build-009 worktree GC 加 agent_run_id 外键改判据
变更：2026-07-14-lease-gc-recovery-reliability
状态：superseded
退役理由：WorktreeLease 模型（worktree/model.py）已无 agent_run_id 列、worktree/service.py 无按 AgentRun 终态判据的 GC 扫描，特性整体不存在于当前代码（2026-09-28 复核）
摘要：（无场景名）
依据决策：D-003@v2
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-03
最近确认：632c87add

## FR-build-010 心跳窗口放宽 + attempt 可配
变更：2026-07-14-lease-gc-recovery-reliability
状态：superseded
退役理由：lease_heartbeat_ttl_sec / lease_max_attempts 配置项不存在，心跳窗口为 lease_service.py LEASE_DURATION_SECONDS=60 硬编码类常量，TTL 放宽 300s 与可配承诺整体不成立（2026-09-28 复核）
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-04
最近确认：632c87add

## FR-build-011 failed run 重试入口
变更：2026-07-14-lease-gc-recovery-reliability
状态：superseded
退役理由：POST /workspaces/{ws}/agent/runs/{id}/retry 端点在当前 agent/router.py 不存在（runs 路由仅 list/get/kill/input/logs/stream），failed run 重试入口特性已移除（2026-09-28 复核）
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-05
最近确认：632c87add

## FR-build-012 悬空 session 可见性
变更：2026-07-14-lease-gc-recovery-reliability
状态：superseded
退役理由：AgentSessionRead（daemon/schema.py）已无 runtime_online 字段；离线可见性语义由后续 machine status / SessionPanel 离线判定与 runtimes 页离线统计承接，原字段契约不存在（2026-09-28 复核）
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-06
最近确认：632c87add

## FR-build-013 lease service 死代码清理
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-07
最近确认：632c87add

## FR-build-014 守护测试（防回归）
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-08
最近确认：632c87add

## FR-build-015 每人一套排序持久化（D-001/D-011/D-006@v2）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 登录用户 U 在默认视图拖动工作区卡片或使用「移动到…」；When 一次 move 成功（单行 sort_position 更新，事务含幂等 backfill）；Then U 的列表按新顺序展示，刷新/换设备后保持；其他任何用户的列表与此前完全一致
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-01
最近确认：e21bf19cc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchc25:backend/app/modules/workspace/tests/test_move_order.py
  tests: backend/app/modules/workspace/tests/test_move_order.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-14-workspace-drag-sort
  status: active

## FR-build-016 move 锚点端点契约（D-013/D-007）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-007@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given 用户对目标工作区具备 WORKSPACE_READ（非管理员还需行级可见）；When POST /workspaces/{id}/move 携带恰好一个锚点（after_id / before_id / to）；Then 服务端按锚点更新位置并返回 {workspace, rebalanced, rank}；锚点三选一违反→422 ANCHOR_CONFLICT；锚点不可见/软删
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-02
最近确认：e21bf19cc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchcc4:backend/app/modules/workspace/tests/test_move_order.py
  tests: backend/app/modules/workspace/tests/test_move_order.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-14-workspace-drag-sort
  status: active

## FR-build-017 列表默认排序接入（D-004/D-011）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户 U 打开列表（或任意筛选组合）；When 服务端执行 list_with_owner(order_user_id=U)；Then 结果按 (无排序行→最前, sort_position ASC, created_at DESC) 排列；无行用户与从未拖过的视图 = 现状 created_a
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-03
最近确认：e21bf19cc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchcnb:backend/app/modules/workspace/tests/test_move_order.py
  tests: backend/app/modules/workspace/tests/test_move_order.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-14-workspace-drag-sort
  status: active

## FR-build-018 页内拖拽（D-003@v2/D-010）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-008@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 默认视图、无筛选激活、页内 ≥2 张卡；When 用户拖动卡片手柄落在本页某位置；Then 前端发一次 moveWorkspace(id, {after_id: 落位前邻卡})，乐观更新，失败回滚刷新；卡片手柄与整卡点击进详情不冲突
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-04
最近确认：e21bf19cc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchcyy:frontend/src/components/__tests__/workspace-drag-grid.test.tsx
  tests: frontend/src/components/__tests__/workspace-drag-grid.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-14-workspace-drag-sort
  status: active

## FR-build-019 边缘投放带跨页（D-003@v2/D-012）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-003@v2、D-012@v1
场景正文：
- 场景：默认场景 — Given 默认视图拖拽进行中；When 网格上下浮现投放带（第 1 页无上带、末页无下带）；Then 下带提交 {to:"next_page_head"}、上带提交 {to:"prev_page_tail"}（均含 page_size，默认 12）；成功后按响应
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-05
最近确认：e21bf19cc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchdas:frontend/src/components/__tests__/workspace-drag-grid.test.tsx
  tests: backend/app/modules/workspace/tests/test_move_order.py | frontend/src/components/__tests__/workspace-drag-grid.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-14-workspace-drag-sort
  status: active

## FR-build-020 「移动到…」弹窗（D-009@v2）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-009@v2
场景正文：
- 场景：默认场景 — Given 默认视图某张卡的菜单；When 用户选目标页与页首/页尾并确认；Then 前端先拉取目标页默认视图数据，按方向规则计算 id 锚点（页首：向上 before/向下 after=目标页第一张；页尾对偶到目标页最后一张；同页：页首 bef
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-06
最近确认：e21bf19cc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchji6:frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-14-workspace-drag-sort
  status: active

## FR-build-021 筛选态禁拖保护（D-005@v2）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-005@v2
场景正文：
- 场景：默认场景 — Given q/type/unclassified/status≠active/user_id/include_deleted 任一激活；When 列表渲染；Then 手柄呈禁用态（可见灰显）+ 提示"筛选状态下不可拖拽排序"；投放带与「移动到…」入口同步禁用；不发任何 move 请求
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-07
最近确认：e21bf19cc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchju3:frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx | frontend/src/components/__tests__/workspace-drag-grid.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-14-workspace-drag-sort
  status: active

## FR-build-022 分页数量不变量（D-014）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-014@v1
场景正文：
- 场景：默认场景 — Given 任意合法 move（页内/投放带/弹窗）；When 移动完成并重新分页；Then total 不变、每页恒 PAGE_SIZE 张（末页允许不满）、序列无重复 id、无空页/丢卡
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-08
最近确认：e21bf19cc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchk5q:frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-14-workspace-drag-sort
  status: active

## FR-build-023 health 回显真实提交
变更：2026-09-26-deploy-eng-hardening
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-deploy-eng-hardening/requirements.md#FR-01
最近确认：a71027153ae5c7197d3f355878f6a5e2b9334ec4

## FR-build-024 build 提示目录正确
变更：2026-09-26-deploy-eng-hardening
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-deploy-eng-hardening/requirements.md#FR-02
最近确认：a71027153ae5c7197d3f355878f6a5e2b9334ec4

## FR-build-025 backup 自动保留窗
变更：2026-09-26-deploy-eng-hardening
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-deploy-eng-hardening/requirements.md#FR-03
最近确认：a71027153ae5c7197d3f355878f6a5e2b9334ec4

## FR-build-026 gen 并行会话守卫
变更：2026-09-26-deploy-eng-hardening
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-deploy-eng-hardening/requirements.md#FR-04
最近确认：a71027153ae5c7197d3f355878f6a5e2b9334ec4

## FR-build-027 git 竞态重试
变更：2026-09-26-deploy-eng-hardening
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-deploy-eng-hardening/requirements.md#FR-05
最近确认：a71027153ae5c7197d3f355878f6a5e2b9334ec4

## FR-build-028 语法与本地可验
变更：2026-09-26-deploy-eng-hardening
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-deploy-eng-hardening/requirements.md#FR-06
最近确认：a71027153ae5c7197d3f355878f6a5e2b9334ec4

## FR-build-029 _read_touched_modules 对含 .. 段或绝对路径的 doc 值不读盘：模块名回退
变更：2026-09-27-audit-followup-hardening
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When _read_touched_modules 对含 .. 段或绝对路径的 doc 值不读盘：模块名回退 id、doc 字段不外发越界路径（不放 chip），正常相；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-audit-followup-hardening/requirements.md#FR-01
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-audit-followup-hardening:flow:FR-01
  tests: backend/app/modules/change/tests/test_assets.py::test_touched_modules_doc_traversal_guard（../、/etc/passwd、C:/Windows
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-audit-followup-hardening
  status: active

## FR-build-030 docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA
变更：2026-09-27-audit-followup-hardening
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA 覆盖行删除并留同 backend 口径的注释说明；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-audit-followup-hardening/requirements.md#FR-02
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94

## FR-build-031 gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）
变更：2026-09-27-audit-followup-hardening
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given api 相关模块就绪；When gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-audit-followup-hardening/requirements.md#FR-03
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94

## FR-build-032 234000 迁移 docstring 补 stranded revision 人工 stamp 运
变更：2026-09-27-audit-followup-hardening
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 相关模块就绪；When 234000 迁移 docstring 补 stranded revision 人工 stamp 运维注记；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-audit-followup-hardening/requirements.md#FR-04
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-audit-followup-hardening:flow:FR-04
  tests: backend/tests/test_align_platform_change_events_migration.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-audit-followup-hardening
  status: active

## FR-build-033 test_assets 新增越界 doc 用例（..
变更：2026-09-27-audit-followup-hardening
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When test_assets 新增越界 doc 用例（..；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-audit-followup-hardening/requirements.md#FR-05
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-audit-followup-hardening:flow:FR-05
  tests: backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_assets.py::test_touched_modules_doc_traversal_guard（同
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-audit-followup-hardening
  status: active

## FR-build-034 与绝对路径两形态）绿，既有聚焦测试绿
变更：2026-09-27-audit-followup-hardening
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 与绝对路径两形态）绿，既有聚焦测试绿；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-audit-followup-hardening/requirements.md#FR-06
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-audit-followup-hardening:flow:FR-06
  tests: backend/app/modules/change/tests/test_assets.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-audit-followup-hardening
  status: active

## FR-build-035 变更中心与工作区列表行 hover 为实色 muted 背景+transition-colors 1
变更：2026-09-27-hover-polish
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更中心与工作区列表行 hover 为实色 muted 背景+transition-colors 100ms 级过渡，无紫色边框；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-hover-polish/requirements.md#FR-01
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-build-036 标题链接 hover 下划线保持
变更：2026-09-27-hover-polish
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 标题链接 hover 下划线保持；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-hover-polish/requirements.md#FR-02
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-build-037 hover 操作浮现过渡平滑
变更：2026-09-27-hover-polish
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When hover 操作浮现过渡平滑；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-hover-polish/requirements.md#FR-03
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-build-038 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对
变更：2026-09-27-hover-polish
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-hover-polish/requirements.md#FR-04
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-build-039 pnpm prototype:build 一键产出全部原型视图的自包含 HTML（零外部引用、离线双
变更：2026-09-27-prototype-pipeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When pnpm prototype:build 一键产出全部原型视图的自包含 HTML（零外部引用、离线双击可用、内嵌三主题切换）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-01
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

## FR-build-040 页面类原型：视图源码（tsx，import 生产 primer 组件与 token）入仓并通过 ts
变更：2026-09-27-prototype-pipeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When 页面类原型：视图源码（tsx，import 生产 primer 组件与 token）入仓并通过 tsc 与 eslint；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-02
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-prototype-pipeline:flow:FR-02
  tests: frontend/src/components/prototype/__tests__/prototype-smoke.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-prototype-pipeline
  status: active

## FR-build-041 流程类原型：FlowDiagram 原语（节点与边 JSON 源 → 分层 SVG 布局、token 着色、零新增依赖）
变更：2026-09-27-prototype-pipeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 原型管线就绪；When 以节点与边 JSON 源渲染流程图；Then 产出分层 SVG 布局、颜色全部走主题 token、不引入新依赖
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-03
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-prototype-pipeline:flow:FR-03
  tests: frontend/src/components/prototype/__tests__/flow-diagram.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-prototype-pipeline
  status: active

## FR-build-042 流程类原型：至少一个真实流程示例视图（SillySpec 变更流程状态机）入仓并编译为独立 HTML
变更：2026-09-27-prototype-pipeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given FlowDiagram 原语就绪；When 视图入仓并执行原型编译；Then 编译产物为可离线双击的独立 HTML
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-04
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-prototype-pipeline:flow:FR-04
  tests: frontend/src/components/prototype/__tests__/prototype-smoke.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-prototype-pipeline
  status: active

## FR-build-043 原型分型规约落档（页面类、流程类、规则类各自的源方言、产物形态、批准与晋升路径）
变更：2026-09-27-prototype-pipeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 原型管线就绪；When 撰写原型规约文档；Then 三类原型的源方言、产物形态、批准与晋升路径均有明文
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-05
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

## FR-build-044 既有业务页面与组件零改动（仅新增原型管线文件、package.json 脚本行、.gitignore
变更：2026-09-27-prototype-pipeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When 既有业务页面与组件零改动（仅新增原型管线文件、package.json 脚本行、.gitignore）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-06
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

## FR-build-045 编译产物入仓且与源码可对账（重编译后 git diff 为空）
变更：2026-09-27-prototype-pipeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 编译产物入仓且与源码可对账（重编译后 git diff 为空）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-07
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9
