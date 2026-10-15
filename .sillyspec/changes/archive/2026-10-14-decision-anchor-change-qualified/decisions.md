---
author: flow-machine-draft
created_at: 2026-10-15T00:59:45.902Z
---
# 决策记录（Decisions）— 2026-10-14-decision-anchor-change-qualified

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：复合属性是新增 DOM 契约，若未来其它消费方按 `[data-entry-anchor=…]` 全量枚举做统计会少算复合锚——已核查现网消费方（知识库页 selectEntry、沉淀资产卡弹窗、测试断言）均为「按值查单个」，无枚举面。 - 弃案 A：改裸 `data-entry-anchor` 的值为复合形态——会破坏旧深链与潜在收藏链接，且 INDEX/触达等裸锚消费方需同步迁移，改动面大收益零，弃。 - 弃案 B：后端 assets 响应给 decisions 条目加变更号字段（前端免传 changeKey）——需改 OpenAPI schema + gen:types + 前端类型同步，而 changeKey 在详情页现成可得，后端改动纯属多余，弃。
