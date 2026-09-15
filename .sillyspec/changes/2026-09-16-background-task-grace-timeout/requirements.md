---
author: qinyi
created_at: 2026-09-15 23:45:36
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 风险复审者 | 未来重议该风险或线上异常归因时检索 known-issues 观察项的读者 |

## 功能需求

### FR-01: known-issues 观察项登记
Given hasBackgroundTaskGrace 无界宽限风险已被 R-01 接受但暴露差未文档化
When 本变更收尾（quick --linked-changes 落盘）
Then .sillyspec/knowledge/known-issues.md 新增观察项，含四要素：暴露差（stale-flip 60min 有界 vs bg-task 无界）、缓解链（写策略+人审+inject 切轮+终态兜底+重启 fail-closed）、重估触发（线上泄漏实证/policy_audit 误放行线索）、未来修复首选（双窗兜底：静默<60min 且总时长<4h）

## 非功能需求
- 兼容性：零源码改动，守卫/注册表/backend 受理行为与 3a389d08d 落地现状完全一致

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 否定决策（不改代码）催生的唯一可交付物即观察项登记 |
