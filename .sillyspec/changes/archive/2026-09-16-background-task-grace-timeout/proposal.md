---
author: qinyi
created_at: 2026-09-15 23:45:36
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
2026-09-16 24h 风险审查发现 hasBackgroundTaskGrace 无时间上限（泄漏条目使写通道放行直至会话终态），超出 stale-flip 60min 有界先例；前作 R-01 已接受该风险但未记录暴露差与重估条件，未来重议无锚。

## 关键问题
- 暴露差事实（有界 vs 无界）只存在于本次审查会话，未落任何文档，会随会话结束丢失。
- 任何封顶修复方案都有误杀真后台任务、重演 94.5min 权限锁死事故的回归风险，草率修复比不修更危险。
- 未来线上若出现注册表泄漏实证，缺少首选修复方案（双窗兜底）与阈值依据的存档。

## 变更范围
仅文档动作：known-issues.md 新增 1 条观察项（四要素：暴露差/缓解链/重估触发/未来修复首选）+ 本变更四件套存档否定决策（用户裁决：不改代码）。

## 不在范围内（显式清单）
- 不改 sillyhub-daemon 任何源码（守卫/注册表/锚点行为零变化）
- 不实现任何宽限封顶方案（双窗兜底/绝对上限/静默失活）
- 不改 interactive.md 等模块文档

## 成功标准（可验证）
- known-issues.md 含该观察项且四要素齐全（grep 可检索 hasBackgroundTaskGrace/STALE_RUN_WRITE_GRACE_MS）
- 本变更 decisions.md 含 D-001@v1（否定决策与用户裁决证据）
- sillyhub-daemon 源码零 diff（git status 核对）
