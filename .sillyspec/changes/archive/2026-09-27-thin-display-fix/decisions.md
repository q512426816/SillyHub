---
author: flow-machine-draft
created_at: 2026-09-27T06:09:53.101Z
---
# 决策记录（Decisions）— 2026-09-27-thin-display-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：steps 兜底判定对「无 steps 记录的标准变更」误判——判定要求 steps.length>0，空 steps 不命中（标准变更 active 期必有步骤记录，归档标准变更 steps 含四阶段痕迹已验证 observation 样本）。钉子测试暴露并修正了 quick 时间窗缺失（历史 quick 误标）；放弃：列表行归档 flow-thin 出身标识——列表投影无 steps/change created_at 有但 change_type=feature 无信号，需后端 is_thin 投影（已列遗留）。
