---
author: flow-machine-draft
created_at: 2026-10-27T23:43:41.505Z
---
# 决策记录（Decisions）— 2026-10-28-cgroup-v2-watermark-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：混合挂载形态（v2 无限制 `max` 且 v1 文件同时在）会回退用 v1 limit 算水位——语义上仍是「存在某限制」，方向安全，且该形态实际不存在于统一层级宿主。试过放弃的方案：为 `max` 字面量加显式分支返回哨兵值——放弃，因为现有 ValueError 落回路径已得到正确终态（None 跳过），加分支只增加状态面。
