---
id: task-04
title: 里程碑主子 expand + 模块三级(实施阶段:里程碑→模块→明细)
priority: P0
estimated_hours: 8
depends_on: [task-01, task-02]
blocks: [task-05]
requirement_ids: [FR-03]
decision_ids: []
author: qinyi
created_at: 2026-06-21T01:10:00+0800
---

## 目标
里程碑列表行 expand 后内嵌明细子表;实施阶段支持「里程碑→模块→明细」三级层级(模块为中间层)。用 PpmSubTable 组件承载展开行。覆盖 FR-03。

## 文件
- `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx`(改:表格行加 expand)
- `frontend/src/components/ppm-sub-table.tsx`(task-02 产出,本任务消费/扩展)

## 实现要点(对照源)
- 对照源 `psplannode/index.vue`:顶层表格 expand 行展开 `NodeDetailList`(明细节点列表)。
- 主表行 expand 触发 → PpmSubTable 渲染当前里程碑的 ps_plan_node_detail 列表(列:节点名/责任人 PpmUserSelect/工期/计划起止)。
- 模块三级:实施阶段视图,里程碑行 expand → 模块中间层(PpmSubTable 二级,列:模块名/责任人/进度)→ 模块行再 expand → 明细节点(三级)。
- 三级用 PpmSubTable 嵌套 expand + 行内只读(编辑留 task-06)。
- 复用 lib/ppm 取明细/模块接口(task-02 已加),无新增接口。

## 验收
- [ ] 里程碑列表行可 expand,展开内嵌明细子表(非新页面)
- [ ] 实施阶段视图三级层级正确:里程碑→模块→明细,逐级 expand
- [ ] PpmSubTable 组件被复用,不重复造轮子
- [ ] 对照源 `psplannode/index.vue` 交互一致
- [ ] frontend typecheck + build 通过
