---
author: flow-machine-draft
created_at: 2026-10-13T03:00:28.585Z
---
# 提案书（Proposal）— 2026-10-13-subagent-stub-reconcile

## 动机

任务原话转写：动机:历史会话时间线里子代理容器(分页窗口截断致派发行缺失时落成 stub 段)永久显示「运行中」且名字回落类型名 general-purpose;实测全新浏览器仍复现。修法:渲染层与会话任务快照(GI GET /sessions/{id}/tasks 已返回 tool_use_id,后端零改动)按 tool_use_id 对账收敛。
成功标准:
- 子代理容器头(stub 与无任务元数据且运行中的 tool 段)按 tool_use_id 匹配任务快照:匹配到终态行时徽章/状态点/时长按快照展示(已完成/失败/已停止+权威时长),不再恒显「运行中」;无匹配维持现状
- 容器头名称优先快照 task_name(真实任务名),stub 不再显示类型名 general-purpose;无匹配维持 subagentType 回退
- 有任务元数据的 tool 段与已配对结果的段行为不变(零回归);补前端回归测试

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 子代理容器头(stub 与无任务元数据且运行中的 tool 段)按 tool_use_id 匹配任务快照:匹配到终态行时徽章/状态点/时长按快照展示(已完成/失败/已停止+权威时长),不再恒显「运行中」;无匹配维持现状
2. 容器头名称优先快照 task_name(真实任务名),stub 不再显示类型名 general-purpose;无匹配维持 subagentType 回退
3. 有任务元数据的 tool 段与已配对结果的段行为不变(零回归);补前端回归测试

## 成功标准（可验证）

1. 子代理容器头(stub 与无任务元数据且运行中的 tool 段)按 tool_use_id 匹配任务快照:匹配到终态行时徽章/状态点/时长按快照展示(已完成/失败/已停止+权威时长),不再恒显「运行中」;无匹配维持现状
2. 容器头名称优先快照 task_name(真实任务名),stub 不再显示类型名 general-purpose;无匹配维持 subagentType 回退
3. 有任务元数据的 tool 段与已配对结果的段行为不变(零回归);补前端回归测试
