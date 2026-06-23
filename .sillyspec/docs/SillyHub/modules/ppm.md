---
schema_version: 1
doc_type: module-card
module_id: ppm
author: qinyi
created_at: 2026-06-20T15:35:00+0800
---

# ppm — 项目与问题管理

## 定位
平台级业务模块(不绑 workspace),从 dept_project_back/ppdmq-module-ppm 全量复刻。路由 `/api/ppm/*`,`require_permission_any(PPM_*)`。

## 契约摘要
- **5 子域**:`project`(项目/客户/成员/干系人)、`plan`(模板 + ps 计划/里程碑)、`problem`(问题清单 + 变更)、`task`(任务计划/执行/工时)、`kanban`(看板聚合)
- **common**:`crud`(分页泛型 Page[T])/`export`(openpyxl)/`fsm`(状态机基类,参照 change.TRANSITIONS)
- **21 表 / 102 路由 / 2 套状态机**(问题 4 节点审批流 + 里程碑 draft→review→approve→done + 变更版本链)
- **权限**:PPM_PROJECT_*/CUSTOMER_*/PLAN_*/PROBLEM_*/TASK_*/WORKHOUR_*/KANBAN_*(24 个,auth/permissions.py)

## 关键逻辑
- 问题审批流:申请→开发经理→项目经理→部门经理→验证→关闭;**bug 跳过部门经理**;按项目角色查 project_member 找下一处理人(缺失则挂起 ProblemPendingAssignment)
- 里程碑变更:走 `parent_id` 版本链(旧版 archived,新版 draft),不走状态迁移
- 复用 auth(User/Org/Role)、audit_logs、settings

## 注意事项
- 平台级,**无 workspace_id**
- 通知走 audit_logs(**无独立站内信**),附件用 `file_urls` JSON(**无上传服务**)
- silly 动态表单已弃(状态机替代),多租户 tenant_id 丢弃
- 工时统计 stat-by-user/project;看板 reorder 持久化 kanban_order
- 看板 matrix(人员×日期)任务**跨天连续展示**(ql-007):`TaskCardVO` 返回 `start_time`,前端 `taskDateKeys` 按 `start_time~deadline` 区间每一天落 cell(限 366 天);DateNav 仅控展示列不参与任务拉取过滤(对齐源 selectKanbanCards 无日期过滤)

## 人工备注
<!-- MANUAL_NOTES_START -->
迁移自 dept_project_back/ppdmq-module-ppm + dept_project_front(变更 2026-06-20-ppm-module-migration)。源 ~120 接口/22 表/2 套审批流。e2e 动态验证待运行环境。
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260621-004-f2a1 | migrate_from_ruoyi module 顺序 bug + resync 重同步模块数据(78 条)
- ql-20260621-005-7c3e | 看板任务卡片缺失(DateNav→filters 移除,任务默认全量对齐源)
- ql-20260621-006-b4d8 | ps_project_plan.project_id 全 NULL 修复(migrate 漏 map_fk + resync)
- ql-20260621-007-c5e9 | 看板 matrix 任务跨天连续展示(start_time~deadline 每一天)
- ql-20260621-008-d6f2 | milestone 详情抽屉 isValid 报错(DatePicker Form.Item name + 显式 value 冲突,去 name)
- ql-20260621-009-e8a1 | 看板任务详情对齐源 TaskDetailDrawer(补优先级/进度/创建/更新时间)
- ql-20260621-010-a1b2 | hotfix 看板 API 500(service _derive_priority 用未 import 的 UTC)
- ql-20260622-014-c8f3 | /project-plan GET 改 response_model=Page[T] 返回 total(原 list 丢 total),前端 listProjectPlans 返 PageResp + page.tsx 受控分页 (page/pageSize/total + onChange 重查 + 查询回到 page=1)
- ql-20260622-015-7e2a | project-plans 页面默认 pageSize 10→20 + 左侧项目经理树改受控 expandedKeys 强制全展开(defaultExpandAll 异步 treeData 不可靠)
- ql-20260622-016-3b9d | /project-plan GET 加 PsProjectPlanListReq 过滤(原 PageReq 丢过滤参数 → 前端过滤失效);service ilike+时间区间;前端 RangePicker onChange 选中即查
- ql-20260622-017-4a1f | project-plans 表格 scroll.y:500 去掉(自适应高度);Table.Summary 移除 fixed="bottom"(无 y 时吸底无意义);已有分页每页≤20 不需要固定高度兜底
- ql-20260622-018-9d2c | project-plans 表格 scroll.y 改 "calc(100vh - 300px)" 按视窗自适应(撤回 ql-017 误解);Table.Summary 恢复 fixed="bottom" 吸底
- ql-20260622-019-5b6c | project-plans 表格高度预留 300→430px
- ql-20260622-020-8c1a | /project-plan/export-excel 422 修复:FastAPI 路由按注册顺序匹配,字面量路径 export-excel 被 {item_id} 路径参数拦截当 UUID 解析失败 → 把 export 路由移到 {item_id} 之前
- ql-20260622-022-6a1f | 前端 downloadExcel 忽略后端 Content-Disposition 文件名 → 新增 parseFilenameFromContentDisposition 解析 RFC 5987 filename*=UTF-8'' header,优先用服务端文件名(项目计划_YYYYMMDD_HHmmss.xlsx)
- ql-20260622-030-7e2a | /problem-list GET 加过滤 Query(keyword/status多值/project_id/pro_type/is_urgent/find_time_start/end) + response_model 改 Page[ProblemListResp] 返 total;service.list_problems 构造 where_clauses(keyword 跨 6 字段 ilike / status in / 其余精确 / find_time 区间);apiFetch query 支持 string[] append 多值编码
- ql-20260622-033-d5e8 | /problem-list/export-excel 422 修复:FastAPI 按注册顺序匹配,字面量路径 export-excel 被 {item_id} 参数化路由拦截当 UUID 解析 → 把 export_problems / export_problem_changes(及对应 _COLUMNS)从文件末尾移到各自 list 端点紧邻之后、{item_id} GET 之前(同 ql-020 project-plan 同款问题)
- ql-20260622-034-c3a7 | problem-list 按钮/导出对齐 project-plans:前端 "查询"→"搜索" 去掉 outline(回退 primary);后端 export_problems / export_problem_changes 文件名改时间戳格式 `问题清单_YYYYMMDD_HHmmss.xlsx` / `问题变更_YYYYMMDD_HHmmss.xlsx`(对齐 ql-022-6a1f project-plan)
- ql-20260622-037-d4c1 | /problem-change GET 加过滤 Query(keyword/status多值/created_at_start/end) + response_model 改 Page[ProblemChangeResp] 返 total;service.list_changes 构造 where_clauses(or_ ilike 跨 4 字段 / status in / created_at 区间);前端 listProblemChanges 返 PageResp + page.tsx 受控分页(page/pageSize/total + onChange 重查 + 查询回到 page=1)
- ql-20260623-002-f3b8 | /task-plan/page + /personal-task-plan/page + /task-plan/export-excel 3 端点加过滤 Query(status多值/month/year/start_time/end_time/work_partner);PlanTaskPageReq.status 由 str 改 list[str],新增 start_time/end_time/work_partner 字段;service.page 加 IN/区间/ilike 过滤;export 文件名改时间戳格式 `任务计划_YYYYMMDD_HHmmss.xlsx`(对齐 ql-022-6a1f project-plan)
