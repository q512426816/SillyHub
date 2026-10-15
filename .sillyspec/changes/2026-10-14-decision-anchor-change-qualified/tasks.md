---
author: flow-machine-draft
created_at: 2026-10-15T00:42:33.492Z
---
# 任务注册表（Tasks）— 2026-10-14-decision-anchor-change-qualified

- [x] task-01: entry-card-list.test.tsx 先行加复合锚断言（同 id 跨变更 fixture，验证：新用例红）
- [x] task-02: entry-card-list.tsx DecisionCard 输出 data-entry-anchor-qualified（id+变更字段齐备才输出，裸锚不动，验证：task-01 转绿）
- [ ] task-03: change-assets-card.test.tsx 加「同 id 跨变更弹窗精确定位」用例 + 深链 anchor 带变更号前缀断言（验证：新用例红）
- [ ] task-04: change-assets-card.tsx 加 changeKey prop + FR/决策行深链前缀 + 弹窗定位复合锚优选；详情页透传 changeKey（验证：task-03 转绿）
- [ ] task-05: knowledge-page.test.tsx 加「anchor 含变更号前缀先试复合锚」用例；knowledge/page.tsx 深链滚动双选择器（验证：转绿）
- [ ] task-06: 回归三文件 vitest + 知识触达/手册既有锚点用例不回退 + tsc + eslint 全绿
