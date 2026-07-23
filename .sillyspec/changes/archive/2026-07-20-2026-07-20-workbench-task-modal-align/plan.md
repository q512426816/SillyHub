---
author: qinyi
created_at: 2026-07-20T10:18:00
---

# plan.md — 工作台「我的任务」操作弹窗对齐任务计划页

> 变更 `2026-07-20-workbench-task-modal-align` · 复杂度 medium · 纯前端抽取型重构
> 依据 design.md（D-001~D-005）+ proposal.md

## 复杂度判定

medium：新增 1 组件 + 改 2 页面 + 条件删 1 文件，无后端/数据流；动任务计划页有回归风险，靠 verify 兜底。

## Wave 依赖图

```
W1(抽组件) ──┬─→ W2(任务计划页接入) ──┐
             └─→ W3(工作台接入)     ──┴─→ W4(清理+验证)
```

---

## Wave 1：抽公共 TaskDetailModal 组件

- [x] task-01: 新建 TaskDetailModal 组件
  - 新建 `frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx`
  - 从 `task-plans/page.tsx` 逐字搬迁：antd `Modal`(L802-969) + `handleOpenDetail` 拉 `listTaskExecutes`(L263-302) + `handleDetailExecute` 提交(L304-351) + `detailDays` 跨天拆分 + `detailInflightId`
  - props：`{ task: PlanTask|null; mode: "detail"|"execute"; onClose; onChanged? }`（D-004 antd Modal width=760）
  - 内部自管 records/detailDays/inflightId/busy + useEffect[task] 拉记录 + handleDetailExecute
  - 完成标准：组件可独立渲染（task=null 不弹），tsc 通过

---

## Wave 2：任务计划页接入（抽取型，零行为变更）

依赖 W1。

- [x] task-02: task-plans 替换内联 Modal 为组件调用
  - 删内联 Modal L802-969 + handleOpenDetail L263-302 + handleDetailExecute L304-351 + state（detailMode/recordsTask/detailDays/detailInflightId）
  - 新增 detailTask + detailMode state，渲染 `<TaskDetailModal task mode onClose onChanged=load>`
  - 操作列 onClick：启动=handleStart(不变) / 执行=setDetailTask+mode=execute / 详情=setDetailTask+mode=detail
  - 完成标准：详情/执行/启动行为与改造前逐字一致
- [x] task-03: 删 task-plans 遗留代码
  - 删未被调用的 handleResume(L366-392) + ExecuteTaskDialog 引用(L792-800)
  - 完成标准：tsc 通过，task-plans 单测全绿

---

## Wave 3：工作台接入 + 启动行为对齐

依赖 W1。

- [x] task-04: workbench 接入 TaskDetailModal
  - 新增 detailTask + detailMode state，渲染 `<TaskDetailModal>`
  - 详情按钮 → setDetailTask+mode=detail；执行按钮(进行中) → setDetailTask+mode=execute
  - 删只读详情 Dialog(L421-484) + ExecuteTaskDialog 引用 + handleResume + ExecuteTaskState import
  - 完成标准：详情/执行弹出与任务计划页同款窗
- [x] task-05: handleStart 改为只切状态（D-002）
  - startPlanTask → loadTasks + onChanged?.() + toast「任务已启动，点执行填报进展」（R-03）
  - 移除「启动后 setExecute 打开 ExecuteTaskDialog」逻辑
  - 完成标准：启动只切状态不弹窗，tsc 通过

---

## Wave 4：ExecuteTaskDialog 去留 + 验证

依赖 W2 + W3。

- [x] task-06: ExecuteTaskDialog 去留（D-005 / R-02）
  - `grep -r ExecuteTaskDialog frontend/src` 确认引用方
  - 仅 task-plans + workbench → 删 execute-task-dialog.tsx；有第三方 → 保留
  - 完成标准：无孤儿文件，tsc 通过
- [x] task-07: 类型检查
  - `cd frontend && npx tsc --noEmit`
  - 完成标准：零类型错误
- [x] task-08: 前端全量单测零回归（R-01 核心）
  - `cd frontend && npx vitest run`，重点 task-plans / workbench
  - 完成标准：全绿无回归
- [x] task-09: 浏览器实测
  - 任务计划页详情/执行/启动 三路径与改造前一致；工作台详情/执行弹同款窗、启动只切状态
  - 完成标准：两页行为一致

---

## 验收门槛（execute → verify）

- task-07 tsc 必过、task-08 vitest 全绿（任务计划页零回归是硬指标）、task-09 浏览器实测通过
- verify 对照 design.md D-001~D-005 + R-01~R-04 复核
