---
plan_level: full
reason: 前端组件族多文件改造（6 改 + 2 新源文件 + 3 测试文件），含 context/面板/槽位状态三个联动面，需 Wave 依赖编排
estimated_files: 11
cross_module: true
has_schema_change: false
has_state_machine_change: false
needs_parallel_execution: true
needs_human_review: true
---

# 实现计划（Plan）— 会话子代理三分栏展示

> 决策追踪：任务编排执行 D-001@V1（三分栏交互模型）→ task-01/03/04；D-002@V1（默认视图行为补全）→ task-01/02/03；D-003@V1（方案 A 右栏单槽位/面板归属 SessionPanel）→ task-03/04。无未覆盖决策。

## Spike 前置验证

无——复用组件签名已经独立审查逐一对码（panel-resizer.tsx usePanelWidth/PanelResizer、portal-file-panels.tsx 宽度常量、turn-state.ts findSegmentById、turn-segment-views.tsx SubagentBlockView 590-760、turn-timeline.tsx 1183-1188 过滤点、sessions-portal.tsx filePreview 195/659-663/980-1006），无技术不确定性。

## Wave 1（并行，无依赖）

- task-01
- task-02

依赖说明：task-01（context + SubagentBlockView 双模式）与 task-02（对话视图过滤放宽）文件互不相交可并行；task-01 是 task-03 的契约输入。

## Wave 2（依赖 Wave 1）

- task-03

依赖说明：SubagentDetailPanel + SessionPanel props + 面板根 flex 行消费 task-01 的 SubagentPanelContext 与紧凑卡片；产出 task-04 需要的 SessionPanel props 契约。

## Wave 3（依赖 Wave 2）

- task-04

依赖说明：portal 槽位互斥接线（subagentView/双向清零/props 装配）消费 task-03 的 SessionPanel props；收尾集成验证。

## 风险对照（摘 design §8）

- 中栏不再内联细节 → task-01 无 context 回退分支 + dialog 零回归用例
- 根 flex 改造高度链 → task-03 仅 openSubagentId 非空才切根布局 + session-panel-dialog 回归
- handleJumpToSubagent 行为变更 → task-03 双路径（page 开右栏 / dialog 旧定位）
- 对话视图混入非对话元素 → task-02 dispatch_worker 不进对话视图约束 + 弱化样式
- 面板归属两棵树宽度记忆 → task-03 与文件预览同 LS 键 + 互不重叠生命周期（design §5.B）

## 需求覆盖（FR → Wave）

- FR-01 右栏单槽位互斥 → Wave 2（task-03 props 契约）+ Wave 3（task-04 双向清零/会话切换清零）
- FR-02 中栏紧凑卡片 → Wave 1（task-01 双模式）
- FR-03 右栏详情面板 → Wave 2（task-03 SubagentDetailPanel + flex 行 + 目录联动）
- FR-04 对话视图可见性 → Wave 1（task-02 过滤放宽）
- FR-05 兼容与回归 → Wave 1（task-01 无 context 回退）+ Wave 2（task-03 dialog 零回归）+ Wave 3（task-04 既有用例回归）
