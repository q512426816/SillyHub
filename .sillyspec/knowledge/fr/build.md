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
骨架：thin
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
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA 覆盖行删除并留同 backend 口径的注释说明；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-audit-followup-hardening/requirements.md#FR-02
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94

## FR-build-031 gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）
变更：2026-09-27-audit-followup-hardening
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given api 相关模块就绪；When gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-audit-followup-hardening/requirements.md#FR-03
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94

## FR-build-032 234000 迁移 docstring 补 stranded revision 人工 stamp 运
变更：2026-09-27-audit-followup-hardening
状态：active
骨架：thin
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
骨架：thin
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
骨架：thin
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
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更中心与工作区列表行 hover 为实色 muted 背景+transition-colors 100ms 级过渡，无紫色边框；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-hover-polish/requirements.md#FR-01
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-build-036 标题链接 hover 下划线保持
变更：2026-09-27-hover-polish
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 标题链接 hover 下划线保持；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-hover-polish/requirements.md#FR-02
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-build-037 hover 操作浮现过渡平滑
变更：2026-09-27-hover-polish
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When hover 操作浮现过渡平滑；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-hover-polish/requirements.md#FR-03
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-build-038 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对
变更：2026-09-27-hover-polish
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-hover-polish/requirements.md#FR-04
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-build-039 pnpm prototype:build 一键产出全部原型视图的自包含 HTML（零外部引用、离线双
变更：2026-09-27-prototype-pipeline
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When pnpm prototype:build 一键产出全部原型视图的自包含 HTML（零外部引用、离线双击可用、内嵌三主题切换）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-01
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

## FR-build-040 页面类原型：视图源码（tsx，import 生产 primer 组件与 token）入仓并通过 ts
变更：2026-09-27-prototype-pipeline
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When 页面类原型：视图源码（tsx，import 生产 primer 组件与 token）入仓并通过 tsc 与 eslint；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-02
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-prototype-pipeline:flow:FR-02
  tests: frontend/src/components/prototype/__tests__/prototype-smoke.test.tsx
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
  tests: frontend/src/components/prototype/__tests__/flow-diagram.test.tsx
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
  tests: frontend/src/components/prototype/__tests__/prototype-smoke.test.tsx
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
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When 既有业务页面与组件零改动（仅新增原型管线文件、package.json 脚本行、.gitignore）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-06
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

## FR-build-045 编译产物入仓且与源码可对账（重编译后 git diff 为空）
变更：2026-09-27-prototype-pipeline
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 编译产物入仓且与源码可对账（重编译后 git diff 为空）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/requirements.md#FR-07
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9

## FR-build-046 frontend/vitest.config.ts 移除 passWithNoTests，恢复正常
变更：2026-09-30-vitest-passwithnotests-rollback
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When frontend/vitest.config.ts 移除 passWithNoTests，恢复正常 vitest 语义（空收集报错）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-vitest-passwithnotests-rollback/requirements.md#FR-01
最近确认：557497bae50851b1723c49d0f973a0a06f6dc744

## FR-build-047 门禁复核：原始失败面下不再产生 vitest run e2e/auth.spec.ts 命令（已在
变更：2026-09-30-vitest-passwithnotests-rollback
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given e2e 相关模块就绪；When 门禁复核：原始失败面下不再产生 vitest run e2e/auth.spec.ts 命令（已在 sillyspec 仓验证）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-vitest-passwithnotests-rollback/requirements.md#FR-02
最近确认：557497bae50851b1723c49d0f973a0a06f6dc744

## FR-build-048 工具缺陷文档移入 docs/sillyspec/finished/ 并附处置记录
变更：2026-09-30-vitest-passwithnotests-rollback
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 工具缺陷文档移入 docs/sillyspec/finished/ 并附处置记录；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-vitest-passwithnotests-rollback/requirements.md#FR-03
最近确认：557497bae50851b1723c49d0f973a0a06f6dc744

## FR-build-049 撤除后相关测试与门禁实测通过
变更：2026-09-30-vitest-passwithnotests-rollback
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 撤除后相关测试与门禁实测通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-vitest-passwithnotests-rollback/requirements.md#FR-04
最近确认：557497bae50851b1723c49d0f973a0a06f6dc744

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-vitest-passwithnotests-rollback:flow:FR-04
  tests: frontend/src/components/__tests__/top-bar.test.tsx | test/dynamic-deps-comment-edge.test.mjs
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-vitest-passwithnotests-rollback
  status: active

## FR-build-050 定位段（session 查询）串行执行，RPC 段保持 Semaphore(3) 并发，AsyncSession 不再被并发使用
变更：2026-10-03-usage-ingest-session-concurrency
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 定位段（session 查询）串行执行，RPC 段保持 Semaphore(3) 并发，AsyncSession 不再被并发使用；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-ingest-session-concurrency/requirements.md#FR-01
最近确认：bf325fda515865d118734dc1bfa6fa47233bd067

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-usage-ingest-session-concurrency:flow:FR-01
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py::test_ingest_locate_never_overlaps_across_batch（4
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-usage-ingest-session-concurrency
  status: active

## FR-build-051 新增回归测试：并发窗口下断言定位调用永不重叠，且旧实现（定位在信号灯内）该测试必红
变更：2026-10-03-usage-ingest-session-concurrency
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 新增回归测试：并发窗口下断言定位调用永不重叠，且旧实现（定位在信号灯内）该测试必红；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-ingest-session-concurrency/requirements.md#FR-02
最近确认：bf325fda515865d118734dc1bfa6fa47233bd067

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-usage-ingest-session-concurrency:flow:FR-02
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py::test_ingest_locate_never_overlaps_across_batch（本会话两步实证
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-usage-ingest-session-concurrency
  status: active

## FR-build-052 model_validate 校验异常不再炸出 gather，单条畸形不丢弃同批已成功条目
变更：2026-10-03-usage-ingest-session-concurrency
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When model_validate 校验异常不再炸出 gather，单条畸形不丢弃同批已成功条目；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-ingest-session-concurrency/requirements.md#FR-03
最近确认：bf325fda515865d118734dc1bfa6fa47233bd067

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-usage-ingest-session-concurrency:flow:FR-03
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py::test_ingest_malformed_usage_isolates_failure（畸形
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-usage-ingest-session-concurrency
  status: active

## FR-build-053 既有 test_usage_ingest.py 全部保持通过
变更：2026-10-03-usage-ingest-session-concurrency
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 既有 test_usage_ingest.py 全部保持通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-ingest-session-concurrency/requirements.md#FR-04
最近确认：bf325fda515865d118734dc1bfa6fa47233bd067

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-usage-ingest-session-concurrency:flow:FR-04
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-usage-ingest-session-concurrency
  status: active

## FR-build-054 摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输入，与平台 agent_runs 口径对齐），max(0,...) 防负
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输入，与平台 agent_runs 口径对齐），max(0,...) 防负；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-01
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-01
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py::test_ingest_writes_snapshot_with_column_mapping（6800−5600=1200
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-055 注释锚定 113/113 实证
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 注释锚定 113/113 实证；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-02
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

## FR-build-056 命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-03
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx「本地 CLI 桶行 api_requests 有值直显」用例
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-057 本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_seen)、耗时含跨度（ISO 字符串字典序比较）
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_seen)、耗时含跨度（ISO 字符串字典序比较）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-04
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-04
  tests: backend/app/modules/change/tests/test_usage_stats.py::test_local_only_triple_from_seen_at（03:37:50.183→04:14:12.160
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-058 混合场景与 run 段取 MIN/MAX、耗时相加
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 混合场景与 run 段取 MIN/MAX、耗时相加；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-05
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-05
  tests: backend/app/modules/change/tests/test_usage_stats.py::test_local_triple_and_invocations_contribute（run
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-059 请求次数：本地段 SUM(invocations) 并入 api_requests
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given api 相关模块就绪；When 请求次数：本地段 SUM(invocations) 并入 api_requests；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-06
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-06
  tests: backend/app/modules/change/tests/test_usage_stats.py::test_local_triple_and_invocations_contribute（api_requests==12
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-060 注脚声明口径（输入=非缓存输入
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 注脚声明口径（输入=非缓存输入；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-07
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-07
  tests: frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-061 时间为上报观察跨度
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 时间为上报观察跨度；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-08
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-08
  tests: backend/app/modules/change/tests/test_usage_stats.py::test_local_only_triple_from_seen_at（跨度毫秒断言）——注脚文案侧由
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-062 请求次数含 CLI 计数）
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 请求次数含 CLI 计数）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-09
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-09
  tests: backend/app/modules/change/tests/test_usage_stats.py::test_local_triple_and_invocations_contribute（桶行
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-063 轮次维持 0（无来源）
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 轮次维持 0（无来源）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-10
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-10
  tests: backend/app/modules/change/tests/test_usage_stats.py::test_local_triple_and_invocations_contribute（num_turns==1
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-064 覆盖写幂等使活跃日志下次上报自动重算
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 幂等 相关模块就绪；When 覆盖写幂等使活跃日志下次上报自动重算；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-11
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-11
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py::test_ingest_idempotent_overwrite（两次摄取同值幂等）——自动重算=幂等+节流窗口外重摄的推论
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-065 聚焦测试全绿：test_usage_ingest + test_usage_stats + change-usage-card
变更：2026-10-03-local-usage-caliber-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 聚焦测试全绿：test_usage_ingest + test_usage_stats + change-usage-card；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-local-usage-caliber-fix/requirements.md#FR-12
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-caliber-fix:flow:FR-12
  tests: backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/platform_sync/tests/test_usage_ingest.py | frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-caliber-fix
  status: active

## FR-build-066 候选筛选与聚合消费口径一致（白名单 format + 已关联会话 + 无快照幂等 + 无 runs 会话）
变更：2026-10-03-usage-backfill-script
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 幂等 相关模块就绪；When 候选筛选与聚合消费口径一致（白名单 format + 已关联会话 + 无快照幂等 + 无 runs 会话）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-backfill-script/requirements.md#FR-01
最近确认：373239040c2899e288f1f904584ad692584aa2c7

## FR-build-067 dry-run 只打印影响计数不落库
变更：2026-10-03-usage-backfill-script
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When dry-run 只打印影响计数不落库；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-backfill-script/requirements.md#FR-02
最近确认：373239040c2899e288f1f904584ad692584aa2c7

## FR-build-068 --apply 逐条 RPC 解析覆盖写、末尾 commit、每 50 条进度回报
变更：2026-10-03-usage-backfill-script
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When --apply 逐条 RPC 解析覆盖写、末尾 commit、每 50 条进度回报；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-backfill-script/requirements.md#FR-03
最近确认：373239040c2899e288f1f904584ad692584aa2c7

## FR-build-069 复用既有摄取方法（归一口径/全降级/幂等零重复实现）
变更：2026-10-03-usage-backfill-script
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 幂等 相关模块就绪；When 复用既有摄取方法（归一口径/全降级/幂等零重复实现）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-backfill-script/requirements.md#FR-04
最近确认：373239040c2899e288f1f904584ad692584aa2c7

## FR-build-070 ruff 通过
变更：2026-10-03-usage-backfill-script
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When ruff 通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-backfill-script/requirements.md#FR-05
最近确认：373239040c2899e288f1f904584ad692584aa2c7

## FR-build-071 服务器 dry-run 实测候选数与 DB 直查一致（173 变更口径）
变更：2026-10-03-usage-backfill-script
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 服务器 dry-run 实测候选数与 DB 直查一致（173 变更口径）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-03-usage-backfill-script/requirements.md#FR-06
最近确认：373239040c2899e288f1f904584ad692584aa2c7

## FR-build-072 归档态与在途态的知识触达区块标题均使用用户语言（「知识触达（本变更参考过的知识）」形态），标题正文不再出现「待复核标记反查」「注入命中」等机制黑话
变更：2026-10-04-knowledge-touch-plain-title
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 归档态与在途态的知识触达区块标题均使用用户语言（「知识触达（本变更参考过的知识）」形态），标题正文不再出现「待复核标记反查」「注入命中」等机制黑话；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-knowledge-touch-plain-title/requirements.md#FR-01
最近确认：a8d3ad5b8d85a1f303de3d358cfb010d938c7f13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-knowledge-touch-plain-title:flow:FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::知识触达组
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-knowledge-touch-plain-title
  status: active

## FR-build-073 数据口径（在途=执行期注入命中实时记录
变更：2026-10-04-knowledge-touch-plain-title
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 数据口径（在途=执行期注入命中实时记录；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-knowledge-touch-plain-title/requirements.md#FR-02
最近确认：a8d3ad5b8d85a1f303de3d358cfb010d938c7f13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-knowledge-touch-plain-title:flow:FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::在途变更知识触达
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-knowledge-touch-plain-title
  status: active

## FR-build-074 归档=条目内「待复核」标记反查为权威、与实时命中合并去重）以悬停提示（title 属性）形式保留，表述准确
变更：2026-10-04-knowledge-touch-plain-title
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 归档=条目内「待复核」标记反查为权威、与实时命中合并去重）以悬停提示（title 属性）形式保留，表述准确；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-knowledge-touch-plain-title/requirements.md#FR-03
最近确认：a8d3ad5b8d85a1f303de3d358cfb010d938c7f13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-knowledge-touch-plain-title:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::知识触达组
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-knowledge-touch-plain-title
  status: active

## FR-build-075 change-assets-card 组件测试断言同步更新并通过
变更：2026-10-04-knowledge-touch-plain-title
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 / 测试 相关模块就绪；When change-assets-card 组件测试断言同步更新并通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-knowledge-touch-plain-title/requirements.md#FR-04
最近确认：a8d3ad5b8d85a1f303de3d358cfb010d938c7f13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-knowledge-touch-plain-title:flow:FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-knowledge-touch-plain-title
  status: active

## FR-build-076 知识库 FR-auto-frontend-093 条目（引用了旧标签文案）做内容过时最小修正
变更：2026-10-04-knowledge-touch-plain-title
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 知识库 FR-auto-frontend-093 条目（引用了旧标签文案）做内容过时最小修正；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-knowledge-touch-plain-title/requirements.md#FR-05
最近确认：a8d3ad5b8d85a1f303de3d358cfb010d938c7f13

## FR-build-077 resolve_takeover_machine 在会话行 cwd 为空时，取该会话最新 platform_agent_logs 条目的 agent_cwd（主日志优先，缺省任一条目）参与 tier3 匹配
变更：2026-10-04-takeover-tier3-agent-cwd-fallback
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When resolve_takeover_machine 在会话行 cwd 为空时，取该会话最新 platform_agent_logs 条目的 agent_cwd（主；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-takeover-tier3-agent-cwd-fallback/requirements.md#FR-01
最近确认：38dac6640ba5963b70f788745959497d6b97c050

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-takeover-tier3-agent-cwd-fallback:flow:FR-01
  tests: backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier3_fallback_entry_agent_cwd（回退命中）+
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-takeover-tier3-agent-cwd-fallback
  status: active

## FR-build-078 真实形态（会话行 cwd 为空、entry 带 agent_cwd、单机白名单覆盖）下 tier3 唯一命中在线机器并完成接手
变更：2026-10-04-takeover-tier3-agent-cwd-fallback
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 真实形态（会话行 cwd 为空、entry 带 agent_cwd、单机白名单覆盖）下 tier3 唯一命中在线机器并完成接手；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-takeover-tier3-agent-cwd-fallback/requirements.md#FR-02
最近确认：38dac6640ba5963b70f788745959497d6b97c050

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-takeover-tier3-agent-cwd-fallback:flow:FR-02
  tests: backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier3_fallback_entry_agent_cwd（会话行
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-takeover-tier3-agent-cwd-fallback
  status: active

## FR-build-079 会话行与 entry 均无 cwd 时维持原 409 文案与行为（回归不变）
变更：2026-10-04-takeover-tier3-agent-cwd-fallback
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 会话行与 entry 均无 cwd 时维持原 409 文案与行为（回归不变）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-takeover-tier3-agent-cwd-fallback/requirements.md#FR-03
最近确认：38dac6640ba5963b70f788745959497d6b97c050

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-takeover-tier3-agent-cwd-fallback:flow:FR-03
  tests: backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier3_no_cwd_anywhere_409（全空
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-takeover-tier3-agent-cwd-fallback
  status: active

## FR-build-080 新增回退路径有单测覆盖，daemon 模块现有 takeover 测试全绿
变更：2026-10-04-takeover-tier3-agent-cwd-fallback
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 新增回退路径有单测覆盖，daemon 模块现有 takeover 测试全绿；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-04-takeover-tier3-agent-cwd-fallback/requirements.md#FR-04
最近确认：38dac6640ba5963b70f788745959497d6b97c050

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-takeover-tier3-agent-cwd-fallback:flow:FR-04
  tests: backend/app/modules/daemon/tests/test_takeover.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-takeover-tier3-agent-cwd-fallback
  status: active

## FR-build-081 build_handoff_prompt 按 kind 五值契约组装：user_input（sender=system_event 跳过）→ 用户行、reply → 助手行（500 截断）、thinking 跳过、tool_use → 操作行+文件提取、tool_result 失败标记回贴配对 tool_use
变更：2026-10-04-handoff-doc-kind-contract
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-04-handoff-doc-kind-contract/requirements.md#FR-01
最近确认：5d86f73b2cfc02a803dc079a4d0daaddbb85bc94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-handoff-doc-kind-contract:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_sections_and_dedup」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-handoff-doc-kind-contract
  status: active

## FR-build-082 tool_input 兼容 JSON 字符串（含 2KB 截断致 json 解析失败的 regex 兜底）与 dict 双形态，涉及文件节真实数据可产出
变更：2026-10-04-handoff-doc-kind-contract
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given tool_use 段 tool_input 为 2KB 截断的坏 JSON 字符串（path 类键在截断点前）/ When 提取涉及文件 / Then 路径仍进
全文：.sillyspec/changes/archive/2026-10-04-handoff-doc-kind-contract/requirements.md#FR-02
最近确认：5d86f73b2cfc02a803dc079a4d0daaddbb85bc94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-handoff-doc-kind-contract:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_truncated_tool_input_regex_fallback」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-handoff-doc-kind-contract
  status: active

## FR-build-083 _build_handoff_first_prompt 的 cwd 会话行优先、空则回退所选 entry 的 agent_cwd（与 tier3 同口径）
变更：2026-10-04-handoff-doc-kind-contract
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 会话行 cwd 为空且所选 entry 带 agent_cwd / When RPC parsed 组装交接文档 / Then 文档「工作目录」显示 entry
全文：.sillyspec/changes/archive/2026-10-04-handoff-doc-kind-contract/requirements.md#FR-03
最近确认：5d86f73b2cfc02a803dc079a4d0daaddbb85bc94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-handoff-doc-kind-contract:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py「TestHandoffEndToEnd::test_handoff_doc_injected」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-handoff-doc-kind-contract
  status: active

## FR-build-084 测试改用真实契约消息形态，覆盖 system_event 跳过/失败回贴/截断 JSON 兜底/cwd 回退，takeover+handoff 相关测试全绿
变更：2026-10-04-handoff-doc-kind-contract
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given test_takeover_handoff.py 与 test_takeover.py / When 全量执行 / Then 26 用例全绿。
全文：.sillyspec/changes/archive/2026-10-04-handoff-doc-kind-contract/requirements.md#FR-04
最近确认：5d86f73b2cfc02a803dc079a4d0daaddbb85bc94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-handoff-doc-kind-contract:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-handoff-doc-kind-contract
  status: active

## FR-build-085 最近操作行携带紧凑摘要：路径类工具显示入参 path 类字段值、Bash 显示 command 首段，均截 120 字符；无可用摘要时维持纯工具名
变更：2026-10-04-handoff-op-detail
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-04-handoff-op-detail/requirements.md#FR-01
最近确认：0479804512b435b4129e8eacb2b5768802f9c1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-handoff-op-detail:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_sections_and_dedup」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-handoff-op-detail
  status: active

## FR-build-086 摘要提取复用 tool_input JSON 解析链（含截断坏 JSON regex 兜底），涉及文件节与操作行共用同一提取逻辑不漂移
变更：2026-10-04-handoff-op-detail
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given tool_input 为 2KB 截断坏 JSON 且 path/command 键在截断点前 / When 提取 / Then 涉及文件与操作摘要均能取到同一
全文：.sillyspec/changes/archive/2026-10-04-handoff-op-detail/requirements.md#FR-02
最近确认：0479804512b435b4129e8eacb2b5768802f9c1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-handoff-op-detail:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_truncated_tool_input_regex_fallback」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-handoff-op-detail
  status: active

## FR-build-087 失败标记（失败）仍回贴在行尾
变更：2026-10-04-handoff-op-detail
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given tool_use（带摘要）+ 同 tool_use_id 的 is_error tool_result / When 组装 / Then 操作行为 `- 工具名
全文：.sillyspec/changes/archive/2026-10-04-handoff-op-detail/requirements.md#FR-03
最近确认：0479804512b435b4129e8eacb2b5768802f9c1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-handoff-op-detail:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_sections_and_dedup」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-handoff-op-detail
  status: active

## FR-build-088 测试覆盖路径/命令/无摘要三形态，takeover+handoff 测试全绿
变更：2026-10-04-handoff-op-detail
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 更新后的 handoff 测试 / When 全量执行 / Then 26 用例全绿。
全文：.sillyspec/changes/archive/2026-10-04-handoff-op-detail/requirements.md#FR-04
最近确认：0479804512b435b4129e8eacb2b5768802f9c1ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-04-handoff-op-detail:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-04-handoff-op-detail
  status: active

## FR-build-089 默认（不带 --profile）docker compose up -d 不再拉起 litellm 与 litellm-db：docker compose config --services 默认输出不含两者，带 --profile litellm 后包含
变更：2026-10-05-litellm-crashloop-quarantine
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-05-litellm-crashloop-quarantine/requirements.md#FR-01
最近确认：0d419ddad3523713b28806579fb28b198ae920dc

## FR-build-090 隔离可逆且零数据丢失：litellm-db-data 卷与两服务配置原样保留，--profile litellm（或显式 up -d litellm litellm-db，Compose 显式点名自动激活 profile）即可恢复拉起
变更：2026-10-05-litellm-crashloop-quarantine
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-05-litellm-crashloop-quarantine/requirements.md#FR-02
最近确认：0d419ddad3523713b28806579fb28b198ae920dc

## FR-build-091 其余服务（postgres/redis/minio/backend/frontend 等）的 config 渲染输出与改动前一致，仅新增 profiles 门，不改任何镜像/环境/依赖
变更：2026-10-05-litellm-crashloop-quarantine
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-05-litellm-crashloop-quarantine/requirements.md#FR-03
最近确认：0d419ddad3523713b28806579fb28b198ae920dc

## FR-build-092 compose 配置通过 docker compose config 校验无错误（本机 Docker 29.5.2 + deploy/.env 实测）
变更：2026-10-05-litellm-crashloop-quarantine
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-05-litellm-crashloop-quarantine/requirements.md#FR-04
最近确认：0d419ddad3523713b28806579fb28b198ae920dc

## FR-build-093 deploy/docker-compose.yml 注释与 docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 新增 2026-10-05 段一致：profiles 门是临时隔离，选新 tag 的专门变更须一并移除
变更：2026-10-05-litellm-crashloop-quarantine
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-05-litellm-crashloop-quarantine/requirements.md#FR-05
最近确认：0d419ddad3523713b28806579fb28b198ae920dc

## FR-build-094 产出单文件自包含 HTML（零外部网络依赖，双击即开），放在 docs/promo/ 下
变更：2026-10-05-promo-film-page
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：离线双击打开
全文：.sillyspec/changes/archive/2026-10-05-promo-film-page/requirements.md#FR-01
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7

## FR-build-095 影片分多幕场景动画，覆盖平台核心价值：规范驱动（SillySpec 生命周期）、架构（backend/daemon/agent）、多 Agent 编排、实时可视、团队协作与安全
变更：2026-10-05-promo-film-page
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：章节结构
全文：.sillyspec/changes/archive/2026-10-05-promo-film-page/requirements.md#FR-02
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7

## FR-build-096 文案与平台事实一致（12 种宿主 Agent、worktree 隔离、双层审批、Docker Compose 一键起等，取自 README）
变更：2026-10-05-promo-film-page
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：数字可溯源
全文：.sillyspec/changes/archive/2026-10-05-promo-film-page/requirements.md#FR-03
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7

## FR-build-097 提供播放器交互：播放/暂停、可拖动进度条、章节标记与跳转、静音、重播
变更：2026-10-05-promo-film-page
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：拖动进度条
全文：.sillyspec/changes/archive/2026-10-05-promo-film-page/requirements.md#FR-04
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7

## FR-build-098 含 WebAudio 合成背景音乐（无音频文件），支持静音开关
变更：2026-10-05-promo-film-page
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：静音
全文：.sillyspec/changes/archive/2026-10-05-promo-film-page/requirements.md#FR-05
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7

## FR-build-099 视觉使用平台 AI-Native 品牌色（紫 #7C3AED / 青 #0891B2）
变更：2026-10-05-promo-film-page
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：品牌一致性
全文：.sillyspec/changes/archive/2026-10-05-promo-film-page/requirements.md#FR-06
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7

## FR-build-100 在浏览器实际打开验证：无 JS 报错、多时间点截图动画正常、文字无乱码
变更：2026-10-05-promo-film-page
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：验证留痕
全文：.sillyspec/changes/archive/2026-10-05-promo-film-page/requirements.md#FR-07
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7

## FR-build-101 产出 docs/promo/v2/index.html + assets/（26 张真实界面截图），相对路径双击即开
变更：2026-10-05-promo-film-v2
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：离线双击打开
全文：.sillyspec/changes/archive/2026-10-05-promo-film-v2/requirements.md#FR-01
最近确认：7da35f4cb7be766ec46365637cb77fc11bbe2df5

## FR-build-102 影片约 300 秒、11 幕，主角为真实界面截图（浏览器窗口框+Ken Burns 推拉+区域高亮标注），文案人话化、事实与线上环境一致
变更：2026-10-05-promo-film-v2
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：人话文案
全文：.sillyspec/changes/archive/2026-10-05-promo-film-v2/requirements.md#FR-02
最近确认：7da35f4cb7be766ec46365637cb77fc11bbe2df5

## FR-build-103 卡顿修复：禁用逐帧 shadowBlur（辉光精灵化）、静态层缓存（底色/暗角/遮幅）、颗粒降频降合成、自适应画质三档+帧率降级；1080p 实测稳定 ≥55fps
变更：2026-10-05-promo-film-v2
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：自动降级
全文：.sillyspec/changes/archive/2026-10-05-promo-film-v2/requirements.md#FR-03
最近确认：7da35f4cb7be766ec46365637cb77fc11bbe2df5

## FR-build-104 播放器沿用 v1 交互（播放/暂停/章节进度条/跳转/静音/重播/快捷键）
变更：2026-10-05-promo-film-v2
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-05-promo-film-v2/requirements.md#FR-04
最近确认：7da35f4cb7be766ec46365637cb77fc11bbe2df5

## FR-build-105 WebAudio 合成配乐扩展至全片（约 120 小节，分章情绪），幕起始带音效
变更：2026-10-05-promo-film-v2
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-05-promo-film-v2/requirements.md#FR-05
最近确认：7da35f4cb7be766ec46365637cb77fc11bbe2df5

## FR-build-106 浏览器实测：无 JS 报错、全时间轴扫描零异常、≥10 时间点截图视觉验收无乱码无缺陷
变更：2026-10-05-promo-film-v2
状态：superseded
退役理由：宣传片交付物已随 2026-10-05-remove-promo-film 整体删除（docs/promo 目录不存在，见 FR-build-107），本条描述对象不在当前仓库；如需重建须走新变更（2026-10-06 复核）
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-05-promo-film-v2/requirements.md#FR-06
最近确认：7da35f4cb7be766ec46365637cb77fc11bbe2df5

## FR-build-107 docs/promo 目录整体从仓库删除（git rm 显式 pathspec，历史可恢复）
变更：2026-10-05-remove-promo-film
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-05-remove-promo-film/requirements.md#FR-01
最近确认：5eb9b1dd74e57562ae64dee99adcbca21e1844d8

## FR-build-108 .sillyspec/docs/multi-agent-platform/modules/docs.md 中 promo 条目移除
变更：2026-10-05-remove-promo-film
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-05-remove-promo-film/requirements.md#FR-02
最近确认：5eb9b1dd74e57562ae64dee99adcbca21e1844d8

## FR-build-109 删除后仓库无悬空引用（README/模块文档不再指向 docs/promo）
变更：2026-10-05-remove-promo-film
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-05-remove-promo-film/requirements.md#FR-03
最近确认：5eb9b1dd74e57562ae64dee99adcbca21e1844d8

## FR-build-110 deploy/docker-compose.yml 的 litellm 服务新增 logging json-file 有界配置（max-size + max-file）
变更：2026-10-06-litellm-log-rotation
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-litellm-log-rotation/requirements.md#FR-01
最近确认：6a3bd3113b5d405935f3b2de2a54e8c30c9815ba

## FR-build-111 默认 up -d 启用集合不变：docker compose config --services 仍为 5 个核心服务，litellm/litellm-db 仍仅在 litellm profile
变更：2026-10-06-litellm-log-rotation
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-litellm-log-rotation/requirements.md#FR-02
最近确认：6a3bd3113b5d405935f3b2de2a54e8c30c9815ba

## FR-build-112 本机 docker compose config 渲染通过，且 litellm 服务除新增 logging 外无其它配置差异
变更：2026-10-06-litellm-log-rotation
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-litellm-log-rotation/requirements.md#FR-03
最近确认：6a3bd3113b5d405935f3b2de2a54e8c30c9815ba

## FR-build-113 backend/Dockerfile 技能 COPY 源从仓库快照(additional_contexts skills)改为 node-tools 阶段已装 sillyspec 包的 .claude/skills
变更：2026-10-08-backend-skills-follow-cli
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-skills-follow-cli/requirements.md#FR-01
最近确认：c1970cd37f0338f3a3b122bf3638e649e515f18f

## FR-build-114 npm 安装层引用 SILLYSPEC_REFRESH arg（时间戳爆破缓存），deploy/docker-compose.yml 传参、build-and-save.sh 每次打包自动导出新时间戳并回显镜像内 sillyspec 版本
变更：2026-10-08-backend-skills-follow-cli
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-skills-follow-cli/requirements.md#FR-02
最近确认：c1970cd37f0338f3a3b122bf3638e649e515f18f

## FR-build-115 deploy/.env 的 SILLYSPEC_VERSION 置空并注释为应急回滚口（默认走 npm latest）
变更：2026-10-08-backend-skills-follow-cli
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-skills-follow-cli/requirements.md#FR-03
最近确认：c1970cd37f0338f3a3b122bf3638e649e515f18f

## FR-build-116 本地带 refresh 重建后容器内 sillyspec 版本=npm latest 且 /app/sillyspec-skills 与该版本技能数一致（21 个含 flow）、health ok
变更：2026-10-08-backend-skills-follow-cli
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-backend-skills-follow-cli/requirements.md#FR-04
最近确认：c1970cd37f0338f3a3b122bf3638e649e515f18f
