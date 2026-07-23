---
author: qinyi
created_at: 2026-07-20T10:15:49
---

# design.md — 工作台「我的任务」操作弹窗对齐任务计划页

> 变更 `2026-07-20-workbench-task-modal-align` · 方案 A（抽公共 `TaskDetailModal` 两页复用）
> 蓝本：`task-plans/page.tsx` L263-392、L792-969 的内联详情 Modal + 跨天拆分逻辑

## 1. 背景

见 proposal.md §1。任务计划页详情 Modal 内联在页面里（~200 行），工作台用旧 `ExecuteTaskDialog`，两处分叉。抽公共组件消除分叉。

## 2. 设计目标

- `TaskDetailModal` 作为「任务详情 + 执行记录 + 跨天填报」的单一真实源
- 任务计划页改造后行为与现状逐字一致（抽取型重构，零行为变更）
- 工作台接入后获得与任务计划页一致的体验，且启动按钮改为只切状态

## 3. 非目标

见 proposal.md §3。

## 4. 总体方案

把任务计划页 L802-969 的内联 antd `Modal` 及其依赖的页面级 state/函数（`detailMode` / `recordsTask` / `detailDays` / `detailInflightId` / `handleOpenDetail` / `handleDetailExecute`）整体迁入新组件 `TaskDetailModal`，组件自管数据拉取与提交，外层只透传 `task` / `mode` / `onClose` / `onChanged`。

两个调用方改为：
- 任务计划页：删内联 Modal + 相关 state/函数 → 渲染 `<TaskDetailModal>`
- 工作台：删只读 Dialog + `ExecuteTaskDialog` + `handleResume` → 渲染 `<TaskDetailModal>`；`handleStart` 改为只切状态

## 4.5 决策清单

| 编号 | 决策 | 理由 |
|---|---|---|
| D-001 | 选方案 A：抽公共 `TaskDetailModal`，任务计划页 + 工作台两页复用 | 单一真实源消除分叉；B 内联复制会再次漂移（当前问题根源）；C 跳转离开工作台体验差，用户 AskUserQuestion 已否决 |
| D-002 | 工作台「启动」按钮改为只切状态（`startPlanTask` + toast），不弹执行填写窗 | 对齐任务计划页既有行为；用户 AskUserQuestion 确认 |
| D-003 | 工作台不引入「编辑/删除」任务能力 | 个人工作台是执行视角，编辑/删除属管理者视角，超出本次范围 |
| D-004 | `TaskDetailModal` 使用 antd `Modal`（width=760） | 与任务计划页现状逐字一致，保证抽取型重构零行为变更（R-01） |
| D-005 | `ExecuteTaskDialog` 抽取后若全仓无第三方引用则删除，否则保留 | 避免 R-02 误删致编译失败；execute 阶段 grep 门控 |

## 5. 接口定义（TaskDetailModal）

```ts
// frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx
export type TaskDetailMode = "detail" | "execute";

export interface TaskDetailModalProps {
  /** 当前查看的任务；null 表示关闭（不渲染 Modal） */
  task: PlanTask | null;
  /** detail=只读任务信息+执行记录表；execute=进行中任务额外展开跨天填报区 */
  mode: TaskDetailMode;
  /** 关闭回调（提交完成 / 点取消 / 关闭触发） */
  onClose: () => void;
  /** 执行提交成功后回调，外层据此刷新列表/summary（可选） */
  onChanged?: () => void;
}
```

组件内部（从 `task-plans/page.tsx` 迁入，逻辑保持不变）：
- state：`records: TaskExecute[]`、`detailDays`（按 start_time~end_time 拆天的填报行）、`detailInflightId`（对接 status=30 的 in-flight 记录）、`busy`
- `useEffect[task]`：`task` 变化 → `listTaskExecutes({ plan_task_id, page_size: 100 })` 拉记录 → `setRecords` + 派生 `detailDays` / `detailInflightId`
- `buildDetailDays(task, records)`：复刻任务计划页跨天拆分逻辑（首条对接 in-flight，后续天 start+execute）
- `handleDetailExecute(action: "submit" | "complete")`：`executePlanTask({ action, task_execute_id, execute_info, time_spent })` → 重拉 `records` → `onChanged?.()`

Modal 内容（width=760，复刻 L802-969）：
1. 任务信息卡（项目/模块/计划开始~截止/状态/负责人/配合人员/预估工时/备注）
2. 历史执行记录表（开始/结束/耗时/说明）
3. 填报区：仅当 `mode === "execute" && task.status === "进行中" && detailInflightId` 时显示——`detailDays` 按天的「本次耗时 + 执行说明」+「提交(回未开始) / 完成」按钮

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx` | 公共任务详情 Modal（antd，自管记录拉取/跨天拆分/提交） |
| 修改 | `frontend/src/app/(dashboard)/ppm/task-plans/page.tsx` | 删内联 Modal L802-969 + handleOpenDetail L263-302 + handleDetailExecute L304-351 + 相关 state + 遗留 handleResume L366-392 + ExecuteTaskDialog 引用 L792-800；替换为 `<TaskDetailModal>` |
| 修改 | `frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx` | 删只读详情 Dialog + ExecuteTaskDialog 引用 + handleResume + ExecuteTaskState；handleStart 改只切状态；接入 `<TaskDetailModal>` |
| 删除（条件） | `frontend/src/app/(dashboard)/ppm/_components/execute-task-dialog.tsx` | execute 阶段 grep 确认无第三方引用后删除孤儿；否则保留 |

## 7. 数据模型

不涉及（纯前端，无表结构/字段变更）。

## 8. 兼容策略（brownfield）

- 项目未上线，无版本兼容负担（CLAUDE.md 规则 11）
- **任务计划页**：抽取型重构，删除内联代码后用 `<TaskDetailModal>` 等价替换，行为须与改造前逐字一致；verify 阶段前端全量单测（重点 task-plans 相关）+ 浏览器实测对比，任一行为偏移即判回归
- **工作台**：启动按钮行为有变更（由「启动后立即弹填写窗」改为「只切状态」），这是用户明确要求对齐任务计划页的有意变更，不算回归
- 回退路径：若 `TaskDetailModal` 抽取导致任务计划页难修的回归，可临时让任务计划页回退内联 Modal（git revert 该文件），工作台仍用新组件——两页解耦，不影响彼此

## 9. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 抽取型重构引入任务计划页行为回归（detailDays 派生/提交逻辑搬迁出错） | P0 | 组件内逻辑逐字搬迁不改写；verify 跑 task-plans 全量单测；浏览器实测详情/执行/提交三路径 |
| R-02 | `ExecuteTaskDialog` 被第三方页面引用，误删导致编译失败 | P1 | execute 阶段先 `grep -r ExecuteTaskDialog` 全仓确认引用方；仅 task-plans+workbench 时才删 |
| R-03 | 工作台「启动」改只切状态后，用户找不到填报入口（心智惯性） | P2 | 启动 toast 文案提示「点执行填报进展」；执行按钮在「进行中」态立即可见 |
| R-04 | detailDays 跨天拆分依赖任务 start_time/end_time，边界数据（null/同天）处理 | P2 | 完全复刻任务计划页既有边界处理，不新写逻辑 |
