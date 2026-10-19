---
author: flow-machine-draft
created_at: 2026-10-19T03:31:01.431Z
---
# 决策记录（Decisions）— 2026-10-19-change-list-created-sort

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：风险：默认排序变化改变用户既有习惯（最近活动 → 创建时间）——正是用户主动要求， 非回归。created_at 与 updated_at 在 reparse 回填 mtime 时的差异：created_at 是 建行时刻（CLI 创建顺序），语义即用户诉求。放弃方案：改后端缺省值——会波及全部 不传 sort 的调用方（change-autolink 等），契约面无谓扩大。
