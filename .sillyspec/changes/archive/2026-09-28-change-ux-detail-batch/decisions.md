---
author: flow-machine-draft
created_at: 2026-09-28T09:32:06.868Z
---
# 决策记录（Decisions）— 2026-09-28-change-ux-detail-batch

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：布局类改动（grid/h-64/滚动）在真实浏览器的观感无法由 jsdom 断言——已按 tailwind 语义保守实现（md 两列、h-64 固定高、min-h-0 flex-1 overflow-y-auto 链条齐全），真机目验移交用户；列表行修复是标准 flex 陷阱修法（min-w-0），确定性高。放弃的方案：沉淀资产每组独立 max-h（行高不齐对不齐）——改统一 h-64 换取网格对齐；平台同步保留常驻但折叠——用户明确要求收进按钮，折叠态仍占一行。
