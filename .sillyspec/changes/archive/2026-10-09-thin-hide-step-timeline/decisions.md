---
author: flow-machine-draft
created_at: 2026-10-09T04:28:17.885Z
---
# 决策记录（Decisions）— 2026-10-09-thin-hide-step-timeline

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：出身误判导致厚变更卡片被误隐藏——缓解：复用已被 thin-badge-survives-archive / thin-display-fix 两个变更钉过的既有谓词，不引入新判定逻辑。试过放弃的方案：①按「3 行同一时间戳 + stage=archive」特征过滤补种行——放弃，脆弱启发式且过滤后必空卡；②后端停止补种 steps——放弃，补种行承载归档终态投影语义（status=archived 读时覆盖依赖 latest_progress），前端隐藏是展示层正确切面。
