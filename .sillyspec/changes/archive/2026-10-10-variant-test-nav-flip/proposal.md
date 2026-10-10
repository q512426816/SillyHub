---
author: flow-machine-draft
created_at: 2026-10-10T11:53:02.320Z
---
# 提案书（Proposal）— 2026-10-10-variant-test-nav-flip

## 动机

任务原话转写：上一变更 2026-10-10-single-turn-nav-and-jump-head（已归档）把轮次导航隐藏阈值 <3 放宽为 <1，但漏跑了 session-panel-variant.test.tsx——其回归锚用例用 1 轮 fixture 断言「轮次导航不存在」（锁旧 ql-20260909-005 行为，注释本就预留「常驻断言随行为翻转」），当前 HEAD 该用例红。
成功标准：
- session-panel-variant.test.tsx 回归锚用例断言翻转为「1 轮 fixture 导航列渲染」，全文件绿
- 轮次导航相关全部测试文件（turn-nav-list / turn-catalog / session-history-scroll / page.test / session-panel-history-race / session-panel-variant）全绿
- 除该断言外零代码改动

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. session-panel-variant.test.tsx 回归锚用例断言翻转为「1 轮 fixture 导航列渲染」，全文件绿
2. 轮次导航相关全部测试文件（turn-nav-list / turn-catalog / session-history-scroll / page.test / session-panel-history-race / session-panel-variant）全绿
3. 除该断言外零代码改动

## 成功标准（可验证）

1. session-panel-variant.test.tsx 回归锚用例断言翻转为「1 轮 fixture 导航列渲染」，全文件绿
2. 轮次导航相关全部测试文件（turn-nav-list / turn-catalog / session-history-scroll / page.test / session-panel-history-race / session-panel-variant）全绿
3. 除该断言外零代码改动
