## FR-build-001 pm 项目管理 CRUD(覆盖 D-001@v1/D-003@v1/D-005@v1/D-007@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
待复核：recent-quick
场景正文：
- 场景：默认场景 — Given 已登录且有 PPM_PROJECT_WRITE 权限的用户；When 创建/查询/修改/删除 项目、客户、成员、干系人；Then 记录落库 + 自动审计;无权限返回 403;支持 /export-excel 导出;附件存 file_urls(JSON)
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-01
最近确认：859a24672

## FR-build-002 plan 计划策划与模板(覆盖 D-001@v1/D-005@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
待复核：recent-quick
场景正文：
- 场景：默认场景 — Given 有 PPM_PLAN_WRITE 权限；When 管理项目计划/里程碑/计划节点模板及子表明细；Then 主子表一致性保存;查询按项目聚合
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-02
最近确认：859a24672

## FR-build-003 problem 问题清单审批流(覆盖 D-002@v1/D-004@v1/D-006@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
待复核：recent-quick
场景正文：
- 场景：默认场景 — Given 问题清单记录(status=已保存)且有 PPM_PROBLEM_WRITE；When 依次执行 nextProcess(申请→开发经理→项目经理→部门经理→验证→关闭)/ rejectProcess / doneTask / closeTask；Then status 按 4 节点状态机流转;bug 类型跳过部门经理;每次流转写 ProcessLog + ProcessTask + audit_log;有未关闭变
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-03
最近确认：859a24672

## FR-build-004 里程碑明细流(覆盖 D-002@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
待复核：recent-quick
场景正文：
- 场景：默认场景 — Given 里程碑明细(status=草稿)；When saveProcess / rejectProcess / changeProcess；Then status 在(草稿→审核→审批→完成)流转,驳回回退,变更生成新版本(parent_id 关联);写 _process 履历
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-04
最近确认：859a24672

## FR-build-005 task 任务与工时(覆盖 D-001@v1/D-003@v1/D-005@v1)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
待复核：recent-quick
场景正文：
- 场景：默认场景 — Given 有 PPM_TASK_WRITE / PPM_WORKHOUR_WRITE；When 管理任务计划/执行/工时,执行 executePlan,统计 stat-by-user/project；Then 任务执行联动 TaskExecute 生成;工时统计正确;支持 /export-excel;个人视图按当前登录人过滤
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-05
最近确认：859a24672

## FR-build-006 kanban 看板(覆盖 D-001@v1, X-001)
变更：2026-06-20-2026-06-20-ppm-module-migration
状态：active
摘要：默认场景
待复核：recent-quick
场景正文：
- 场景：默认场景 — Given 有 PPM_KANBAN_VIEW；When 查询看板人员列/任务卡片/分配/拖拽排序；Then 人员=可见 project_member(可按 Organization 分组);reorder 持久化 kanban_order
全文：.sillyspec/changes/archive/2026-06-20-2026-06-20-ppm-module-migration/requirements.md#FR-06
最近确认：859a24672

## FR-build-007 lease GC 周期调度接线
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
待复核：recent-quick
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-01
最近确认：632c87add

## FR-build-008 interactive lease 永不被 GC（红线）
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
待复核：recent-quick
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-02
最近确认：632c87add

## FR-build-009 worktree GC 加 agent_run_id 外键改判据
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
待复核：recent-quick
依据决策：D-003@v2
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-03
最近确认：632c87add

## FR-build-010 心跳窗口放宽 + attempt 可配
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
待复核：recent-quick
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-04
最近确认：632c87add

## FR-build-011 failed run 重试入口
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
待复核：recent-quick
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-05
最近确认：632c87add

## FR-build-012 悬空 session 可见性
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
待复核：recent-quick
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-06
最近确认：632c87add

## FR-build-013 lease service 死代码清理
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
待复核：recent-quick
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-07-14-lease-gc-recovery-reliability/requirements.md#FR-07
最近确认：632c87add

## FR-build-014 守护测试（防回归）
变更：2026-07-14-lease-gc-recovery-reliability
状态：active
摘要：（无场景名）
待复核：recent-quick
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

## FR-build-016 move 锚点端点契约（D-013/D-007）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-007@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given 用户对目标工作区具备 WORKSPACE_READ（非管理员还需行级可见）；When POST /workspaces/{id}/move 携带恰好一个锚点（after_id / before_id / to）；Then 服务端按锚点更新位置并返回 {workspace, rebalanced, rank}；锚点三选一违反→422 ANCHOR_CONFLICT；锚点不可见/软删
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-02
最近确认：e21bf19cc

## FR-build-017 列表默认排序接入（D-004/D-011）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户 U 打开列表（或任意筛选组合）；When 服务端执行 list_with_owner(order_user_id=U)；Then 结果按 (无排序行→最前, sort_position ASC, created_at DESC) 排列；无行用户与从未拖过的视图 = 现状 created_a
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-03
最近确认：e21bf19cc

## FR-build-018 页内拖拽（D-003@v2/D-010）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-008@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 默认视图、无筛选激活、页内 ≥2 张卡；When 用户拖动卡片手柄落在本页某位置；Then 前端发一次 moveWorkspace(id, {after_id: 落位前邻卡})，乐观更新，失败回滚刷新；卡片手柄与整卡点击进详情不冲突
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-04
最近确认：e21bf19cc

## FR-build-019 边缘投放带跨页（D-003@v2/D-012）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-003@v2、D-012@v1
场景正文：
- 场景：默认场景 — Given 默认视图拖拽进行中；When 网格上下浮现投放带（第 1 页无上带、末页无下带）；Then 下带提交 {to:"next_page_head"}、上带提交 {to:"prev_page_tail"}（均含 page_size，默认 12）；成功后按响应
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-05
最近确认：e21bf19cc

## FR-build-020 「移动到…」弹窗（D-009@v2）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-009@v2
场景正文：
- 场景：默认场景 — Given 默认视图某张卡的菜单；When 用户选目标页与页首/页尾并确认；Then 前端先拉取目标页默认视图数据，按方向规则计算 id 锚点（页首：向上 before/向下 after=目标页第一张；页尾对偶到目标页最后一张；同页：页首 bef
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-06
最近确认：e21bf19cc

## FR-build-021 筛选态禁拖保护（D-005@v2）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-005@v2
场景正文：
- 场景：默认场景 — Given q/type/unclassified/status≠active/user_id/include_deleted 任一激活；When 列表渲染；Then 手柄呈禁用态（可见灰显）+ 提示"筛选状态下不可拖拽排序"；投放带与「移动到…」入口同步禁用；不发任何 move 请求
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-07
最近确认：e21bf19cc

## FR-build-022 分页数量不变量（D-014）
变更：2026-09-14-workspace-drag-sort
状态：active
摘要：默认场景
依据决策：D-014@v1
场景正文：
- 场景：默认场景 — Given 任意合法 move（页内/投放带/弹窗）；When 移动完成并重新分页；Then total 不变、每页恒 PAGE_SIZE 张（末页允许不满）、序列无重复 id、无空页/丢卡
全文：.sillyspec/changes/archive/2026-09-14-workspace-drag-sort/requirements.md#FR-08
最近确认：e21bf19cc
