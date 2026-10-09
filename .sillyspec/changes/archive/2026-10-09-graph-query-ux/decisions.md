---
author: flow-machine-draft
created_at: 2026-10-09T01:10:58.507Z
---
# 决策记录（Decisions）— 2026-10-09-graph-query-ux

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：自动切 tab 抢走结果面焦点（实测即翻车——path 预置用例被详情 tab 抢走 reason 文案）。已收口为仅 neighbors 切详情。放弃的方案：①所有带锚点 sub 都切详情——否，impact 闭包/path 推理链的价值在结果面；②antd Select 弹层内做富 tooltip——否，原生 title 在弹层滚动环境不稳，动态说明行同信息更可靠。
