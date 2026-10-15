---
author: flow-machine-draft
created_at: 2026-10-15T08:39:20.384Z
---
# 决策记录（Decisions）— 2026-10-15-pseudo-domain-migration

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：主域机械裁决的错分（如 ci-recurrence-guard 横断变更落 frontend_components 而非 CI 语义域）——接受：规则与触达路由同源（判定集含 frontend_components 时注入必达），横断变更多域命中下无唯一正确解；人工改判两处已在案。次风险：6 条无变更条目主题判域 daemon 属人工判断——留痕可复议。第三风险：坏段/重复段修复属数据手术——归档真相源核验+段字节级操作+validate ok+git 留痕四重保护。放弃方案：①按条目语义逐条人工判域（436 条不可行）；②保持 unmapped 只设基线消音（用户明示迁真域）；③重蒸馏迁移（归档源改不动）。
