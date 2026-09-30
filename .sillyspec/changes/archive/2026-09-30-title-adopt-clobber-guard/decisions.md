---
author: flow-machine-draft
created_at: 2026-09-30T01:01:01.208Z
---
# 决策记录（Decisions）— 2026-09-30-title-adopt-clobber-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：兜底判定把「裸模板 H1 文本」也算兜底——若作者刻意把自定义标题写成恰命中 TEMPLATE_H1_RE 的纯类型词文案（如就叫「提案书」），其标题会被收养/重派生刷新掉。该口径与 normalize_display_title 既有判定同源，非新标准；真实碰撞面可忽略。放弃的方案：a) Change 加 title_source 标记列区分收养/派生来源——需 schema 变更且两文档路径都要改判定，收益不抵复杂度；b) 只守 documents 路径不守 reparse——审查实证 _apply_parsed 同样无条件覆盖，漏守即缺陷残留（test_apply_parsed_fallback_keeps_semantic_title 先红实证）。遗留（超出本变更）：documents H1 派生值超 500 字在 Postgres 仍会 DataError（documents 路径有 broad except 降级告警；reparse 路径会使该次扫描失败——预存行为，触发需 500+ 字 H1 的病态输入）。
