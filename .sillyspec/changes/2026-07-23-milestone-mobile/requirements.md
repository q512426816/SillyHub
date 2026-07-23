---
author: qinyi
created_at: 2026-07-23 10:21:07
---
# 需求规格（Requirements）— 里程碑明细移动端整页完整复刻

## 角色
| 角色 | 说明 |
|---|---|
| 项目经理 / 计划员 | 开立里程碑、模块、明细，编辑 draft 明细 |
| 项目执行人 | 变更自己负责的明细信息，查看明细 |
| 审核人 | 审核 / 审批明细（本变更预留入口与只读展示） |
| 只读用户 | 无编辑权限，全程只能查看 |

## 功能需求

### FR-01：三层钻取入口
覆盖决策：D-001, D-002
Given 用户从项目计划移动卡片点「里程碑」进入
When 页面读取 plan 参数
Then 展示里程碑列表（第一层），有 has_module 的里程碑可点进模块列表（第二层），明细可点进明细列表（第三层），每层可返回

### FR-02：里程碑列表与 CRUD（第一层）
覆盖决策：D-001, D-006
Given 在里程碑列表
When 用户有 plan.can_edit
Then 可新建 / 编辑 / 删除里程碑，卡片显示序号/总体阶段/任务主题/责任人/工作量/周期/has_module 标识
Given 用户无 plan.can_edit
Then 只能查看，看不到新建/编辑/删除按钮

### FR-03：模块列表与 CRUD（第二层，仅 has_module 里程碑）
覆盖决策：D-001, D-002
Given 进入一个 has_module 的里程碑
When 用户有编辑权
Then 可新建 / 编辑 / 删除模块，顶部有「新建模块」「导入模块」入口；卡片显示模块名/计划类型/责任人/工作量/周期
Given 里程碑非 has_module
Then 不展示模块层

### FR-04：明细列表与 CRUD（第三层）
覆盖决策：D-001, D-003
Given 在明细列表
When 用户有编辑权
Then 可新建明细、查看/编辑 draft 与 rejected 明细、对 done 明细发起变更(changeInfo)、删除明细
Then 卡片显示明细阶段/任务主题/角色/工时/周期/执行人/执行状态/状态徽标/变更版标识

### FR-05：8 mode 表单分发
覆盖决策：D-003, D-004, D-005
Given 打开某明细的表单
When 按 modeForStatus + 列表显式覆盖分发 mode
Then 按 mode 显示对应字段块与可编辑性：
- create：开立信息全字段可编辑
- edit：开立信息全字段可编辑（draft/rejected）
- changeInfo：开立信息全字段可编辑，不改状态不出版本（done 变更）
- view：全只读
- audit / approve / change / changeApprove：开立只读 + 对应审批/变更块（本变更预留）
When 提交
Then create→保存(draft)/提交(done)；edit→保存(update)/提交(update+save)；changeInfo→提交(update→sync task)

### FR-06：审批流程（表单内提交）
覆盖决策：D-004
Given 用户在表单内点提交/驳回/变更
When 二次确认通过
Then 调 save / reject / changePlanNodeDetailProcess；成功后刷新列表
When 后端返回 422/409（并发乐观锁）
Then 提示「已被他人处理」并 reload

### FR-07：Timeline 履历
覆盖决策：D-001
Given 查看明细详情
When 调 listPlanNodeDetailProcesses
Then 纵向时间线展示处理历史，reject 染红 / change 染橙 / 其余染绿

### FR-08：工作日联动
覆盖决策：D-006
Given 在 create / edit / changeInfo 模式
When 用户填 plan_begin_time + plan_workload
Then 自动用 addWorkingDaysDate（含 2026 节假日表）算出 plan_complete_time，结果与桌面一致

### FR-09：版本链
覆盖决策：D-001
Given 明细发生过变更
When 调 listPsPlanNodeDetailVersions
Then 展示版本链（parent_id 关联）

### FR-10：模块 Excel 导入
覆盖决策：D-002, D-006
Given 在模块层（has_module 里程碑）
When 用户走 上传 → 预览 → 提交 三步
Then importModulesPreview（FormData）→ importModulesCommit（JSON）完成批量导入

### FR-11：明细导出
覆盖决策：D-001, D-006
Given 在明细列表
When 用户点导出
Then exportMilestoneDetails 下载 Excel

### FR-12：权限
覆盖决策：D-006
Given readOnly = !(plan.can_edit)
When readOnly = true
Then 全页禁写入（建/改/删/导入），导出与查询不禁
When 块级控制
Then baseEditable(create/edit/changeInfo) / auditEditable(audit+audit_user 匹配) / changeApproveEditable(changeApprove+approve_user 匹配)，matchAnyUser 匹配逗号串用户

## 非功能需求
- 兼容性：前端跨平台浏览器，Windows/Linux/macOS 开发环境一致
- 可回退：纯前端新增页与组件，删除即可回退，不影响桌面与后端
- 可测试：三层钻取、mode 分发、工作日联动、权限块各组件单测覆盖；关键流程集成测试
- 零回归：桌面 `milestone-details/**` 现有测试全绿，不新增桌面改动
- 性能：三层按需钻取加载，避免全量渲染；大列表虚拟化或分页（plan 阶段定）

## 决策覆盖矩阵
（决策详见 design.md 第 10 节）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001 | FR-01~04, 07, 09, 11, 12 | 整页完整复刻（三层 + 8mode） |
| D-002 | FR-01, 03, 10 | 三层钻取式（非行内展开），竖屏 |
| D-003 | FR-04, 05 | modeForStatus 分发 + 列表显式覆盖 |
| D-004 | FR-05, 06 | 流程在表单内提交 |
| D-005 | FR-05 | MVP 优先 create/edit/changeInfo/view，其余预留 |
| D-006 | FR-02, 03, 08, 10, 11, 12 | 数据 100% 复用 lib |
