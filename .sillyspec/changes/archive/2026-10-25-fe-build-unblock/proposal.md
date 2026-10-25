---
author: flow-machine-draft
created_at: 2026-10-25T12:36:38.202Z
---
# 提案书（Proposal）— 2026-10-25-fe-build-unblock

## 动机

任务原话转写：修复前端构建红态两处类型错误

动机与背景：并行变更 2026-10-25-session-config-deferred-switch 提交面带进两处类型错误致 next build 失败（main 红态、部署构建阻断）：page-helpers.tsx:435 TS2532（noUncheckedIndexedAccess 下 ordered[i-1] 可能为 undefined）；session-panel-variant.test.tsx:238 TS2322（unknown[] 不能赋给 LlmProviderRead[]）。均为类型层面修复，行为零变化（?. 与 as never[] 断言收口）。

成功标准：
- pnpm build 成功（Type error 归零）
- session-panel-variant.test.tsx 13 用例全绿
- 行为零变化：首轮 configChangeLine 前轮传 null 语义不变

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. pnpm build 成功（Type error 归零）
2. session-panel-variant.test.tsx 13 用例全绿
3. 行为零变化：首轮 configChangeLine 前轮传 null 语义不变

## 成功标准（可验证）

1. pnpm build 成功（Type error 归零）
2. session-panel-variant.test.tsx 13 用例全绿
3. 行为零变化：首轮 configChangeLine 前轮传 null 语义不变
