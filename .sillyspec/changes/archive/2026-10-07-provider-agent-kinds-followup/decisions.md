---
author: flow-machine-draft
created_at: 2026-10-06T23:57:45.740Z
---
# 决策记录（Decisions）— 2026-10-07-provider-agent-kinds-followup

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：FR-01 修复后 `agent_kinds` 键出现在所有编辑提交 body 里，既有表单/apiformat 测试若存在对 PATCH body 的全量精确匹配断言（toEqual）会因新增键挂掉——处置：跑定向测试，按新契约补断言键（补字段属契约演进，非改测试凑绿）。试过放弃：①schema 层禁 null（`agent_kinds: list[...]` 去掉 `| None`）——把契约上合法的显式 null 变成 422，第三方调用方行为被动变化，且与同 DTO 其它 nullable 字段风格不一致；②前端映射器发 `agent_kinds: v.agent_kinds ?? null`——引入 null 与缺省两种「不动」歧义表达，无收益。
