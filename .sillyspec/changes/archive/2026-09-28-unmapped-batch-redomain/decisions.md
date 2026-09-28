---
author: flow-machine-draft
created_at: 2026-09-28T13:42:16.181Z
---
# 决策记录（Decisions）— 2026-09-28-unmapped-batch-redomain

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：粗域错置（name/text 级判定的变更可能有个别条目实际属另一端）——条目全文随迁、搜索按内容命中，错置代价是「在相邻模块也能搜到」而非丢失；判定依据全量留档可回溯可再迁。放弃的方案：①逐条 698 次语义判定——成本翻数倍、收益边际（粗桶清理已达成可查找目标）；②给 redomain 工具补 --by-change 参数后用工具迁——正确长期路径（已留档 docs/sillyspec 缺陷2）但等工具排期，本次数据清理不该被工具改进阻塞。 >
