---
author: flow-machine-draft
created_at: 2026-10-08T15:51:04.491Z
---
# 决策记录（Decisions）— 2026-10-08-ci-sweep-2-migration-anchor

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：并行会话持续加迁移导致锚反复红——结构性成本已由约定承担（每次新迁移随动一行），改用「断言单 head + 链尾 ≥ 某版本」弱断言会失去精确锚定防分叉价值，放弃。
