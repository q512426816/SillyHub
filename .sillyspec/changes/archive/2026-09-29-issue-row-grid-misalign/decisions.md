---
author: flow-machine-draft
created_at: 2026-09-29T01:15:17.872Z
---
# 决策记录（Decisions）— 2026-09-29-issue-row-grid-misalign

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：占位 div 占据首轨 auto 宽度——空 div 无内容宽≈0，轨道宽 0，视觉零位移；对带 leading 调用零影响。放弃方案：改 ISSUE_ROW_GRID 为三轨模板/条件模板——两套模板分叉后 header/row 对齐约束翻倍，占位是同文件既有先例的最小修复。 另注：三断点①②按会话自主模式跳过等待（用户已给 DOM 级证据、根因有 Playwright 复现锚定、改动一行），③归档结果照常汇报。
