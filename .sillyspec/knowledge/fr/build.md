## FR-build-001 pm 项目管理 CRUD(覆盖 D-001@v1/D-003@v1/D-005@v1/D-007@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已登录且有 PPM_PROJECT_WRITE 权限的用户；When 创建/查询/修改/删除 项目、客户、成员、干系人；Then 记录落库 + 自动审计;无权限返回 403;支持 /export-excel 导出;附件存 file_urls(JSON)
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-01
最近确认：859a24672

## FR-build-002 plan 计划策划与模板(覆盖 D-001@v1/D-005@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 有 PPM_PLAN_WRITE 权限；When 管理项目计划/里程碑/计划节点模板及子表明细；Then 主子表一致性保存;查询按项目聚合
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-02
最近确认：859a24672

## FR-build-003 problem 问题清单审批流(覆盖 D-002@v1/D-004@v1/D-006@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 问题清单记录(status=已保存)且有 PPM_PROBLEM_WRITE；When 依次执行 nextProcess(申请→开发经理→项目经理→部门经理→验证→关闭)/ rejectProcess / doneTask / closeTask；Then status 按 4 节点状态机流转;bug 类型跳过部门经理;每次流转写 ProcessLog + ProcessTask + audit_log;有未关闭变
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-03
最近确认：859a24672

## FR-build-004 里程碑明细流(覆盖 D-002@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 里程碑明细(status=草稿)；When saveProcess / rejectProcess / changeProcess；Then status 在(草稿→审核→审批→完成)流转,驳回回退,变更生成新版本(parent_id 关联);写 _process 履历
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-04
最近确认：859a24672

## FR-build-005 task 任务与工时(覆盖 D-001@v1/D-003@v1/D-005@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 有 PPM_TASK_WRITE / PPM_WORKHOUR_WRITE；When 管理任务计划/执行/工时,执行 executePlan,统计 stat-by-user/project；Then 任务执行联动 TaskExecute 生成;工时统计正确;支持 /export-excel;个人视图按当前登录人过滤
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-05
最近确认：859a24672

## FR-build-006 kanban 看板(覆盖 D-001@v1, X-001)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 有 PPM_KANBAN_VIEW；When 查询看板人员列/任务卡片/分配/拖拽排序；Then 人员=可见 project_member(可按 Organization 分组);reorder 持久化 kanban_order
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-06
最近确认：859a24672

## FR-build-007 lease GC 周期调度接线
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-01
最近确认：632c87add

## FR-build-008 interactive lease 永不被 GC（红线）
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-02
最近确认：632c87add

## FR-build-009 worktree GC 加 agent_run_id 外键改判据
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
依据决策：D-003@v2
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-03
最近确认：632c87add

## FR-build-010 心跳窗口放宽 + attempt 可配
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-04
最近确认：632c87add

## FR-build-011 failed run 重试入口
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-05
最近确认：632c87add

## FR-build-012 悬空 session 可见性
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
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
