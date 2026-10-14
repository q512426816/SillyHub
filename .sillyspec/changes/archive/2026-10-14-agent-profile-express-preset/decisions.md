---
author: flow-machine-draft
created_at: 2026-10-14T02:49:32.264Z
---
# 决策记录（Decisions）— 2026-10-14-agent-profile-express-preset

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：协议文案把「新功能/大改动」也错误降级进极速通道——文案显式写入规模定级与拒绝降级条款（新功能提示改走完整 brainstorm 流程）。放弃方案 A（加为第三条 `is_system_default=True` 默认档案）：会进 `resolve_profile` 兜底链改变所有未选档案会话的默认人格（破坏零回归），且 seed 去重按 provider 与既有 claude 默认档冲突；放弃方案 B（仅用管理 API 在当前库建一条数据）：DB 重置即丢（规则 11 允许重置）、不可复现，不符合「平台预置」语义。
