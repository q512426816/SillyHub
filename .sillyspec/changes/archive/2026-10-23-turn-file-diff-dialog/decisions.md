---
author: flow-machine-draft
created_at: 2026-10-23T00:36:35.806Z
---
# 决策记录（Decisions）— 2026-10-23-turn-file-diff-dialog

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是补丁配对覆盖率——subagent（Task 工具）内部的 Edit 日志带 parent_tool_use_id/depth 归属列，文件卡 numstat 归因不区分主/子代理；方案按「本轮全部日志（含子代理行）」配对，多出的补丁段照实展示（它们确实改了该文件），不做主/子过滤（过滤反而丢内容）。Write 新建文件的 structuredPatch 可能缺行号形态，parseStructuredPatch 对形状不符返回 null → 该段占位「补丁格式不可解析」，不伪造。 试过放弃的方案：① 给 daemon 快照 DTO 增加 patch 文本字段——放大 /runs 全量轮列表载荷（500 文件上限 × patch 体积），且历史轮无数据，放弃；② 新增 daemon `git diff baselineHead -- path` 端点实时重算——可覆盖 shell 归因行，但需 daemon HTTP 面 + backend 代理，且历史正确性妥协（后续轮改同一文件后 diff 不再是「本轮」内容），跨度超出本需求决策面，记为后续独立变更候选；③ 点击跳转 agent-log 视图——非弹窗形式，违背用户明示「弹窗形式」。
