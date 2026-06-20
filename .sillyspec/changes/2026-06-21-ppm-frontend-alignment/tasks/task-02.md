---
id: task-02
title: W0 后端 project-member 过滤 + lib 参数 + PpmSubTable
priority: P0
estimated_hours: 4
depends_on: []
blocks: [task-03, task-04, task-06]
requirement_ids: [FR-01]
decision_ids: []
author: qinyi
created_at: 2026-06-21T01:10:00+0800
---

## 目标
为审批人/成员按角色筛选提供后端 query 增强;封装主子展开+行内编辑通用子表组件,支撑 W2/W3。

## 文件
- 修改 `backend/app/modules/ppm/project/router.py`(project-member page 路由)
- 修改 `backend/app/modules/ppm/project/service.py`(project-member page service)
- 修改 `frontend/src/lib/ppm/project.ts`(成员 page 加过滤参数)
- 新增 `frontend/src/components/ppm-sub-table.tsx`

## 实现要点(对照源,不写代码)
- **后端过滤**(不改签名,加可选 query 参数,保持向后兼容):
  - router:project-member page 端点接收 query `pm_project_id: Optional[int] = None`、`role_name: Optional[str] = None`(对应源 SillySelect projectMember 资源 url `/pm/project-member/page` 的 searchData 过滤语义)
  - service:WHERE 条件追加 `pm_project_id == :pm_project_id`、`role_name LIKE %role_name%` 或精确匹配(按字段类型定),仅当参数非 None 时拼接
  - 不改现有返回结构,不加新 schema 字段
- **lib/ppm/project.ts**:成员 page 调用函数签名追加 `filters?: { pm_project_id?: number; role_name?: string; searchText?: string }`,透传 query 参数
- **PpmSubTable**(对照源主子展开场景):
  - props `{ rowKey; columns; expandColumns; dataSource; onRowSave; expandableTriggerField? }`
  - 基于 AntD Table `expandable.expandedRowRender` 渲染子表
  - 子表支持行内编辑模式(双击/编辑按钮切换 Input),保存回调 `onRowSave(row)`
  - 主行展开图标 + 展开时延迟加载子数据(若提供 `onExpand`)
  - 复用 ppm-resource-table 风格,不重写列定义逻辑

## 验收
- [ ] `GET /api/ppm/project-member?page&pm_project_id=X` 只返回该项目成员
- [ ] `&role_name=Y` 按 role_name 过滤生效
- [ ] 不传参数时行为与改动前一致(回归无破坏)
- [ ] lib 调用函数支持新 filters,旧调用不传仍工作
- [ ] PpmSubTable 能展开主行、子表行内编辑保存
- [ ] backend pytest 现有 ppm 用例通过 + 新增过滤用例通过
- [ ] frontend typecheck + build 通过
