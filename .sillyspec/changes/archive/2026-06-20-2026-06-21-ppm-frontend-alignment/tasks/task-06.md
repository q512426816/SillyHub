---
id: task-06
title: 计划节点模板明细子表行内批量编辑 + project_type 字典 + 责任人下拉
priority: P1
estimated_hours: 6
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
author: qinyi
created_at: 2026-06-21T01:10:00+0800
---

## 目标
计划节点模板明细支持整表行内 input 编辑 + 一键加多行;project_type 用 PpmDictSelect 字典下拉;模块责任人用 PpmUserSelect(res=projectMember)。覆盖 FR-04。

## 文件
- `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx`(改:明细子表行内编辑态 + 字段控件替换)

## 实现要点(对照源)
- 对照源 `plannode/NodeDetailForm.vue`:整表行内 input 编辑(受控 state 存编辑值),工具栏「+ 多行」批量 append 空行,统一保存。
- 状态管理:受控表格行 state + 批量保存(R-04),未保存变更用本地 state 缓冲,提交时 diff。
- project_type 列:PpmDictSelect(task-01,字典类型=project_type)替换纯文本。
- 模块/明细责任人列:PpmUserSelect(res=projectMember,searchData=当前模板 project_id)。
- 复用 task-02 PpmSubTable 的行内编辑能力。

## 验收
- [ ] 明细子表可整表行内编辑(非弹窗)
- [ ] 「+ 多行」批量加行,统一保存成功
- [ ] project_type 字典下拉,责任人按项目过滤下拉
- [ ] 对照源 `NodeDetailForm.vue` 交互一致
- [ ] frontend typecheck + build 通过
