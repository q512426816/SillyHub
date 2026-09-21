## FR-lib-ppm-001 PpmUserSelect 基础组件(覆盖 D-009@v1)
变更：2026-06-20-2026-06-21-ppm-frontend-alignment
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ppm 表单含 *_user_id 字段；When 用 PpmUserSelect(res + searchData)；Then 按 res(user/projectMember/role/project)+ searchData(pm_project_id/role_name)过滤,服务
全文：.sillyspec/changes/archive/2026-06-20-2026-06-21-ppm-frontend-alignment/requirements.md#FR-01
最近确认：44a5ed491

## FR-lib-ppm-002 项目成员角色+联动(覆盖 D-009@v1)
变更：2026-06-20-2026-06-21-ppm-frontend-alignment
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 项目成员表单；When 选角色(res=role 多选)+ 选用户(res=user)；Then 角色 auth.Role 多选;选用户联动回填 depart_name/phone/user_name;项目→成员入口
全文：.sillyspec/changes/archive/2026-06-20-2026-06-21-ppm-frontend-alignment/requirements.md#FR-02
最近确认：44a5ed491

## FR-lib-ppm-003 里程碑主子+审批表单
变更：2026-06-20-2026-06-21-ppm-frontend-alignment
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 里程碑明细；When expand 里程碑→内嵌明细(模块三级)+ 按状态操作(审核/审批/变更差异化表单)；Then 主子展开 + 模块层 + 状态化表单 + Timeline 履历
全文：.sillyspec/changes/archive/2026-06-20-2026-06-21-ppm-frontend-alignment/requirements.md#FR-03
最近确认：44a5ed491

## FR-lib-ppm-004 计划节点模板行内编辑+字典
变更：2026-06-20-2026-06-21-ppm-frontend-alignment
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 计划节点模板明细；When 行内批量编辑 + project_type 字典 + 责任人下拉；Then 整表行内编辑 + 字典选项 + 责任人 PpmUserSelect
全文：.sillyspec/changes/archive/2026-06-20-2026-06-21-ppm-frontend-alignment/requirements.md#FR-04
最近确认：44a5ed491

## FR-lib-ppm-005 细节(附件URL/工作日/处置)(覆盖 D-010@v1)
变更：2026-06-20-2026-06-21-ppm-frontend-alignment
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 附件/工作日/问题处置；When 附件 URL 管理(PpmFileUrls)+ 工作日联动 + 处置按钮；Then 多 URL 增删(D-010)+ 选开始+工时算完成 + 处置操作
全文：.sillyspec/changes/archive/2026-06-20-2026-06-21-ppm-frontend-alignment/requirements.md#FR-05
最近确认：44a5ed491
