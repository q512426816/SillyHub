---
author: flow-machine-draft
created_at: 2026-09-27T10:13:07.856Z
---
# 决策记录（Decisions）— 2026-09-27-knowledge-governance-cards

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：与 CLI digest 的口径分叉（unmapped 基线消音平台侧没有、绑定信号缺失）——双出口数字可能不一致；缓解：unmapped 只进 totals 降展示级、绑定信号 CLI 独有已在两端注释与卡面处置文案交叉指引，v2 可经 daemon RPC 直采 CLI digest --json 收敛单源。次风险：伪域 v1 只读卡（迁移动作 CLI 手工）——动作回传 v2；阈值与 CLI 同值但两处字面量（跨仓无法单源），注释互指。放弃方案：daemon RPC 实时跑 CLI digest——正确终态但需 daemon+RPC 双端改造，v1 平台直算已解 3/4 信号可见性，性价比不对等。
