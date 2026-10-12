---
author: flow-machine-draft
created_at: 2026-10-12T01:40:14.963Z
---
# 决策记录（Decisions）— 2026-10-12-borrow-ctx-truncate-rest

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 风险：换行/反引号等合法路径字符经 500 截断后仍可能在正文内换行呈现——截断只限长不限形（与 408bc0889 同款边界），收尾免责行+写守卫 enforcement（D-003 红线：写隔离唯一权威是 SessionManager 写守卫）兜底；彻底转义会破坏合法路径显示（POSIX 允许换行/反引号），得不偿失。 - 放弃方案 A：对字段值做 markdown 转义/去反引号——破坏合法路径与名称显示，且转义规则本身成为新注入面；截断+免责行是既有单一范式。 - 放弃方案 B：把 type/default_branch 一并截断——两字段为 backend 受约束枚举/短标识，无自由文本注入面，纳入只会稀释「自由文本长字段」防线的语义。
